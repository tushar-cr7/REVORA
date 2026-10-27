"""
The repository contract. Tests taking `any_repo` run against BOTH the in-memory repository and
PostgreSQL, so the two cannot drift apart; the rest are PostgreSQL-only guarantees (transactions,
copies, money exactness, durability across re-instantiation).
"""
import threading
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest

from backend.app.domain.models import (
    AttemptStatus,
    AuditEvent,
    CaseState,
    IdempotencyRecord,
    RecoveryCase,
    ScanRun,
    new_id,
    utc_now_iso,
)
from backend.app.repositories.errors import DuplicateIdempotencyKey, MoneyPrecisionError, StaleWrite
from backend.app.repositories.postgres import PostgresRepository, to_money
from backend.tests.support import (
    FakeClock,
    ScriptedProvider,
    build_service,
    case_of,
    ledger,
    make_tx,
    register_run,
)

TX1, TX2, TX3 = "tx_fp_000001", "tx_fp_000002", "tx_fp_000003"


def service_on(repo, txs, **kw):
    return build_service(txs, repo=repo, provider=kw.pop("provider", ScriptedProvider(["recovered"])), **kw)


# ── runs ─────────────────────────────────────────────────────────────────
def test_the_newest_scan_is_active_and_the_previous_one_is_superseded_not_deleted(any_repo):
    s1 = service_on(any_repo, [make_tx(1)], seed=1)
    first = any_repo.get_active_run()
    s2 = build_service([make_tx(1, amount=999.0)], repo=any_repo, seed=2, analyze=False)
    second = any_repo.get_active_run()
    assert first.run_id != second.run_id
    previous = any_repo.get_run(first.run_id)
    assert previous.status == "superseded" and previous.superseded_at is not None
    assert [r.run_id for r in any_repo.list_runs()] == [first.run_id, second.run_id]   # history, in order
    assert any_repo.get_transaction_by_id(TX1, first.run_id).amount == 5000.0         # same id, different record
    assert any_repo.get_transaction_by_id(TX1, second.run_id).amount == 999.0
    assert any_repo.get_transaction_by_id(TX1).amount == 999.0                        # default = active run
    assert case_of(s1, TX1).case_id != any_repo.get_case_for_transaction(TX1, first.run_id).case_id


def test_an_identical_scan_reactivates_the_existing_run_with_its_state(any_repo):
    service = service_on(any_repo, [make_tx(1)], seed=5)
    run = any_repo.get_active_run()
    other = build_service([make_tx(1, amount=1.0)], repo=any_repo, seed=6, analyze=False)   # supersedes it
    assert any_repo.get_active_run().run_id != run.run_id
    again, created = any_repo.register_scan_run(
        ScanRun(run_id="run_new", merchant_id="merch_test", source_fingerprint=run.source_fingerprint, n_total=1, seed=5,
                created_at=utc_now_iso(), last_scanned_at=utc_now_iso()), [], [])
    assert not created and again.run_id == run.run_id and again.scan_count == 2
    assert any_repo.get_active_run().run_id == run.run_id and any_repo.get_run(run.run_id).status == "active"
    assert any_repo.get_case_for_transaction(TX1).decision_id is not None   # its analysis survived


def test_cases_are_created_with_their_run_and_cannot_belong_to_another(any_repo):
    service = service_on(any_repo, [make_tx(1)])
    run = any_repo.get_active_run()
    foreign = RecoveryCase(case_id="c_x", run_id="run_other", merchant_id="m", transaction_id="t", leak_id="l",
                           customer_id="c", leak_type="failed_payment", amount=1.0)
    with pytest.raises(ValueError):
        any_repo.register_scan_run(
            ScanRun(run_id="run_fresh", merchant_id="m", source_fingerprint="fp_fresh", n_total=1, seed=1,
                    created_at=utc_now_iso(), last_scanned_at=utc_now_iso()), [], [foreign])
    assert any_repo.get_active_run().run_id == run.run_id          # a refused registration changed nothing


def test_transactions_cases_and_decisions_read_back_in_run_order(any_repo):
    txs = [make_tx(n, amount=100.0 * n) for n in (3, 1, 2)]
    service = service_on(any_repo, txs)
    assert [t.transaction_id for t in any_repo.get_all_transactions()] == ["tx_fp_000003", "tx_fp_000001", "tx_fp_000002"]
    assert [c.transaction_id for c in any_repo.list_cases()] == ["tx_fp_000003", "tx_fp_000001", "tx_fp_000002"]
    assert [d.transaction_id for d in any_repo.get_all_decisions()] == ["tx_fp_000003", "tx_fp_000001", "tx_fp_000002"]
    assert any_repo.get_transaction_by_id("fp_000001").transaction_id == TX1       # a leak id resolves to its transaction
    assert any_repo.get_case_for_transaction("fp_000002").transaction_id == TX2
    decision = any_repo.get_decision(TX1)
    assert any_repo.get_decision(decision.decision_id).decision_id == decision.decision_id
    assert any_repo.get_decision("nope") is None and any_repo.get_case("nope") is None


def test_analysis_figures_and_policy_snapshots_are_persisted(any_repo):
    service = service_on(any_repo, [make_tx(1), make_tx(2, amount=60000.0)], prob=0.8)
    tx = any_repo.get_transaction_by_id(TX1)
    assert tx.model_recovery_prob == pytest.approx(0.8) and tx.contacts_today == 0
    decision = any_repo.get_decision(TX1)
    assert decision.policy_limits == service.policy.to_dict() and decision.policy_version == "1.0.0"
    assert decision.run_id == case_of(service, TX1).run_id and decision.case_id == case_of(service, TX1).case_id
    assert decision.candidates_evaluated and {"action", "probability", "expected_value"} <= set(decision.candidates_evaluated[0])


# ── ledger, idempotency, audit ───────────────────────────────────────────
def test_the_ledger_keeps_attempts_in_order_and_customers_across_runs(any_repo):
    clock = FakeClock()
    service = service_on(any_repo, [make_tx(1, customer_id="cust_shared")], provider=ScriptedProvider(["no_recovery"]), clock=clock)
    service.execute_case(TX1, "a1")
    clock.advance(hours=7)
    service.execute_case(TX1, "a2")
    attempts = ledger(service, TX1)
    assert [(a.sequence, a.attempt_number, a.status) for a in attempts] == [
        (1, 1, AttemptStatus.COMPLETED), (2, 2, AttemptStatus.COMPLETED)]
    assert all(isinstance(a.authorization, dict) and a.authorization["allowed"] for a in attempts)
    assert [a.attempt_id for a in any_repo.list_customer_attempts("merch_test", "cust_shared")] == [a.attempt_id for a in attempts]
    assert any_repo.list_customer_attempts("merch_test", "someone_else") == []
    assert [a.attempt_id for a in any_repo.list_attempts()] == [a.attempt_id for a in attempts]   # active-run scope
    assert any_repo.get_attempt(attempts[0].attempt_id).attempt_id == attempts[0].attempt_id
    assert any_repo.get_attempt("att_nope") is None


def test_listing_attempts_since_a_moment_and_reserved_ones(any_repo):
    clock = FakeClock()
    service = service_on(any_repo, [make_tx(1), make_tx(2)], clock=clock)
    service.execute_case(TX1, "k1")
    clock.advance(hours=2)
    service.execute_case(TX2, "k2")
    cutoff = (clock() - timedelta(hours=1)).isoformat()
    assert [a.transaction_id for a in any_repo.list_attempts_since(cutoff)] == [TX2]
    assert any_repo.list_reserved_attempts(clock().isoformat()) == []


def test_inserting_a_second_idempotency_record_for_a_scope_is_refused(any_repo):
    service = service_on(any_repo, [make_tx(1)])
    service.execute_case(TX1, "k1")
    case = case_of(service, TX1)
    attempt = ledger(service, TX1)[0]
    duplicate = IdempotencyRecord(merchant_id="merch_test", operation="execute_intervention", key="k1",
                                  request_fingerprint="whatever", case_id=case.case_id, attempt_id=attempt.attempt_id)
    with pytest.raises(DuplicateIdempotencyKey):
        any_repo.insert_idempotency_record(duplicate)
    record = any_repo.get_idempotency_record("merch_test", "execute_intervention", "k1")
    assert record.status == "completed" and record.http_status == 200 and record.response["status"] == "recovered"
    assert any_repo.get_idempotency_record("other_merchant", "execute_intervention", "k1") is None
    assert any_repo.get_idempotency_record("merch_test", "other_operation", "k1") is None


def test_a_completed_idempotency_record_can_never_be_rebound_to_another_request(any_repo):
    service = service_on(any_repo, [make_tx(1)])
    service.execute_case(TX1, "k1")
    record = any_repo.get_idempotency_record("merch_test", "execute_intervention", "k1")
    rebound = replace(record, request_fingerprint="a different request")      # a new object: never edit a stored one in place
    with pytest.raises(ValueError, match="fingerprint cannot be changed"):
        any_repo.save_idempotency_record(rebound)
    assert any_repo.get_idempotency_record("merch_test", "execute_intervention", "k1").request_fingerprint == record.request_fingerprint


def _audit(repo, n, **kw):
    fields = dict(
        event_id=new_id("evt", 16), merchant_id="merch_test", transaction_id=TX1, leak_id="fp_000001", decision_id=None,
        intervention_id=None, timestamp=utc_now_iso(), event_type="DECISION_CREATED", action="retry",
        policy_result={"allowed": True}, run_id=repo.get_active_run().run_id,
    )
    fields.update(kw)
    event = AuditEvent(**fields)
    repo.save_audit_event(event)
    return event


def test_audit_filters_return_the_same_events_on_both_repositories(any_repo):
    service = service_on(any_repo, [make_tx(1), make_tx(2, leak_type="abandoned_checkout"), make_tx(3, leak_type="failed_subscription")])
    service.execute_case(TX1, "k1")
    runless = _audit(any_repo, 0, run_id=None, transaction_id="tx_runless", leak_id="fp_runless", event_type="LEGACY")

    log = any_repo.get_audit_log(limit=1000)
    assert [e.event_type for e in log][:3] == ["DECISION_CREATED"] * 3          # oldest first
    assert runless.event_id in {e.event_id for e in log}                         # run-less events stay visible
    assert [e.event_id for e in any_repo.get_audit_log(limit=1000, newest_first=True)] == [e.event_id for e in reversed(log)]
    assert len(any_repo.get_audit_log(limit=2)) == 2
    assert {e.transaction_id for e in any_repo.get_audit_log(limit=1000, transaction_id=TX1)} == {TX1}
    # `leak_type` matches events whose leak id starts with the value's first two letters, or whose action equals it.
    by_prefix = any_repo.get_audit_log(limit=1000, leak_type="ac")
    assert by_prefix and {e.leak_id[:2] for e in by_prefix} == {"ac"}
    by_action = any_repo.get_audit_log(limit=1000, leak_type="retry")
    assert by_action and all(e.leak_id.startswith("re") or e.action == "retry" for e in by_action)
    by_event = any_repo.get_audit_log(limit=1000, status="EXECUTION_SUCCEEDED")
    by_outcome = any_repo.get_audit_log(limit=1000, status="recovered")
    assert len(by_event) == 1 and [e.event_id for e in by_outcome] == [e.event_id for e in by_event]

    summary = any_repo.summarize_audit_log()
    assert summary["matched"] == len(log) and sum(summary["counts_by_type"].values()) == len(log)
    assert summary["counts_by_type"]["EXECUTION_SUCCEEDED"] == 1 and summary["counts_by_type"]["LEGACY"] == 1
    assert any_repo.summarize_audit_log(transaction_id="tx_nope") == {"matched": 0, "counts_by_type": {}}


def test_audit_scoping_by_run(any_repo):
    service = service_on(any_repo, [make_tx(1)], seed=1)
    first_run = any_repo.get_active_run().run_id
    build_service([make_tx(1)], repo=any_repo, seed=2)                 # a second run, analysed
    assert {e.run_id for e in any_repo.get_audit_log(limit=1000)} == {any_repo.get_active_run().run_id}
    assert {e.run_id for e in any_repo.get_audit_log(limit=1000, run_id=first_run)} == {first_run}
    assert {e.run_id for e in any_repo.get_audit_log(limit=1000, run_id="all")} == {first_run, any_repo.get_active_run().run_id}


def test_reads_with_no_active_run_are_empty_not_errors(any_repo):
    assert any_repo.get_active_run() is None and any_repo.list_runs() == []
    assert any_repo.get_all_transactions() == [] and any_repo.list_cases() == [] and any_repo.get_all_decisions() == []
    assert any_repo.get_all_interventions() == [] and any_repo.get_audit_log() == []
    assert any_repo.summarize_audit_log() == {"matched": 0, "counts_by_type": {}}
    assert any_repo.get_transaction_by_id(TX1) is None and any_repo.get_case_for_transaction(TX1) is None


# ── PostgreSQL-only guarantees ───────────────────────────────────────────
def test_an_exception_rolls_back_everything_written_inside_the_block(pg_repo):
    service = service_on(pg_repo, [make_tx(1)])
    case = case_of(service, TX1)
    with pytest.raises(RuntimeError, match="boom"):
        with pg_repo.atomic():
            locked = pg_repo.get_case(case.case_id)
            locked.transition(CaseState.BLOCKED, "inside the block")
            pg_repo.save_case(locked)
            assert pg_repo.get_case(case.case_id).state == CaseState.BLOCKED     # visible to its own transaction
            raise RuntimeError("boom")
    assert pg_repo.get_case(case.case_id).state == CaseState.AUTHORIZED          # ...and gone afterwards


def test_a_clean_block_commits_as_one_unit_and_nested_blocks_join_it(pg_repo):
    service = service_on(pg_repo, [make_tx(1)])
    case_id = case_of(service, TX1).case_id
    with pg_repo.atomic():
        with pg_repo.atomic():
            inner = pg_repo.get_case(case_id)
            inner.transition(CaseState.BLOCKED, "nested")
            pg_repo.save_case(inner)
        # the inner block ending did not commit: a second connection still sees the old state
        other = PostgresRepository(pg_repo._pool)
        assert other.get_case(case_id).state == CaseState.AUTHORIZED
    assert pg_repo.get_case(case_id).state == CaseState.BLOCKED


def test_a_nested_failure_aborts_the_whole_outer_unit(pg_repo):
    service = service_on(pg_repo, [make_tx(1)])
    case_id = case_of(service, TX1).case_id
    with pytest.raises(ValueError):
        with pg_repo.atomic():
            first = pg_repo.get_case(case_id)
            first.transition(CaseState.BLOCKED, "outer")
            pg_repo.save_case(first)
            with pg_repo.atomic():
                raise ValueError("inner failure")
    assert pg_repo.get_case(case_id).state == CaseState.AUTHORIZED


def test_a_stale_copy_cannot_overwrite_a_newer_case_even_without_the_row_lock(pg_repo):
    service = service_on(pg_repo, [make_tx(1)])
    case_id = case_of(service, TX1).case_id
    reader_a, reader_b = pg_repo.get_case(case_id), pg_repo.get_case(case_id)       # two copies of the same version
    read_version = reader_a.version
    reader_a.transition(CaseState.BLOCKED, "first writer")
    pg_repo.save_case(reader_a)
    assert reader_a.version == read_version + 1                                     # the saved object tracks the row
    reader_b.transition(CaseState.BLOCKED, "second writer, stale")
    with pytest.raises(StaleWrite, match="changed by another unit of work"):
        pg_repo.save_case(reader_b)
    stored = pg_repo.get_case(case_id)
    assert stored.version == read_version + 1 and [h["reason"] for h in stored.history][-1] == "first writer"
    reader_a.transition(CaseState.AUTHORIZED, "same object may save again")         # a later save in the same unit is fine
    pg_repo.save_case(reader_a)
    assert pg_repo.get_case(case_id).version == read_version + 2
    assert "version" not in stored.to_dict()                                        # storage bookkeeping, not API surface


def test_getters_return_copies_so_an_unsaved_change_is_not_persisted(pg_repo):
    service = service_on(pg_repo, [make_tx(1)])
    case_id = case_of(service, TX1).case_id
    copy = pg_repo.get_case(case_id)
    copy.state = CaseState.RECOVERED
    copy.recovered_amount = 5000.0
    assert pg_repo.get_case(case_id).state == CaseState.AUTHORIZED and pg_repo.get_case(case_id).recovered_amount == 0.0
    tx = pg_repo.get_transaction_by_id(TX1)
    tx.retries_so_far = 99
    assert pg_repo.get_transaction_by_id(TX1).retries_so_far == 0


def test_a_row_lock_makes_a_second_writer_wait_for_the_first(pg_repo, pg_connect):
    service = service_on(pg_repo, [make_tx(1)])
    case_id = case_of(service, TX1).case_id
    second = pg_connect()
    order, entered = [], threading.Event()

    def holder():
        with pg_repo.atomic():
            pg_repo.get_case(case_id)         # FOR UPDATE
            entered.set()
            threading.Event().wait(0.4)
            order.append("holder done")

    def waiter():
        entered.wait(5)
        with second.atomic():
            second.get_case(case_id)          # blocks until the holder commits
            order.append("waiter ran")

    threads = [threading.Thread(target=holder), threading.Thread(target=waiter)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    assert order == ["holder done", "waiter ran"]


def test_money_is_exact_and_never_silently_rounded(pg_repo):
    assert to_money(1999.99) == Decimal("1999.99") and to_money(5000) == Decimal("5000.00")
    assert to_money(Decimal("0.10")) == Decimal("0.10") and to_money(0) == Decimal("0.00")
    with pytest.raises(MoneyPrecisionError, match="more than two decimal places"):
        to_money(10.005)
    with pytest.raises(MoneyPrecisionError):
        to_money(0.1 + 0.2)                      # 0.30000000000000004 is not a two-decimal amount
    for bad in (float("nan"), float("inf"), None, True, "abc"):
        with pytest.raises(MoneyPrecisionError):
            to_money(bad)
    with pytest.raises(MoneyPrecisionError, match="outside the supported range"):
        to_money(10 ** 15)

    service = service_on(pg_repo, [make_tx(1, amount=1234.56)])
    assert pg_repo.get_transaction_by_id(TX1).amount == 1234.56            # reads back as the very same float
    assert case_of(service, TX1).amount == 1234.56


def test_a_scan_with_an_inexact_amount_is_refused_whole(pg_repo):
    bad = make_tx(1, amount=10.005)
    with pytest.raises(MoneyPrecisionError):
        register_run(service_on(pg_repo, [make_tx(9)], analyze=False), [bad], seed=77)
    runs = pg_repo.list_runs()
    assert len(runs) == 1 and pg_repo.get_transaction_by_id("tx_fp_000001") is None   # only the earlier valid run exists


def test_state_survives_a_new_repository_on_the_same_database(pg_repo, pg_connect):
    clock = FakeClock()
    service = service_on(pg_repo, [make_tx(1, amount=2500.0), make_tx(2, amount=800.0)], clock=clock)
    first = service.execute_case(TX1, "persist-1")
    expected_cases = [c.to_dict() for c in pg_repo.list_cases()]
    expected_audit = [e.to_dict() for e in pg_repo.get_audit_log(limit=1000)]
    expected_runs = [r.to_dict() for r in pg_repo.list_runs()]

    reopened = pg_connect()                                      # a brand new pool: what a restarted process would have
    assert [c.to_dict() for c in reopened.list_cases()] == expected_cases
    assert [e.to_dict() for e in reopened.get_audit_log(limit=1000)] == expected_audit
    assert [r.to_dict() for r in reopened.list_runs()] == expected_runs
    assert reopened.get_active_run().run_id == expected_runs[0]["run_id"]
    record = reopened.get_idempotency_record("merch_test", "execute_intervention", "persist-1")
    assert record.status == "completed" and record.response == first.intervention
    assert reopened.get_intervention_by_id(first.intervention["intervention_id"]).recovered_amount == 2500.0
    assert reopened.get_decision(TX2).policy_limits == service.policy.to_dict()


def test_destructive_maintenance_is_off_unless_asked_for(pg_dsn, pg_schema):
    from backend.app.db import migrate

    migrate.upgrade(pg_dsn, pg_schema)
    guarded = PostgresRepository.connect(pg_dsn, schema=pg_schema)
    try:
        with pytest.raises(RuntimeError, match="allow_destructive"):
            guarded.clear()
    finally:
        guarded.close()


def test_schemas_are_isolated_from_each_other(pg_dsn, pg_repo):
    from backend.app.db import migrate
    from backend.tests import pg_support

    service_on(pg_repo, [make_tx(1)])
    other_schema = pg_support.new_schema_name()
    pg_support.create_schema(pg_dsn, other_schema)
    try:
        migrate.upgrade(pg_dsn, other_schema)
        other = PostgresRepository.connect(pg_dsn, schema=other_schema)
        try:
            assert other.get_active_run() is None and other.list_cases(run_id="all") == []
        finally:
            other.close()
    finally:
        pg_support.drop_schema(pg_dsn, other_schema)


def test_the_pool_bounds_concurrency_instead_of_failing(pg_dsn, pg_schema):
    from backend.app.db import migrate

    migrate.upgrade(pg_dsn, pg_schema)
    small = PostgresRepository.connect(pg_dsn, schema=pg_schema, pool_size=2)
    try:
        results = []

        def work():
            with small.atomic():
                threading.Event().wait(0.15)
                results.append(small.get_active_run())

        threads = [threading.Thread(target=work) for _ in range(8)]       # 8 callers, 2 connections
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert len(results) == 8
    finally:
        small.close()
