"""
Event ingestion and the detection boundary, end to end, on BOTH repositories (the `any_repo`
fixture runs each test against the in-memory repository and a real PostgreSQL).

What these pin down
  * a failure opens exactly one case, and an inert one: nothing is decided, authorized or executed;
  * redelivery and out-of-order delivery converge on the same state and never duplicate a case;
  * a settlement closes the case without counting as a recovery;
  * the merchant on an event is recorded as an unauthenticated claim and scopes everything it creates.
"""
import pytest

from backend.app.domain.events import ObligationStatus, ProcessingStatus
from backend.app.domain.models import AuditEventType, CaseState
from backend.app.repositories.errors import EventIdentityConflict
from backend.app.services.detection_service import DetectionOutcome
from backend.app.domain.workspaces import ExecutionNotAvailable
from backend.app.services.execution_service import StaleRun
from backend.app.services.recovery_service import RecoveryService
from backend.app.services.ingestion_service import EventValidationError
from backend.tests.events_support import (
    CHECKOUT_ABANDONED,
    CHECKOUT_STARTED,
    FAILED,
    INV_ISSUED,
    INV_OVERDUE,
    INV_PAID,
    INV_VOIDED,
    SUB_FAILED,
    SUCCEEDED,
    Pipeline,
    event,
    parsed,
)
from backend.tests.events_support import EVENTS_WS, ensure_event_workspace

OUTCOME = DetectionOutcome


@pytest.fixture
def pipe(any_repo):
    return Pipeline(any_repo)


# ── opening a case ───────────────────────────────────────────────────────
def test_a_payment_failure_opens_one_inert_recovery_case(pipe):
    result = pipe.ingest("e1")
    assert not result.duplicate and result.detection.outcome == OUTCOME.OPENED
    assert result.event.processing_status == "processed" and result.event.merchant_assertion == "unauthenticated_claim"

    obligation = pipe.obligation()
    assert obligation.status == "at_risk" and obligation.leak_type == "failed_payment"
    assert (obligation.amount_minor, obligation.currency, obligation.customer_ref) == (249900, "INR", "cust_1")

    case = pipe.case_of(obligation)
    assert case.state == CaseState.OPEN and case.amount == 2499.0 and case.leak_type == "failed_payment"
    assert case.decision_id is None and case.attempt_count == 0 and case.authorized_action is None
    run = pipe.repo.get_run(case.run_id, workspace_id=EVENTS_WS)
    assert run.kind == "ingestion" and run.status == "standby"
    assert pipe.repo.get_active_run(workspace_id=EVENTS_WS) is None  # an event never changes what the dashboard is looking at

    tx = pipe.repo.get_transaction_by_id(case.transaction_id, case.run_id, workspace_id=EVENTS_WS)
    assert tx.amount == 2499.0 and tx.customer_id == "cust_1" and tx.failure_code == "card_declined"
    # What the source never reported stays unknown instead of becoming a permissive default.
    assert tx.retries_so_far is None and tx.hours_since_event is None and tx.age_days is None
    assert tx.ltv_bucket is None and tx.prior_successful_payments is None


def test_receiving_an_event_executes_and_decides_nothing(pipe):
    pipe.ingest("e1")
    case = pipe.case_of()
    assert pipe.repo.list_attempts(case_id=case.case_id, workspace_id=EVENTS_WS) == []
    assert pipe.repo.get_all_interventions(run_id="all", workspace_id=EVENTS_WS) == []
    assert pipe.repo.get_all_decisions(run_id="all", workspace_id=EVENTS_WS) == []
    types = [e.event_type for e in pipe.repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS)]
    assert types == [AuditEventType.CASE_OPENED_FROM_EVENTS.value]
    event_row = pipe.repo.get_audit_log(limit=1, run_id="all", workspace_id=EVENTS_WS)[0]
    assert event_row.case_id == case.case_id and event_row.run_id == case.run_id


def test_an_event_derived_case_cannot_be_executed(pipe):
    pipe.ingest("e1")
    case = pipe.case_of()
    service = RecoveryService(repo=pipe.repo, audit_service=pipe.audit, clock=pipe.clock)
    with pytest.raises(ExecutionNotAvailable):        # merch_a is a merchant (recommend_only) workspace: refused at the gate
        service.execute_case(EVENTS_WS, case.case_id, "try-it")
    assert pipe.repo.list_attempts(case_id=case.case_id, workspace_id=EVENTS_WS) == []
    assert pipe.case_of().state == CaseState.OPEN

    # In a DEMO workspace the gate passes, and the case is still not executable: it is in no ACTIVE run.
    ensure_event_workspace(pipe.repo, "demo_events", "demo")
    pipe.ingest("e2", merchant="demo_events", ref="ord_demo")
    demo_case = pipe.case_of(merchant="demo_events", ref="ord_demo")
    with pytest.raises(StaleRun):
        service.execute_case("demo_events", demo_case.case_id, "try-it")
    assert pipe.repo.list_attempts(case_id=demo_case.case_id, workspace_id="demo_events") == []
    assert pipe.case_of(merchant="demo_events", ref="ord_demo").state == CaseState.OPEN


def test_each_supported_object_kind_opens_its_own_kind_of_case(pipe):
    pipe.ingest("p", FAILED, ref="ord_1")
    pipe.ingest("s", SUB_FAILED, ref="sub_1:2026-10", data={"failure_code": "x", "consecutive_failures": 3})
    pipe.ingest("i", INV_OVERDUE, ref="inv_1", data={"due_at": "2026-10-01T00:00:00+00:00"})
    kinds = {
        ("payment", "ord_1"): "failed_payment",
        ("subscription_cycle", "sub_1:2026-10"): "failed_subscription",
        ("invoice", "inv_1"): "overdue_invoice",
    }
    for (kind, ref), leak in kinds.items():
        case = pipe.case_of(kind=kind, ref=ref)
        assert case.leak_type == leak and case.state == CaseState.OPEN
    sub_tx = pipe.repo.get_transaction_by_id(pipe.case_of(kind="subscription_cycle", ref="sub_1:2026-10").transaction_id,
                                             pipe.case_of(kind="subscription_cycle", ref="sub_1:2026-10").run_id, workspace_id=EVENTS_WS)
    assert sub_tx.consecutive_failures == 3
    invoice_tx = pipe.repo.get_transaction_by_id(pipe.case_of(kind="invoice", ref="inv_1").transaction_id,
                                                 pipe.case_of(kind="invoice", ref="inv_1").run_id, workspace_id=EVENTS_WS)
    assert invoice_tx.age_days is None  # time-varying, so never stored as a stale number


def test_overdue_invoice_flow_issue_overdue_pay(pipe):
    pipe.ingest("i1", INV_ISSUED, at=0, ref="inv_9", data={"due_at": "2026-10-25T00:00:00+00:00"})
    assert pipe.obligation(kind="invoice", ref="inv_9").status == "observed"
    assert pipe.obligation(kind="invoice", ref="inv_9").case_id is None  # issued is not a failure
    assert pipe.ingest("i2", INV_OVERDUE, at=60, ref="inv_9").detection.outcome == OUTCOME.OPENED
    assert pipe.ingest("i3", INV_PAID, at=120, ref="inv_9").detection.outcome == OUTCOME.RESOLVED
    assert pipe.case_of(kind="invoice", ref="inv_9").state == CaseState.RESOLVED_AT_SOURCE


def test_a_voided_invoice_also_closes_the_case(pipe):
    pipe.ingest("o", INV_OVERDUE, at=0, ref="inv_2")
    result = pipe.ingest("v", INV_VOIDED, at=10, ref="inv_2")
    assert result.detection.outcome == OUTCOME.RESOLVED
    assert pipe.obligation(kind="invoice", ref="inv_2").status == ObligationStatus.VOID.value


# ── duplicates ───────────────────────────────────────────────────────────
def test_a_redelivered_event_is_acknowledged_and_changes_nothing(pipe):
    first = pipe.ingest("e1")
    snapshot = (
        len(pipe.repo.list_source_events(workspace_id=EVENTS_WS)), len(pipe.repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS)),
        pipe.obligation().event_count, pipe.case_of().case_id,
    )
    for _ in range(4):
        again = pipe.ingest("e1")
        assert again.duplicate and again.detection is None
        assert again.event.event_id == first.event.event_id
    assert snapshot == (
        len(pipe.repo.list_source_events(workspace_id=EVENTS_WS)), len(pipe.repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS)),
        pipe.obligation().event_count, pipe.case_of().case_id,
    )
    assert len(pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1


def test_the_same_identity_with_different_content_is_a_conflict_and_the_original_survives(pipe):
    pipe.ingest("e1", amount_minor=249900)
    with pytest.raises(EventIdentityConflict) as err:
        pipe.ingest("e1", amount_minor=999900)
    assert err.value.event_id == pipe.repo.list_source_events(workspace_id=EVENTS_WS)[0].event_id
    assert pipe.repo.list_source_events(workspace_id=EVENTS_WS)[0].amount_minor == 249900
    assert pipe.case_of().amount == 2499.0
    assert len(pipe.repo.list_source_events(workspace_id=EVENTS_WS)) == 1


def test_identity_is_scoped_by_merchant_and_by_source(pipe):
    a = pipe.ingest("same-id", merchant="merch_a")
    b = pipe.ingest("same-id", merchant="merch_b")        # another merchant's claim: its own event
    c = pipe.ingest("same-id", merchant="merch_a", source="other")
    assert len({a.event.event_id, b.event.event_id, c.event.event_id}) == 3
    assert not a.duplicate and not b.duplicate and not c.duplicate
    # three events, in the two workspaces that claimed them: (merch_a, internal), (merch_a, other), (merch_b, internal)
    assert len(pipe.repo.list_source_events(workspace_id="merch_a")) == 2
    assert len(pipe.repo.list_source_events(workspace_id="merch_b")) == 1


def test_merchants_never_share_obligations_runs_or_cases(pipe):
    pipe.ingest("e1", merchant="merch_a", ref="ord_1")
    pipe.ingest("e1", merchant="merch_b", ref="ord_1")    # same reference id, different claimed merchant
    a, b = pipe.obligation(merchant="merch_a"), pipe.obligation(merchant="merch_b")
    assert a.obligation_id != b.obligation_id and a.case_id != b.case_id and a.run_id != b.run_id
    assert pipe.repo.get_case(a.case_id, workspace_id="merch_a").merchant_id == "merch_a"
    assert pipe.repo.get_case(b.case_id, workspace_id="merch_b").merchant_id == "merch_b"
    assert pipe.repo.get_case(b.case_id, workspace_id="merch_a") is None          # not visible from the other workspace
    assert pipe.repo.get_obligation(b.obligation_id, workspace_id="merch_a") is None
    # A settlement for merchant A must not touch merchant B's case.
    pipe.ingest("s1", SUCCEEDED, at=10, merchant="merch_a", ref="ord_1")
    assert pipe.case_of(merchant="merch_a").state == CaseState.RESOLVED_AT_SOURCE
    assert pipe.case_of(merchant="merch_b").state == CaseState.OPEN
    for ws in ("merch_a", "merch_b"):
        assert {e.merchant_assertion for e in pipe.repo.list_source_events(workspace_id=ws)} == {"unauthenticated_claim"}


# ── out of order ─────────────────────────────────────────────────────────
def final_state(pipe, **where):
    obligation = pipe.obligation(**where)
    case = pipe.case_of(obligation)
    return (obligation.status, obligation.failure_count, obligation.event_count, case.state if case else None)


def test_a_success_delivered_before_the_older_failure_never_opens_a_case(pipe):
    pipe.ingest("s", SUCCEEDED, at=10)                    # happened second, arrived first
    assert pipe.obligation().status == "settled" and pipe.obligation().case_id is None
    late = pipe.ingest("f", FAILED, at=0)                 # happened first, arrived second
    assert late.detection.outcome == OUTCOME.NOT_AT_RISK
    assert pipe.case_of() is None and pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS) == []


def test_in_order_and_out_of_order_delivery_end_in_the_same_obligation(any_repo):
    in_order = Pipeline(any_repo)
    in_order.ingest("f1", FAILED, at=0, ref="o1")
    in_order.ingest("f2", FAILED, at=30, ref="o1", data={"failure_code": "x", "attempt_number": 2})
    in_order.ingest("s", SUCCEEDED, at=60, ref="o1")
    expected = final_state(in_order, ref="o1")
    assert expected == ("settled", 2, 3, CaseState.RESOLVED_AT_SOURCE)

    # Same events, a different merchant namespace (so one repository can hold both), reversed arrival.
    reversed_ = Pipeline(any_repo)
    reversed_.ingest("s", SUCCEEDED, at=60, ref="o1", merchant="merch_r")
    reversed_.ingest("f2", FAILED, at=30, ref="o1", merchant="merch_r", data={"failure_code": "x", "attempt_number": 2})
    reversed_.ingest("f1", FAILED, at=0, ref="o1", merchant="merch_r")
    obligation = reversed_.obligation(merchant="merch_r", ref="o1")
    assert (obligation.status, obligation.failure_count, obligation.event_count) == expected[:3]
    assert obligation.case_id is None          # it was never at risk once the success was known
    assert expected[3] == CaseState.RESOLVED_AT_SOURCE


def test_a_failure_older_than_a_success_is_ignored_even_when_the_case_was_resolved(pipe):
    pipe.ingest("f0", FAILED, at=0)
    pipe.ingest("s", SUCCEEDED, at=10)
    assert pipe.case_of().state == CaseState.RESOLVED_AT_SOURCE
    result = pipe.ingest("late", FAILED, at=5)            # delivered late, but older than the settlement
    assert result.detection.outcome == OUTCOME.UNCHANGED
    assert pipe.obligation().status == "settled" and pipe.case_of().state == CaseState.RESOLVED_AT_SOURCE


def test_a_failure_after_settlement_does_not_reopen_the_case(pipe):
    pipe.ingest("f0", FAILED, at=0)
    pipe.ingest("s", SUCCEEDED, at=10)
    result = pipe.ingest("f-new", FAILED, at=20)          # genuinely newer than the success
    assert result.detection.outcome == OUTCOME.REOPEN_REFUSED
    assert pipe.case_of().state == CaseState.RESOLVED_AT_SOURCE
    assert len(pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1


def test_repeated_failures_refresh_the_one_case_instead_of_adding_cases(pipe):
    assert pipe.ingest("f1", FAILED, at=0).detection.outcome == OUTCOME.OPENED
    case_id = pipe.case_of().case_id
    second = pipe.ingest("f2", FAILED, at=30, data={"failure_code": "insufficient_funds", "attempt_number": 3})
    assert second.detection.outcome == OUTCOME.UPDATED and second.detection.case_id == case_id
    # A different event (new id) restating the same facts at the same instant changes nothing about the case.
    third = pipe.ingest("f3", FAILED, at=30, data={"failure_code": "insufficient_funds", "attempt_number": 3})
    assert third.detection.outcome == OUTCOME.UNCHANGED
    # A later failure moves the case's event time forward: that is a real change.
    assert pipe.ingest("f4", FAILED, at=60, data={"failure_code": "insufficient_funds", "attempt_number": 3}).detection.outcome == OUTCOME.UPDATED
    case = pipe.case_of()
    tx = pipe.repo.get_transaction_by_id(case.transaction_id, case.run_id, workspace_id=EVENTS_WS)
    assert (tx.failure_code, tx.retries_so_far) == ("insufficient_funds", 2)   # attempt 3 = 2 retries, as REPORTED
    assert pipe.obligation().failure_count == 4
    assert len(pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1


def test_retries_are_never_inferred_from_the_number_of_deliveries(pipe):
    pipe.ingest("f1", FAILED, at=0)
    pipe.ingest("f2", FAILED, at=30)
    case = pipe.case_of()
    tx = pipe.repo.get_transaction_by_id(case.transaction_id, case.run_id, workspace_id=EVENTS_WS)
    assert pipe.obligation().failure_count == 2 and tx.retries_so_far is None   # unknown, so it fails closed later


# ── what is not enough to open a case ───────────────────────────────────
def test_a_failure_without_an_amount_is_stored_but_opens_nothing_until_one_is_reported(pipe):
    first = pipe.ingest("f1", FAILED, at=0, amount_minor=None, currency=None)
    assert first.detection.outcome == OUTCOME.INSUFFICIENT_DATA and "amount" in first.detection.reason
    assert first.event.processing_status == "processed" and pipe.case_of() is None
    second = pipe.ingest("f2", FAILED, at=10)
    assert second.detection.outcome == OUTCOME.OPENED


def test_a_foreign_currency_cannot_open_a_case(pipe):
    result = pipe.ingest("f1", FAILED, amount_minor=5000, currency="USD")
    assert result.detection.outcome == OUTCOME.INSUFFICIENT_DATA and "USD" in result.detection.reason
    assert pipe.case_of() is None and pipe.obligation().status == "at_risk"


def test_a_failure_without_a_customer_cannot_open_a_case(pipe):
    result = pipe.ingest("f1", FAILED, customer=None)
    assert result.detection.outcome == OUTCOME.INSUFFICIENT_DATA and "customer" in result.detection.reason


@pytest.mark.parametrize("event_type", [CHECKOUT_STARTED, CHECKOUT_ABANDONED])
def test_checkout_events_are_stored_but_never_open_cases(pipe, event_type):
    result = pipe.ingest("c1", event_type, ref="chk_1")
    assert result.event.processing_status == ProcessingStatus.IGNORED.value and result.detection is None
    assert pipe.repo.list_obligations(workspace_id=EVENTS_WS) == [] and pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS) == []
    assert len(pipe.repo.list_source_events(workspace_id=EVENTS_WS)) == 1


# ── closing a case that has already moved on ─────────────────────────────
def test_a_settlement_after_the_case_finished_is_flagged_not_rewritten(pipe):
    pipe.ingest("f", FAILED, at=0)
    case = pipe.case_of()
    # Walk the case to a finished state the way execution would (executing -> escalated).
    case.transition(CaseState.AUTHORIZED, "t")
    case.transition(CaseState.EXECUTING, "t")
    case.transition(CaseState.ESCALATED, "t")
    case.active_attempt_id = None
    pipe.repo.save_case(case)

    result = pipe.ingest("s", SUCCEEDED, at=10)
    assert result.detection.outcome == OUTCOME.SETTLED_WHILE_FROZEN
    assert pipe.case_of().state == CaseState.ESCALATED                    # history is not rewritten
    assert pipe.obligation().settled_while_frozen is True                 # but someone is asked to reconcile
    assert AuditEventType.CASE_RESOLVED_AT_SOURCE.value not in [
        e.event_type for e in pipe.repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS)
    ]


def test_resolving_at_the_source_is_not_a_recovery(pipe):
    pipe.ingest("f", FAILED, at=0)
    pipe.ingest("s", SUCCEEDED, at=10)
    case = pipe.case_of()
    assert case.state == CaseState.RESOLVED_AT_SOURCE
    assert case.recovered_amount == 0.0 and case.recovered_attempt_id is None and case.attempt_count == 0
    resolved = [e for e in pipe.repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS)
                if e.event_type == AuditEventType.CASE_RESOLVED_AT_SOURCE.value]
    assert len(resolved) == 1 and resolved[0].outcome["recovered"] is False and resolved[0].case_id == case.case_id
    assert pipe.ingest("s2", SUCCEEDED, at=11).detection.outcome == OUTCOME.UNCHANGED   # a second success: nothing more
    assert len([e for e in pipe.repo.get_audit_log(limit=100, run_id="all", workspace_id=EVENTS_WS)
                if e.event_type == AuditEventType.CASE_RESOLVED_AT_SOURCE.value]) == 1


# ── validation inside the service ────────────────────────────────────────
def test_an_event_from_the_future_is_refused(pipe):
    with pytest.raises(EventValidationError) as err:
        pipe.ingestion.ingest(parsed(source_event_id="future", at=60 * 24 * 10))   # 10 days after the fixture, > server clock
    assert err.value.code == "occurred_at_in_future"
    assert pipe.repo.list_source_events(workspace_id=EVENTS_WS) == []


# ── failure and replay ───────────────────────────────────────────────────
def test_a_detection_failure_keeps_the_event_and_can_be_replayed(pipe, monkeypatch):
    real = pipe.detection.evaluate

    def broken(*args, **kwargs):
        raise RuntimeError("detector unavailable")

    monkeypatch.setattr(pipe.detection, "evaluate", broken)
    result = pipe.ingest("e1")
    assert result.event.processing_status == "failed" and "detector unavailable" in result.event.failure_reason
    assert len(pipe.repo.list_source_events(workspace_id=EVENTS_WS)) == 1        # the event is not lost
    assert pipe.case_of() is None

    monkeypatch.setattr(pipe.detection, "evaluate", real)
    replay = pipe.ingestion.reprocess(EVENTS_WS, result.event.event_id)
    assert replay.event.processing_status == "processed" and replay.detection.outcome == OUTCOME.OPENED
    assert pipe.case_of().state == CaseState.OPEN

    again = pipe.ingestion.reprocess(EVENTS_WS, result.event.event_id)           # replay is idempotent
    assert again.detection.outcome == OUTCOME.UNCHANGED
    assert len(pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1


def test_a_redelivery_of_a_failed_event_retries_it(pipe, monkeypatch):
    real = pipe.detection.evaluate
    monkeypatch.setattr(pipe.detection, "evaluate", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    assert pipe.ingest("e1").event.processing_status == "failed"
    monkeypatch.setattr(pipe.detection, "evaluate", real)
    healed = pipe.ingest("e1")                                         # the provider redelivers
    assert healed.duplicate and healed.event.processing_status == "processed"
    assert pipe.case_of().state == CaseState.OPEN and len(pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 1


def test_reprocess_failed_replays_everything_that_is_not_done(pipe, monkeypatch):
    real = pipe.detection.evaluate
    monkeypatch.setattr(pipe.detection, "evaluate", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    pipe.ingest("e1", ref="o1")
    pipe.ingest("e2", ref="o2")
    monkeypatch.setattr(pipe.detection, "evaluate", real)
    results = pipe.ingestion.reprocess_failed(EVENTS_WS)
    assert len(results) == 2 and all(r.event.processing_status == "processed" for r in results)
    assert len(pipe.repo.list_cases(run_id="all", workspace_id=EVENTS_WS)) == 2
    with pytest.raises(KeyError):
        pipe.ingestion.reprocess(EVENTS_WS, "sev_unknown")


def test_every_stored_event_keeps_what_replay_and_reconciliation_need(pipe):
    pipe.ingest("e1", raw={"provider_field": "kept apart"})
    stored = pipe.repo.list_source_events(workspace_id=EVENTS_WS)[0]
    assert stored.source == "internal" and stored.source_event_id == "e1" and stored.event_id.startswith("sev_")
    assert stored.occurred_at.startswith("2026-10-20T10:00:00") and stored.received_at.startswith("2026-10-22T12:00:00")
    assert stored.reference_kind == "payment" and stored.reference_id == "ord_1"
    assert len(stored.content_fingerprint) == 64 and stored.payload == {"failure_code": "card_declined"}
    assert "raw_payload" not in stored.to_dict() and "provider_field" not in str(stored.to_dict())   # raw never leaks out
