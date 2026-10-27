"""Errors a repository raises. They carry no storage-driver types, so services can handle them
without knowing which implementation is behind the interface."""
import random
import time
from typing import Callable, TypeVar

T = TypeVar("T")


class RepositoryError(Exception):
    """Base class for storage-level failures that are not the caller's fault."""


class DuplicateIdempotencyKey(RepositoryError):
    """
    An idempotency record for (merchant_id, operation, key) already exists.

    Raised by `insert_idempotency_record` when two requests race on a new key. With a database
    this surfaces at COMMIT-visible time, after the losing transaction has already done work,
    so the whole `atomic()` section rolls back and the caller re-evaluates against the winner.
    """


class EventIdentityConflict(RepositoryError):
    """The same (merchant, source, source_event_id) was delivered again with different content."""

    def __init__(self, event_id: str, stored_fingerprint: str, received_fingerprint: str):
        super().__init__(
            f"Source event {event_id} already exists with different content "
            f"(stored {stored_fingerprint[:12]}, received {received_fingerprint[:12]})."
        )
        self.event_id = event_id
        self.stored_fingerprint = stored_fingerprint
        self.received_fingerprint = received_fingerprint


class TransientStorageError(RepositoryError):
    """
    The database aborted the unit of work for a reason that a retry can cure (a deadlock, or a
    serialization failure). The unit was rolled back whole, so re-running it from the start is safe.
    """


def run_with_retry(unit: Callable[[], T], attempts: int = 4, base_delay: float = 0.02) -> T:
    """
    Run a whole unit of work, re-running it from scratch if the database aborted it as transient.
    `unit` must be the COMPLETE unit (everything inside one `atomic()`), never part of one, and must
    re-read whatever it depends on, because the world may have changed between attempts.
    """
    for attempt in range(1, attempts + 1):
        try:
            return unit()
        except TransientStorageError:
            if attempt == attempts:
                raise
            time.sleep(base_delay * attempt * (0.5 + random.random()))  # jittered backoff so racers do not collide again
    raise AssertionError("unreachable")


class StaleWrite(RepositoryError):
    """
    A save would overwrite a newer version of the row: the object was read before another unit of work
    committed a change to it (or was read without the row lock). The save is refused; re-read and retry.
    """


class MoneyPrecisionError(RepositoryError, ValueError):
    """An amount cannot be stored exactly (more than two decimal places, or not finite). Refused, never rounded."""


class SchemaNotReady(RepositoryError):
    """The database schema is missing, out of date, or ahead of this code."""
