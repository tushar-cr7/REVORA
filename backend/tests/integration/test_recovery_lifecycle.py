"""
Regression tests for Phase 1: recovery-case lifecycle, attempt ledger, execution-time
policy enforcement, scoped idempotency, scan isolation and bulk safety.

Every property is checked through observable state (the case, the attempt ledger,
interventions, analytics, audit events and what the provider was actually asked to
do) against deterministic fixtures — see backend/tests/support.py.
"""
import threading
import time
from dataclasses import replace

import pytest

from backend.app.domain.models import (
    Action,
    AttemptStatus,
    CaseState,
    ExecutionAttempt,
    IdempotencyRecord,
    utc_now_iso,
)
from backend.app.domain.policy import DEFAULT_POLICY
from backend.app.repositories.in_memory import InMemoryRepository
from backend.app.services.audit_service import AuditService
from backend.app.services.execution_service import (
    ActionMismatch,
    CaseConflict,
    CaseNotFound,
    IdempotencyInProgress,
    IdempotencyKeyInvalid,
    IdempotencyKeyReuse,
    PolicyDenied,
    ProviderFailure,
    ReplayedExecutionError,
    StaleRun,
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
    register_run,
)
from backend.tests.support import TEST_WS
from backend.app.domain.workspaces import DEMO_WORKSPACE_ID

TX1 = "tx_fp_000001"
TX2 = "tx_fp_000002"


def audit_types(service, tx_id=None):
    return [e.event_type for e in service.repo.get_audit_log(limit=10000, transaction_id=tx_id, workspace_id=TEST_WS)]


def widen_race_window(service, seconds=0.02):
    """
    Fault injection: stall inside the reservation critical section (right after the idempotency and
    state checks, before the attempt is written). Without real mutual exclusion every concurrent
    request would get through the checks and reserve; with it they queue up and see each other.
    """
    original = service.executor._policy_source

    def slow():
        time.sleep(seconds)
        return original()

    service.executor._policy_source = slow


# ──────────────────────────────────────────────────────────────────────────
# R1 — policy is re-evaluated at execution, against current state
# ──────────────────────────────────────────────────────────────────────────
def test_retry_cap_of_two_cannot_be_bypassed_by_repeated_execution():
    clock = FakeClock()
    provider = ScriptedProvider(outcomes=["no_recovery"])
    service = build_service([make_tx(1)], provider=provider, clock=clock)
    assert service.repo.get_decision(TX1, workspace_id=TEST_WS).final_action == "retry"

    # Cap = 2 and the ingested record shows 0 prior retries, so exactly two attempts are legitimate.
    for n in (1, 2):
        out = service.execute_case(TEST_WS, TX1, f"attempt-{n}")
        assert out.intervention["status"] == "attempted_no_recovery"
        clock.advance(hours=7)  # past the 6h cooldown, so only the cap is in play

    # The third and every later request is refused, however many fresh keys are used.
    for n in range(3, 12):
        with pytest.raises(PolicyDenied) as denied:
            service.execute_case(TEST_WS, TX1, f"attempt-{n}")
        assert "Retry limit exceeded (2/2)" in denied.value.message
        assert denied.value.extra["safe_alternative"] == "escalate"

    assert len(provider.calls) == 2  # nothing past the cap ever reached the provider
    case = case_of(service, TX1)
    assert case.attempt_count == 2
    assert case.state == CaseState.BLOCKED
    statuses = [a.status for a in ledger(service, TX1)]
    assert statuses.count(AttemptStatus.COMPLETED) == 2
    assert statuses.count(AttemptStatus.DENIED) == 9
    assert len(service.repo.get_all_interventions(workspace_id=TEST_WS)) == 2
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == 0


def test_a_decision_authorized_earlier_is_not_executable_after_the_policy_tightens():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=8000.0)], provider=provider)
    decision = service.repo.get_decision(TX1, workspace_id=TEST_WS)
    assert decision.policy_allowed and decision.final_action == "retry"

    service.policy = replace(DEFAULT_POLICY, max_auto_recovery_value=5000.0)  # constraint changes after analysis

    with pytest.raises(PolicyDenied) as denied:
        service.execute_case(TEST_WS, TX1, "k1")
    assert "auto-recovery ceiling" in denied.value.message
    assert provider.calls == []
    assert service.repo.get_all_interventions(workspace_id=TEST_WS) == []
    case = case_of(service, TX1)
    assert case.state == CaseState.BLOCKED and case.safe_alternative == "escalate"

    # Re-analysis refreshes the decision from current policy; only then is the rerouted action runnable.
    service.analyze_revenue(TEST_WS)
    refreshed = service.repo.get_decision(TX1, workspace_id=TEST_WS)
    assert refreshed.decision_id != decision.decision_id
    assert not refreshed.policy_allowed and refreshed.final_action == "escalate"
    out = service.execute_case(TEST_WS, TX1, "k2")
    assert out.intervention["status"] == "escalated_to_merchant"
    assert [c["action"] for c in provider.calls] == ["escalate"]
    assert case_of(service, TX1).state == CaseState.ESCALATED


def test_a_policy_denied_action_never_reaches_the_provider_and_is_audited_once():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=8000.0)], provider=provider)
    service.policy = replace(DEFAULT_POLICY, max_auto_recovery_value=5000.0)
    before = audit_types(service, TX1)

    with pytest.raises(PolicyDenied):
        service.execute_case(TEST_WS, TX1, "denied-key")
    assert provider.calls == []

    new_events = audit_types(service, TX1)[len(before):]
    assert new_events == ["ACTION_BLOCKED"]
    event = service.repo.get_audit_log(limit=10000, transaction_id=TX1, workspace_id=TEST_WS)[-1]
    assert event.outcome["status"] == "denied_at_execution"
    assert event.policy_result["allowed"] is False
    assert event.case_id == case_of(service, TX1).case_id and event.attempt_id

    # A replay of the denied request returns the same refusal and writes nothing new.
    count = len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS))
    ledger_len = len(ledger(service, TX1))
    with pytest.raises(ReplayedExecutionError) as again:
        service.execute_case(TEST_WS, TX1, "denied-key")
    assert again.value.status_code == 409 and again.value.code == "policy_denied" and again.value.replayed
    assert len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS)) == count
    assert len(ledger(service, TX1)) == ledger_len
    assert provider.calls == []


def test_missing_safety_critical_data_fails_closed_at_execution():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider)
    assert service.repo.get_decision(TX1, workspace_id=TEST_WS).final_action == "retry"

    # The figure disappears after the decision was made (bad re-sync, partial record, ...).
    service.repo.get_transaction_by_id(TX1, workspace_id=TEST_WS).retries_so_far = None

    with pytest.raises(PolicyDenied) as denied:
        service.execute_case(TEST_WS, TX1, "k1")
    assert "retries_so_far" in denied.value.message and "failing closed" in denied.value.message
    assert provider.calls == []
    assert case_of(service, TX1).state == CaseState.BLOCKED


def test_missing_data_at_ingestion_is_not_defaulted_to_a_permissive_zero():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, retries_so_far=None)], provider=provider)  # analysed with the gap present

    decision = service.repo.get_decision(TX1, workspace_id=TEST_WS)
    assert not decision.policy_allowed
    assert "Missing or invalid safety-critical input" in decision.policy_reason
    assert decision.final_action == "escalate"  # rerouted to a person, never silently retried

    out = service.execute_case(TEST_WS, TX1, "k1")
    assert out.intervention["status"] == "escalated_to_merchant"
    assert [c["action"] for c in provider.calls] == ["escalate"]


def test_hand_offs_and_no_action_are_always_executable_so_no_case_is_stranded():
    """
    A ₹40,000 failure inside the cooldown window is suppressed by the cooldown rule, which
    outranks the ceiling rule at decision time. Executing that suppression must still work:
    gating a no-action on the ceiling would strand the case (analysis re-derives the same
    decision, execution would deny it forever).
    """
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=40000.0, hours_since_event=2)], provider=provider)
    decision = service.repo.get_decision(TX1, workspace_id=TEST_WS)
    assert decision.ai_proposed_action == "retry" and decision.final_action == "suppress"
    assert not decision.policy_allowed and "Cooldown" in decision.policy_reason

    out = service.execute_case(TEST_WS, TX1, "k")
    assert out.intervention["status"] == "suppressed" and out.intervention["recovered_amount"] == 0.0
    assert case_of(service, TX1).state == CaseState.SUPPRESSED
    assert [c["action"] for c in provider.calls] == ["suppress"]
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == 0


def test_escalation_is_executable_even_when_safety_inputs_are_missing():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=40000.0)], provider=provider)   # over the ceiling -> escalate
    tx = service.repo.get_transaction_by_id(TX1, workspace_id=TEST_WS)
    tx.retries_so_far = tx.hours_since_event = None                              # data gap discovered later
    out = service.execute_case(TEST_WS, TX1, "k")
    assert out.intervention["status"] == "escalated_to_merchant"
    assert case_of(service, TX1).state == CaseState.ESCALATED


def test_read_only_paths_tolerate_a_record_with_a_data_gap():
    service = build_service([make_tx(1), make_tx(2, retries_so_far=None, hours_since_event=None)])
    sim = service.simulate_policy(TEST_WS, DEFAULT_POLICY)           # counts the gap as blocked, does not crash
    assert sim["total_transactions"] == 2 and sim["blocked_count"] >= 1
    answer = service.copilot_query(TEST_WS, "diagnose", transaction_id="tx_fp_000002")
    assert "unknown" in answer["answer"] and answer["key_metrics"]["policy_allowed"] is False


def test_subscription_missing_failure_count_fails_closed():
    service = build_service([make_tx(1, leak_type="failed_subscription", amount=900.0, consecutive_failures=None)])
    decision = service.repo.get_decision("tx_fs_000001", workspace_id=TEST_WS)
    assert not decision.policy_allowed and "consecutive_failures" in decision.policy_reason


# ──────────────────────────────────────────────────────────────────────────
# R2 — duplicates cannot manufacture recovery
# ──────────────────────────────────────────────────────────────────────────
def test_replay_with_the_same_key_creates_no_attempt_and_no_extra_recovery():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=2500.0)], provider=provider)

    first = service.execute_case(TEST_WS, TX1, "same-key")
    events_after_first = len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS))
    summary = service.get_analytics_summary(TEST_WS)
    assert first.intervention["recovered_amount"] == 2500.0 and not first.replayed

    for _ in range(5):
        replay = service.execute_case(TEST_WS, TX1, "same-key")
        assert replay.replayed
        assert replay.intervention == first.intervention  # the original result, verbatim

    assert len(provider.calls) == 1
    assert len(ledger(service, TX1)) == 1
    assert len(service.repo.get_all_interventions(workspace_id=TEST_WS)) == 1
    assert len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS)) == events_after_first  # replays add no audit events
    assert service.get_analytics_summary(TEST_WS) == summary
    assert summary["total_recovered"] == 2500.0 and summary["recovered_count"] == 1


def test_distinct_keys_cannot_recover_the_same_case_twice():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=2500.0)], provider=provider)
    service.execute_case(TEST_WS, TX1, "k0")

    for n in range(1, 8):
        with pytest.raises(CaseConflict) as conflict:
            service.execute_case(TEST_WS, TX1, f"k{n}")
        assert conflict.value.extra["case_state"] == "recovered"

    assert len(provider.calls) == 1
    assert len(ledger(service, TX1)) == 1  # refusals before authorization leave no ledger entry
    stats = service.get_analytics_summary(TEST_WS)
    assert stats["total_recovered"] == 2500.0 and stats["recovered_count"] == 1 and stats["attempted_count"] == 1


def test_analytics_count_unique_recovery_outcomes_only():
    provider = ScriptedProvider(["no_recovery", "recovered", "recovered", "recovered"])
    clock = FakeClock()
    service = build_service(
        [make_tx(1, amount=1000.0), make_tx(2, amount=2000.0), make_tx(3, amount=90000.0)],
        provider=provider, clock=clock,
    )
    service.execute_case(TEST_WS, TX1, "a1")           # no recovery
    clock.advance(hours=7)
    service.execute_case(TEST_WS, TX1, "a2")           # recovered on the second attempt
    service.execute_case(TEST_WS, TX2, "b1")           # recovered
    service.execute_case(TEST_WS, "tx_fp_000003", "c1")  # 90000 > ceiling: escalated, not a recovery
    for n in range(5):                        # hammer the finished cases
        service.execute_case(TEST_WS, TX2, "b1")       # replay
        with pytest.raises(CaseConflict):
            service.execute_case(TEST_WS, TX1, f"dup-{n}")

    stats = service.get_analytics_summary(TEST_WS)
    assert stats["total_recovered"] == 3000.0   # 1000 + 2000, each counted once
    assert stats["recovered_count"] == 2
    assert stats["attempted_count"] == 3        # three recovery-class attempts ran
    assert stats["attempted_amount"] == 3000.0  # two cases attempted
    assert stats["escalation_count"] == 1
    assert stats["execution_mode"] == "simulation"
    assert case_of(service, "tx_fp_000003").state == CaseState.ESCALATED
    assert case_of(service, "tx_fp_000003").recovered_amount == 0.0


# ──────────────────────────────────────────────────────────────────────────
# R3 — idempotency: scoped, fingerprinted, race-safe
# ──────────────────────────────────────────────────────────────────────────
def test_reusing_a_key_for_a_different_transaction_is_rejected():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1), make_tx(2)], provider=provider)
    first = service.execute_case(TEST_WS, TX1, "shared")

    with pytest.raises(IdempotencyKeyReuse) as reuse:
        service.execute_case(TEST_WS, TX2, "shared")
    assert reuse.value.status_code == 422

    assert case_of(service, TX2).state == CaseState.AUTHORIZED
    assert ledger(service, TX2) == []
    assert len(provider.calls) == 1
    assert service.execute_case(TEST_WS, TX1, "shared").intervention["intervention_id"] == first.intervention["intervention_id"]


def test_a_transaction_id_and_its_leak_id_are_the_same_target_for_a_key():
    service = build_service([make_tx(1)])
    first = service.execute_case(TEST_WS, TX1, "k")
    replay = service.execute_case(TEST_WS, "fp_000001", "k")  # leak id form of the same case
    assert replay.replayed and replay.intervention == first.intervention


def test_reusing_a_key_with_a_different_action_or_payload_is_rejected():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider)

    service.execute_case(TEST_WS, TX1, "k", expected_action="retry")
    assert service.execute_case(TEST_WS, TX1, "k", expected_action="retry").replayed      # same payload: fine
    with pytest.raises(IdempotencyKeyReuse):
        service.execute_case(TEST_WS, TX1, "k", expected_action="payment_link")            # different action
    with pytest.raises(IdempotencyKeyReuse):
        service.execute_case(TEST_WS, TX1, "k")                                              # payload dropped
    assert len(provider.calls) == 1


def test_expected_action_guards_against_a_changed_recommendation():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider)
    with pytest.raises(ActionMismatch) as mismatch:
        service.execute_case(TEST_WS, TX1, "k", expected_action="payment_link")
    assert mismatch.value.extra["authorized_action"] == "retry"
    assert provider.calls == [] and ledger(service, TX1) == []
    # A refusal that never reserved anything does not burn the key.
    assert service.execute_case(TEST_WS, TX1, "k", expected_action="retry").intervention["status"] == "recovered"


def test_idempotency_keys_are_scoped_by_merchant_and_operation():
    repo = InMemoryRepository()
    base = dict(request_fingerprint="fp", case_id="c", attempt_id="a", status="completed")
    repo.save_idempotency_record(IdempotencyRecord(merchant_id="m1", operation="execute_intervention", key="K", **base))
    assert repo.get_idempotency_record("m1", "execute_intervention", "K") is not None
    assert repo.get_idempotency_record("m2", "execute_intervention", "K") is None
    assert repo.get_idempotency_record("m1", "some_other_operation", "K") is None


def test_blank_keys_are_treated_as_absent_and_oversized_keys_are_refused():
    service = build_service([make_tx(1)])
    with pytest.raises(IdempotencyKeyInvalid):
        service.execute_case(TEST_WS, TX1, "k" * 256)
    assert ledger(service, TX1) == []
    out = service.execute_case(TEST_WS, TX1, "   ")  # whitespace-only == no key
    assert out.intervention["idempotency_key"] is None


def test_concurrent_identical_requests_produce_one_execution():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=4000.0)], provider=provider)
    widen_race_window(service)
    workers = 12
    barrier = threading.Barrier(workers)
    results, lock = [], threading.Lock()

    def worker():
        barrier.wait()
        try:
            outcome = ("ok", service.execute_case(TEST_WS, TX1, "race-key"))
        except Exception as exc:  # noqa: BLE001 - classified below
            outcome = ("err", exc)
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=worker) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    assert len(results) == workers

    oks = [r for kind, r in results if kind == "ok"]
    errs = [r for kind, r in results if kind == "err"]
    assert all(isinstance(e, IdempotencyInProgress) for e in errs), errs  # the only acceptable refusal
    assert len([o for o in oks if not o.replayed]) == 1
    assert len({o.intervention["intervention_id"] for o in oks}) == 1

    assert len(provider.calls) == 1
    assert len(ledger(service, TX1)) == 1
    assert len(service.repo.get_all_interventions(workspace_id=TEST_WS)) == 1
    stats = service.get_analytics_summary(TEST_WS)
    assert stats["total_recovered"] == 4000.0 and stats["recovered_count"] == 1


def test_concurrent_distinct_keys_on_one_case_produce_one_effect():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1, amount=4000.0)], provider=provider)
    widen_race_window(service)
    workers = 12
    barrier = threading.Barrier(workers)
    results, lock = [], threading.Lock()

    def worker(i):
        barrier.wait()
        try:
            outcome = ("ok", service.execute_case(TEST_WS, TX1, f"key-{i}"))
        except Exception as exc:  # noqa: BLE001
            outcome = ("err", exc)
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    oks = [r for kind, r in results if kind == "ok"]
    errs = [r for kind, r in results if kind == "err"]
    assert len(oks) == 1
    assert all(isinstance(e, CaseConflict) for e in errs), errs
    assert len(provider.calls) == 1 and len(ledger(service, TX1)) == 1
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == 4000.0


def test_an_in_flight_request_is_refused_not_duplicated_and_replays_once_finished():
    entered, gate = threading.Event(), threading.Event()
    provider = ScriptedProvider(["recovered"], gate=gate, entered=entered)
    service = build_service([make_tx(1, amount=1500.0)], provider=provider)
    result = {}

    def slow_request():
        result["outcome"] = service.execute_case(TEST_WS, TX1, "slow-key")

    thread = threading.Thread(target=slow_request)
    thread.start()
    assert entered.wait(timeout=10)  # the attempt is reserved and the provider call is in flight

    # While in flight the ledger shows a reserved attempt that already counts.
    case = case_of(service, TX1)
    assert case.state == CaseState.EXECUTING and case.attempt_count == 1
    assert [a.status for a in ledger(service, TX1)] == [AttemptStatus.RESERVED]

    with pytest.raises(IdempotencyInProgress):
        service.execute_case(TEST_WS, TX1, "slow-key")      # the same request again
    with pytest.raises(CaseConflict):
        service.execute_case(TEST_WS, TX1, "another-key")   # a different request for the same case
    assert len(provider.calls) == 1

    gate.set()
    thread.join(timeout=10)
    replay = service.execute_case(TEST_WS, TX1, "slow-key")
    assert replay.replayed and replay.intervention == result["outcome"].intervention
    assert len(provider.calls) == 1 and len(ledger(service, TX1)) == 1
    assert case_of(service, TX1).state == CaseState.RECOVERED


# ──────────────────────────────────────────────────────────────────────────
# Attempt ledger & case state machine, observed through execution
# ──────────────────────────────────────────────────────────────────────────
def test_attempt_ledger_records_authorization_numbering_and_outcomes():
    clock = FakeClock()
    provider = ScriptedProvider(["no_recovery", "recovered"])
    service = build_service([make_tx(1, amount=3000.0)], provider=provider, clock=clock)
    case = case_of(service, TX1)
    assert case.state == CaseState.AUTHORIZED and case.attempt_count == 0

    service.execute_case(TEST_WS, TX1, "a1")
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.attempt_count == 1
    clock.advance(hours=7)
    service.execute_case(TEST_WS, TX1, "a2")
    assert case.state == CaseState.RECOVERED and case.attempt_count == 2

    first, second = ledger(service, TX1)
    assert (first.sequence, first.attempt_number, second.sequence, second.attempt_number) == (1, 1, 2, 2)
    assert first.status == second.status == AttemptStatus.COMPLETED
    assert (first.outcome_status, first.recovered, first.recovered_amount) == ("attempted_no_recovery", False, 0.0)
    assert (second.outcome_status, second.recovered, second.recovered_amount) == ("recovered", True, 3000.0)
    assert case.recovered_attempt_id == second.attempt_id and case.recovered_amount == 3000.0

    # Each attempt carries its own authorization, computed from the ledger as it stood.
    assert first.requested_action == first.final_action == "retry"
    assert first.authorization["allowed"] and first.authorization["policy_version"]
    assert first.authorization["limits"]["max_retries"] == 2
    assert first.authorization["inputs"]["retries_so_far"] == 0
    assert second.authorization["inputs"]["retries_so_far"] == 1
    assert second.authorization["inputs"]["hours_since_last_attempt"] == pytest.approx(7.0)
    assert first.provider == "ScriptedProvider" and first.execution_mode == "simulation"
    assert first.decision_id == case.decision_id

    interventions = service.repo.get_all_interventions(workspace_id=TEST_WS)
    assert {i.attempt_id for i in interventions} == {first.attempt_id, second.attempt_id}
    assert all(i.case_id == case.case_id and i.run_id == case.run_id for i in interventions)
    assert all(i.execution_mode == "simulation" for i in interventions)
    assert [h["to"] for h in case.history] == [
        "authorized", "executing", "attempted_no_recovery", "executing", "recovered",
    ]


def test_a_failed_attempt_needs_fresh_policy_authorization_before_it_can_be_retried():
    clock = FakeClock()
    provider = ScriptedProvider(["no_recovery", "recovered"])
    service = build_service([make_tx(1)], provider=provider, clock=clock)
    first = service.execute_case(TEST_WS, TX1, "k1")
    assert first.intervention["status"] == "attempted_no_recovery"

    # Same key: a replay of attempt 1, not a new attempt.
    assert service.execute_case(TEST_WS, TX1, "k1").replayed
    assert len(provider.calls) == 1

    # New key straight away: a new attempt was requested but the cooldown since the last retry holds.
    with pytest.raises(PolicyDenied) as denied:
        service.execute_case(TEST_WS, TX1, "k2")
    assert "Cooldown not elapsed" in denied.value.message
    assert len(provider.calls) == 1
    assert case_of(service, TX1).state == CaseState.BLOCKED
    assert case_of(service, TX1).attempt_count == 1  # the denial consumed nothing

    # Once policy is satisfied the same new request is authorized afresh and becomes attempt 2.
    clock.advance(hours=7)
    second = service.execute_case(TEST_WS, TX1, "k3")
    assert second.intervention["status"] == "recovered"
    assert [a.attempt_number for a in ledger(service, TX1) if a.status == AttemptStatus.COMPLETED] == [1, 2]
    assert len(provider.calls) == 2


def test_a_provider_failure_is_recorded_counted_and_replayable_but_never_a_recovery():
    clock = FakeClock()
    provider = ScriptedProvider(["raise", "recovered"])
    service = build_service([make_tx(1)], provider=provider, clock=clock)

    with pytest.raises(ProviderFailure) as failure:
        service.execute_case(TEST_WS, TX1, "k1")
    assert failure.value.status_code == 502
    case = case_of(service, TX1)
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.attempt_count == 1
    assert case.active_attempt_id is None  # never stranded in "executing"
    (attempt,) = ledger(service, TX1)
    assert attempt.status == AttemptStatus.FAILED and "scripted provider outage" in attempt.failure_reason
    assert service.repo.get_all_interventions(workspace_id=TEST_WS) == []
    stats = service.get_analytics_summary(TEST_WS)
    assert stats["total_recovered"] == 0 and stats["recovered_count"] == 0 and stats["attempted_count"] == 1
    assert "EXECUTION_FAILED" in audit_types(service, TX1) and "EXECUTION_SUCCEEDED" not in audit_types(service, TX1)

    with pytest.raises(ReplayedExecutionError) as replayed:   # same key: the stored failure, no second call
        service.execute_case(TEST_WS, TX1, "k1")
    assert replayed.value.status_code == 502 and len(provider.calls) == 1

    with pytest.raises(PolicyDenied):                          # the failed call still counts toward cooldown
        service.execute_case(TEST_WS, TX1, "k2")
    clock.advance(hours=7)
    assert service.execute_case(TEST_WS, TX1, "k3").intervention["status"] == "recovered"


def test_a_bookkeeping_failure_after_the_provider_call_releases_the_case_and_the_key(caplog):
    clock = FakeClock()
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider, clock=clock)

    def explode(_intervention):
        raise RuntimeError("storage fault")

    service.repo.save_intervention = explode            # fault injection: first write after the provider returns
    with pytest.raises(RuntimeError):
        service.execute_case(TEST_WS, TX1, "k1")
    del service.repo.save_intervention                  # storage recovers

    case = case_of(service, TX1)
    assert case.state == CaseState.ATTEMPTED_NO_RECOVERY and case.active_attempt_id is None
    (attempt,) = ledger(service, TX1)
    assert attempt.status == AttemptStatus.FAILED and "bookkeeping" in attempt.failure_reason
    assert case.attempt_count == 1                       # the provider call may have happened: it counts
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == 0
    assert "execution bookkeeping failed" in caplog.text

    with pytest.raises(ReplayedExecutionError) as replayed:   # the key is not stuck "in progress"
        service.execute_case(TEST_WS, TX1, "k1")
    assert replayed.value.status_code == 500 and replayed.value.code == "execution_bookkeeping_error"
    assert len(provider.calls) == 1

    clock.advance(hours=7)                                    # and the case can be retried with fresh authorization
    assert service.execute_case(TEST_WS, TX1, "k2").intervention["status"] == "recovered"


@pytest.mark.parametrize("bad_status", ["recovered_but_wrong_tx", "unknown_status", "wrong_action"])
def test_an_untrustworthy_provider_result_is_never_recorded_as_a_recovery(bad_status):
    class BadProvider(ScriptedProvider):
        def execute(self, leak, decision, idempotency_key=None):
            itv = super().execute(leak, decision, idempotency_key)
            if bad_status == "recovered_but_wrong_tx":
                itv.transaction_id = "tx_somebody_else"
            elif bad_status == "unknown_status":
                itv.status, itv.recovered, itv.recovered_amount = "settled", True, itv.amount
            else:
                itv.final_action = "payment_link"
            return itv

    service = build_service([make_tx(1)], provider=BadProvider(["recovered"]))
    with pytest.raises(ProviderFailure):
        service.execute_case(TEST_WS, TX1, "k")
    assert case_of(service, TX1).state == CaseState.ATTEMPTED_NO_RECOVERY
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == 0
    assert service.repo.get_all_interventions(workspace_id=TEST_WS) == []


def test_terminal_cases_refuse_further_execution_without_touching_the_ledger():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1), make_tx(2, amount=90000.0)], provider=provider)
    service.execute_case(TEST_WS, TX1, "r")       # recovered
    service.execute_case(TEST_WS, TX2, "e")       # escalated (over the ceiling)
    calls, events = len(provider.calls), len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS))

    for tx_id, state in ((TX1, "recovered"), (TX2, "escalated")):
        with pytest.raises(CaseConflict) as conflict:
            service.execute_case(TEST_WS, tx_id, "new-key")
        assert conflict.value.extra["case_state"] == state
        assert len(ledger(service, tx_id)) == 1
    assert len(provider.calls) == calls
    assert len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS)) == events


def test_contact_cap_is_enforced_from_the_ledger_not_from_the_decision_time_snapshot():
    clock = FakeClock()
    provider = ScriptedProvider(["recovered"])
    service = build_service(
        [make_tx(1, leak_type="abandoned_checkout", customer_id="cust_shared")], provider=provider, clock=clock
    )
    tx_id = "tx_ac_000001"
    assert service.repo.get_decision(tx_id, workspace_id=TEST_WS).final_action == "payment_link"  # allowed when analysed

    # Since analysis, another case reached the same customer (a completed contact on the ledger).
    service.repo.save_attempt(ExecutionAttempt(
        attempt_id="att_prior", case_id="case_elsewhere", run_id="run_elsewhere", merchant_id="merch_test",
        transaction_id="tx_elsewhere", customer_id="cust_shared", sequence=1, attempt_number=1,
        requested_action="reminder", final_action="reminder", decision_id=None,
        authorization={"allowed": True, "final_action": "reminder"}, status=AttemptStatus.COMPLETED,
        idempotency_key=None, request_fingerprint="x", provider="ScriptedProvider", execution_mode="simulation",
        created_at=clock().isoformat(), completed_at=clock().isoformat(),
    ))

    with pytest.raises(PolicyDenied) as denied:
        service.execute_case(TEST_WS, tx_id, "k1")
    assert "Daily customer contact limit" in denied.value.message
    assert provider.calls == []

    clock.advance(hours=25)   # the trailing 24h window has passed
    assert service.execute_case(TEST_WS, tx_id, "k2").intervention["status"] == "recovered"


def test_a_denied_or_failed_contact_ledger_entry_counts_correctly():
    clock = FakeClock()
    service = build_service(
        [make_tx(1, leak_type="abandoned_checkout", customer_id="cust_a"),
         make_tx(2, leak_type="abandoned_checkout", customer_id="cust_a")],
        clock=clock,
    )
    # Same customer, one run: the decision-time contact plan allows one contact and reroutes the other.
    first, second = service.repo.get_decision("tx_ac_000001", workspace_id=TEST_WS), service.repo.get_decision("tx_ac_000002", workspace_id=TEST_WS)
    assert first.final_action == "payment_link" and first.policy_allowed
    assert second.final_action == "suppress" and "contact limit" in second.policy_reason

    service.execute_case(TEST_WS, "tx_ac_000001", "k1")
    service.analyze_revenue(TEST_WS)   # re-analysis sees the real contact on the ledger and keeps the plan
    assert service.repo.get_decision("tx_ac_000002", workspace_id=TEST_WS).final_action == "suppress"


# ──────────────────────────────────────────────────────────────────────────
# Analysis is idempotent
# ──────────────────────────────────────────────────────────────────────────
def test_reanalysis_does_not_churn_decisions_or_duplicate_audit_events():
    service = build_service([make_tx(1), make_tx(2, leak_type="abandoned_checkout", amount=3000.0)])
    ids = {t: service.repo.get_decision(t, workspace_id=TEST_WS).decision_id for t in (TX1, "tx_ac_000002")}
    events = len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS))

    for _ in range(3):
        service.analyze_revenue(TEST_WS)

    assert {t: service.repo.get_decision(t, workspace_id=TEST_WS).decision_id for t in ids} == ids
    assert len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS)) == events
    assert audit_types(service).count("DECISION_CREATED") == 2


def test_reanalysis_leaves_cases_with_recorded_outcomes_alone():
    service = build_service([make_tx(1, amount=2000.0)])
    service.execute_case(TEST_WS, TX1, "k")
    decision_id = service.repo.get_decision(TX1, workspace_id=TEST_WS).decision_id
    service.policy = replace(DEFAULT_POLICY, max_retries=0)   # would now block a retry
    service.analyze_revenue(TEST_WS)
    assert service.repo.get_decision(TX1, workspace_id=TEST_WS).decision_id == decision_id
    assert case_of(service, TX1).state in (CaseState.RECOVERED, CaseState.ATTEMPTED_NO_RECOVERY)


def test_a_case_that_was_never_analysed_is_decided_on_demand_as_before():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider, analyze=False)
    assert case_of(service, TX1).state == CaseState.OPEN

    out = service.execute_case(TEST_WS, TX1, "k")
    assert out.intervention["status"] == "recovered"
    assert case_of(service, TX1).decision_id is not None and "DECISION_CREATED" in audit_types(service, TX1)


# ──────────────────────────────────────────────────────────────────────────
# Audit trail
# ──────────────────────────────────────────────────────────────────────────
def test_execution_lifecycle_events_are_ordered_attributed_and_never_falsely_successful():
    clock = FakeClock()
    service = build_service([make_tx(1), make_tx(2, amount=90000.0)],
                            provider=ScriptedProvider(["no_recovery"]), clock=clock)
    service.execute_case(TEST_WS, TX1, "k1")
    service.execute_case(TEST_WS, TX2, "k2")

    assert audit_types(service, TX1) == ["DECISION_CREATED", "ACTION_AUTHORIZED", "EXECUTION_STARTED", "EXECUTION_FAILED"]
    assert audit_types(service, TX2) == ["ACTION_BLOCKED", "ACTION_AUTHORIZED", "EXECUTION_STARTED", "ESCALATION_CREATED"]
    assert "EXECUTION_SUCCEEDED" not in audit_types(service)  # nothing recovered, nothing reported as success

    case = case_of(service, TX1)
    exec_events = [e for e in service.repo.get_audit_log(limit=10000, transaction_id=TX1, workspace_id=TEST_WS) if e.attempt_id]
    assert {e.attempt_id for e in exec_events} == {ledger(service, TX1)[0].attempt_id}
    assert all(e.case_id == case.case_id and e.run_id == case.run_id for e in exec_events)
    assert exec_events[-1].intervention_id is not None            # existing consumers rely on this
    assert exec_events[-1].outcome["status"] == "attempted_no_recovery"
    assert exec_events[-1].outcome["recovered"] is False


# ──────────────────────────────────────────────────────────────────────────
# R4 — scan runs isolate state
# ──────────────────────────────────────────────────────────────────────────
def _real_scan_service(provider=None):
    repo = InMemoryRepository()
    service = RecoveryService(repo=repo, audit_service=AuditService(repo), provider=provider or ScriptedProvider(["recovered"]),
                              clock=FakeClock())
    service.model = FixedProbModel(0.9)
    return service


def test_a_new_scan_cannot_attach_history_to_a_different_transaction():
    service = _real_scan_service()
    repo = service.repo

    scan_a = service.scan_revenue(n_total=50, seed=42)
    scan_b = service.scan_revenue(n_total=100, seed=42)
    run_a, run_b = scan_a["run_id"], scan_b["run_id"]
    assert run_a != run_b and scan_b["superseded_run_id"] == run_a and not scan_b["reused_existing_run"]

    # The hazard: the same transaction id is a different record (different amount) in the two runs.
    collisions = [
        t.transaction_id for t in repo.get_all_transactions(run_a, workspace_id=DEMO_WORKSPACE_ID)
        if repo.get_transaction_by_id(t.transaction_id, run_b, workspace_id=DEMO_WORKSPACE_ID)
        and repo.get_transaction_by_id(t.transaction_id, run_b, workspace_id=DEMO_WORKSPACE_ID).amount != t.amount
    ]
    assert collisions, "fixture should contain ids whose data differs between scans"
    tx_id = collisions[0]
    amount_a = repo.get_transaction_by_id(tx_id, run_a, workspace_id=DEMO_WORKSPACE_ID).amount
    amount_b = repo.get_transaction_by_id(tx_id, run_b, workspace_id=DEMO_WORKSPACE_ID).amount

    # Work happens in run A...
    again = service.scan_revenue(n_total=50, seed=42)
    assert again["run_id"] == run_a and again["reused_existing_run"] and again["superseded_run_id"] == run_b
    service.analyze_revenue(DEMO_WORKSPACE_ID)
    executed = service.execute_case(DEMO_WORKSPACE_ID, tx_id, "run-a-key")
    case_a = repo.get_case_for_transaction(tx_id, workspace_id=DEMO_WORKSPACE_ID)
    assert case_a.run_id == run_a and executed.intervention["amount"] == amount_a
    decision_a = repo.get_decision(case_a.decision_id, workspace_id=DEMO_WORKSPACE_ID)
    assert decision_a.run_id == run_a

    # ...then run B becomes active. A's history must not follow the id.
    scan_b2 = service.scan_revenue(n_total=100, seed=42)
    assert scan_b2["run_id"] == run_b and scan_b2["reused_existing_run"]
    case_b = repo.get_case_for_transaction(tx_id, workspace_id=DEMO_WORKSPACE_ID)
    assert case_b.case_id != case_a.case_id and case_b.run_id == run_b
    assert case_b.state == CaseState.OPEN and case_b.attempt_count == 0 and case_b.decision_id is None
    assert repo.get_transaction_by_id(tx_id, workspace_id=DEMO_WORKSPACE_ID).amount == amount_b != amount_a
    assert repo.get_decision(tx_id, workspace_id=DEMO_WORKSPACE_ID) is None                              # A's decision is not B's
    assert repo.get_decision(decision_a.decision_id, workspace_id=DEMO_WORKSPACE_ID).run_id == run_a     # ...but is still retrievable by id

    # Historical records keep their original relationships.
    itv = repo.get_intervention_by_id(executed.intervention["intervention_id"], workspace_id=DEMO_WORKSPACE_ID)
    assert itv.run_id == run_a and itv.case_id == case_a.case_id and itv.amount == amount_a
    assert repo.get_transaction_by_id(itv.transaction_id, itv.run_id, workspace_id=DEMO_WORKSPACE_ID).amount == itv.amount
    assert case_a.state in (CaseState.RECOVERED, CaseState.ATTEMPTED_NO_RECOVERY, CaseState.ESCALATED, CaseState.SUPPRESSED)

    # Default reads show only the active run; history stays reachable explicitly.
    assert service.get_interventions(DEMO_WORKSPACE_ID) == []
    assert len(service.get_interventions(DEMO_WORKSPACE_ID, run_id="all")) == 1
    assert service.get_analytics_summary(DEMO_WORKSPACE_ID)["total_recovered"] == 0
    assert repo.get_audit_log(limit=10000, transaction_id=tx_id, workspace_id=DEMO_WORKSPACE_ID) == []
    assert len(repo.get_audit_log(limit=10000, transaction_id=tx_id, run_id="all", workspace_id=DEMO_WORKSPACE_ID)) >= 3

    # B's case runs independently of A's.
    service.analyze_revenue(DEMO_WORKSPACE_ID)
    out_b = service.execute_case(DEMO_WORKSPACE_ID, tx_id, "run-b-key")
    assert out_b.case_id == case_b.case_id and out_b.intervention["amount"] == amount_b
    assert len(repo.list_attempts(case_id=case_a.case_id, workspace_id=DEMO_WORKSPACE_ID)) == 1   # A's ledger was not touched by B's execution
    assert len(ledger(service, tx_id, DEMO_WORKSPACE_ID)) == 1                         # ledger() resolves the active run's (B's) case


def test_a_case_from_a_superseded_run_is_not_executable():
    service = _real_scan_service()
    service.scan_revenue(n_total=50, seed=42)
    service.analyze_revenue(DEMO_WORKSPACE_ID)
    old_case = service.repo.list_cases(workspace_id=DEMO_WORKSPACE_ID)[0]
    service.scan_revenue(n_total=100, seed=42)

    with pytest.raises(StaleRun) as stale:
        service.execute_case(DEMO_WORKSPACE_ID, old_case.case_id, "k")
    assert stale.value.status_code == 409
    assert service.repo.list_attempts(case_id=old_case.case_id, workspace_id=DEMO_WORKSPACE_ID) == []
    assert old_case.state != CaseState.EXECUTING


def test_repeating_an_identical_scan_keeps_all_state_instead_of_resetting_it():
    service = _real_scan_service()
    service.scan_revenue(n_total=50, seed=42)
    service.analyze_revenue(DEMO_WORKSPACE_ID)
    tx_id = service.get_opportunities(DEMO_WORKSPACE_ID, limit=1)[0]["transaction_id"]
    service.execute_case(DEMO_WORKSPACE_ID, tx_id, "k")
    case = service.repo.get_case_for_transaction(tx_id, workspace_id=DEMO_WORKSPACE_ID)
    state, attempts, decisions = case.state, len(ledger(service, tx_id, DEMO_WORKSPACE_ID)), len(service.repo.get_all_decisions(workspace_id=DEMO_WORKSPACE_ID))

    for _ in range(3):   # the dashboard re-scans on page loads
        again = service.scan_revenue(n_total=50, seed=42)
        service.analyze_revenue(DEMO_WORKSPACE_ID)
        assert again["reused_existing_run"]

    assert service.repo.get_case_for_transaction(tx_id, workspace_id=DEMO_WORKSPACE_ID) is case
    assert (case.state, len(ledger(service, tx_id, DEMO_WORKSPACE_ID)), len(service.repo.get_all_decisions(workspace_id=DEMO_WORKSPACE_ID))) == (state, attempts, decisions)
    assert len(service.get_interventions(DEMO_WORKSPACE_ID)) == 1
    assert service.repo.get_active_run(workspace_id=DEMO_WORKSPACE_ID).scan_count == 4
    with pytest.raises(CaseConflict):
        service.execute_case(DEMO_WORKSPACE_ID, tx_id, "after-rescan")


def test_unknown_targets_are_not_found():
    service = build_service([make_tx(1)])
    with pytest.raises(CaseNotFound) as missing:
        service.execute_case(TEST_WS, "tx_nope", "k")
    assert isinstance(missing.value, ValueError) and missing.value.status_code == 404


# ──────────────────────────────────────────────────────────────────────────
# Bulk recovery shares the pathway
# ──────────────────────────────────────────────────────────────────────────
def _bulk_fixture(**kw):
    txs = [
        make_tx(1, amount=1000.0), make_tx(2, amount=2000.0), make_tx(3, amount=3000.0),
        make_tx(4, leak_type="abandoned_checkout", amount=4000.0),
        make_tx(5, leak_type="abandoned_checkout", amount=5000.0),
        make_tx(6, leak_type="overdue_invoice", amount=8000.0, age_days=45, hours_since_event=45 * 24),
    ]
    provider = ScriptedProvider(["recovered", "no_recovery", "recovered", "no_recovery", "recovered"])
    return build_service(txs, provider=provider, **kw), provider


def test_bulk_recovery_twice_does_not_duplicate_anything():
    service, provider = _bulk_fixture()

    first = service.recover_revenue(TEST_WS)
    assert first["executed_now"] == 6 and first["skipped_now"] == 0 and first["blocked_now"] == 0
    assert (first["recovered_now"] + first["not_recovered_now"] + first["escalated_now"]
            + first["suppressed_now"]) == first["executed_now"]
    assert first["escalated_now"] == 1                       # the 45-day invoice is rerouted, not "recovered"
    assert first["policy_violations"] == 0
    calls = len(provider.calls)
    assert calls == 6
    snapshot = {k: first[k] for k in ("total_recovered", "recovered_count", "attempted_count", "actions_executed")}

    second = service.recover_revenue(TEST_WS)
    assert second["executed_now"] == 0 and second["skipped_now"] == 6
    assert len(provider.calls) == calls
    assert {k: second[k] for k in snapshot} == snapshot       # cumulative figures unchanged
    assert len(service.repo.get_all_interventions(workspace_id=TEST_WS)) == 6
    assert len(service.repo.list_attempts(workspace_id=TEST_WS)) == 6
    assert service.get_analytics_summary(TEST_WS)["total_recovered"] == first["total_recovered"]

    recovered_amounts = sum(c.amount for c in service.repo.list_cases(workspace_id=TEST_WS) if c.state == CaseState.RECOVERED)
    assert first["total_recovered"] == recovered_amounts
    assert first["total_recovered"] <= first["total_at_risk"]


def test_bulk_recovery_applies_execution_time_policy_to_every_case():
    service, provider = _bulk_fixture()
    service.policy = replace(DEFAULT_POLICY, max_auto_recovery_value=2500.0)  # tightened after analysis

    result = service.recover_revenue(TEST_WS)
    # Cases whose stale decision is now above the ceiling are denied at execution and never reach the
    # provider. The invoice already rerouted to escalation stays executable: handing it to a person is safe.
    assert result["blocked_now"] == 3 and result["executed_now"] == 3
    assert sorted(c["action"] for c in provider.calls) == ["escalate", "retry", "retry"]
    assert result["escalated_now"] == 1
    assert result["policy_violations"] == 0

    denied = lambda: [a for a in service.repo.list_attempts(workspace_id=TEST_WS) if a.status == AttemptStatus.DENIED]  # noqa: E731
    assert len(denied()) == 3
    audit_after_first = len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS))

    repeat = service.recover_revenue(TEST_WS)
    assert repeat["executed_now"] == 0 and repeat["blocked_now"] == 3 and repeat["skipped_now"] == 3
    # The stored denials are replayed: a second bulk call writes no new ledger or audit entries.
    assert len(denied()) == 3
    assert len(service.repo.get_audit_log(limit=10000, workspace_id=TEST_WS)) == audit_after_first
    assert len(provider.calls) == 3


def test_bulk_recovery_does_not_retry_a_failed_case():
    clock = FakeClock()
    service, provider = _bulk_fixture(clock=clock)
    service.recover_revenue(TEST_WS)
    retried_candidates = [c for c in service.repo.list_cases(workspace_id=TEST_WS) if c.state == CaseState.ATTEMPTED_NO_RECOVERY]
    assert retried_candidates
    clock.advance(hours=48)
    calls = len(provider.calls)
    again = service.recover_revenue(TEST_WS)
    assert again["executed_now"] == 0 and len(provider.calls) == calls   # a retry takes an explicit request


def test_bulk_recovery_requires_a_scan():
    repo = InMemoryRepository()
    service = RecoveryService(repo=repo, audit_service=AuditService(repo), provider=ScriptedProvider())
    with pytest.raises(ValueError):
        service.recover_revenue(TEST_WS)


def test_policy_violations_is_computed_from_the_ledger_not_hard_coded():
    service, _ = _bulk_fixture()
    service.recover_revenue(TEST_WS)
    assert service.recover_revenue(TEST_WS)["policy_violations"] == 0

    # Corrupt one attempt so it claims an action its authorization did not allow.
    attempt = service.repo.list_attempts(workspace_id=TEST_WS)[0]
    attempt.authorization = dict(attempt.authorization, final_action="payment_link")
    assert service.recover_revenue(TEST_WS)["policy_violations"] == 1


# ──────────────────────────────────────────────────────────────────────────
# Misc contracts
# ──────────────────────────────────────────────────────────────────────────
def test_legacy_individual_execution_wrapper_returns_the_intervention_dict():
    service = build_service([make_tx(1)])
    itv = service.execute_individual_intervention(TEST_WS, TX1, idempotency_key="legacy")
    assert itv["transaction_id"] == TX1 and itv["idempotency_key"] == "legacy"
    assert service.execute_individual_intervention(TEST_WS, TX1, idempotency_key="legacy")["intervention_id"] == itv["intervention_id"]


def test_requests_without_a_key_are_still_guarded_by_case_state():
    provider = ScriptedProvider(["recovered"])
    service = build_service([make_tx(1)], provider=provider)
    service.execute_case(TEST_WS, TX1)
    with pytest.raises(CaseConflict):
        service.execute_case(TEST_WS, TX1)
    assert len(provider.calls) == 1


def test_case_detail_exposes_the_ledger():
    service = build_service([make_tx(1)])
    service.execute_case(TEST_WS, TX1, "k")
    case = case_of(service, TX1)
    detail = service.get_case_detail(TEST_WS, case.case_id)
    assert detail["state"] == "recovered" and detail["attempt_count"] == 1
    assert [a["status"] for a in detail["attempts"]] == ["completed"]
    assert service.get_case_detail(TEST_WS, "case_nope") is None
    assert service.get_cases(TEST_WS, state="recovered")[0]["case_id"] == case.case_id
    assert utc_now_iso() >= detail["created_at"]
