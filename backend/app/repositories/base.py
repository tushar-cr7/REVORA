from abc import ABC, abstractmethod
from typing import Any, ContextManager, Dict, List, Optional, Sequence, Tuple
from backend.app.domain.events import RevenueObligation, SourceEvent
from backend.app.domain.models import (
    AuditEvent,
    Decision,
    ExecutionAttempt,
    IdempotencyRecord,
    Intervention,
    RecoveryCase,
    ScanRun,
    Transaction,
)

# Query scoping. Every run-scoped read takes `run_id`:
#   None            -> the active scan run (what the dashboard is looking at)
#   ALL_RUNS ("all")-> history across every run
#   "<run id>"      -> that specific run


class BaseRepository(ABC):
    def describe(self) -> Dict[str, Any]:
        """What this store is, for the readiness endpoint. Raises if it cannot be reached."""
        return {"backend": type(self).__name__, "durable": False}

    # ── concurrency ──────────────────────────────────────────────────────
    @abstractmethod
    def atomic(self) -> ContextManager[Any]:
        """
        A critical section and a unit of work. Everything read and written inside one
        `with repo.atomic():` block is isolated from every other `atomic()` block and is
        applied all-or-nothing:

        * in-memory: a re-entrant lock. Writes are NOT undone if the block raises.
        * PostgreSQL: one database transaction. It commits when the block exits normally and
          ROLLS BACK when it raises, so an exception discards every write made inside it.
          Reads of a case inside the block take a row lock (`SELECT ... FOR UPDATE`) held until
          the block ends; `get_active_run` takes a shared lock on the active run.

        Consequences callers must respect:
        1. Nested blocks join the outer one (one transaction, committed by the outermost).
        2. To REFUSE a request while keeping the record of the refusal, finish the block and
           raise afterwards; raising inside it would erase the record on a database.
        3. Mutations of an object returned by a getter are only persisted by the matching
           `save_*` call. A getter may return a copy.
        4. Keep blocks short and never hold one across a call to an external provider.
        """

    @abstractmethod
    def lock_customer(self, merchant_id: str, customer_id: str) -> None:
        """
        Serialize every `atomic()` section that locks the same (merchant, customer) until the
        current section ends. Contact limits are counted across a customer's cases, so two
        reservations for different cases of one customer must not both read "no contact yet".
        Must be called inside `atomic()`. No-op where `atomic()` is already a global lock.
        """

    # ── scan runs ────────────────────────────────────────────────────────
    @abstractmethod
    def register_scan_run(
        self, run: ScanRun, transactions: List[Transaction], cases: List[RecoveryCase]
    ) -> Tuple[ScanRun, bool]:
        """
        Store a new run with its transactions and cases and make it the active run
        (the previously active run becomes `superseded`; nothing is deleted). If a
        run with the same source fingerprint already exists it is re-activated
        instead and the arguments are discarded. Returns (run, created).
        """

    @abstractmethod
    def find_run_by_fingerprint(self, fingerprint: str) -> Optional[ScanRun]:
        pass

    @abstractmethod
    def activate_run(self, run_id: str) -> ScanRun:
        pass

    @abstractmethod
    def get_active_run(self) -> Optional[ScanRun]:
        pass

    @abstractmethod
    def get_run(self, run_id: str) -> Optional[ScanRun]:
        pass

    @abstractmethod
    def list_runs(self) -> List[ScanRun]:
        pass

    # ── transactions (immutable once a run is registered) ────────────────
    @abstractmethod
    def get_transaction_by_id(self, tx_id: str, run_id: Optional[str] = None) -> Optional[Transaction]:
        pass

    @abstractmethod
    def get_all_transactions(self, run_id: Optional[str] = None) -> List[Transaction]:
        pass

    @abstractmethod
    def update_transaction_analysis(
        self, run_id: str, transaction_id: str, model_recovery_prob: Optional[float], contacts_today: Optional[int]
    ) -> None:
        """
        Persist the two figures analysis computes onto a transaction: the model's recovery
        probability and the decision-time contact count. Everything else on a scanned
        transaction is immutable once its run is registered.
        """

    @abstractmethod
    def update_transaction_analyses(
        self, run_id: str, rows: Sequence[Tuple[str, Optional[float], Optional[int]]]
    ) -> None:
        """`update_transaction_analysis` for many transactions: (transaction_id, probability, contacts_today or None)."""

    @abstractmethod
    def lock_cases(self, run_id: str, transaction_ids: Sequence[str]) -> List[RecoveryCase]:
        """
        The cases of these transactions in one run, in run order, row-locked until the enclosing
        `atomic()` section ends (a database); the same objects the single-case getters return
        (in-memory). One statement for a whole batch. Must be called inside `atomic()`.
        """

    # ── recovery cases ───────────────────────────────────────────────────
    @abstractmethod
    def save_case(self, case: RecoveryCase):
        pass

    @abstractmethod
    def get_case(self, case_id: str) -> Optional[RecoveryCase]:
        pass

    @abstractmethod
    def get_case_for_transaction(self, key: str, run_id: Optional[str] = None) -> Optional[RecoveryCase]:
        """`key` is a transaction_id or leak_id, resolved inside one run."""

    @abstractmethod
    def list_cases(self, run_id: Optional[str] = None) -> List[RecoveryCase]:
        pass

    # ── decisions ────────────────────────────────────────────────────────
    @abstractmethod
    def save_decision(self, decision: Decision):
        pass

    @abstractmethod
    def get_decision(self, decision_id_or_leak_id: str) -> Optional[Decision]:
        """A decision_id (any run), or a transaction/leak id (resolved to the active run's current decision)."""

    @abstractmethod
    def get_all_decisions(self, run_id: Optional[str] = None) -> List[Decision]:
        """The current decision of each case in the run."""

    # ── attempt ledger ───────────────────────────────────────────────────
    @abstractmethod
    def save_attempt(self, attempt: ExecutionAttempt):
        pass

    @abstractmethod
    def get_attempt(self, attempt_id: str) -> Optional[ExecutionAttempt]:
        pass

    @abstractmethod
    def list_attempts(
        self, case_id: Optional[str] = None, run_id: Optional[str] = None
    ) -> List[ExecutionAttempt]:
        """A case's ledger in sequence order, or every attempt in a run when no case is given."""

    @abstractmethod
    def list_customer_attempts(self, merchant_id: str, customer_id: str) -> List[ExecutionAttempt]:
        """Attempts against one customer across every run (a person is not scoped to a scan)."""

    @abstractmethod
    def list_attempts_since(self, created_since: str) -> List[ExecutionAttempt]:
        """Every attempt, in any run, created at or after `created_since` (ISO 8601). Bounded by the window."""

    @abstractmethod
    def list_reserved_attempts(self, created_before: str) -> List[ExecutionAttempt]:
        """Attempts still `reserved` that were reserved before `created_before` (ISO 8601), oldest first, all runs."""

    # ── idempotency ──────────────────────────────────────────────────────
    @abstractmethod
    def get_idempotency_record(self, merchant_id: str, operation: str, key: str) -> Optional[IdempotencyRecord]:
        pass

    @abstractmethod
    def insert_idempotency_record(self, record: IdempotencyRecord) -> None:
        """Create the record. Raises DuplicateIdempotencyKey if (merchant_id, operation, key) already exists."""

    @abstractmethod
    def save_idempotency_record(self, record: IdempotencyRecord):
        """Update an existing record (completion). Never changes its request fingerprint."""

    # ── interventions ────────────────────────────────────────────────────
    @abstractmethod
    def save_intervention(self, intervention: Intervention):
        pass

    @abstractmethod
    def get_intervention_by_id(self, intervention_id: str) -> Optional[Intervention]:
        pass

    @abstractmethod
    def get_all_interventions(self, run_id: Optional[str] = None) -> List[Intervention]:
        pass

    @abstractmethod
    def get_escalations(self, run_id: Optional[str] = None) -> List[Decision]:
        pass

    # ── audit ────────────────────────────────────────────────────────────
    @abstractmethod
    def save_audit_event(self, event: AuditEvent):
        pass

    @abstractmethod
    def get_audit_log(
        self,
        limit: int = 200,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        newest_first: bool = False,
        run_id: Optional[str] = None,
    ) -> List[AuditEvent]:
        pass

    @abstractmethod
    def summarize_audit_log(
        self,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Matching-event count and per-event-type counts, before any limit is applied."""
        pass

    # ── source events, obligations, ingestion run (Phase 2) ──────────────
    @abstractmethod
    def get_or_create_ingestion_run(self, merchant_id: str, now_iso: str) -> ScanRun:
        """The standing, never-activated run that holds a merchant's event-derived cases."""

    @abstractmethod
    def create_case(self, case: RecoveryCase, transaction: Transaction) -> None:
        """Add one transaction and its case to an EXISTING ingestion run. Refuses a scan run."""

    @abstractmethod
    def update_source_transaction(self, transaction: Transaction) -> None:
        """Replace the facts of a transaction that belongs to an ingestion run. Refuses a scan run."""

    @abstractmethod
    def insert_source_event(self, event: SourceEvent) -> Tuple[SourceEvent, bool]:
        """
        Store a normalized event unless (merchant_id, source, source_event_id) already exists.
        Returns (stored_event, created). A repeat delivery with identical content returns the
        stored event and created=False; different content raises EventIdentityConflict.
        """

    @abstractmethod
    def get_source_event(self, event_id: str) -> Optional[SourceEvent]:
        pass

    @abstractmethod
    def list_source_events(
        self,
        merchant_id: Optional[str] = None,
        processing_status: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 100,
    ) -> List[SourceEvent]:
        """Newest-received first."""

    @abstractmethod
    def list_events_for_reference(self, merchant_id: str, reference_kind: str, reference_id: str) -> List[SourceEvent]:
        """Every stored event about one object, ordered by occurred_at then event id (a total order)."""

    @abstractmethod
    def mark_source_event(
        self, event_id: str, processing_status: str, failure_reason: Optional[str], processed_at: str
    ) -> None:
        pass

    @abstractmethod
    def lock_obligation(
        self, merchant_id: str, reference_kind: str, reference_id: str, leak_type: str, now_iso: str
    ) -> RevenueObligation:
        """Get-or-create the obligation for a reference and hold it (row lock) until the section ends. Inside atomic()."""

    @abstractmethod
    def save_obligation(self, obligation: RevenueObligation) -> None:
        pass

    @abstractmethod
    def get_obligation(self, obligation_id: str) -> Optional[RevenueObligation]:
        pass

    @abstractmethod
    def list_obligations(
        self, merchant_id: Optional[str] = None, status: Optional[str] = None, limit: int = 100
    ) -> List[RevenueObligation]:
        pass

    @abstractmethod
    def clear(self):
        """Delete everything. Test-only: implementations refuse unless explicitly enabled."""
