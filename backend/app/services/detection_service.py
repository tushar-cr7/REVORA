"""
The detection boundary: from "what a source has reported about this object" to "should a recovery
case exist for it".

It reads the stored events for one reference, folds them (order-insensitively) into a revenue
obligation, and then opens, updates or closes the recovery case for that obligation — all in one
unit of work, under a lock on the obligation, so concurrent or repeated events converge on the same
single case.

What it deliberately does NOT do
  * It never executes or authorizes anything, and it never calls the model or the decision engine.
    A case it opens is `open`: no decision, no action. Analysis and policy remain the only path
    to an executable action.
  * It does not invent facts the events did not carry. Fields a source never reported stay None, and
    the strict policy evaluator fails closed on None. Time-varying figures (hours since the event,
    invoice age) are NOT computed here: they would be stale the moment they were stored.
  * Cases are opened in the merchant's INGESTION run, which is never the active run, so they are not
    shown by the dashboard's active-run reads and cannot be executed (`409 run_superseded`). Making
    live cases actionable is a later, explicit product step.

Rules implemented (each needs only fields the event model has)
  failed_payment      payment.attempt_failed        ... open until payment.attempt_succeeded
  failed_subscription subscription.payment_failed   ... open until subscription.payment_succeeded
  overdue_invoice     invoice.overdue               ... open until invoice.paid / invoice.voided
Not implemented: abandoned_checkout (no checkout -> payment link in the model; see projection.py).
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Optional

from backend.app.domain.events import (
    REFERENCE_LEAK_TYPE,
    SUPPORTED_CASE_CURRENCY,
    MINOR_UNITS_PER_MAJOR,
    ObligationStatus,
    ReferenceKind,
    RevenueObligation,
)
from backend.app.domain.models import (
    AuditEventType,
    CaseState,
    RecoveryCase,
    Transaction,
)
from backend.app.ingestion.projection import ObligationProjection, fold
from backend.app.repositories.base import BaseRepository
from backend.app.services.audit_service import AuditService

logger = logging.getLogger("revora.detection")

# Cases in these states have not been acted on to a conclusion, so a source report can still close
# them or refresh their facts.
_REVISABLE = frozenset(
    {CaseState.OPEN, CaseState.AUTHORIZED, CaseState.BLOCKED, CaseState.ATTEMPTED_NO_RECOVERY}
)


class DetectionOutcome(str, Enum):
    OPENED = "case_opened"                    # a new case now exists for this obligation
    UPDATED = "case_updated"                  # the open case's facts were refreshed
    RESOLVED = "case_resolved_at_source"      # the source reported it settled / voided; the case was closed
    UNCHANGED = "unchanged"                   # nothing to do (duplicate, or already in the right state)
    NOT_AT_RISK = "not_at_risk"               # the obligation exists but no failure stands against it
    INSUFFICIENT_DATA = "insufficient_data"   # at risk, but the events lack what a case needs
    SETTLED_WHILE_FROZEN = "settled_while_frozen"  # settled after the case was executing / finished: reconcile
    REOPEN_REFUSED = "reopen_refused"         # a new failure after the case was resolved: not reopened
    NOT_SUPPORTED = "not_supported"           # no detection rule for this kind of object yet


@dataclass
class DetectionResult:
    outcome: DetectionOutcome
    obligation_id: str
    case_id: Optional[str] = None
    reason: Optional[str] = None

    def to_dict(self):
        return {
            "outcome": self.outcome.value,
            "obligation_id": self.obligation_id,
            "case_id": self.case_id,
            "reason": self.reason,
        }


class DetectionService:
    def __init__(
        self,
        repo: BaseRepository,
        audit_service: AuditService,
        clock: Optional[Callable[[], datetime]] = None,
    ):
        self.repo = repo
        self.audit_service = audit_service
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    # ── entry point ──────────────────────────────────────────────────────
    def evaluate(self, merchant_id: str, reference_kind: str, reference_id: str) -> DetectionResult:
        """Idempotent: evaluating the same stored events again changes nothing."""
        kind = ReferenceKind(reference_kind)
        leak_type = REFERENCE_LEAK_TYPE[kind]
        now_iso = self.clock().isoformat()

        with self.repo.atomic():
            # The obligation row is the mutex for everything about this object.
            obligation = self.repo.lock_obligation(merchant_id, kind.value, reference_id, leak_type, now_iso)
            events = self.repo.list_events_for_reference(merchant_id, kind.value, reference_id)
            projection = fold(events)
            self._apply_projection(obligation, projection)
            obligation.last_evaluated_at = now_iso

            if kind == ReferenceKind.CHECKOUT:
                result = DetectionResult(
                    DetectionOutcome.NOT_SUPPORTED, obligation.obligation_id,
                    reason="Checkout events are stored but not used for detection: the event model cannot tell "
                           "whether the customer later paid another way.",
                )
            elif projection.status == ObligationStatus.AT_RISK.value:
                result = self._on_at_risk(obligation, projection, now_iso)
            elif projection.status in (ObligationStatus.SETTLED.value, ObligationStatus.VOID.value):
                result = self._on_closed(obligation, projection, now_iso)
            else:
                result = DetectionResult(
                    DetectionOutcome.NOT_AT_RISK, obligation.obligation_id, obligation.case_id,
                    "No failure or overdue notice stands against this object.",
                )
            self.repo.save_obligation(obligation)
            return result

    @staticmethod
    def _apply_projection(obligation: RevenueObligation, p: ObligationProjection) -> None:
        obligation.status = p.status
        obligation.customer_ref = p.customer_ref
        obligation.amount_minor = p.amount_minor
        obligation.currency = p.currency
        obligation.failure_count = p.failure_count
        obligation.reported_attempt_number = p.reported_attempt_number
        obligation.consecutive_failures = p.consecutive_failures
        obligation.latest_failure_code = p.latest_failure_code
        obligation.payment_method = p.payment_method
        obligation.first_at_risk_at = p.first_at_risk_at
        obligation.last_at_risk_at = p.last_at_risk_at
        obligation.due_at = p.due_at
        obligation.settled_at = p.settled_at
        obligation.event_count = p.event_count
        obligation.last_event_at = p.last_event_at

    # ── at risk: open or refresh the case ────────────────────────────────
    def _on_at_risk(self, obligation: RevenueObligation, p: ObligationProjection, now_iso: str) -> DetectionResult:
        missing = self._missing_for_case(p)
        if obligation.case_id is None:
            if missing:
                return DetectionResult(
                    DetectionOutcome.INSUFFICIENT_DATA, obligation.obligation_id,
                    reason=f"Cannot open a case yet: {missing}. A later event may supply it.",
                )
            return self._open_case(obligation, p, now_iso)

        case = self.repo.get_case(obligation.case_id, workspace_id=obligation.merchant_id)  # row-locked on a database
        if case.state == CaseState.RESOLVED_AT_SOURCE:
            return DetectionResult(
                DetectionOutcome.REOPEN_REFUSED, obligation.obligation_id, case.case_id,
                "The case was resolved at the source; a failure reported after settlement is not reopened. "
                "Report a new reference for a new obligation.",
            )
        if case.state not in _REVISABLE or missing:
            return DetectionResult(
                DetectionOutcome.UNCHANGED, obligation.obligation_id, case.case_id,
                f"Case is {case.state.value}; its facts are not rewritten." if case.state not in _REVISABLE
                else f"Cannot refresh the case: {missing}.",
            )
        return self._refresh_case(obligation, case, p)

    @staticmethod
    def _missing_for_case(p: ObligationProjection) -> Optional[str]:
        problems = []
        if p.amount_minor is None or p.amount_minor <= 0:
            problems.append("no positive amount reported")
        elif p.currency != SUPPORTED_CASE_CURRENCY:
            problems.append(f"currency {p.currency} is not supported (cases are {SUPPORTED_CASE_CURRENCY} only)")
        if not p.customer_ref:
            problems.append("no customer reference reported")
        return "; ".join(problems) or None

    def _transaction_from(self, obligation: RevenueObligation, p: ObligationProjection, run_id: str) -> Transaction:
        """
        A transaction record built ONLY from reported facts. What a source did not report stays None;
        the strict policy evaluator then fails closed on it instead of assuming a permissive default.
        `retries_so_far` is the source's own attempt count minus one, never inferred from how many
        failure events happened to be delivered (a missed delivery would undercount).
        """
        retries = None if p.reported_attempt_number is None else max(0, p.reported_attempt_number - 1)
        is_subscription = obligation.reference_kind == ReferenceKind.SUBSCRIPTION_CYCLE.value
        return Transaction(
            transaction_id=obligation.obligation_id,
            leak_id=obligation.obligation_id,
            merchant_id=obligation.merchant_id,
            customer_id=p.customer_ref,
            amount=p.amount_minor / MINOR_UNITS_PER_MAJOR,
            leak_type=obligation.leak_type,
            payment_method=p.payment_method,
            failure_code=p.latest_failure_code,
            prior_successful_payments=None,
            ltv_bucket=None,
            retries_so_far=retries,
            hours_since_event=None,   # time-varying: computed from event_time at decision time, never stored
            age_days=None,            # likewise
            event_time=p.last_at_risk_at or p.last_event_at,
            merchant_segment=None,
            payment_id=obligation.reference_id if obligation.reference_kind == ReferenceKind.PAYMENT.value else None,
            visit_count=None,
            reached_payment_page=None,
            consecutive_failures=p.consecutive_failures if is_subscription else None,
            subscription_age_days=None,
            contacts_today=0,
            run_id=run_id,
        )

    def _open_case(self, obligation: RevenueObligation, p: ObligationProjection, now_iso: str) -> DetectionResult:
        run = self.repo.get_or_create_ingestion_run(obligation.merchant_id, now_iso)
        tx = self._transaction_from(obligation, p, run.run_id)
        case = RecoveryCase(
            case_id=f"case_{obligation.obligation_id}",
            run_id=run.run_id,
            merchant_id=obligation.merchant_id,
            transaction_id=tx.transaction_id,
            leak_id=tx.leak_id,
            customer_id=tx.customer_id,
            leak_type=tx.leak_type,
            amount=tx.amount,
            created_at=now_iso,
            updated_at=now_iso,
        )
        self.repo.create_case(case, tx)
        obligation.run_id = run.run_id
        obligation.case_id = case.case_id
        self.audit_service.log_event(
            merchant_id=case.merchant_id,
            transaction_id=case.transaction_id,
            leak_id=case.leak_id,
            event_type=AuditEventType.CASE_OPENED_FROM_EVENTS,
            action="none",
            policy_result={"note": "Detection only: no decision was made and no policy was evaluated."},
            outcome={
                "status": "case_opened",
                "obligation_id": obligation.obligation_id,
                "reference": {"kind": obligation.reference_kind, "id": obligation.reference_id},
                "failure_count": p.failure_count,
                "evidence_event_count": p.event_count,
            },
            run_id=case.run_id,
            case_id=case.case_id,
            provider="detection",
        )
        return DetectionResult(DetectionOutcome.OPENED, obligation.obligation_id, case.case_id)

    def _refresh_case(self, obligation: RevenueObligation, case: RecoveryCase, p: ObligationProjection) -> DetectionResult:
        fresh = self._transaction_from(obligation, p, case.run_id)
        current = self.repo.get_transaction_by_id(case.transaction_id, case.run_id, workspace_id=case.merchant_id)
        changed_fields = [
            name for name in (
                "customer_id", "amount", "payment_method", "failure_code", "retries_so_far", "event_time",
                "payment_id", "consecutive_failures",
            )
            if getattr(current, name) != getattr(fresh, name)
        ]
        if not changed_fields:
            return DetectionResult(DetectionOutcome.UNCHANGED, obligation.obligation_id, case.case_id)
        self.repo.update_source_transaction(fresh)
        return DetectionResult(
            DetectionOutcome.UPDATED, obligation.obligation_id, case.case_id,
            f"Refreshed from newer events: {', '.join(changed_fields)}.",
        )

    # ── settled / voided: close the case ─────────────────────────────────
    def _on_closed(self, obligation: RevenueObligation, p: ObligationProjection, now_iso: str) -> DetectionResult:
        if obligation.case_id is None:
            return DetectionResult(
                DetectionOutcome.NOT_AT_RISK, obligation.obligation_id,
                reason=f"The source reports this object {p.status}; no case was ever opened.",
            )
        case = self.repo.get_case(obligation.case_id, workspace_id=obligation.merchant_id)  # row-locked on a database
        if case.state == CaseState.RESOLVED_AT_SOURCE:
            return DetectionResult(DetectionOutcome.UNCHANGED, obligation.obligation_id, case.case_id)
        if case.state not in _REVISABLE:
            # Executing, or already recovered / escalated / suppressed. Rewriting that history would make
            # the outcome untrue, so leave the case and ask a person to reconcile.
            obligation.settled_while_frozen = True
            return DetectionResult(
                DetectionOutcome.SETTLED_WHILE_FROZEN, obligation.obligation_id, case.case_id,
                f"The source reports this object {p.status} but the case is already {case.state.value}; "
                "left as is and flagged for reconciliation.",
            )
        case.transition(
            CaseState.RESOLVED_AT_SOURCE, f"source reported the object {p.status}", at=now_iso
        )
        case.blocked_reason = None
        case.safe_alternative = None
        self.repo.save_case(case)
        self.audit_service.log_event(
            merchant_id=case.merchant_id,
            transaction_id=case.transaction_id,
            leak_id=case.leak_id,
            event_type=AuditEventType.CASE_RESOLVED_AT_SOURCE,
            action="none",
            policy_result={"note": "The source reported the obligation closed; no recovery was attempted or counted."},
            outcome={
                "status": "resolved_at_source",
                "source_status": p.status,
                "settled_at": p.settled_at,
                "obligation_id": obligation.obligation_id,
                "recovered": False,
                "recovered_amount": 0.0,
            },
            decision_id=case.decision_id,
            run_id=case.run_id,
            case_id=case.case_id,
            provider="detection",
        )
        return DetectionResult(DetectionOutcome.RESOLVED, obligation.obligation_id, case.case_id)
