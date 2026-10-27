"""The normalized event contract: what is accepted, and that everything else is refused with a reason."""
import copy

import pytest
from pydantic import ValidationError

from backend.app.domain.events import (
    EVENT_REFERENCE_KIND,
    MERCHANT_ASSERTION_UNAUTHENTICATED,
    EventType,
    obligation_internal_id,
    source_event_internal_id,
)
from backend.app.ingestion.schemas import MAX_RAW_PAYLOAD_BYTES, NormalizedEventIn
from backend.app.services.ingestion_service import content_fingerprint
from backend.tests.events_support import (
    CHECKOUT_ABANDONED,
    CHECKOUT_STARTED,
    FAILED,
    INV_ISSUED,
    INV_OVERDUE,
    INV_PAID,
    INV_VOIDED,
    SUB_FAILED,
    SUB_SUCCEEDED,
    SUCCEEDED,
    event,
)


def errors_of(body):
    with pytest.raises(ValidationError) as err:
        NormalizedEventIn.model_validate(body)
    return err.value.errors()


@pytest.mark.parametrize("event_type", [t.value for t in EventType])
def test_every_event_type_in_the_vocabulary_has_an_accepted_shape(event_type):
    body = event("e1", event_type)
    if event_type in (INV_ISSUED, INV_OVERDUE):
        body["data"] = {"due_at": "2026-10-30T00:00:00+05:30"}
    parsed = NormalizedEventIn.model_validate(body)
    assert parsed.event_type.value == event_type
    assert parsed.reference.kind == EVENT_REFERENCE_KIND[EventType(event_type)]


def test_a_minimal_event_needs_no_amount_customer_or_provider_extras():
    body = event("e1", SUCCEEDED, amount_minor=None, currency=None, customer=None)
    parsed = NormalizedEventIn.model_validate(body)
    assert parsed.amount_minor is None and parsed.customer_ref is None and parsed.data == {}


def test_type_specific_data_is_normalized_and_unknown_keys_are_rejected():
    ok = NormalizedEventIn.model_validate(
        event("e1", SUB_FAILED, data={"failure_code": " card_declined ", "consecutive_failures": 2})
    )
    assert ok.data == {"failure_code": "card_declined", "consecutive_failures": 2}
    assert any(e["type"] == "extra_forbidden" for e in errors_of(event("e2", FAILED, data={"failure_code": "x", "bogus": 1})))
    assert any(e["type"] == "missing" for e in errors_of(event("e3", FAILED, data={})))  # failure_code is required
    assert errors_of(event("e4", SUB_FAILED, data={"failure_code": "x", "consecutive_failures": 0}))  # must be >= 1


@pytest.mark.parametrize(
    "mutation,fragment",
    [
        (lambda b: b.pop("source_event_id"), "source_event_id"),
        (lambda b: b.pop("claimed_merchant_id"), "claimed_merchant_id"),
        (lambda b: b.pop("occurred_at"), "occurred_at"),
        (lambda b: b.pop("reference"), "reference"),
        (lambda b: b.update(event_type="payment.exploded"), "event_type"),
        (lambda b: b.update(source="Bad Source!"), "source"),
        (lambda b: b.update(source_event_id=""), "source_event_id"),
        (lambda b: b.update(source_event_id="x" * 256), "source_event_id"),
        (lambda b: b.update(source_event_id="a\nb"), "source_event_id"),
        (lambda b: b.update(claimed_merchant_id=""), "claimed_merchant_id"),
        (lambda b: b.update(unexpected_field=1), "unexpected_field"),
        (lambda b: b.update(amount_minor=1999.5), "amount_minor"),       # money is integer minor units
        (lambda b: b.update(amount_minor=-1), "amount_minor"),
        (lambda b: b.update(amount_minor="1999"), "amount_minor"),       # strict: no string coercion
        (lambda b: b.update(currency="inr"), "currency"),
        (lambda b: b.update(customer_ref=""), "customer_ref"),
        (lambda b: b.update(occurred_at="yesterday"), "occurred_at"),
    ],
)
def test_malformed_events_are_rejected_naming_the_field(mutation, fragment):
    body = event("e1")
    mutation(body)
    problems = errors_of(body)
    assert any(fragment in ".".join(str(part) for part in p["loc"]) or fragment in p["msg"] for p in problems), problems


def test_a_timestamp_without_an_offset_is_rejected():
    body = event("e1")
    body["occurred_at"] = "2026-10-20T10:00:00"
    problems = errors_of(body)
    assert any("timezone" in p["msg"].lower() for p in problems)


def test_the_same_instant_in_different_offsets_is_the_same_content():
    a = NormalizedEventIn.model_validate(event("e1") | {"occurred_at": "2026-10-20T10:00:00+00:00"})
    b = NormalizedEventIn.model_validate(event("e1") | {"occurred_at": "2026-10-20T15:30:00+05:30"})
    assert content_fingerprint(a) == content_fingerprint(b)


def test_reference_kind_must_match_the_event_type():
    body = event("e1", FAILED)
    body["reference"]["kind"] = "invoice"
    assert any("reference.kind" in p["msg"] for p in errors_of(body))


def test_amount_and_currency_come_together():
    assert any("together" in p["msg"] for p in errors_of(event("e1", amount_minor=100, currency=None)))
    body = event("e1", currency="INR", amount_minor=None)
    body["currency"] = "INR"
    assert any("together" in p["msg"] for p in errors_of(body))


def test_the_raw_payload_is_bounded_and_must_be_plain_json():
    big = {"blob": "x" * (MAX_RAW_PAYLOAD_BYTES + 1)}
    assert any("limit" in p["msg"] for p in errors_of(event("e1", raw=big)))
    assert errors_of(event("e1", raw={"n": float("nan")}))


def test_fingerprint_changes_with_content_but_not_with_raw_or_key_order():
    base = NormalizedEventIn.model_validate(event("e1"))
    same_with_raw = NormalizedEventIn.model_validate(event("e1", raw={"delivery_attempt": 3}))
    other_amount = NormalizedEventIn.model_validate(event("e1", amount_minor=250000))
    other_data = NormalizedEventIn.model_validate(event("e1", data={"failure_code": "insufficient_funds"}))
    assert content_fingerprint(base) == content_fingerprint(same_with_raw)
    assert len({content_fingerprint(x) for x in (base, other_amount, other_data)}) == 3


def test_internal_ids_are_stable_and_scoped():
    a = source_event_internal_id("merch_a", "internal", "e1")
    assert a == source_event_internal_id("merch_a", "internal", "e1")
    assert a != source_event_internal_id("merch_b", "internal", "e1")   # another merchant
    assert a != source_event_internal_id("merch_a", "other", "e1")      # another source
    assert obligation_internal_id("merch_a", "payment", "o1") != obligation_internal_id("merch_a", "invoice", "o1")
    assert source_event_internal_id("merch_a", "internal", "e1").startswith("sev_")


def test_the_merchant_field_is_named_and_recorded_as_a_claim():
    body = event("e1")
    assert "claimed_merchant_id" in body and "merchant_id" not in body
    assert MERCHANT_ASSERTION_UNAUTHENTICATED == "unauthenticated_claim"
    # sending a bare `merchant_id` (which would read as trusted) is refused as an unknown field
    assert any(p["type"] == "extra_forbidden" for p in errors_of(copy.deepcopy(body) | {"merchant_id": "merch_a"}))


@pytest.mark.parametrize("event_type", [INV_PAID, INV_VOIDED, SUB_SUCCEEDED, CHECKOUT_STARTED, CHECKOUT_ABANDONED])
def test_events_with_no_type_specific_fields_reject_stray_data(event_type):
    assert errors_of(event("e1", event_type, data={"anything": 1}))
