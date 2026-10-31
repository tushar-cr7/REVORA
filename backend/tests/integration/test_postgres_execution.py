"""
Phase 1's execution-safety invariants, proven again on a real PostgreSQL database — plus what only a
database can break: refusals that must survive a rollback, units of work that must commit or vanish
whole, a process that dies mid-execution, and concurrent callers on SEPARATE connection pools
(each one stands in for a separate worker process; the database cannot tell the difference).

Verification style: after an action, state is read back through a FRESH repository (a new pool), so
what is asserted is what was committed — not what a cached object happens to hold.
"""
import threading
import time
from dataclasses import replace

import pytest

from backend.app.domain.models import AttemptStatus, AuditEventType, CaseState
from backend.app.domain.policy import DEFAULT_POLICY
from backend.app.repositories.errors import TransientStorageError
from backend.app.services.audit_service import AuditService
from backend.app.services.execution_service import (
    CaseConflict,
    IdempotencyInProgress,
    IdempotencyKeyReuse,
    PolicyDenied,
    ProviderFailure,
    ReplayedExecutionError,
    ReservationExpired,
    StaleRun,
    _Reservation,
)
from backend.app.services.recovery_service import RecoveryService
from backend.tests.support import (
    FakeClock,
    FixedProbModel,
    ScriptedProvider,
    build_service,
    case_of,
    ledger,
    make_tx,
)
from backend.tests.support import TEST_WS
from backend.app.domain.workspaces import DEMO_WORKSPACE_ID

TX1, TX2, TX3 = "tx_fp_000001", "tx_fp_000002", "tx_fp_000003"


def attach(repo, provider, clock, policy=None):
    """Another application instance over the same database (its own repository, therefore its own pool)."""
    service = RecoveryService(repo=repo, audit_service=AuditService(repo), provider=provider, clock=clock, policy=policy)
    service.model = FixedProbModel(0.9)
    return service


def audit_types(repo, tx_id=None):
    return [e.event_type for e in repo.get_audit_log(limit=10000, transaction_id=tx_id, workspace_id=TEST_WS)]


def run_together(callables, timeout=90):
    """Release every callable at the same instant; return [("ok", value) | ("err", exception)] in order."""
    results = [None] * len(callables)
    barrier = threading.Barrier(len(callables))

    def runner(i, fn):
        barrier.wait()
        try:
            results[i] = ("ok", fn())
        except Exception as exc:  # noqa: BLE001 - classified by the caller
            results[i] = ("err", exc)

    threads = [threading.Thread(target=runner, args=(i, fn)) for i, fn in enumerate(callables)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=timeout)
    assert all(r is not None for r in results), "a worker did not finish"
    return results


def widen_race_window(service, seconds=0.05, rendezvous=None):
    """
    Stall inside the reservation unit of work at the two points a race needs to be wide:
      * after the case has been read and the idempotency / state checks passed   (policy source), and
      * after the facts and the verdict are computed, before anything is written   (provider source).

    With `rendezvous` (a threading.Barrier shared by all workers) the stall is a meeting point instead of
    a sleep: if nothing serializes the workers they ALL arrive having read the same stale state, so a
    missing safeguard shows up every time. When a lock does serialize them only one worker can be inside
    at once, the barrier times out for it and breaks, and the rest pass straight through.
    """
    original_policy, original_provider = service.executor._policy_source, service.executor._provider_source

    def stall():
        if rendezvous is None:
            time.sleep(seconds)
            return
        try:
            rendezvous.wait(timeout=0.6)
        except threading.BrokenBarrierError:
            pass

    def slow_policy():
        stall()
        return original_policy()

    def slow_provider():
        stall()
        return original_provider()

    service.executor._policy_source = slow_policy
    service.executor._provider_source = slow_provider


# ══════════════════════════════════════════════════════════════════════════
# Phase 1 invariants on PostgreSQL
# ══════════════════════════════════════════════════════════════════════════
def test_the_retry_cap_holds_and_every_denial_is_committed(pg_repo, pg_connect):
    clock = FakeClock()
    provider = ScriptedProvider(["no_recovery"])
    service = build_service([make_tx(1)], provider=provider, clock=clock, repo=pg_repo)
    for n in (1, 2):
        assert service.execute_case(TEST_WS, TX1, f"attempt-{n}").intervention["status"] == "attempted_no_recovery"
        clock.advance(hours=7)
    for n in range(3, 8):
        with pytest.raises(PolicyDenied) as denied:
            service.execute_case(TEST_WS, TX1, f"attempt-{n}")
        assert "Retry limit exceeded (2/2)" in denied.value.message and denied.value.extra["safe_alternative"] == "escalate"
    assert len(provider.calls) == 2

    fresh = pg_connect()                                   # what a restarted process would read
    case = fresh.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    attempts = fresh.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)
    statuses = [a.status for a in attempts]
    assert statuses.count(AttemptStatus.COMPLETED) == 2 and statuses.count(AttemptStatus.DENIED) == 5   # denials persisted
    assert case.state == CaseState.BLOCKED and case.attempt_count == 2
    assert [a.attempt_number for a in attempts if a.status == AttemptStatus.COMPLETED] == [1, 2]
    assert all(a.attempt_number is None and a.final_action is None for a in attempts if a.status == AttemptStatus.DENIED)
    assert audit_types(fresh, TX1).count("ACTION_BLOCKED") == 5


def test_a_denied_request_is_a_committed_record_that_replays_without_writing_again(pg_repo, pg_connect):
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=8000.0)], provider=provider, repo=pg_repo)
    service.policy = replace(DEFAULT_POLICY, max_auto_recovery_value=5000.0)
    with pytest.raises(PolicyDenied):
        service.execute_case(TEST_WS, TX1, "denied-key")

    fresh = pg_connect()
    record = fresh.get_idempotency_record("merch_test", "execute_intervention", "denied-key")
    assert record.status == "completed" and record.http_status == 409 and record.response["code"] == "policy_denied"
    case = fresh.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert case.state == CaseState.BLOCKED and case.blocked_reason and case.safe_alternative == "escalate"
    denied = [a for a in fresh.list_attempts(case_id=case.case_id, workspace_id=TEST_WS) if a.status == AttemptStatus.DENIED]
    assert len(denied) == 1 and denied[0].authorization["allowed"] is False and denied[0].authorization["limits"]["max_auto_recovery_value"] == 5000.0
    events_before = len(fresh.get_audit_log(limit=10000, workspace_id=TEST_WS))

    with pytest.raises(ReplayedExecutionError) as again:
        attach(fresh, provider, FakeClock(), policy=service.policy).execute_case(TEST_WS, TX1, "denied-key")
    assert again.value.replayed and again.value.code == "policy_denied"
    assert len(fresh.get_audit_log(limit=10000, workspace_id=TEST_WS)) == events_before
    assert len([a for a in fresh.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)]) == 1
    assert provider.calls == []


def test_replays_and_duplicate_keys_never_manufacture_recovery(pg_repo):
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=2500.0), make_tx(2)], provider=provider, repo=pg_repo)
    first = service.execute_case(TEST_WS, TX1, "same-key")
    for _ in range(4):
        replay = service.execute_case(TEST_WS, TX1, "same-key")
        assert replay.replayed and replay.intervention == first.intervention
    for n in range(4):
        with pytest.raises(CaseConflict) as conflict:
            service.execute_case(TEST_WS, TX1, f"other-{n}")
        assert conflict.value.extra["case_state"] == "recovered"
    with pytest.raises(IdempotencyKeyReuse):
        service.execute_case(TEST_WS, TX2, "same-key")                 # same key, different target
    stats = service.get_analytics_summary(TEST_WS)
    assert stats["total_recovered"] == 2500.0 and stats["recovered_count"] == 1 and stats["attempted_count"] == 1
    assert len(provider.calls) == 1 and len(ledger(service, TX1)) == 1 and ledger(service, TX2) == []


def test_a_provider_failure_is_committed_counted_and_replayable(pg_repo, pg_connect):
    clock = FakeClock()
    provider = ScriptedProvider(["raise", "recovered"])
    service = build_service([make_tx(1)], provider=provider, clock=clock, repo=pg_repo)
    with pytest.raises(ProviderFailure) as failure:
        service.execute_case(TEST_WS, TX1, "k1")
    assert failure.value.status_code == 502

    fresh = pg_connect()
    case = fresh.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    (attempt,) = fresh.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)
    assert attempt.status == AttemptStatus.FAILED and "scripted provider outage" in attempt.failure_reason
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.active_attempt_id is None and case.attempt_count == 1
    assert fresh.get_all_interventions(workspace_id=TEST_WS) == []
    assert "EXECUTION_FAILED" in audit_types(fresh, TX1) and "EXECUTION_SUCCEEDED" not in audit_types(fresh, TX1)
    record = fresh.get_idempotency_record("merch_test", "execute_intervention", "k1")
    assert record.http_status == 502 and record.response["code"] == "provider_failure"

    with pytest.raises(ReplayedExecutionError):               # the stored failure, no second provider call
        service.execute_case(TEST_WS, TX1, "k1")
    assert len(provider.calls) == 1
    with pytest.raises(PolicyDenied):                         # a failed call still counts toward the cooldown
        service.execute_case(TEST_WS, TX1, "k2")
    clock.advance(hours=7)
    assert service.execute_case(TEST_WS, TX1, "k3").intervention["status"] == "recovered"


def test_completion_is_atomic_a_late_failure_undoes_every_write_of_the_unit(pg_repo, pg_connect, caplog):
    """
    Fail the LAST write of the completion unit (the audit event). The intervention insert, the attempt
    and case updates and the idempotency completion before it must all vanish with it; only the
    separate abort unit survives, closing the reservation as a failed, counted attempt.
    """
    clock = FakeClock()
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=900.0)], provider=provider, clock=clock, repo=pg_repo)
    real_log = service.audit_service.log_event

    def failing_log(**kwargs):
        if kwargs["event_type"] == AuditEventType.EXECUTION_SUCCEEDED:
            raise RuntimeError("audit store unavailable")
        return real_log(**kwargs)

    service.audit_service.log_event = failing_log
    with pytest.raises(RuntimeError, match="audit store unavailable"):
        service.execute_case(TEST_WS, TX1, "k1")
    service.audit_service.log_event = real_log
    assert "execution bookkeeping failed" in caplog.text

    fresh = pg_connect()
    case = fresh.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    (attempt,) = fresh.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)
    assert fresh.get_all_interventions(run_id="all", workspace_id=TEST_WS) == []                 # the intervention insert was rolled back
    assert attempt.status == AttemptStatus.FAILED and "bookkeeping" in attempt.failure_reason and not attempt.recovered
    assert attempt.intervention_id is None and attempt.recovered_amount == 0.0
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.recovered_amount == 0.0 and case.active_attempt_id is None
    assert case.attempt_count == 1                                          # the provider may have acted: it counts
    assert "EXECUTION_SUCCEEDED" not in audit_types(fresh, TX1)
    assert audit_types(fresh, TX1).count("EXECUTION_FAILED") == 1           # the abort is on the record
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == 0

    with pytest.raises(ReplayedExecutionError) as replay:                   # the key is not stuck "in progress"
        service.execute_case(TEST_WS, TX1, "k1")
    assert replay.value.status_code == 500 and replay.value.code == "execution_bookkeeping_error"
    clock.advance(hours=7)
    assert service.execute_case(TEST_WS, TX1, "k2").intervention["status"] == "recovered"   # recoverable with fresh authorization


def test_a_failing_first_write_of_completion_also_leaves_nothing_half_done(pg_repo, pg_connect):
    service = build_service([make_tx(1)], provider=ScriptedProvider(["recovered"]), repo=pg_repo)

    def explode(_):
        raise RuntimeError("storage fault")

    pg_repo.save_intervention = explode
    with pytest.raises(RuntimeError):
        service.execute_case(TEST_WS, TX1, "k1")
    del pg_repo.save_intervention
    fresh = pg_connect()
    assert fresh.get_all_interventions(run_id="all", workspace_id=TEST_WS) == []
    assert fresh.get_case_for_transaction(TX1, workspace_id=TEST_WS).state == CaseState.ATTEMPTED_NO_RECOVERY


def test_analytics_and_the_audit_trail_survive_a_restart(pg_repo, pg_connect):
    clock = FakeClock()
    provider = ScriptedProvider(["recovered", "no_recovery", "recovered"])
    service = build_service([make_tx(1, amount=1000.0), make_tx(2, amount=2000.0), make_tx(3, amount=90000.0)],
                            provider=provider, clock=clock, repo=pg_repo)
    for tx_id, key in ((TX1, "a"), (TX2, "b"), (TX3, "c")):
        service.execute_case(TEST_WS, tx_id, key)
    before = service.get_analytics_summary(TEST_WS)
    audit_before = [e.to_dict() for e in pg_repo.get_audit_log(limit=10000, workspace_id=TEST_WS)]
    assert before["total_recovered"] == 1000.0 and before["recovered_count"] == 1 and before["escalation_count"] == 1

    restarted = attach(pg_connect(), ScriptedProvider(["recovered"]), clock)
    assert restarted.get_analytics_summary(TEST_WS) == before
    assert [e.to_dict() for e in restarted.repo.get_audit_log(limit=10000, workspace_id=TEST_WS)] == audit_before
    for tx_id, key in ((TX1, "a"), (TX2, "b")):
        assert restarted.execute_case(TEST_WS, tx_id, key).replayed                 # idempotency records came back too
    with pytest.raises(CaseConflict):
        restarted.execute_case(TEST_WS, TX1, "brand-new-key")                       # and a recovered case stays recovered
    assert restarted.get_analytics_summary(TEST_WS) == before


def test_bulk_recovery_twice_and_individual_execution_follow_the_same_rules(pg_repo):
    txs = [make_tx(1, amount=1000.0), make_tx(2, amount=2000.0), make_tx(3, amount=3000.0),
           make_tx(4, leak_type="abandoned_checkout", amount=4000.0),
           make_tx(5, leak_type="overdue_invoice", amount=8000.0, age_days=45, hours_since_event=45 * 24)]
    provider = ScriptedProvider(["recovered", "no_recovery"])
    service = build_service(txs, provider=provider, repo=pg_repo)
    service.policy = replace(DEFAULT_POLICY, max_auto_recovery_value=2500.0)      # tightened after analysis

    first = service.recover_revenue(TEST_WS)
    # 3000 and 4000 exceed the tightened ceiling and are denied; 1000 and 2000 run; the 45-day invoice was already
    # rerouted to escalation, which stays executable (handing a case to a person is the safe sink).
    assert first["blocked_now"] == 2 and first["executed_now"] == 3 and first["escalated_now"] == 1
    assert first["policy_violations"] == 0
    calls = len(provider.calls)
    second = service.recover_revenue(TEST_WS)
    assert second["executed_now"] == 0 and len(provider.calls) == calls          # nothing runs twice
    assert second["total_recovered"] == first["total_recovered"]

    # The very cases bulk recovery denied are denied for an individual request too: one rule set.
    denied_ids = [a.transaction_id for a in pg_repo.list_attempts(workspace_id=TEST_WS) if a.status == AttemptStatus.DENIED]
    assert sorted(denied_ids) == ["tx_ac_000004", "tx_fp_000003"]
    for tx_id in denied_ids:
        with pytest.raises(PolicyDenied):
            service.execute_case(TEST_WS, tx_id, f"individual-{tx_id}")
    assert len(provider.calls) == calls


def test_a_case_from_a_superseded_run_is_not_executable_and_a_new_run_isolates_state(pg_repo):
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider, repo=pg_repo, seed=1)
    old_case = case_of(service, TX1)
    build_service([make_tx(1, amount=777.0)], provider=provider, repo=pg_repo, seed=2)      # supersedes the first run
    with pytest.raises(StaleRun):
        service.execute_case(TEST_WS, old_case.case_id, "k")
    assert pg_repo.list_attempts(case_id=old_case.case_id, workspace_id=TEST_WS) == []
    new_case = pg_repo.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert new_case.case_id != old_case.case_id and new_case.state == CaseState.AUTHORIZED
    assert attach(pg_repo, provider, FakeClock()).execute_case(TEST_WS, TX1, "k").intervention["amount"] == 777.0


# ══════════════════════════════════════════════════════════════════════════
# A process that dies mid-execution
# ══════════════════════════════════════════════════════════════════════════
def crashed_after_reservation(pg_repo, pg_connect, key="crash-key", **service_kwargs):
    """Run phase 1 only (the reservation commits), then 'die': no provider call, no completion."""
    clock = FakeClock()
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=1500.0)], provider=provider, clock=clock, repo=pg_repo, **service_kwargs)
    case = case_of(service, TX1)
    reservation = service.executor._reserve_with_retry(TEST_WS, case.case_id, key, None)
    assert isinstance(reservation, _Reservation) and provider.calls == []
    return clock, provider, reservation, pg_connect()


def test_a_reservation_survives_the_crash_and_blocks_duplicates_while_it_might_still_be_alive(pg_repo, pg_connect):
    clock, provider, reservation, fresh = crashed_after_reservation(pg_repo, pg_connect)
    case = fresh.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert case.state == CaseState.EXECUTING and case.active_attempt_id == reservation.attempt_id
    assert fresh.get_attempt(reservation.attempt_id, workspace_id=TEST_WS).status == AttemptStatus.RESERVED
    restarted = attach(fresh, provider, clock)
    with pytest.raises(IdempotencyInProgress):
        restarted.execute_case(TEST_WS, TX1, "crash-key")                         # the original owner may still be alive
    with pytest.raises(CaseConflict):
        restarted.execute_case(TEST_WS, TX1, "other-key")
    assert provider.calls == []


def test_startup_recovery_closes_an_abandoned_reservation_as_a_failed_counted_attempt(pg_repo, pg_connect):
    clock, provider, reservation, fresh = crashed_after_reservation(pg_repo, pg_connect)
    restarted = attach(fresh, provider, clock)
    assert restarted.executor.recover_interrupted() == []                # too young: nothing is touched
    clock.advance(minutes=20)                                            # beyond the 15-minute reservation timeout
    assert restarted.executor.recover_interrupted() == [reservation.attempt_id]
    assert restarted.executor.recover_interrupted() == []                # idempotent

    check = pg_connect()
    case = check.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    attempt = check.get_attempt(reservation.attempt_id, workspace_id=TEST_WS)
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.active_attempt_id is None and case.attempt_count == 1
    assert attempt.status == AttemptStatus.FAILED and attempt.failure_reason.startswith("interrupted:")
    assert attempt.recovered is False and check.get_all_interventions(run_id="all", workspace_id=TEST_WS) == []
    assert restarted.get_analytics_summary(TEST_WS)["total_recovered"] == 0
    failed = [e for e in check.get_audit_log(limit=1000, transaction_id=TX1, workspace_id=TEST_WS) if e.event_type == "EXECUTION_FAILED"]
    assert len(failed) == 1 and failed[0].outcome["status"] == "interrupted" and failed[0].attempt_id == attempt.attempt_id

    with pytest.raises(ReplayedExecutionError) as replay:                # the key is no longer "in progress" forever
        restarted.execute_case(TEST_WS, TX1, "crash-key")
    assert replay.value.status_code == 500 and replay.value.code == "execution_interrupted"

    # The interrupted attempt still counts: the provider may have acted, so the retry cooldown applies.
    with pytest.raises(PolicyDenied, match="Cooldown not elapsed"):
        restarted.execute_case(TEST_WS, TX1, "next-key")
    clock.advance(hours=7)
    out = restarted.execute_case(TEST_WS, TX1, "next-key-2")
    assert out.intervention["status"] == "recovered"
    assert [a.attempt_number for a in check.list_attempts(case_id=case.case_id, workspace_id=TEST_WS) if a.status != AttemptStatus.DENIED] == [1, 2]


def test_the_next_request_for_the_case_reclaims_a_dead_reservation_without_any_sweep(pg_repo, pg_connect):
    clock, provider, reservation, fresh = crashed_after_reservation(pg_repo, pg_connect)
    clock.advance(minutes=20)
    restarted = attach(fresh, provider, clock)
    with pytest.raises(ReplayedExecutionError) as replay:                # the SAME key: reclaimed, then answered
        restarted.execute_case(TEST_WS, TX1, "crash-key")
    assert replay.value.code == "execution_interrupted"
    check = pg_connect()
    assert check.get_attempt(reservation.attempt_id, workspace_id=TEST_WS).status == AttemptStatus.FAILED     # and it stuck: it committed
    assert check.get_case_for_transaction(TX1, workspace_id=TEST_WS).state == CaseState.ATTEMPTED_NO_RECOVERY


def test_a_new_key_also_reclaims_and_is_then_judged_by_current_policy(pg_repo, pg_connect):
    clock, provider, reservation, fresh = crashed_after_reservation(pg_repo, pg_connect)
    clock.advance(hours=8)                                               # reclaimable, and past the retry cooldown
    out = attach(fresh, provider, clock).execute_case(TEST_WS, TX1, "fresh-key")
    assert out.intervention["status"] == "recovered"
    attempts = pg_connect().list_attempts(case_id=case_of(attach(fresh, provider, clock), TX1).case_id, workspace_id=TEST_WS)
    assert [(a.status, a.attempt_number) for a in attempts] == [(AttemptStatus.FAILED, 1), (AttemptStatus.COMPLETED, 2)]


def test_a_result_that_arrives_after_its_reservation_was_closed_is_not_recorded(pg_repo, pg_connect, caplog):
    entered, gate = threading.Event(), threading.Event()
    clock = FakeClock()
    provider = ScriptedProvider(["recovered"], gate=gate, entered=entered)
    service = build_service([make_tx(1, amount=1500.0)], provider=provider, clock=clock, repo=pg_repo)
    outcome = {}

    def slow_request():
        try:
            outcome["value"] = service.execute_case(TEST_WS, TX1, "slow")
        except Exception as exc:  # noqa: BLE001
            outcome["error"] = exc

    worker = threading.Thread(target=slow_request)
    worker.start()
    assert entered.wait(timeout=20)                                       # reserved, provider call in flight
    clock.advance(minutes=30)
    attach(pg_connect(), provider, clock).executor.recover_interrupted()  # another process presumes it dead
    gate.set()
    worker.join(timeout=30)

    assert isinstance(outcome.get("error"), ReservationExpired) and outcome["error"].status_code == 409
    check = pg_connect()
    assert check.get_all_interventions(run_id="all", workspace_id=TEST_WS) == []                # a result for a closed attempt is not booked
    case = check.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.recovered_amount == 0.0
    assert "its result is NOT recorded" in caplog.text


# ══════════════════════════════════════════════════════════════════════════
# Concurrency across separate connection pools
# ══════════════════════════════════════════════════════════════════════════
def three_instances(pg_repo, pg_connect, provider, clock, workers=12, **policy):
    repos = [pg_repo, pg_connect(), pg_connect()]
    services = [attach(r, provider, clock, **policy) for r in repos]
    meeting = threading.Barrier(workers)
    for s in services:
        widen_race_window(s, rendezvous=meeting)
    return repos, services


def test_the_same_idempotency_key_from_many_workers_executes_exactly_once(pg_repo, pg_connect):
    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    build_service([make_tx(1, amount=4000.0)], provider=provider, clock=clock, repo=pg_repo)
    repos, services = three_instances(pg_repo, pg_connect, provider, clock)
    results = run_together([lambda s=s: s.execute_case(TEST_WS, TX1, "race-key") for s in services for _ in range(4)])

    oks = [r for kind, r in results if kind == "ok"]
    errs = [r for kind, r in results if kind == "err"]
    assert all(isinstance(e, IdempotencyInProgress) for e in errs), errs
    assert len([o for o in oks if not o.replayed]) == 1
    assert len({o.intervention["intervention_id"] for o in oks}) == 1
    check = pg_connect()
    assert len(provider.calls) == 1
    assert len(check.list_attempts(case_id=case_of(services[0], TX1).case_id, workspace_id=TEST_WS)) == 1
    assert len(check.get_all_interventions(run_id="all", workspace_id=TEST_WS)) == 1
    assert services[0].get_analytics_summary(TEST_WS)["total_recovered"] == 4000.0


def test_distinct_keys_for_one_case_from_many_workers_produce_one_effect(pg_repo, pg_connect):
    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    build_service([make_tx(1, amount=4000.0)], provider=provider, clock=clock, repo=pg_repo)
    repos, services = three_instances(pg_repo, pg_connect, provider, clock)
    results = run_together([lambda s=s, i=i: s.execute_case(TEST_WS, TX1, f"key-{i}") for i, s in enumerate(services * 4)])

    oks = [r for kind, r in results if kind == "ok"]
    errs = [r for kind, r in results if kind == "err"]
    assert len(oks) == 1 and all(isinstance(e, CaseConflict) for e in errs), errs
    assert len(provider.calls) == 1
    check = pg_connect()
    assert len(check.list_attempts(case_id=case_of(services[0], TX1).case_id, workspace_id=TEST_WS)) == 1
    assert services[0].get_analytics_summary(TEST_WS)["total_recovered"] == 4000.0


def test_the_database_constraints_alone_stop_a_duplicate_effect_when_row_locking_is_bypassed(pg_dsn, pg_schema, pg_repo):
    """
    Defense in depth. Replace the row-locking case read with a plain one, so the application-level
    mutual exclusion is gone, and race distinct keys at one case. The clean "case not executable"
    answers may degrade into raw integrity errors, but the unique indexes must still make a second
    reservation impossible: one provider call, one attempt, one recovery.
    """
    from backend.app.repositories.postgres import PostgresRepository, _case

    class NoRowLocks(PostgresRepository):
        def get_case(self, case_id, *, workspace_id):
            with self._cursor() as cur:
                cur.execute(
                    "SELECT * FROM recovery_cases WHERE case_id = %s AND merchant_id = %s", (case_id, workspace_id)
                )
                row = cur.fetchone()
                return _case(row) if row else None

    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    build_service([make_tx(1, amount=4000.0)], provider=provider, clock=clock, repo=pg_repo)
    repos = [NoRowLocks.connect(pg_dsn, schema=pg_schema, pool_size=8) for _ in range(3)]
    try:
        services = [attach(r, provider, clock) for r in repos]
        meeting = threading.Barrier(12)
        for s in services:
            widen_race_window(s, rendezvous=meeting)
        results = run_together([lambda s=s, i=i: s.execute_case(TEST_WS, TX1, f"key-{i}") for i, s in enumerate(services * 4)])
    finally:
        for r in repos:
            r.close()
    oks = [r for kind, r in results if kind == "ok"]
    assert len(oks) == 1, [(kind, type(r).__name__) for kind, r in results]
    assert len(provider.calls) == 1
    case = pg_repo.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert case.state == CaseState.RECOVERED and case.recovered_amount == 4000.0 and case.attempt_count == 1
    assert len(pg_repo.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)) == 1
    assert len(pg_repo.get_all_interventions(run_id="all", workspace_id=TEST_WS)) == 1


def test_one_key_raced_across_two_different_cases_lets_one_win_and_rolls_the_other_back_whole(pg_repo, pg_connect):
    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    build_service([make_tx(1), make_tx(2)], provider=provider, clock=clock, repo=pg_repo)
    repos, services = three_instances(pg_repo, pg_connect, provider, clock, workers=2)
    results = run_together([lambda: services[0].execute_case(TEST_WS, TX1, "shared"), lambda: services[1].execute_case(TEST_WS, TX2, "shared")])

    winners = [r for kind, r in results if kind == "ok"]
    losers = [r for kind, r in results if kind == "err"]
    assert len(winners) == 1 and len(losers) == 1 and isinstance(losers[0], IdempotencyKeyReuse)   # 422, not a 500
    assert len(provider.calls) == 1
    check = pg_connect()
    won_tx = winners[0].intervention["transaction_id"]
    lost_tx = TX2 if won_tx == TX1 else TX1
    lost_case = check.get_case_for_transaction(lost_tx, workspace_id=TEST_WS)
    # The loser's unit of work rolled back as a whole: no attempt, no state change, no audit residue.
    assert check.list_attempts(case_id=lost_case.case_id, workspace_id=TEST_WS) == [] and lost_case.state == CaseState.AUTHORIZED
    assert [t for t in audit_types(check, lost_tx)] == ["DECISION_CREATED"]
    record = check.get_idempotency_record("merch_test", "execute_intervention", "shared")
    assert record.case_id == check.get_case_for_transaction(won_tx, workspace_id=TEST_WS).case_id


def test_the_daily_contact_cap_holds_across_a_customers_cases_executed_in_parallel(pg_repo, pg_connect):
    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    txs = [make_tx(n, leak_type="abandoned_checkout", customer_id="cust_shared") for n in range(1, 7)]
    service = build_service(txs, provider=provider, clock=clock, repo=pg_repo, analyze=False)
    service.policy = replace(DEFAULT_POLICY, max_customer_contacts_per_day=10)      # all six are authorized at analysis
    service.analyze_revenue(TEST_WS)
    assert {pg_repo.get_decision(t.transaction_id, workspace_id=TEST_WS).final_action for t in txs} <= {"payment_link", "reminder"}
    tight = replace(DEFAULT_POLICY, max_customer_contacts_per_day=1)                # the cap in force at execution
    repos = [pg_repo, pg_connect(), pg_connect()]
    services = [attach(r, provider, clock, policy=tight) for r in repos]
    meeting = threading.Barrier(len(txs))
    for s in services:
        widen_race_window(s, rendezvous=meeting)

    results = run_together([lambda s=services[i % 3], t=t: s.execute_case(TEST_WS, t.transaction_id, f"k-{t.transaction_id}")
                            for i, t in enumerate(txs)])
    oks = [r for kind, r in results if kind == "ok"]
    errs = [r for kind, r in results if kind == "err"]
    assert len(oks) == 1, [type(e).__name__ for e in errs]
    assert all(isinstance(e, PolicyDenied) and "Daily customer contact limit" in e.message for e in errs)
    assert len(provider.calls) == 1                                                  # one customer, one contact
    check = pg_connect()
    contacts = [a for a in check.list_customer_attempts("merch_test", "cust_shared")
                if a.status in (AttemptStatus.COMPLETED, AttemptStatus.RESERVED, AttemptStatus.FAILED)]
    assert len(contacts) == 1


def test_concurrent_scans_of_the_same_source_data_create_one_run(pg_dsn, pg_schema, pg_repo, pg_connect):
    clock = FakeClock()
    services = [attach(r, ScriptedProvider(), clock) for r in (pg_repo, pg_connect(), pg_connect(), pg_connect())]
    results = run_together([lambda s=s: s.scan_revenue(n_total=30, seed=11) for s in services])
    assert all(kind == "ok" for kind, _ in results), results
    scans = [r for _, r in results]
    assert len({s["run_id"] for s in scans}) == 1                                    # everyone agrees on the run
    assert sum(1 for s in scans if not s["reused_existing_run"]) == 1                # exactly one created it
    runs = pg_repo.list_runs(workspace_id=DEMO_WORKSPACE_ID)
    assert len(runs) == 1 and runs[0].status == "active" and runs[0].scan_count == 4
    assert len(pg_repo.get_all_transactions(workspace_id=DEMO_WORKSPACE_ID)) == 30 and len(pg_repo.list_cases(workspace_id=DEMO_WORKSPACE_ID)) == 30


def test_concurrent_scans_of_different_data_leave_exactly_one_active_run(pg_repo, pg_connect):
    clock = FakeClock()
    services = [attach(r, ScriptedProvider(), clock) for r in (pg_repo, pg_connect(), pg_connect(), pg_connect())]
    results = run_together([lambda s=s, seed=seed: s.scan_revenue(n_total=20, seed=seed) for s, seed in zip(services, (1, 2, 3, 4))])
    assert all(kind == "ok" for kind, _ in results), results
    runs = pg_repo.list_runs(workspace_id=DEMO_WORKSPACE_ID)
    assert len(runs) == 4 and sorted(r.status for r in runs) == ["active", "superseded", "superseded", "superseded"]
    assert all(r.superseded_at for r in runs if r.status == "superseded")
    assert pg_repo.get_active_run(workspace_id=DEMO_WORKSPACE_ID).run_id in {s["run_id"] for _, s in results}


def test_analysis_waits_for_an_execution_in_flight_and_does_not_disturb_it(pg_repo, pg_connect):
    entered, gate = threading.Event(), threading.Event()
    clock = FakeClock()
    provider = ScriptedProvider(["recovered"], gate=gate, entered=entered)
    service = build_service([make_tx(1, amount=1500.0), make_tx(2)], provider=provider, clock=clock, repo=pg_repo)
    decision_before = pg_repo.get_decision(TX1, workspace_id=TEST_WS).decision_id
    worker = threading.Thread(target=lambda: service.execute_case(TEST_WS, TX1, "slow"))
    worker.start()
    assert entered.wait(timeout=20)

    other = attach(pg_connect(), ScriptedProvider(), clock)
    other.analyze_revenue(TEST_WS)                                                           # runs while TX1 is executing
    case = pg_connect().get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert case.state == CaseState.EXECUTING and case.decision_id == decision_before  # frozen: analysis left it alone

    gate.set()
    worker.join(timeout=30)
    final = pg_connect().get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert final.state == CaseState.RECOVERED and final.recovered_amount == 1500.0 and final.decision_id == decision_before


def test_an_execution_waits_for_an_analysis_that_holds_its_case_and_then_sees_the_refreshed_decision(pg_repo, pg_connect):
    """
    Analysis locks a chunk of cases and may rewrite their decisions. An execution that arrives while it
    holds the case must wait for it to commit and then act on the REFRESHED decision — not reserve against
    the old one and have analysis overwrite the case underneath it.
    """
    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    build_service([make_tx(1, amount=1500.0)], provider=provider, clock=clock, repo=pg_repo)
    stale_decision = pg_repo.get_decision(TX1, workspace_id=TEST_WS)
    assert stale_decision.final_action == "retry"

    tighter = replace(DEFAULT_POLICY, max_auto_recovery_value=500.0)          # 1500 now exceeds the ceiling -> escalate
    analyst = attach(pg_connect(), ScriptedProvider(), clock, policy=tighter)
    holding = threading.Event()
    real_facts = analyst.executor.policy_facts

    def slow_facts(*args, **kwargs):
        holding.set()
        time.sleep(0.8)                                                       # analysis holds the locked chunk
        return real_facts(*args, **kwargs)

    analyst.executor.policy_facts = slow_facts
    analysis_error, execution = [], {}

    def analyse():
        try:
            analyst.analyze_revenue(TEST_WS)
        except Exception as exc:  # noqa: BLE001
            analysis_error.append(exc)

    def execute():
        try:
            execution["outcome"] = attach(pg_connect(), provider, clock).execute_case(TEST_WS, TX1, "waiting-key")
        except Exception as exc:  # noqa: BLE001
            execution["error"] = exc

    t1 = threading.Thread(target=analyse)
    t1.start()
    assert holding.wait(timeout=20)
    t2 = threading.Thread(target=execute)
    t2.start()
    t1.join(60); t2.join(60)

    assert analysis_error == [], analysis_error                               # analysis was not undercut by the execution
    assert "error" not in execution, execution.get("error")
    assert execution["outcome"].intervention["status"] == "escalated_to_merchant"      # it acted on the refreshed decision
    assert [c["action"] for c in provider.calls] == ["escalate"]              # and never on the stale 'retry'
    final = pg_connect().get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert final.state == CaseState.ESCALATED and final.decision_id != stale_decision.decision_id


def test_a_scan_cannot_slip_between_authorization_and_reservation(pg_repo, pg_connect):
    """Reserving takes a shared lock on the active run; a scan that supersedes it must wait for the reservation."""
    provider, clock = ScriptedProvider(["recovered"]), FakeClock()
    service = build_service([make_tx(1)], provider=provider, clock=clock, repo=pg_repo)
    case = case_of(service, TX1)
    scanner = attach(pg_connect(), provider, clock)
    order = []
    inside, release = threading.Event(), threading.Event()

    def reserve_then_hold():
        with pg_repo.atomic():
            pg_repo.get_case(case.case_id, workspace_id=TEST_WS)
            assert pg_repo.get_active_run(workspace_id=TEST_WS).run_id == case.run_id          # shared lock on the active run
            inside.set()
            release.wait(10)
            order.append("reservation unit ends")

    def scan():
        inside.wait(10)
        scanner.scan_revenue(n_total=10, seed=999, merchant_id=TEST_WS)     # supersedes the SAME workspace's active run
        order.append("scan committed")

    t1, t2 = threading.Thread(target=reserve_then_hold), threading.Thread(target=scan)
    t1.start(); t2.start()
    time.sleep(0.5)
    assert order == []                                                      # the scan is waiting, not racing past us
    release.set()
    t1.join(30); t2.join(60)
    assert order == ["reservation unit ends", "scan committed"]


# ══════════════════════════════════════════════════════════════════════════
# Transient database aborts (deadlock / serialization failure)
# ══════════════════════════════════════════════════════════════════════════
def test_the_database_deadlock_is_reported_as_a_typed_transient_error_and_the_survivor_commits(pg_repo, pg_connect):
    """Two units lock two cases in opposite orders. PostgreSQL aborts one; the other must complete."""
    import psycopg2

    service = build_service([make_tx(1), make_tx(2)], repo=pg_repo)
    c1, c2 = case_of(service, TX1).case_id, case_of(service, TX2).case_id
    other = pg_connect()
    first_holds, second_holds = threading.Event(), threading.Event()
    outcome = {}

    def unit(name, repo, mine, theirs, mine_held, theirs_held):
        try:
            with repo.atomic():
                repo.get_case(mine, workspace_id=TEST_WS)
                mine_held.set()
                theirs_held.wait(10)
                repo.get_case(theirs, workspace_id=TEST_WS)                 # the opposite order: one of the two is the deadlock victim
                outcome[name] = "committed"
        except Exception as exc:  # noqa: BLE001
            outcome[name] = exc

    t1 = threading.Thread(target=unit, args=("a", pg_repo, c1, c2, first_holds, second_holds))
    t2 = threading.Thread(target=unit, args=("b", other, c2, c1, second_holds, first_holds))
    t1.start(); t2.start(); t1.join(30); t2.join(30)

    victims = [v for v in outcome.values() if isinstance(v, TransientStorageError)]
    survivors = [v for v in outcome.values() if v == "committed"]
    assert len(victims) == 1 and len(survivors) == 1, outcome            # a typed error, never a raw driver exception
    assert isinstance(victims[0].__cause__, psycopg2.errors.DeadlockDetected)


def test_a_transient_abort_during_reservation_is_retried_and_leaves_exactly_one_attempt(pg_repo, pg_connect):
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=1200.0)], provider=provider, repo=pg_repo)
    real_log, failures = service.audit_service.log_event, []

    def flaky_log(**kwargs):
        if kwargs["event_type"] == AuditEventType.EXECUTION_STARTED and not failures:
            failures.append(1)
            raise TransientStorageError("simulated deadlock at the last write of the reservation")
        return real_log(**kwargs)

    service.audit_service.log_event = flaky_log
    out = service.execute_case(TEST_WS, TX1, "flaky-reserve")
    assert out.intervention["status"] == "recovered" and failures == [1]

    check = pg_connect()
    case = check.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    attempts = check.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)
    assert len(attempts) == 1 and attempts[0].sequence == 1 and attempts[0].attempt_number == 1   # the aborted try left nothing
    assert len(provider.calls) == 1
    types = audit_types(check, TX1)
    assert types.count("ACTION_AUTHORIZED") == 1 and types.count("EXECUTION_STARTED") == 1       # and no duplicate events
    assert case.state == CaseState.RECOVERED and case.attempt_count == 1


def test_a_transient_abort_while_booking_the_result_is_retried_not_abandoned(pg_repo, pg_connect):
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=800.0)], provider=provider, repo=pg_repo)
    real_log, failures = service.audit_service.log_event, []

    def flaky_log(**kwargs):
        if kwargs["event_type"] == AuditEventType.EXECUTION_SUCCEEDED and len(failures) < 2:
            failures.append(1)
            raise TransientStorageError("simulated deadlock while booking the result")
        return real_log(**kwargs)

    service.audit_service.log_event = flaky_log
    out = service.execute_case(TEST_WS, TX1, "flaky-complete")
    assert out.intervention["status"] == "recovered" and len(failures) == 2
    check = pg_connect()
    case = check.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    assert len(provider.calls) == 1                                      # the provider was not called again
    assert len(check.get_all_interventions(run_id="all", workspace_id=TEST_WS)) == 1           # exactly one booked result
    assert case.recovered_amount == 800.0
    assert [a.status for a in check.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)] == [AttemptStatus.COMPLETED]


def test_a_persistently_failing_booking_ends_in_the_abort_path_not_a_stuck_case(pg_repo, pg_connect):
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=800.0)], provider=provider, repo=pg_repo)
    real_log = service.audit_service.log_event

    def always_flaky(**kwargs):
        if kwargs["event_type"] == AuditEventType.EXECUTION_SUCCEEDED:
            raise TransientStorageError("persistent")
        return real_log(**kwargs)

    service.audit_service.log_event = always_flaky
    with pytest.raises(TransientStorageError):
        service.execute_case(TEST_WS, TX1, "doomed")
    service.audit_service.log_event = real_log
    check = pg_connect()
    case = check.get_case_for_transaction(TX1, workspace_id=TEST_WS)
    (attempt,) = check.list_attempts(case_id=case.case_id, workspace_id=TEST_WS)
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.active_attempt_id is None      # released, not stranded
    assert attempt.status == AttemptStatus.FAILED and check.get_all_interventions(run_id="all", workspace_id=TEST_WS) == []
