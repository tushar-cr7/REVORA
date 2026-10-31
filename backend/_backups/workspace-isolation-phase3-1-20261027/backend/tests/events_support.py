"""Deterministic event fixtures. Timestamps are offsets in minutes from a fixed instant."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from backend.app.domain.events import EventType
from backend.app.ingestion.schemas import NormalizedEventIn
from backend.app.services.audit_service import AuditService
from backend.app.services.detection_service import DetectionService
from backend.app.services.ingestion_service import IngestionService
from backend.tests.support import FakeClock

T0 = datetime(2026, 10, 20, 10, 0, 0, tzinfo=timezone.utc)
SERVER_NOW = datetime(2026, 10, 22, 12, 0, 0, tzinfo=timezone.utc)  # after every fixture timestamp

FAILED = EventType.PAYMENT_ATTEMPT_FAILED.value
SUCCEEDED = EventType.PAYMENT_ATTEMPT_SUCCEEDED.value
SUB_FAILED = EventType.SUBSCRIPTION_PAYMENT_FAILED.value
SUB_SUCCEEDED = EventType.SUBSCRIPTION_PAYMENT_SUCCEEDED.value
INV_ISSUED = EventType.INVOICE_ISSUED.value
INV_OVERDUE = EventType.INVOICE_OVERDUE.value
INV_PAID = EventType.INVOICE_PAID.value
INV_VOIDED = EventType.INVOICE_VOIDED.value
CHECKOUT_STARTED = EventType.CHECKOUT_STARTED.value
CHECKOUT_ABANDONED = EventType.CHECKOUT_ABANDONED.value

_REFERENCE_KIND = {
    FAILED: "payment", SUCCEEDED: "payment",
    SUB_FAILED: "subscription_cycle", SUB_SUCCEEDED: "subscription_cycle",
    INV_ISSUED: "invoice", INV_OVERDUE: "invoice", INV_PAID: "invoice", INV_VOIDED: "invoice",
    CHECKOUT_STARTED: "checkout", CHECKOUT_ABANDONED: "checkout",
}
_DEFAULT_DATA = {FAILED: {"failure_code": "card_declined"}, SUB_FAILED: {"failure_code": "card_declined"}}


def event(
    source_event_id: str,
    event_type: str = FAILED,
    at: float = 0,
    ref: str = "ord_1",
    merchant: str = "merch_a",
    source: str = "internal",
    amount_minor: Optional[int] = 249900,
    currency: Optional[str] = "INR",
    customer: Optional[str] = "cust_1",
    data: Optional[Dict[str, Any]] = None,
    **extra: Any,
) -> Dict[str, Any]:
    body = {
        "source": source,
        "source_event_id": source_event_id,
        "claimed_merchant_id": merchant,
        "event_type": event_type,
        "occurred_at": (T0 + timedelta(minutes=at)).isoformat(),
        "reference": {"kind": _REFERENCE_KIND[event_type], "id": ref},
        "customer_ref": customer,
        "amount_minor": amount_minor,
        "currency": currency,
        "data": dict(_DEFAULT_DATA.get(event_type, {}) if data is None else data),
    }
    body.update(extra)
    return {k: v for k, v in body.items() if v is not None or k in extra}


def parsed(**kwargs) -> NormalizedEventIn:
    return NormalizedEventIn.model_validate(event(**kwargs))


class Pipeline:
    """Ingestion + detection over a repository, with a fixed server clock."""

    def __init__(self, repo, now: datetime = SERVER_NOW):
        self.repo = repo
        self.clock = FakeClock(now)
        self.audit = AuditService(repo)
        self.detection = DetectionService(repo, self.audit, clock=self.clock)
        self.ingestion = IngestionService(repo, self.detection, clock=self.clock)

    def ingest(self, source_event_id: str, event_type: str = FAILED, **kwargs):
        return self.ingestion.ingest(parsed(source_event_id=source_event_id, event_type=event_type, **kwargs))

    def obligation(self, merchant: str = "merch_a", kind: str = "payment", ref: str = "ord_1"):
        from backend.app.domain.events import obligation_internal_id

        return self.repo.get_obligation(obligation_internal_id(merchant, kind, ref))

    def case_of(self, obligation=None, **kwargs):
        obligation = obligation or self.obligation(**kwargs)
        return self.repo.get_case(obligation.case_id) if obligation and obligation.case_id else None
