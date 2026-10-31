"""
Fold the events about one object into its current state.

This is a pure function of the SET of events, not of the order they arrived in: events are first
put in a total order (when they happened at the source, then settle/void after failure at the
same instant, then event id). A late-delivered old failure therefore cannot overwrite a newer
success, and delivering the same events in any order, or twice, yields the same projection.
That is what makes out-of-order delivery safe.

Tie-break rationale: if a failure and a success carry the same timestamp, the success wins. The
cost of wrongly treating a settled object as unpaid (chasing a customer who already paid) is
higher than the cost of missing one failure.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence

from backend.app.domain.events import EventType, ObligationStatus, SourceEvent

FAILURE_TYPES = frozenset({EventType.PAYMENT_ATTEMPT_FAILED.value, EventType.SUBSCRIPTION_PAYMENT_FAILED.value})
AT_RISK_TYPES = FAILURE_TYPES | {EventType.INVOICE_OVERDUE.value}
SETTLE_TYPES = frozenset(
    {
        EventType.PAYMENT_ATTEMPT_SUCCEEDED.value,
        EventType.SUBSCRIPTION_PAYMENT_SUCCEEDED.value,
        EventType.INVOICE_PAID.value,
    }
)
VOID_TYPES = frozenset({EventType.INVOICE_VOIDED.value})
CLOSING_TYPES = SETTLE_TYPES | VOID_TYPES

# Accepted and stored, but nothing in the current event model lets detection act on them safely.
# checkout.*: an abandoned checkout is only "unpaid" until the customer pays another way, and the
# model has no field linking a checkout to the payment that completes it; acting on it could chase
# a customer who has already paid.
NO_DETECTION_TYPES = frozenset({EventType.CHECKOUT_STARTED.value, EventType.CHECKOUT_ABANDONED.value})


@dataclass(frozen=True)
class ObligationProjection:
    status: str = ObligationStatus.OBSERVED.value
    customer_ref: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    failure_count: int = 0
    reported_attempt_number: Optional[int] = None
    consecutive_failures: Optional[int] = None
    latest_failure_code: Optional[str] = None
    payment_method: Optional[str] = None
    first_at_risk_at: Optional[str] = None
    last_at_risk_at: Optional[str] = None
    due_at: Optional[str] = None
    settled_at: Optional[str] = None
    event_count: int = 0
    last_event_at: Optional[str] = None


def _when(ts: str) -> datetime:
    parsed = datetime.fromisoformat(ts)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def event_order_key(event: SourceEvent):
    return (_when(event.occurred_at), 1 if event.event_type in CLOSING_TYPES else 0, event.event_id)


def fold(events: Sequence[SourceEvent]) -> ObligationProjection:
    state = ObligationProjection()
    if not events:
        return state

    status = ObligationStatus.OBSERVED.value
    customer_ref = amount_minor = currency = None
    failure_count = 0
    reported_attempt = consecutive = None
    failure_code = payment_method = None
    first_risk = last_risk = due_at = settled_at = None

    ordered = sorted(events, key=event_order_key)
    for event in ordered:
        data = event.payload or {}
        if event.customer_ref is not None:
            customer_ref = event.customer_ref
        if event.amount_minor is not None:
            amount_minor, currency = event.amount_minor, event.currency
        if data.get("due_at"):
            due_at = data["due_at"]
        if data.get("payment_method"):
            payment_method = data["payment_method"]
        if data.get("attempt_number") is not None:
            reported_attempt = max(reported_attempt or 0, data["attempt_number"])

        kind = event.event_type
        if kind in AT_RISK_TYPES:
            status = ObligationStatus.AT_RISK.value
            settled_at = None
            first_risk = first_risk or event.occurred_at
            last_risk = event.occurred_at
            if kind in FAILURE_TYPES:
                failure_count += 1
                failure_code = data.get("failure_code", failure_code)
                if data.get("consecutive_failures") is not None:
                    consecutive = data["consecutive_failures"]
        elif kind in SETTLE_TYPES:
            status = ObligationStatus.SETTLED.value
            settled_at = event.occurred_at
        elif kind in VOID_TYPES:
            status = ObligationStatus.VOID.value
            settled_at = event.occurred_at
        # invoice.issued and checkout.* only contribute context above.

    return ObligationProjection(
        status=status,
        customer_ref=customer_ref,
        amount_minor=amount_minor,
        currency=currency,
        failure_count=failure_count,
        reported_attempt_number=reported_attempt,
        consecutive_failures=consecutive,
        latest_failure_code=failure_code,
        payment_method=payment_method,
        first_at_risk_at=first_risk,
        last_at_risk_at=last_risk,
        due_at=due_at,
        settled_at=settled_at,
        event_count=len(ordered),
        last_event_at=ordered[-1].occurred_at,
    )
