"""
Normalized source events and the revenue obligations derived from them (Phase 2).

Layering, from raw to actionable:

    provider payload   -> (adapter, future)   -> NormalizedEvent (validated at the API boundary)
    SourceEvent        stored once per (merchant, source, source_event_id); never edited
    RevenueObligation  a projection of ALL events about one payment / billing cycle / invoice;
                       recomputed from the event set, so arrival order cannot change it
    RecoveryCase       opened or closed by the detection service from the obligation

Nothing in this module executes anything. Receiving an event never authorizes an action.
"""
import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional

# The merchant on an event is whatever the sender claimed. There is no authentication in this
# build, so it is stored as an explicit, unauthenticated claim; a future authenticated ingestion
# path sets "authenticated" only after verifying the sender.
MERCHANT_ASSERTION_UNAUTHENTICATED = "unauthenticated_claim"
MERCHANT_ASSERTION_AUTHENTICATED = "authenticated"

# Money on events is integer minor units (paise for INR). Cases and transactions are
# INR-denominated (the policy ceiling is in rupees), so only this currency can open a case.
SUPPORTED_CASE_CURRENCY = "INR"
MINOR_UNITS_PER_MAJOR = 100


class EventType(str, Enum):
    PAYMENT_ATTEMPT_FAILED = "payment.attempt_failed"
    PAYMENT_ATTEMPT_SUCCEEDED = "payment.attempt_succeeded"
    CHECKOUT_STARTED = "checkout.started"
    CHECKOUT_ABANDONED = "checkout.abandoned"
    SUBSCRIPTION_PAYMENT_FAILED = "subscription.payment_failed"
    SUBSCRIPTION_PAYMENT_SUCCEEDED = "subscription.payment_succeeded"
    INVOICE_ISSUED = "invoice.issued"
    INVOICE_OVERDUE = "invoice.overdue"
    INVOICE_PAID = "invoice.paid"
    INVOICE_VOIDED = "invoice.voided"


class ReferenceKind(str, Enum):
    PAYMENT = "payment"
    SUBSCRIPTION_CYCLE = "subscription_cycle"  # one billing cycle of a subscription, not the subscription itself
    INVOICE = "invoice"
    CHECKOUT = "checkout"


# The object each event type is about. An event whose reference kind disagrees is malformed.
EVENT_REFERENCE_KIND: Dict[EventType, ReferenceKind] = {
    EventType.PAYMENT_ATTEMPT_FAILED: ReferenceKind.PAYMENT,
    EventType.PAYMENT_ATTEMPT_SUCCEEDED: ReferenceKind.PAYMENT,
    EventType.CHECKOUT_STARTED: ReferenceKind.CHECKOUT,
    EventType.CHECKOUT_ABANDONED: ReferenceKind.CHECKOUT,
    EventType.SUBSCRIPTION_PAYMENT_FAILED: ReferenceKind.SUBSCRIPTION_CYCLE,
    EventType.SUBSCRIPTION_PAYMENT_SUCCEEDED: ReferenceKind.SUBSCRIPTION_CYCLE,
    EventType.INVOICE_ISSUED: ReferenceKind.INVOICE,
    EventType.INVOICE_OVERDUE: ReferenceKind.INVOICE,
    EventType.INVOICE_PAID: ReferenceKind.INVOICE,
    EventType.INVOICE_VOIDED: ReferenceKind.INVOICE,
}

# What a reference kind becomes in the closed leak vocabulary shared with the decision engine.
REFERENCE_LEAK_TYPE: Dict[ReferenceKind, str] = {
    ReferenceKind.PAYMENT: "failed_payment",
    ReferenceKind.SUBSCRIPTION_CYCLE: "failed_subscription",
    ReferenceKind.INVOICE: "overdue_invoice",
    ReferenceKind.CHECKOUT: "abandoned_checkout",
}


class ProcessingStatus(str, Enum):
    RECEIVED = "received"    # stored, detection has not run (or crashed before finishing)
    PROCESSED = "processed"  # detection evaluated the obligation (it may have changed nothing)
    IGNORED = "ignored"      # valid, but this event type carries no detection signal yet
    FAILED = "failed"        # stored, but detection could not act on it; see failure_reason


class ObligationStatus(str, Enum):
    OBSERVED = "observed"  # known, but nothing says the money is at risk (e.g. invoice issued)
    AT_RISK = "at_risk"    # the latest relevant fact is a failure / overdue notice
    SETTLED = "settled"    # the source reported it paid / succeeded
    VOID = "void"          # the source cancelled it


def source_event_internal_id(merchant_id: str, source: str, source_event_id: str) -> str:
    """Stable across redeliveries, replays and restores: derived from the event's identity only."""
    digest = hashlib.sha256(f"{merchant_id}|{source}|{source_event_id}".encode("utf-8")).hexdigest()
    return f"sev_{digest[:32]}"


def obligation_internal_id(merchant_id: str, reference_kind: str, reference_id: str) -> str:
    digest = hashlib.sha256(f"{merchant_id}|{reference_kind}|{reference_id}".encode("utf-8")).hexdigest()
    return f"obl_{digest[:24]}"


@dataclass
class SourceEvent:
    event_id: str                   # REVORA's stable id (see source_event_internal_id)
    merchant_id: str                # a CLAIM until merchant_assertion says otherwise
    source: str                     # provider / system identifier, e.g. "internal"
    source_event_id: str            # the provider's own id for this event
    event_type: str
    reference_kind: str
    reference_id: str
    occurred_at: str                # when it happened at the source (ISO 8601, tz-aware)
    received_at: str                # when REVORA stored it
    content_fingerprint: str        # sha256 of the canonical normalized content
    payload: Dict[str, Any]         # validated, type-specific fields
    customer_ref: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    merchant_assertion: str = MERCHANT_ASSERTION_UNAUTHENTICATED
    processing_status: str = ProcessingStatus.RECEIVED.value
    failure_reason: Optional[str] = None
    processed_at: Optional[str] = None
    # Provider-specific payload as received, kept apart from the normalized fields. Detection
    # never reads it. Not part of to_dict(): it can hold personal data.
    raw_payload: Optional[Dict[str, Any]] = field(default=None, repr=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "merchant_id": self.merchant_id,
            "merchant_assertion": self.merchant_assertion,
            "source": self.source,
            "source_event_id": self.source_event_id,
            "event_type": self.event_type,
            "reference": {"kind": self.reference_kind, "id": self.reference_id},
            "customer_ref": self.customer_ref,
            "amount_minor": self.amount_minor,
            "currency": self.currency,
            "payload": self.payload,
            "occurred_at": self.occurred_at,
            "received_at": self.received_at,
            "processing_status": self.processing_status,
            "failure_reason": self.failure_reason,
            "processed_at": self.processed_at,
            "content_fingerprint": self.content_fingerprint,
        }


@dataclass
class RevenueObligation:
    """The projection of every event about one payment / billing cycle / invoice."""
    obligation_id: str
    merchant_id: str
    reference_kind: str
    reference_id: str
    leak_type: str
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
    # Linkage to the recovery lifecycle.
    run_id: Optional[str] = None
    case_id: Optional[str] = None
    # A settlement arrived while the case was already executing / finished. The case is left
    # alone (the outcome must stay truthful) and this flag asks for reconciliation.
    settled_while_frozen: bool = False
    created_at: str = ""
    last_evaluated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "obligation_id": self.obligation_id,
            "merchant_id": self.merchant_id,
            "reference": {"kind": self.reference_kind, "id": self.reference_id},
            "leak_type": self.leak_type,
            "status": self.status,
            "customer_ref": self.customer_ref,
            "amount_minor": self.amount_minor,
            "currency": self.currency,
            "failure_count": self.failure_count,
            "reported_attempt_number": self.reported_attempt_number,
            "consecutive_failures": self.consecutive_failures,
            "latest_failure_code": self.latest_failure_code,
            "payment_method": self.payment_method,
            "first_at_risk_at": self.first_at_risk_at,
            "last_at_risk_at": self.last_at_risk_at,
            "due_at": self.due_at,
            "settled_at": self.settled_at,
            "event_count": self.event_count,
            "last_event_at": self.last_event_at,
            "run_id": self.run_id,
            "case_id": self.case_id,
            "settled_while_frozen": self.settled_while_frozen,
            "created_at": self.created_at,
            "last_evaluated_at": self.last_evaluated_at,
        }
