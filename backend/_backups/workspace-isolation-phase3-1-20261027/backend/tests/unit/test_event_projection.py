"""
The obligation projection is a function of the SET of events. Arrival order, repeats and the offset a
timestamp was written in must not change it — that is what makes out-of-order delivery safe.
"""
import itertools
import random

import pytest

from backend.app.domain.events import ObligationStatus, SourceEvent, source_event_internal_id
from backend.app.ingestion.projection import fold
from backend.app.ingestion.schemas import NormalizedEventIn
from backend.app.services.ingestion_service import IngestionService
from backend.tests.events_support import (
    FAILED,
    INV_ISSUED,
    INV_OVERDUE,
    INV_PAID,
    INV_VOIDED,
    SUB_FAILED,
    SUCCEEDED,
    SERVER_NOW,
    event,
)
from backend.tests.support import FakeClock

_builder = IngestionService(repo=None, detection=None, clock=FakeClock(SERVER_NOW))  # build_event needs no repository


def stored(source_event_id, event_type=FAILED, **kwargs) -> SourceEvent:
    return _builder.build_event(NormalizedEventIn.model_validate(event(source_event_id, event_type, **kwargs)))


def test_no_events_is_an_observed_empty_projection():
    p = fold([])
    assert p.status == ObligationStatus.OBSERVED.value and p.event_count == 0


def test_a_failure_puts_the_object_at_risk_and_carries_the_reported_facts():
    p = fold([stored("e1", at=0, data={"failure_code": "card_declined", "attempt_number": 2, "payment_method": "card"})])
    assert p.status == "at_risk" and p.failure_count == 1
    assert (p.amount_minor, p.currency, p.customer_ref) == (249900, "INR", "cust_1")
    assert (p.latest_failure_code, p.reported_attempt_number, p.payment_method) == ("card_declined", 2, "card")
    assert p.first_at_risk_at == p.last_at_risk_at


def test_a_later_success_settles_it_and_an_earlier_one_does_not():
    assert fold([stored("f", at=0), stored("s", SUCCEEDED, at=10)]).status == "settled"
    # the success happened BEFORE the failure: the failure is the current fact
    assert fold([stored("s", SUCCEEDED, at=0, amount_minor=None, currency=None), stored("f", at=10)]).status == "at_risk"


def test_a_late_delivered_old_failure_cannot_overwrite_a_newer_success():
    in_order = fold([stored("f0", at=0), stored("s", SUCCEEDED, at=10)])
    old_failure_arrives_last = fold([stored("s", SUCCEEDED, at=10), stored("f0", at=0)])
    assert in_order == old_failure_arrives_last and in_order.status == "settled"


def test_simultaneous_failure_and_success_resolve_to_settled():
    # Wrongly chasing a customer who already paid costs more than missing one failure.
    assert fold([stored("f", at=5), stored("s", SUCCEEDED, at=5)]).status == "settled"
    assert fold([stored("s", SUCCEEDED, at=5), stored("f", at=5)]).status == "settled"


def test_invoice_lifecycle():
    issued = stored("i", INV_ISSUED, at=0, data={"due_at": "2026-10-30T00:00:00+00:00"})
    assert fold([issued]).status == "observed" and fold([issued]).due_at == "2026-10-30T00:00:00Z"
    overdue = stored("o", INV_OVERDUE, at=10)
    assert fold([issued, overdue]).status == "at_risk"
    assert fold([issued, overdue, stored("p", INV_PAID, at=20)]).status == "settled"
    assert fold([issued, overdue, stored("v", INV_VOIDED, at=20)]).status == "void"


def test_subscription_counts_come_from_what_the_source_reported():
    p = fold([
        stored("a", SUB_FAILED, at=0, ref="sub_1:2026-10", data={"failure_code": "x", "consecutive_failures": 1}),
        stored("b", SUB_FAILED, at=60, ref="sub_1:2026-10", data={"failure_code": "x", "consecutive_failures": 2}),
    ])
    assert p.failure_count == 2 and p.consecutive_failures == 2


def test_attempt_numbers_are_the_maximum_reported_not_a_count_of_deliveries():
    p = fold([stored("a", at=0, data={"failure_code": "x", "attempt_number": 3})])
    assert p.failure_count == 1 and p.reported_attempt_number == 3  # one event delivered, three attempts made


def test_latest_amount_wins_but_a_missing_amount_never_erases_a_known_one():
    p = fold([stored("a", at=0), stored("b", at=10, amount_minor=None, currency=None)])
    assert p.amount_minor == 249900


@pytest.mark.parametrize("seed", range(12))
def test_every_arrival_order_gives_the_same_projection(seed):
    events = [
        stored("i", INV_ISSUED, at=0, ref="inv_1", data={"due_at": "2026-10-25T00:00:00+00:00"}),
        stored("o1", INV_OVERDUE, at=30, ref="inv_1"),
        stored("o2", INV_OVERDUE, at=60, ref="inv_1"),
        stored("p", INV_PAID, at=90, ref="inv_1"),
        stored("o3", INV_OVERDUE, at=45, ref="inv_1"),
    ]
    expected = fold(events)
    shuffled = events[:]
    random.Random(seed).shuffle(shuffled)
    assert fold(shuffled) == expected and expected.status == "settled"


def test_exhaustive_orderings_of_a_failure_retry_and_success():
    events = [stored("f1", at=0), stored("f2", at=30, data={"failure_code": "x", "attempt_number": 2}), stored("s", SUCCEEDED, at=60)]
    results = {fold(list(order)) for order in itertools.permutations(events)}
    assert len(results) == 1 and results.pop().status == "settled"


def test_delivering_an_event_twice_does_not_double_count_after_dedup():
    # Deduplication happens at storage (one row per identity); the fold sees each fact once.
    one = stored("f1", at=0)
    assert source_event_internal_id("merch_a", "internal", "f1") == one.event_id
    assert fold([one]).failure_count == 1
