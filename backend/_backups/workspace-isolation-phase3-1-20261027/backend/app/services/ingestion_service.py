"""
Event ingestion: validate -> store (once) -> detect.

Order of operations, and why
  1. STORE the normalized event in its own unit of work. Deduplication is the database's unique
     constraint on (merchant, source, source_event_id), not a lookup that could race. From this
     point a valid event is never lost, whatever happens next.
  2. PROCESS it (detection) in a second unit of work. If that fails, the event stays stored and is
     marked `failed` with the reason, so it can be replayed with `reprocess` once the cause is fixed.
  3. A redelivery of an event that is already `processed`/`ignored` is acknowledged and does nothing.
     A redelivery of one that is still `received` or `failed` is processed again (it heals a crash
     between steps 1 and 2).

Receiving an event never executes anything.
"""
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional

from backend.app.domain.events import (
    MERCHANT_ASSERTION_UNAUTHENTICATED,
    ProcessingStatus,
    SourceEvent,
    source_event_internal_id,
)
from backend.app.ingestion.projection import NO_DETECTION_TYPES
from backend.app.ingestion.schemas import NormalizedEventIn
from backend.app.repositories.base import BaseRepository
from backend.app.repositories.errors import run_with_retry
from backend.app.services.detection_service import DetectionResult, DetectionService

logger = logging.getLogger("revora.ingestion")

# An event claiming to have happened later than this is rejected: a far-future timestamp would sort
# after every real event and decide an obligation's state forever.
MAX_CLOCK_SKEW = timedelta(minutes=5)


class EventValidationError(ValueError):
    """A well-formed event that is semantically unacceptable. Maps to HTTP 422."""

    code = "invalid_event"

    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


@dataclass
class IngestionResult:
    event: SourceEvent
    duplicate: bool
    detection: Optional[DetectionResult]

    def to_dict(self):
        return {
            "status": "duplicate" if self.duplicate else "accepted",
            "duplicate": self.duplicate,
            "event": self.event.to_dict(),
            "detection": self.detection.to_dict() if self.detection else None,
        }


def content_fingerprint(event: NormalizedEventIn) -> str:
    """
    Digest of what the event SAYS (not how it arrived): the same identity with the same content is a
    redelivery; the same identity with different content is a conflict. `raw` is excluded on purpose
    (delivery metadata may legitimately differ between attempts) and so is the claimed merchant, which
    is already part of the event's identity.
    """
    canonical = json.dumps(
        {
            "event_type": event.event_type.value,
            "occurred_at": event.occurred_at.astimezone(timezone.utc).isoformat(),
            "reference": {"kind": event.reference.kind.value, "id": event.reference.id},
            "customer_ref": event.customer_ref,
            "amount_minor": event.amount_minor,
            "currency": event.currency,
            "data": event.data,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class IngestionService:
    def __init__(
        self,
        repo: BaseRepository,
        detection: DetectionService,
        clock: Optional[Callable[[], datetime]] = None,
    ):
        self.repo = repo
        self.detection = detection
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def build_event(self, incoming: NormalizedEventIn) -> SourceEvent:
        now = self.clock()
        occurred = incoming.occurred_at.astimezone(timezone.utc)
        if occurred > now + MAX_CLOCK_SKEW:
            raise EventValidationError(
                f"occurred_at {occurred.isoformat()} is in the future "
                f"(more than {int(MAX_CLOCK_SKEW.total_seconds() // 60)} minutes ahead of the server clock).",
                code="occurred_at_in_future",
            )
        merchant = incoming.claimed_merchant_id
        return SourceEvent(
            event_id=source_event_internal_id(merchant, incoming.source, incoming.source_event_id),
            merchant_id=merchant,
            # No authentication exists yet, so the merchant is recorded for what it is: a claim.
            merchant_assertion=MERCHANT_ASSERTION_UNAUTHENTICATED,
            source=incoming.source,
            source_event_id=incoming.source_event_id,
            event_type=incoming.event_type.value,
            reference_kind=incoming.reference.kind.value,
            reference_id=incoming.reference.id,
            customer_ref=incoming.customer_ref,
            amount_minor=incoming.amount_minor,
            currency=incoming.currency,
            payload=dict(incoming.data),
            content_fingerprint=content_fingerprint(incoming),
            occurred_at=occurred.isoformat(),
            received_at=now.isoformat(),
            raw_payload=incoming.raw,
        )

    # ── ingest ───────────────────────────────────────────────────────────
    def ingest(self, incoming: NormalizedEventIn) -> IngestionResult:
        """Raises EventValidationError (422) or EventIdentityConflict (409); otherwise the event is stored."""
        candidate = self.build_event(incoming)

        def store():
            with self.repo.atomic():
                return self.repo.insert_source_event(candidate)

        stored, created = run_with_retry(store)

        if not created and stored.processing_status in (ProcessingStatus.PROCESSED.value, ProcessingStatus.IGNORED.value):
            return IngestionResult(stored, duplicate=True, detection=None)

        detection = self._process(stored)
        return IngestionResult(self.repo.get_source_event(stored.event_id) or stored, duplicate=not created, detection=detection)

    # ── process / replay ─────────────────────────────────────────────────
    def _process(self, event: SourceEvent) -> Optional[DetectionResult]:
        now_iso = self.clock().isoformat()
        if event.event_type in NO_DETECTION_TYPES:
            with self.repo.atomic():
                self.repo.mark_source_event(event.event_id, ProcessingStatus.IGNORED.value, None, now_iso)
            return None
        def detect():
            with self.repo.atomic():
                outcome = self.detection.evaluate(event.merchant_id, event.reference_kind, event.reference_id)
                self.repo.mark_source_event(event.event_id, ProcessingStatus.PROCESSED.value, None, now_iso)
                return outcome

        try:
            return run_with_retry(detect)  # a deadlock rolls the whole unit back; it is re-run from the start
        except Exception as exc:  # noqa: BLE001 - the event is already stored; record why detection could not run
            logger.exception("detection failed for event %s", event.event_id)
            reason = f"{type(exc).__name__}: {exc}"[:500]
            with self.repo.atomic():
                self.repo.mark_source_event(event.event_id, ProcessingStatus.FAILED.value, reason, now_iso)
            return None

    def reprocess(self, event_id: str) -> IngestionResult:
        """Re-run detection for a stored event. Idempotent; the way to replay after a failure is fixed."""
        event = self.repo.get_source_event(event_id)
        if event is None:
            raise KeyError(f"Unknown source event {event_id}.")
        detection = self._process(event)
        return IngestionResult(self.repo.get_source_event(event_id) or event, duplicate=False, detection=detection)

    def reprocess_failed(self, limit: int = 100) -> List[IngestionResult]:
        results = []
        for status in (ProcessingStatus.FAILED.value, ProcessingStatus.RECEIVED.value):
            for event in self.repo.list_source_events(processing_status=status, limit=limit):
                results.append(self.reprocess(event.event_id))
        return results
