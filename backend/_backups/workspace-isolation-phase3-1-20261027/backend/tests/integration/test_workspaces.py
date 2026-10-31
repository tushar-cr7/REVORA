"""
Phase 3.0: workspaces and database-enforced demo isolation.

The rule under test: synthetic demo data is never generated inside a merchant workspace, and a workspace
is never created implicitly. It is checked at three layers, each on its own:
  * the database (raw SQL against migration 0003 — a pass means PostgreSQL said no),
  * both repositories (the same contract, via `any_repo`),
  * the scan service and the HTTP route.

None of this is authentication or tenant isolation; reads are not scoped by workspace yet.
"""
import uuid
from contextlib import contextmanager
from dataclasses import replace

import psycopg2
import psycopg2.errors as pgerr
import pytest
from fastapi.testclient import TestClient

from backend.app.api import routes
from backend.app.db import migrate
from backend.app.domain.models import ScanRun, utc_now_iso
from backend.app.domain.workspaces import (
    DEMO_WORKSPACE_ID,
    InvalidWorkspace,
    SyntheticDataNotAllowed,
    UnknownWorkspace,
    Workspace,
    WorkspaceAlreadyExists,
    new_workspace,
)
from backend.app.main import app
from backend.app.services.audit_service import AuditService
from backend.app.services.recovery_service import RecoveryService
from backend.tests.events_support import Pipeline
from backend.tests.support import FixedProbModel

client = TestClient(app)


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


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


@contextmanager
def refused_by(error_class, constraint=None):
    with pytest.raises(error_class) as err:
        yield
    if constraint is not None:
        assert err.value.diag.constraint_name == constraint, (
            f"refused by {err.value.diag.constraint_name!r}, expected {constraint!r}: {err.value}"
        )


def insert_workspace(raw, workspace_id, kind="merchant", execution_mode=None, origin="explicit"):
    mode = execution_mode or ("simulation" if kind == "demo" else "recommend_only")
    raw("""INSERT INTO workspaces (workspace_id, kind, display_name, base_currency, timezone, execution_mode, origin,
                                   created_at) VALUES (%s, %s, %s, 'INR', 'UTC', %s, %s, now())""",
        (workspace_id, kind, f"ws {workspace_id}", mode, origin))


def insert_run(raw, run_id, merchant_id, kind="synthetic_scan", status="superseded", **extra):
    columns = {"run_id": run_id, "merchant_id": merchant_id, "source_fingerprint": f"fp_{run_id}", "n_total": 1,
               "seed": 1, "status": status, "kind": kind, **extra}
    names = ", ".join(columns)
    raw(f"INSERT INTO scan_runs ({names}, created_at, last_scanned_at) "
        f"VALUES ({', '.join(['%s'] * len(columns))}, now(), now())", list(columns.values()))


def service_on(repo) -> RecoveryService:
    service = RecoveryService(repo=repo, audit_service=AuditService(repo=repo))
    service.model = FixedProbModel(0.9)
    return service


# ── migration ────────────────────────────────────────────────────────────
def test_a_fresh_schema_migrates_to_head_with_only_the_seeded_demo_workspace(pg_dsn, pg_schema, raw):
    assert migrate.upgrade(pg_dsn, pg_schema) == [1, 2, 3]
    assert raw("SELECT name FROM schema_migrations WHERE version = 3") == [("workspaces",)]
    assert raw("SELECT workspace_id, kind, execution_mode, origin, base_currency FROM workspaces") == [
        (DEMO_WORKSPACE_ID, "demo", "simulation", "demo_seed", "INR")
    ]
    columns = {r[0] for r in raw("SELECT column_name FROM information_schema.columns "
                                 "WHERE table_schema = current_schema() AND table_name = 'scan_runs'")}
    assert "workspace_kind" in columns


# Every table that carries a workspace (merchant) id, each with its OWN id so a missed table shows up.
_V2_ROWS = [
    """INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at, status)
       VALUES ('run_a', 'merch_001', 'fp_a', 1, 1, now(), now(), 'active')""",
    """INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at, status, kind)
       VALUES ('run_i', 'w_ingest_run', 'ingest:w_ingest_run', 0, 0, now(), now(), 'standby', 'ingestion')""",
    """INSERT INTO transactions (run_id, transaction_id, ordinal, leak_id, merchant_id, customer_id, amount, leak_type,
                                 event_time) VALUES ('run_a', 'tx_1', 0, 'fp_1', 'w_transaction', 'c', 100.50, 'failed_payment', 'x')""",
    """INSERT INTO recovery_cases (case_id, run_id, ordinal, merchant_id, transaction_id, leak_id, customer_id, leak_type,
                                   amount, state, created_at, updated_at)
       VALUES ('case_1', 'run_a', 0, 'w_case', 'tx_1', 'fp_1', 'c', 'failed_payment', 100.50, 'open', now(), now())""",
    """INSERT INTO decisions (decision_id, run_id, case_id, leak_id, transaction_id, candidates_evaluated, ai_proposed_action,
                              ai_proposed_ev, ai_proposed_probability, policy_allowed, policy_reason, final_action, created_at)
       VALUES ('dec_1', 'run_a', 'case_1', 'fp_1', 'tx_1', '[]', 'retry', 1, 0.5, TRUE, 'ok', 'retry', now())""",
    """INSERT INTO execution_attempts (attempt_id, case_id, run_id, merchant_id, transaction_id, customer_id, sequence,
                                       attempt_number, requested_action, final_action, decision_id, authorization_snapshot,
                                       status, request_fingerprint, provider, execution_mode, created_at)
       VALUES ('att_1', 'case_1', 'run_a', 'w_attempt', 'tx_1', 'c', 1, 1, 'retry', 'retry', 'dec_1', '{}', 'failed',
               'rfp', 'p', 'simulation', now())""",
    """INSERT INTO interventions (intervention_id, decision_id, leak_id, transaction_id, customer_id, merchant_id, amount,
                                  ai_proposed_action, policy_allowed, policy_reason, final_action, provider, status,
                                  recovered, recovered_amount, occurred_at, run_id, case_id, attempt_id)
       VALUES ('itv_1', 'dec_1', 'fp_1', 'tx_1', 'c', 'w_intervention', 100.50, 'retry', TRUE, 'ok', 'retry', 'p',
               'attempted_no_recovery', FALSE, 0, now(), 'run_a', 'case_1', 'att_1')""",
    """INSERT INTO idempotency_records (merchant_id, operation, key, request_fingerprint, case_id, attempt_id, status, created_at)
       VALUES ('w_idempotency', 'execute_intervention', 'k1', 'rfp', 'case_1', 'att_1', 'in_progress', now())""",
    """INSERT INTO audit_events (event_id, merchant_id, transaction_id, leak_id, occurred_at, event_type, action,
                                 policy_result, policy_version, model_version, provider)
       VALUES ('ae_1', 'w_audit', 'tx_1', 'fp_1', now(), 'X', 'none', '{}', '1', '1', 'p'),
              ('ae_2', 'w_case', 'tx_1', 'fp_1', now(), 'X', 'none', '{}', '1', '1', 'p'),
              ('ae_3', '', 'tx_1', 'fp_1', now(), 'X', 'none', '{}', '1', '1', 'p')""",
    """INSERT INTO source_events (event_id, merchant_id, source, source_event_id, event_type, reference_kind, reference_id,
                                  payload, content_fingerprint, occurred_at, received_at)
       VALUES ('sev_1', 'w_source_event', 'internal', 'e1', 'payment.attempt_failed', 'payment', 'o1', '{}', 'f', now(), now())""",
    """INSERT INTO revenue_obligations (obligation_id, merchant_id, reference_kind, reference_id, leak_type, created_at)
       VALUES ('obl_1', 'w_obligation', 'payment', 'o1', 'failed_payment', now())""",
]
_V2_TABLES = ("scan_runs", "transactions", "recovery_cases", "decisions", "execution_attempts", "interventions",
              "idempotency_records", "audit_events", "source_events", "revenue_obligations")


def test_a_database_at_0002_upgrades_and_every_existing_workspace_id_is_backfilled_as_demo(pg_dsn, pg_schema, raw):
    assert migrate.upgrade(pg_dsn, pg_schema, target=2) == [1, 2]
    for statement in _V2_ROWS:
        raw(statement)
    counts_before = {t: raw(f"SELECT count(*) FROM {t}")[0][0] for t in _V2_TABLES}

    assert migrate.upgrade(pg_dsn, pg_schema) == [3]

    # Nothing was lost or rewritten.
    assert {t: raw(f"SELECT count(*) FROM {t}")[0][0] for t in _V2_TABLES} == counts_before
    assert raw("SELECT amount FROM transactions")[0][0] == pytest.approx(100.50)

    rows = raw("SELECT workspace_id, kind, execution_mode, origin, base_currency, timezone FROM workspaces")
    found = {r[0]: r[1:] for r in rows}
    expected_ids = {"merch_001", "w_ingest_run", "w_transaction", "w_case", "w_attempt", "w_intervention",
                    "w_idempotency", "w_audit", "", "w_source_event", "w_obligation"}
    assert set(found) == expected_ids and len(rows) == len(expected_ids)       # one row per id, none missed
    # No pre-existing id is assumed to be a real merchant: all are demo, all say they were backfilled. merch_001
    # had data, so it is a backfilled workspace, not the seed.
    assert set(found.values()) == {("demo", "simulation", "pre_phase3_backfill", "INR", "UTC")}
    # Every run now names its workspace's kind.
    assert raw("SELECT run_id, workspace_kind FROM scan_runs ORDER BY run_id") == [("run_a", "demo"), ("run_i", "demo")]
    assert migrate.status(pg_dsn, pg_schema) == {"head": 3, "current": 3, "pending": [], "applied": [1, 2, 3]}


def test_the_demo_seed_is_added_when_an_upgraded_database_never_used_it(pg_dsn, pg_schema, raw):
    migrate.upgrade(pg_dsn, pg_schema, target=2)
    raw("""INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at, last_scanned_at, status)
           VALUES ('run_x', 'other_demo', 'fp_x', 1, 1, now(), now(), 'active')""")
    assert migrate.upgrade(pg_dsn, pg_schema) == [3]
    assert raw("SELECT workspace_id, origin FROM workspaces ORDER BY workspace_id") == [
        ("merch_001", "demo_seed"), ("other_demo", "pre_phase3_backfill")
    ]


# ── database constraints ─────────────────────────────────────────────────
@pytest.fixture
def head(pg_dsn, pg_schema, raw):
    migrate.upgrade(pg_dsn, pg_schema)
    insert_workspace(raw, "acme", kind="merchant")
    return raw


def test_the_database_refuses_a_synthetic_run_in_a_merchant_or_unknown_workspace(head):
    with refused_by(pgerr.CheckViolation, "scan_runs_synthetic_only_in_demo"):
        insert_run(head, "run_m", "acme")
    # Claiming the demo kind does not help: the database derives it from the workspace registry.
    with refused_by(pgerr.CheckViolation, "scan_runs_synthetic_only_in_demo"):
        insert_run(head, "run_m2", "acme", workspace_kind="demo")
    with refused_by(pgerr.CheckViolation, "scan_runs_synthetic_has_workspace"):
        insert_run(head, "run_u", "never_registered")
    # Moving an existing demo run into a merchant workspace is refused the same way.
    insert_run(head, "run_ok", DEMO_WORKSPACE_ID)
    assert head("SELECT workspace_kind FROM scan_runs WHERE run_id = 'run_ok'") == [("demo",)]
    with refused_by(pgerr.CheckViolation, "scan_runs_synthetic_only_in_demo"):
        head("UPDATE scan_runs SET merchant_id = 'acme' WHERE run_id = 'run_ok'")
    assert head("SELECT count(*) FROM scan_runs")[0][0] == 1


def test_the_foreign_key_backs_the_derivation_trigger(head):
    # With the derivation trigger out of the way, a run that misstates its workspace's kind is still refused.
    head("ALTER TABLE scan_runs DISABLE TRIGGER scan_runs_workspace_kind")
    with refused_by(pgerr.ForeignKeyViolation, "scan_runs_workspace_fk"):
        insert_run(head, "run_lie", "acme", workspace_kind="demo")


def test_ingestion_runs_keep_their_phase_2_behaviour(head):
    insert_run(head, "run_ing_m", "acme", kind="ingestion", status="standby", source_fingerprint="ingest:acme")
    insert_run(head, "run_ing_u", "unregistered_claim", kind="ingestion", status="standby",
               source_fingerprint="ingest:unregistered_claim")
    assert head("SELECT run_id, workspace_kind FROM scan_runs ORDER BY run_id") == [
        ("run_ing_m", "merchant"), ("run_ing_u", None)   # an unregistered claim stays unregistered: no workspace invented
    ]


def test_a_workspace_kind_and_identity_cannot_change_and_a_workspace_cannot_be_deleted(head):
    for statement in (
        f"UPDATE workspaces SET kind = 'merchant', execution_mode = 'recommend_only' WHERE workspace_id = '{DEMO_WORKSPACE_ID}'",
        "UPDATE workspaces SET kind = 'demo', execution_mode = 'simulation' WHERE workspace_id = 'acme'",   # unreferenced
        "UPDATE workspaces SET workspace_id = 'acme2' WHERE workspace_id = 'acme'",
        "UPDATE workspaces SET origin = 'demo_seed' WHERE workspace_id = 'acme'",
        "UPDATE workspaces SET created_at = now() - interval '1 day' WHERE workspace_id = 'acme'",
        "DELETE FROM workspaces WHERE workspace_id = 'acme'",
    ):
        with refused_by(pgerr.IntegrityConstraintViolation):
            head(statement)
    assert head("SELECT workspace_id, kind FROM workspaces ORDER BY workspace_id") == [
        ("acme", "merchant"), (DEMO_WORKSPACE_ID, "demo")
    ]
    head("UPDATE workspaces SET display_name = 'Acme Retail', timezone = 'Asia/Kolkata' WHERE workspace_id = 'acme'")
    assert head("SELECT display_name, timezone FROM workspaces WHERE workspace_id = 'acme'") == [("Acme Retail", "Asia/Kolkata")]


def test_a_merchant_workspace_can_never_use_simulated_execution(head):
    with refused_by(pgerr.CheckViolation, "workspaces_merchant_never_simulates"):
        insert_workspace(head, "acme_sim", kind="merchant", execution_mode="simulation")
    with refused_by(pgerr.CheckViolation, "workspaces_merchant_never_simulates"):
        head("UPDATE workspaces SET execution_mode = 'simulation' WHERE workspace_id = 'acme'")
    insert_workspace(head, "demo_cautious", kind="demo", execution_mode="recommend_only")   # a demo may be stricter


def test_the_workspace_vocabularies_are_enforced_by_the_database(head):
    with refused_by(pgerr.CheckViolation, "workspaces_kind_check"):
        insert_workspace(head, "w1", kind="sandbox", execution_mode="recommend_only")
    with refused_by(pgerr.CheckViolation, "workspaces_execution_mode_check"):
        insert_workspace(head, "w2", kind="demo", execution_mode="live")
    with refused_by(pgerr.CheckViolation, "workspaces_origin_check"):
        insert_workspace(head, "w3", origin="imported")
    with refused_by(pgerr.CheckViolation, "workspaces_id_shape"):
        insert_workspace(head, "")
    with refused_by(pgerr.CheckViolation, "workspaces_id_shape"):
        insert_workspace(head, "x" * 129)
    with refused_by(pgerr.UniqueViolation, "workspaces_pkey"):
        insert_workspace(head, "acme")


# ── repository contract (in-memory and PostgreSQL) ───────────────────────
def test_a_new_repository_starts_with_the_demo_workspace_only(any_repo):
    workspaces = any_repo.list_workspaces()
    assert [(w.workspace_id, w.kind, w.execution_mode, w.origin) for w in workspaces] == [
        (DEMO_WORKSPACE_ID, "demo", "simulation", "demo_seed")
    ]
    assert any_repo.get_workspace(DEMO_WORKSPACE_ID).is_demo
    assert any_repo.get_workspace("nope") is None


def test_workspaces_are_created_only_explicitly_and_only_once(any_repo):
    created = any_repo.create_workspace(new_workspace("acme", "merchant", "Acme Retail", timezone="Asia/Kolkata"))
    assert (created.kind, created.execution_mode, created.origin) == ("merchant", "recommend_only", "explicit")
    assert any_repo.get_workspace("acme").to_dict() == created.to_dict()
    assert [w.workspace_id for w in any_repo.list_workspaces()] == [DEMO_WORKSPACE_ID, "acme"]
    with pytest.raises(WorkspaceAlreadyExists):
        any_repo.create_workspace(new_workspace("acme", "demo", "Acme again"))
    assert any_repo.get_workspace("acme").kind == "merchant"                    # the refusal changed nothing


def test_the_repository_refuses_invalid_workspaces_before_storing_them(any_repo):
    merchant_simulating = Workspace("acme", "merchant", "Acme", "INR", "UTC", "simulation")
    with pytest.raises(InvalidWorkspace, match="cannot use simulated execution"):
        any_repo.create_workspace(merchant_simulating)
    forged_origin = replace(new_workspace("acme", "demo", "Acme"), origin="pre_phase3_backfill")
    with pytest.raises(InvalidWorkspace, match="explicit"):
        any_repo.create_workspace(forged_origin)
    for bad in (dict(workspace_id=""), dict(base_currency="inr"), dict(display_name=" "), dict(kind="sandbox")):
        with pytest.raises(InvalidWorkspace):
            any_repo.create_workspace(replace(new_workspace("acme", "demo", "Acme"), **bad))
    assert [w.workspace_id for w in any_repo.list_workspaces()] == [DEMO_WORKSPACE_ID]


def test_a_returned_workspace_is_a_copy(any_repo):
    any_repo.get_workspace(DEMO_WORKSPACE_ID).kind = "merchant"
    assert any_repo.get_workspace(DEMO_WORKSPACE_ID).kind == "demo"


def _scan_run(merchant_id: str) -> ScanRun:
    now = utc_now_iso()
    return ScanRun(run_id=uid("run"), merchant_id=merchant_id, source_fingerprint=uid("fp"), n_total=0, seed=0,
                   created_at=now, last_scanned_at=now)


def test_the_repository_registers_synthetic_runs_only_in_a_demo_workspace(any_repo):
    any_repo.create_workspace(new_workspace("acme", "merchant", "Acme Retail"))
    with pytest.raises(SyntheticDataNotAllowed):
        any_repo.register_scan_run(_scan_run("acme"), [], [])
    with pytest.raises(UnknownWorkspace):
        any_repo.register_scan_run(_scan_run("never_registered"), [], [])
    assert any_repo.list_runs() == [] and any_repo.get_active_run() is None    # refusals left nothing behind
    run, created = any_repo.register_scan_run(_scan_run(DEMO_WORKSPACE_ID), [], [])
    assert created and any_repo.get_active_run().run_id == run.run_id


def test_clear_keeps_the_workspace_registry(any_repo):
    any_repo.create_workspace(new_workspace("acme", "merchant", "Acme Retail"))
    any_repo.clear()
    assert [w.workspace_id for w in any_repo.list_workspaces()] == [DEMO_WORKSPACE_ID, "acme"]


def test_events_for_a_registered_merchant_workspace_still_open_inert_cases(any_repo):
    any_repo.create_workspace(new_workspace("acme", "merchant", "Acme Retail"))
    pipe = Pipeline(any_repo)
    result = pipe.ingest("e1", merchant="acme", ref="ord_9")
    assert result.detection.outcome.value == "case_opened"
    run = any_repo.get_run(pipe.obligation(merchant="acme", ref="ord_9").run_id)
    assert (run.kind, run.status) == ("ingestion", "standby")                  # still never active, never executable


# ── scan service ─────────────────────────────────────────────────────────
def test_the_scan_service_refuses_unknown_and_merchant_workspaces_and_generates_nothing(any_repo, monkeypatch):
    import backend.app.services.recovery_service as rs

    def must_not_generate(*args, **kwargs):
        raise AssertionError("synthetic data was generated for a refused workspace")

    any_repo.create_workspace(new_workspace("acme", "merchant", "Acme Retail"))
    service = service_on(any_repo)
    monkeypatch.setattr(rs, "generate_dataset", must_not_generate)
    with pytest.raises(UnknownWorkspace):
        service.scan_revenue(n_total=10, seed=1, merchant_id="ghost")
    with pytest.raises(SyntheticDataNotAllowed):
        service.scan_revenue(n_total=10, seed=1, merchant_id="acme")
    assert any_repo.list_runs() == [] and any_repo.get_workspace("ghost") is None   # nothing was auto-created


def test_the_scan_service_still_scans_demo_workspaces(any_repo):
    any_repo.create_workspace(new_workspace("demo_two", "demo", "Second demo"))
    service = service_on(any_repo)
    first = service.scan_revenue(n_total=20, seed=3)                          # the default: the seeded demo workspace
    assert first["total_transactions_scanned"] == 20 and not first["reused_existing_run"]
    assert any_repo.get_run(first["run_id"]).merchant_id == DEMO_WORKSPACE_ID
    second = service.scan_revenue(n_total=20, seed=3, merchant_id="demo_two")
    assert any_repo.get_run(second["run_id"]).merchant_id == "demo_two"
    again = service.scan_revenue(n_total=20, seed=3)
    assert again["reused_existing_run"] and again["run_id"] == first["run_id"]


# ── HTTP ─────────────────────────────────────────────────────────────────
def test_the_scan_endpoint_answers_workspace_refusals_with_typed_errors():
    unknown = uid("ghost")
    resp = client.post("/api/scan", json={"n_total": 10, "seed": 1, "merchant_id": unknown})
    assert resp.status_code == 422
    assert resp.json() == {"detail": resp.json()["detail"], "code": "unknown_workspace", "workspace_id": unknown}
    assert isinstance(resp.json()["detail"], str) and routes.repo.get_workspace(unknown) is None

    merchant = uid("acme")
    routes.repo.create_workspace(new_workspace(merchant, "merchant", "Acme Retail"))
    active_before = routes.repo.get_active_run()
    resp = client.post("/api/scan", json={"n_total": 10, "seed": 1, "merchant_id": merchant})
    assert resp.status_code == 409 and resp.json()["code"] == "synthetic_data_not_allowed"
    assert isinstance(resp.json()["detail"], str) and resp.json()["workspace_id"] == merchant
    after = routes.repo.get_active_run()
    assert (after.run_id if after else None) == (active_before.run_id if active_before else None)


def test_the_scan_endpoint_still_scans_the_default_demo_workspace():
    resp = client.post("/api/scan", json={"n_total": 50, "seed": 42})
    assert resp.status_code == 200 and resp.json()["total_transactions_scanned"] == 50
