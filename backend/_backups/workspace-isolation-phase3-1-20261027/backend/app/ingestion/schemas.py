"""
The normalized event contract, validated at the API boundary.

This is REVORA's own vocabulary, not any payment provider's. A provider adapter (see
`adapters.py`; none is implemented) maps a provider payload onto it. Anything the sender cannot
truthfully supply is left out rather than invented: only the fields below are required.

    {
      "source": "internal",                       # which system produced the event
      "source_event_id": "evt_001",               # that system's stable id for it (dedup key)
      "claimed_merchant_id": "merch_001",         # a CLAIM, not an authenticated identity
      "event_type": "payment.attempt_failed",
      "occurred_at": "2026-10-20T10:00:00+05:30", # when it happened at the source; offset required
      "reference": {"kind": "payment", "id": "ord_123"},
      "customer_ref": "cust_9",                   # optional
      "amount_minor": 249900, "currency": "INR",  # optional, integer minor units, both or neither
      "data": {"failure_code": "card_declined"},  # per-event-type fields, unknown keys rejected
      "raw": {...}                                # optional provider payload, stored apart, never read by detection
    }

`reference.id` must identify the thing a later success would settle. For a gateway that creates a
new payment id on every attempt, that is the order / intent, not each attempt.
"""
import json
from typing import Annotated, Any, Dict, Optional

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PositiveInt,
    StrictInt,
    StringConstraints,
    model_validator,
)

from backend.app.domain.events import EVENT_REFERENCE_KIND, EventType, ReferenceKind

_NO_CONTROL = r"^[^\x00-\x1f\x7f]+$"

Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255, pattern=_NO_CONTROL)]
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64, pattern=_NO_CONTROL)]
SourceName = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-z0-9][a-z0-9_.\-]{0,63}$")]
MerchantClaim = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128, pattern=_NO_CONTROL)
]
CurrencyCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]

MAX_RAW_PAYLOAD_BYTES = 64 * 1024
MAX_AMOUNT_MINOR = 10 ** 12


class _Data(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PaymentAttemptFailedData(_Data):
    failure_code: Code
    attempt_number: Optional[PositiveInt] = None  # the source's own count of attempts so far, if it reports one
    payment_method: Optional[Code] = None


class PaymentAttemptSucceededData(_Data):
    attempt_number: Optional[PositiveInt] = None


class SubscriptionPaymentFailedData(_Data):
    failure_code: Code
    consecutive_failures: Optional[PositiveInt] = None  # consecutive failed billing attempts, as the source counts them
    attempt_number: Optional[PositiveInt] = None
    subscription_id: Optional[Identifier] = None
    payment_method: Optional[Code] = None


class SubscriptionPaymentSucceededData(_Data):
    subscription_id: Optional[Identifier] = None


class InvoiceIssuedData(_Data):
    due_at: Optional[AwareDatetime] = None


class InvoiceOverdueData(_Data):
    due_at: Optional[AwareDatetime] = None


class InvoicePaidData(_Data):
    pass


class InvoiceVoidedData(_Data):
    pass


class CheckoutStartedData(_Data):
    pass


class CheckoutAbandonedData(_Data):
    pass


EVENT_DATA_MODELS: Dict[EventType, type] = {
    EventType.PAYMENT_ATTEMPT_FAILED: PaymentAttemptFailedData,
    EventType.PAYMENT_ATTEMPT_SUCCEEDED: PaymentAttemptSucceededData,
    EventType.SUBSCRIPTION_PAYMENT_FAILED: SubscriptionPaymentFailedData,
    EventType.SUBSCRIPTION_PAYMENT_SUCCEEDED: SubscriptionPaymentSucceededData,
    EventType.INVOICE_ISSUED: InvoiceIssuedData,
    EventType.INVOICE_OVERDUE: InvoiceOverdueData,
    EventType.INVOICE_PAID: InvoicePaidData,
    EventType.INVOICE_VOIDED: InvoiceVoidedData,
    EventType.CHECKOUT_STARTED: CheckoutStartedData,
    EventType.CHECKOUT_ABANDONED: CheckoutAbandonedData,
}


class ReferenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ReferenceKind
    id: Identifier


class NormalizedEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: SourceName
    source_event_id: Identifier
    claimed_merchant_id: MerchantClaim = Field(
        description="Who the sender SAYS the event belongs to. Unauthenticated: never used to authorize anything."
    )
    event_type: EventType
    occurred_at: AwareDatetime
    reference: ReferenceIn
    customer_ref: Optional[Identifier] = None
    amount_minor: Optional[StrictInt] = Field(default=None, ge=0, le=MAX_AMOUNT_MINOR)
    currency: Optional[CurrencyCode] = None
    data: Dict[str, Any] = Field(default_factory=dict)
    raw: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def _check_consistency(self) -> "NormalizedEventIn":
        expected_kind = EVENT_REFERENCE_KIND[self.event_type]
        if self.reference.kind != expected_kind:
            raise ValueError(
                f"event_type '{self.event_type.value}' is about a '{expected_kind.value}' reference, "
                f"but reference.kind is '{self.reference.kind.value}'."
            )
        if (self.amount_minor is None) != (self.currency is None):
            raise ValueError("amount_minor and currency must be given together (integer minor units + ISO 4217 code).")
        # Validate the type-specific fields and keep the NORMALIZED form (defaults dropped, types coerced).
        model = EVENT_DATA_MODELS[self.event_type]
        self.data = model.model_validate(self.data).model_dump(mode="json", exclude_none=True)
        if self.raw is not None:
            try:
                size = len(json.dumps(self.raw, allow_nan=False))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"raw must be a JSON object without NaN/Infinity: {exc}") from exc
            if size > MAX_RAW_PAYLOAD_BYTES:
                raise ValueError(f"raw payload is {size} bytes; the limit is {MAX_RAW_PAYLOAD_BYTES}.")
        return self
