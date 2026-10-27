"""
The PostgreSQL schema: migrations, and the constraints that make the database itself refuse
duplicate effects, orphaned history and impossible states — independent of any application code.

Every violation below is attempted with raw SQL, so a pass means the DATABASE said no, not that
the application happened to be careful.
"""
import threading
from contextlib import contextmanager

import psycopg2
import psycopg2.errors as pgerr
import pytest

from backend.app.db import migrate
from backend.app.repositories.errors import SchemaNotReady
from backend.app.repositories.postgres import PostgresRepository
from backend.tests.support import FakeClock, ScriptedProvider, build_service, make_tx

TX1, TX2 = "tx_fp_000001", "tx_fp_000002"


# ── migrations ───────────────────────────────────────────────────────────
@pytest.fixture
def raw(pg_dsn, pg_schema):
    conn = psycopg2.connect(pg_dsn, options=f"-c search_path={pg_schema}")
    conn.autocommit = True

    def run(sql, params=None):
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else cur.rowcount

    yield run
    conn.close()


def test_migrations_apply_in_order_and_are_recorded(pg_dsn, pg_schema, raw):
    assert migrate.upgrade(pg_dsn, pg_schema) == [1, 2]
    rows = raw("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    assert [(v, n) for v, n, _ in rows] == [(1, "core_recovery_schema"), (2, "event_ingestion")]
    assert all(len(c) == 64 for _, _, c in rows)
    tables = {r[0] for r in raw("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")}
    assert {"scan_runs", "transactions", "recovery_cases", "decisions", "execution_attempts", "interventions",
            "idempotency_records", "audit_events", "source_events", "source_event_raw", "revenue_obligations",
            "schema_migrations"} <= tables


def test_upgrading_again_is_a_no_op(pg_dsn, pg_schema):
    migrate.upgrade(pg_dsn, pg_schema)
    assert migrate.upgrade(pg_dsn, pg_schema) == []
    assert migrate.status(pg_dsn, pg_schema) == {"head": 2, "current": 2, "pending": [], "applied": [1, 2]}


def test_a_database_at_an_older_version_upgrades_without_losing_rows(pg_dsn, pg_schema, raw):
    assert migrate.upgrade(pg_dsn, pg_schema, target=1) == [1]
    assert migrate.status(pg_dsn, pg_schema)["pending"] == [2]
    raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at,
                                  status) VALUES ('run_old', 'm', 'fp_old', 1, 7, now(), now(), 'active')""")
    raw("""INSERT INTO transactions (run_id, transaction_id, ordinal, leak_id, merchant_id, customer_id, amount, leak_type,
                                     event_time) VALUES ('run_old', 'tx_1', 0, 'fp_1', 'm', 'c', 100.50, 'failed_payment', 'x')""")
    assert migrate.upgrade(pg_dsn, pg_schema) == [2]
    assert raw("SELECT run_id, kind, status FROM scan_runs") == [("run_old", "synthetic_scan", "active")]
    assert raw("SELECT amount FROM transactions")[0][0] == pytest.approx(100.50)


def test_a_modified_migration_file_is_detected(pg_dsn, pg_schema, raw):
    migrate.upgrade(pg_dsn, pg_schema)
    raw("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = 1")
    with pytest.raises(migrate.MigrationError, match="changed after it was applied"):
        migrate.upgrade(pg_dsn, pg_schema)
    with pytest.raises(SchemaNotReady, match="modified after it was applied"):
        PostgresRepository.connect(pg_dsn, schema=pg_schema)


def test_starting_against_the_wrong_schema_version_is_a_clear_error(pg_dsn, pg_schema, raw):
    with pytest.raises(SchemaNotReady, match="no REVORA schema"):
        PostgresRepository.connect(pg_dsn, schema=pg_schema)           # never migrated
    migrate.upgrade(pg_dsn, pg_schema, target=1)
    with pytest.raises(SchemaNotReady, match="at version 1 but this code needs 2"):
        PostgresRepository.connect(pg_dsn, schema=pg_schema)           # behind
    migrate.upgrade(pg_dsn, pg_schema)
    raw("INSERT INTO schema_migrations (version, name, checksum) VALUES (99, 'future', 'x')")
    with pytest.raises(SchemaNotReady, match="ahead of this code"):
        PostgresRepository.connect(pg_dsn, schema=pg_schema)           # ahead
    with pytest.raises(migrate.MigrationError, match="does not know"):
        migrate.upgrade(pg_dsn, pg_schema)


def test_auto_migrate_brings_an_empty_database_to_the_current_version(pg_dsn, pg_schema):
    repository = PostgresRepository.connect(pg_dsn, schema=pg_schema, auto_migrate=True)
    try:
        assert repository.describe()["schema_version"] == 2 == repository.describe()["schema_head"]
    finally:
        repository.close()


def test_a_failing_migration_rolls_back_completely(pg_dsn, pg_schema, tmp_path, monkeypatch, raw):
    (tmp_path / "0001_ok.sql").write_text("CREATE TABLE t_ok (id int);")
    (tmp_path / "0002_bad.sql").write_text("CREATE TABLE t_half (id int); SELECT 1/0;")
    real_loader = migrate.load_migrations
    monkeypatch.setattr(migrate, "load_migrations", lambda directory=tmp_path: real_loader(tmp_path))
    with pytest.raises(migrate.MigrationError, match="0002_bad.sql failed and was rolled back"):
        migrate.upgrade(pg_dsn, pg_schema)
    tables = {r[0] for r in raw("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")}
    assert "t_ok" in tables and "t_half" not in tables             # the failed file left nothing behind
    assert [v for (v,) in raw("SELECT version FROM schema_migrations")] == [1]


def test_concurrent_migrators_apply_each_migration_exactly_once(pg_dsn, pg_schema, raw):
    results, errors = [], []
    barrier = threading.Barrier(4)

    def worker():
        barrier.wait()
        try:
            results.append(migrate.upgrade(pg_dsn, pg_schema))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert not errors, errors
    assert sorted(v for applied in results for v in applied) == [1, 2]       # no migration ran twice
    assert [v for (v,) in raw("SELECT version FROM schema_migrations ORDER BY version")] == [1, 2]


def test_crlf_checkouts_do_not_change_a_migrations_identity(tmp_path):
    (tmp_path / "0001_x.sql").write_bytes(b"CREATE TABLE a (id int);\r\n-- c\r\n")
    crlf = migrate.load_migrations(tmp_path)[0]
    (tmp_path / "0001_x.sql").write_bytes(b"CREATE TABLE a (id int);\n-- c\n")
    assert migrate.load_migrations(tmp_path)[0].checksum == crlf.checksum


def test_migration_files_must_be_contiguous_and_well_named(tmp_path):
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "0003_c.sql").write_text("SELECT 1;")
    with pytest.raises(migrate.MigrationError, match="contiguous"):
        migrate.load_migrations(tmp_path)
    (tmp_path / "0003_c.sql").unlink()
    (tmp_path / "notes.sql").write_text("SELECT 1;")
    with pytest.raises(migrate.MigrationError, match="NNNN_name.sql"):
        migrate.load_migrations(tmp_path)


# ── constraints ──────────────────────────────────────────────────────────
@contextmanager
def refused_by(error_class, constraint=None):
    """The statement must be refused by the database — and, when named, by THAT constraint."""
    with pytest.raises(error_class) as err:
        yield
    if constraint is not None:
        assert err.value.diag.constraint_name == constraint, (
            f"refused by {err.value.diag.constraint_name!r}, expected {constraint!r}: {err.value}"
        )


@pytest.fixture
def seeded(pg_repo, raw):
    """Two analysed cases; TX1 executed and recovered. Returns ids for raw-SQL violations."""
    service = build_service([make_tx(1, amount=1000.0), make_tx(2, amount=2000.0)],
                            provider=ScriptedProvider(["recovered"]), clock=FakeClock(), repo=pg_repo)
    service.execute_case(TX1, "seed-key")
    case1, case2 = pg_repo.get_case_for_transaction(TX1), pg_repo.get_case_for_transaction(TX2)
    attempt = pg_repo.list_attempts(case_id=case1.case_id)[0]
    return {
        "run": case1.run_id, "case1": case1.case_id, "case2": case2.case_id, "attempt1": attempt.attempt_id,
        "intervention1": attempt.intervention_id, "decision2": case2.decision_id,
    }


def clone(raw, table, key_column, row_key, **overrides):
    """Insert a copy of one row, overriding some columns (identity columns are generated, not copied)."""
    columns = [r[0] for r in raw(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name = %s AND is_identity = 'NO' ORDER BY ordinal_position", (table,))]
    select = ", ".join("%s" if c in overrides else c for c in columns)
    params = [overrides[c] for c in columns if c in overrides] + [row_key]
    return raw(f"INSERT INTO {table} ({', '.join(columns)}) SELECT {select} FROM {table} WHERE {key_column} = %s", params)


def test_foreign_keys_refuse_orphans(raw, seeded):
    with refused_by(pgerr.ForeignKeyViolation):   # a transaction of a run that does not exist
        raw("""INSERT INTO transactions (run_id, transaction_id, ordinal, leak_id, merchant_id, customer_id, amount,
                                         leak_type, event_time) VALUES ('run_nope', 't', 0, 'l', 'm', 'c', 1, 'failed_payment', 'x')""")
    with refused_by(pgerr.ForeignKeyViolation, "cases_transaction_fk"):   # a case for a transaction that does not exist
        clone(raw, "recovery_cases", "case_id", seeded["case2"], case_id="case_orphan", transaction_id="tx_missing", leak_id="l_missing")
    with refused_by(pgerr.ForeignKeyViolation):   # an attempt for a case that does not exist
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_orphan", case_id="case_missing",
              sequence=7, attempt_number=7, status="failed", recovered=False, recovered_amount=0, intervention_id=None)
    with refused_by(pgerr.ForeignKeyViolation):   # an intervention for an attempt that does not exist
        clone(raw, "interventions", "intervention_id", seeded["intervention1"], intervention_id="itv_orphan",
              attempt_id="att_missing", recovered=False, recovered_amount=0)
    with refused_by(pgerr.ForeignKeyViolation):   # an idempotency record pointing at nothing
        clone(raw, "idempotency_records", "key", "seed-key", key="k2", case_id="case_missing")
    with refused_by(pgerr.ForeignKeyViolation):   # an audit event for a case that does not exist
        raw("""INSERT INTO audit_events (event_id, merchant_id, transaction_id, leak_id, occurred_at, event_type, action,
                                        policy_result, policy_version, model_version, provider, case_id)
               VALUES ('evt_orphan', 'm', 't', 'l', now(), 'X', 'none', '{}', '1', '1', 'p', 'case_missing')""")
    with refused_by(pgerr.ForeignKeyViolation, "cases_decision_fk"):     # a case pointing at a decision that does not exist
        raw("UPDATE recovery_cases SET decision_id = 'dec_missing' WHERE case_id = %s", (seeded["case2"],))


def test_history_cannot_be_deleted_out_from_under_its_children(raw, seeded):
    for table, column, value in (
        ("scan_runs", "run_id", seeded["run"]),
        ("recovery_cases", "case_id", seeded["case1"]),
        ("execution_attempts", "attempt_id", seeded["attempt1"]),
        ("transactions", "transaction_id", TX1),
        ("decisions", "decision_id", seeded["decision2"]),
    ):
        with refused_by(pgerr.ForeignKeyViolation):
            raw(f"DELETE FROM {table} WHERE {column} = %s", (value,))


def test_only_one_run_can_be_active(raw, seeded):
    with refused_by(pgerr.UniqueViolation, "scan_runs_one_active"):
        raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at,
                                      status) VALUES ('run_second', 'm', 'fp_second', 1, 1, now(), now(), 'active')""")
    with refused_by(pgerr.UniqueViolation, "scan_runs_fingerprint_key"):   # the same source data is one run
        clone(raw, "scan_runs", "run_id", seeded["run"], run_id="run_dupe", status="superseded")


def test_a_transaction_has_one_case_per_run_and_one_record_per_id(raw, seeded):
    with refused_by(pgerr.UniqueViolation, "cases_one_per_transaction"):
        clone(raw, "recovery_cases", "case_id", seeded["case1"], case_id="case_second_for_tx1", leak_id="fp_other")
    with refused_by(pgerr.UniqueViolation, "cases_one_per_leak"):
        clone(raw, "recovery_cases", "case_id", seeded["case1"], case_id="case_second_for_leak", transaction_id="tx_other")
    with refused_by(pgerr.UniqueViolation, "transactions_pkey"):
        clone(raw, "transactions", "transaction_id", TX1, leak_id="fp_other")
    with refused_by(pgerr.UniqueViolation, "transactions_leak_unique"):
        clone(raw, "transactions", "transaction_id", TX1, transaction_id="tx_other")


def test_the_ledger_numbers_attempts_without_gaps_repeats_or_two_in_flight(raw, seeded):
    case2 = seeded["case2"]
    tx2 = dict(case_id=case2, transaction_id=TX2, customer_id="cust_00002", decision_id=seeded["decision2"],
               intervention_id=None, completed_at=None, outcome_status=None, recovered=False,
               recovered_amount=0, idempotency_key=None)
    failed = dict(status="failed", recovered=False, recovered_amount=0, intervention_id=None)
    with refused_by(pgerr.UniqueViolation, "attempts_case_sequence_key"):   # the same (case, sequence) twice
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_dupe_seq",
              attempt_number=2, **failed)
    with refused_by(pgerr.UniqueViolation, "attempts_number_key"):          # the same attempt number twice
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_dupe_num",
              sequence=2, **failed)
    clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_reserved_a",
          sequence=1, attempt_number=1, status="reserved", **tx2)
    with refused_by(pgerr.UniqueViolation, "attempts_one_in_flight_per_case"):   # two attempts in flight for one case
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_reserved_b",
              sequence=2, attempt_number=2, status="reserved", **tx2)


def test_a_case_cannot_be_recovered_twice_even_by_two_different_attempts(raw, seeded):
    with refused_by(pgerr.UniqueViolation, "attempts_one_recovery_per_case"):   # a second recovering attempt
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_second_recovery",
              sequence=2, attempt_number=2, intervention_id=None)
    # one intervention per attempt: a replay can never mint a second record for the same attempt
    with refused_by(pgerr.UniqueViolation, "interventions_one_per_attempt"):
        clone(raw, "interventions", "intervention_id", seeded["intervention1"], intervention_id="itv_dupe",
              recovered=False, recovered_amount=0)
    # ...and at most one recovered intervention per case, even if it hangs off a different attempt
    clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_for_itv", sequence=3,
          attempt_number=3, status="failed", recovered=False, recovered_amount=0, intervention_id=None)
    with refused_by(pgerr.UniqueViolation, "interventions_one_recovery_per_case"):
        clone(raw, "interventions", "intervention_id", seeded["intervention1"], intervention_id="itv_second_recovery",
              attempt_id="att_for_itv")


def test_an_idempotency_scope_exists_once(raw, seeded):
    with refused_by(pgerr.UniqueViolation, "idempotency_records_pkey"):
        clone(raw, "idempotency_records", "key", "seed-key")
    # the same key under another merchant or operation is a different scope
    clone(raw, "idempotency_records", "key", "seed-key", merchant_id="another_merchant")
    clone(raw, "idempotency_records", "key", "seed-key", operation="another_operation")


def test_case_rows_cannot_describe_impossible_states(raw, seeded):
    case2 = (seeded["case2"],)
    with refused_by(pgerr.CheckViolation, "cases_executing_has_attempt"):   # executing with nothing in flight
        raw("UPDATE recovery_cases SET state = 'executing', active_attempt_id = NULL WHERE case_id = %s", case2)
    with refused_by(pgerr.CheckViolation, "cases_recovered_has_attempt"):   # recovered with no recovering attempt
        raw("UPDATE recovery_cases SET state = 'recovered', recovered_attempt_id = NULL WHERE case_id = %s", case2)
    with refused_by(pgerr.CheckViolation, "cases_recovered_within_amount"):   # more recovered than was at risk
        raw("UPDATE recovery_cases SET recovered_amount = amount + 1 WHERE case_id = %s", (seeded["case1"],))
    with refused_by(pgerr.CheckViolation, "recovery_cases_state_check"):    # a state outside the machine
        raw("UPDATE recovery_cases SET state = 'refunded' WHERE case_id = %s", case2)
    with refused_by(pgerr.CheckViolation, "recovery_cases_authorized_action_check"):   # an action outside the vocabulary
        raw("UPDATE recovery_cases SET authorized_action = 'wire_transfer' WHERE case_id = %s", case2)


def test_attempt_and_intervention_rows_cannot_describe_impossible_outcomes(raw, seeded):
    with refused_by(pgerr.CheckViolation, "attempts_denied_shape"):   # a denied request that carries an attempt number
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_bad_denied", sequence=9,
              attempt_number=9, status="denied", final_action=None, recovered=False, recovered_amount=0, intervention_id=None)
    with refused_by(pgerr.CheckViolation, "attempts_recovered_only_when_completed"):   # recovered, yet not completed
        clone(raw, "execution_attempts", "attempt_id", seeded["attempt1"], attempt_id="att_bad_rec", sequence=9,
              attempt_number=9, status="failed", intervention_id=None)
    with refused_by(pgerr.CheckViolation, "interventions_recovered_amount_matches"):   # a "recovery" that recovered nothing
        raw("UPDATE interventions SET recovered_amount = 0 WHERE intervention_id = %s", (seeded["intervention1"],))
    with refused_by(pgerr.CheckViolation, "interventions_recovered_within_amount"):   # recovered more than the amount
        raw("UPDATE interventions SET recovered_amount = amount + 1 WHERE intervention_id = %s", (seeded["intervention1"],))


def test_the_closed_vocabularies_are_enforced_by_the_database(raw, seeded):
    with refused_by(pgerr.CheckViolation, "transactions_leak_type_check"):
        raw("UPDATE transactions SET leak_type = 'chargeback' WHERE transaction_id = %s", (TX1,))
    with refused_by(pgerr.CheckViolation, "decisions_final_action_check"):
        raw("UPDATE decisions SET final_action = 'refund' WHERE decision_id = %s", (seeded["decision2"],))
    with refused_by(pgerr.CheckViolation, "transactions_model_recovery_prob_check"):
        raw("UPDATE transactions SET model_recovery_prob = 1.5 WHERE transaction_id = %s", (TX1,))


def test_the_audit_log_cannot_be_edited_or_deleted_through_normal_statements(raw, seeded):
    assert raw("SELECT count(*) FROM audit_events")[0][0] >= 4
    with refused_by(pgerr.IntegrityConstraintViolation):
        raw("UPDATE audit_events SET action = 'tampered'")
    with refused_by(pgerr.IntegrityConstraintViolation):
        raw("DELETE FROM audit_events")
    # Honest limit, asserted so nobody mistakes this for tamper-evidence: the table's owner can remove the guard.
    raw("DROP TRIGGER audit_events_no_change ON audit_events")
    raw("UPDATE audit_events SET action = 'tampered' WHERE event_id = (SELECT event_id FROM audit_events LIMIT 1)")
    assert raw("SELECT count(*) FROM audit_events WHERE action = 'tampered'")[0][0] == 1


def test_event_tables_refuse_unsafe_rows(raw, pg_repo):
    base = dict(event_id="sev_1", merchant_id="m", source="internal", source_event_id="e1",
                event_type="payment.attempt_failed", reference_kind="payment", reference_id="o1")

    def insert(**over):
        cols = {**base, "payload": "{}", "content_fingerprint": "f", "occurred_at": "2026-10-20T10:00:00Z",
                "received_at": "2026-10-22T10:00:00Z", **over}
        raw(f"INSERT INTO source_events ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})", list(cols.values()))

    insert()
    with refused_by(pgerr.UniqueViolation, "source_events_identity_key"):   # the same source identity under another id
        insert(event_id="sev_2")
    with refused_by(pgerr.CheckViolation, "source_events_amount_has_currency"):
        insert(event_id="sev_3", source_event_id="e3", amount_minor=100)
    with refused_by(pgerr.CheckViolation, "source_events_amount_minor_check"):   # non-negative integer minor units
        insert(event_id="sev_4", source_event_id="e4", amount_minor=-5, currency="INR")
    with refused_by(pgerr.CheckViolation, "source_events_failed_has_reason"):    # a failed event must say why
        insert(event_id="sev_5", source_event_id="e5", processing_status="failed")
    with refused_by(pgerr.CheckViolation, "source_events_merchant_assertion_check"):   # a claim until authenticated
        insert(event_id="sev_6", source_event_id="e6", merchant_assertion="verified")
    with refused_by(pgerr.CheckViolation, "source_events_event_type_check"):     # a closed vocabulary
        insert(event_id="sev_7", source_event_id="e7", event_type="payment.exploded")
    with refused_by(pgerr.CheckViolation, "source_events_currency_check"):
        insert(event_id="sev_8", source_event_id="e8", amount_minor=1, currency="inr")


def test_the_ingestion_run_can_never_be_active_and_a_scan_can_never_be_standby(raw, pg_repo):
    with refused_by(pgerr.CheckViolation, "scan_runs_ingestion_is_standby"):
        raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at,
                                      status, kind) VALUES ('r', 'm', 'ingest:m', 0, 0, now(), now(), 'active', 'ingestion')""")
    with refused_by(pgerr.CheckViolation, "scan_runs_scan_is_not_standby"):
        raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at,
                                      status, kind) VALUES ('r', 'm', 'fp', 1, 0, now(), now(), 'standby', 'synthetic_scan')""")


def test_one_case_belongs_to_one_obligation_and_one_obligation_row_per_object(raw, pg_repo):
    from backend.tests.events_support import Pipeline

    pipe = Pipeline(pg_repo)
    pipe.ingest("e1", ref="o1")
    obligation = pipe.obligation(ref="o1")
    raw("""INSERT INTO revenue_obligations (obligation_id, merchant_id, reference_kind, reference_id, leak_type,
                                            created_at) VALUES ('obl_second', 'merch_a', 'payment', 'o2', 'failed_payment', now())""")
    with refused_by(pgerr.UniqueViolation, "obligations_one_case"):
        raw("UPDATE revenue_obligations SET case_id = %s, run_id = %s WHERE obligation_id = 'obl_second'",
            (obligation.case_id, obligation.run_id))
    with refused_by(pgerr.UniqueViolation, "obligations_reference_key"):
        raw("""INSERT INTO revenue_obligations (obligation_id, merchant_id, reference_kind, reference_id, leak_type,
                                                created_at) VALUES ('obl_dupe', 'merch_a', 'payment', 'o1', 'failed_payment', now())""")
