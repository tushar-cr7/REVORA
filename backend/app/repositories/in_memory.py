import threading
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any, ContextManager, Dict, List, Optional, Sequence, Tuple
from backend.app.domain.events import RevenueObligation, SourceEvent, obligation_internal_id
from backend.app.domain.models import (
    ALL_RUNS,
    AuditEvent,
    Decision,
    ExecutionAttempt,
    IdempotencyRecord,
    Intervention,
    RecoveryCase,
    ScanRun,
    Transaction,
    new_id,
    utc_now_iso,
)
from backend.app.domain.workspaces import (
    ExecutionMode,
    ExecutionNotAvailable,
    UnknownWorkspace,
    Workspace,
    WorkspaceAlreadyExists,
    WorkspaceMismatch,
    demo_seed_workspace,
    require_demo_workspace,
    validate_new_workspace,
)
from backend.app.repositories.base import BaseRepository
from backend.app.repositories.errors import DuplicateIdempotencyKey, EventIdentityConflict


def _parse(ts: str) -> datetime:
    parsed = datetime.fromisoformat(ts)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class InMemoryRepository(BaseRepository):
    """
    Process-local storage, for isolated unit tests and explicit non-durable demos
    (REVORA_STORAGE=memory). It is NOT durable. Guarantees, and their limits:

    * `atomic()` is a re-entrant lock, so concurrent threads in this process get
      mutual exclusion across a read-check-write sequence. It does NOT protect
      against a second process (e.g. several uvicorn workers each get their own
      repository), it does NOT roll back writes when a block raises, and nothing
      here survives a restart.
    * Getters return live objects. Mutate them only inside `atomic()`. (The PostgreSQL
      repository returns copies, so production code must always `save_*` what it changed.)
    * Scans never delete: a new run supersedes the old one, and every record keeps
      the `run_id` it was created under.
    * Workspaces mirror migrations 0003 and 0004: the store starts with the seeded demo workspace, a
      synthetic run is refused outside a registered demo workspace, workspaces are handed out
      as copies (so their kind cannot be changed) and `clear()` keeps them. Each workspace has its
      own active run. A record that names another workspace than the run, case or attempt it belongs
      to is refused (WorkspaceMismatch) whenever that parent exists here; an attempt cannot start in a
      workspace that is not `simulation` (ExecutionNotAvailable). Unlike PostgreSQL there are no foreign
      keys, so a parent that does not exist is not an error in this store.
    """

    def __init__(self):
        self._lock = threading.RLock()
        # workspace_id -> Workspace, in registration order
        seed = demo_seed_workspace()
        self._workspaces: Dict[str, Workspace] = {seed.workspace_id: seed}
        self._runs: Dict[str, ScanRun] = {}
        self._run_by_fingerprint: Dict[str, str] = {}
        self._active_run_ids: Dict[str, str] = {}  # workspace_id -> its active run (at most one each)
        # transactions: per run, ordered list + (tx_id | leak_id) -> Transaction
        self._tx_order: Dict[str, List[Transaction]] = {}
        self._tx_index: Dict[str, Dict[str, Transaction]] = {}
        # cases
        self._cases: Dict[str, RecoveryCase] = {}
        self._cases_by_run: Dict[str, List[str]] = {}
        self._case_index: Dict[Tuple[str, str], str] = {}  # (run_id, tx_id | leak_id) -> case_id
        # decisions: every decision ever made, keyed by decision_id (history is kept)
        self._decisions: Dict[str, Decision] = {}
        # attempt ledger
        self._attempts: Dict[str, ExecutionAttempt] = {}
        self._attempts_by_case: Dict[str, List[str]] = {}
        self._attempts_by_run: Dict[str, List[str]] = {}
        self._attempts_by_customer: Dict[Tuple[str, str], List[str]] = {}
        # idempotency, scoped by (merchant_id, operation, key)
        self._idempotency: Dict[Tuple[str, str, str], IdempotencyRecord] = {}
        self._interventions: Dict[str, Intervention] = {}
        self._audit_log: List[AuditEvent] = []
        # source events and obligations (Phase 2)
        self._events: Dict[str, SourceEvent] = {}
        self._event_order: List[str] = []
        self._obligations: Dict[str, RevenueObligation] = {}
        self._ingestion_runs: Dict[str, str] = {}  # merchant_id -> run_id
        # Legacy progress flags (no longer read by the application).
        self.scanned: bool = False
        self.analyzed: bool = False
        self.recovered: bool = False

    def describe(self) -> Dict[str, Any]:
        return {"backend": "memory", "durable": False}

    # ── concurrency ──────────────────────────────────────────────────────
    def atomic(self) -> ContextManager[Any]:
        return self._lock

    def lock_customer(self, merchant_id: str, customer_id: str) -> None:
        return None  # atomic() is already one global lock

    @staticmethod
    def _require_workspace(workspace_id: str) -> str:
        if not workspace_id:
            raise ValueError("workspace_id is required: there is no implicit workspace and no global active run.")
        return workspace_id

    def _scope(self, workspace_id: str, run_id: Optional[str]) -> Optional[str]:
        """
        The run a read covers, inside one workspace: a run id, ALL_RUNS, or None for "nothing".
        None run_id -> the workspace's active run (None if it has none); a run id -> itself only if the
        workspace owns it.
        """
        self._require_workspace(workspace_id)
        if run_id == ALL_RUNS:
            return ALL_RUNS
        if run_id:
            run = self._runs.get(run_id)
            return run_id if run is not None and run.merchant_id == workspace_id else None
        return self._active_run_ids.get(workspace_id)

    def _runs_of(self, workspace_id: str) -> List[str]:
        return [rid for rid, run in self._runs.items() if run.merchant_id == workspace_id]

    def _case_workspace_check(self, merchant_id: str, case_id: Optional[str], run_id: Optional[str] = None) -> None:
        """The in-memory form of the ws_* foreign keys: when the parent case / run exists, the workspace must agree."""
        if case_id is not None:
            case = self._cases.get(case_id)
            if case is not None and (case.merchant_id != merchant_id or (run_id is not None and case.run_id != run_id)):
                raise WorkspaceMismatch(
                    f"A record names a different workspace or run than its case {case_id}; nothing was stored.",
                    merchant_id,
                )
        if run_id is not None:
            run = self._runs.get(run_id)
            if run is not None and run.merchant_id != merchant_id:
                raise WorkspaceMismatch(
                    f"A record names a different workspace than its run {run_id}; nothing was stored.", merchant_id
                )

    def _require_registered(self, workspace_id: str) -> None:
        if workspace_id not in self._workspaces:
            raise UnknownWorkspace(
                f"Workspace {workspace_id!r} does not exist. Workspaces are never created implicitly.", workspace_id
            )

    # ── workspaces ───────────────────────────────────────────────────────
    def get_workspace(self, workspace_id: str) -> Optional[Workspace]:
        with self._lock:
            workspace = self._workspaces.get(workspace_id)
            return replace(workspace) if workspace else None

    def list_workspaces(self) -> List[Workspace]:
        with self._lock:
            return [replace(w) for w in self._workspaces.values()]

    def create_workspace(self, workspace: Workspace) -> Workspace:
        validate_new_workspace(workspace)
        with self._lock:
            if workspace.workspace_id in self._workspaces:
                raise WorkspaceAlreadyExists(
                    f"Workspace {workspace.workspace_id!r} already exists; workspaces are never redefined.",
                    workspace.workspace_id,
                )
            self._workspaces[workspace.workspace_id] = replace(workspace)
            return replace(workspace)

    # ── scan runs ────────────────────────────────────────────────────────
    def register_scan_run(
        self, run: ScanRun, transactions: List[Transaction], cases: List[RecoveryCase]
    ) -> Tuple[ScanRun, bool]:
        with self._lock:
            # Same order of checks as PostgresRepository, so one bad input gets one answer from both:
            # the shape of the request, then ownership, then the workspace rules.
            for case in cases:
                if case.run_id != run.run_id:
                    raise ValueError(f"Case {case.case_id} belongs to run {case.run_id}, not {run.run_id}.")
            for child in (*transactions, *cases):
                if child.merchant_id != run.merchant_id:
                    raise WorkspaceMismatch(
                        f"{type(child).__name__} {getattr(child, 'transaction_id', '?')} names workspace "
                        f"{child.merchant_id!r}, but the run belongs to {run.merchant_id!r}.",
                        run.merchant_id,
                    )
            # Synthetic data only in a registered demo workspace (PostgreSQL also refuses the row itself).
            require_demo_workspace(self._workspaces.get(run.merchant_id), run.merchant_id)
            existing_id = self._run_by_fingerprint.get(run.source_fingerprint)
            if existing_id is not None:
                if self._runs[existing_id].merchant_id != run.merchant_id:
                    raise WorkspaceMismatch(
                        "That source fingerprint already belongs to a run of another workspace.", run.merchant_id
                    )
                return self._activate(existing_id), False

            for tx in transactions:
                tx.run_id = run.run_id

            self._supersede_active(run.merchant_id, run.created_at)
            run.status = "active"
            run.superseded_at = None
            self._runs[run.run_id] = run
            self._run_by_fingerprint[run.source_fingerprint] = run.run_id
            self._active_run_ids[run.merchant_id] = run.run_id

            self._tx_order[run.run_id] = list(transactions)
            index: Dict[str, Transaction] = {}
            for tx in transactions:
                index[tx.transaction_id] = tx
                index[tx.leak_id] = tx
            self._tx_index[run.run_id] = index

            self._cases_by_run[run.run_id] = []
            for case in cases:
                self._cases[case.case_id] = case
                self._cases_by_run[run.run_id].append(case.case_id)
                self._case_index[(run.run_id, case.transaction_id)] = case.case_id
                self._case_index[(run.run_id, case.leak_id)] = case.case_id

            self.scanned = True
            self.analyzed = False
            self.recovered = False
            return run, True

    def _supersede_active(self, workspace_id: str, at: str) -> None:
        run_id = self._active_run_ids.pop(workspace_id, None)
        if run_id is not None:
            current = self._runs[run_id]
            current.status = "superseded"
            current.superseded_at = at

    def _activate(self, run_id: str) -> ScanRun:
        run = self._runs[run_id]
        now = utc_now_iso()
        if self._active_run_ids.get(run.merchant_id) != run_id:
            self._supersede_active(run.merchant_id, now)
            run.status = "active"
            run.superseded_at = None
            self._active_run_ids[run.merchant_id] = run_id
        run.scan_count += 1
        run.last_scanned_at = now
        return run

    def find_run_by_fingerprint(self, fingerprint: str, *, workspace_id: str) -> Optional[ScanRun]:
        with self._lock:
            run_id = self._run_by_fingerprint.get(fingerprint)
            run = self._runs.get(run_id) if run_id else None
            return run if run is not None and run.merchant_id == self._require_workspace(workspace_id) else None

    def activate_run(self, run_id: str, *, workspace_id: str) -> ScanRun:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None or run.merchant_id != self._require_workspace(workspace_id):
                raise KeyError(f"Unknown scan run {run_id}.")  # unknown, or another workspace's: indistinguishable
            if run.kind != "synthetic_scan":
                raise ValueError(f"Run {run_id} is an {run.kind} run and cannot be activated.")
            return self._activate(run_id)

    def get_active_run(self, *, workspace_id: str) -> Optional[ScanRun]:
        with self._lock:
            run_id = self._active_run_ids.get(self._require_workspace(workspace_id))
            return self._runs.get(run_id) if run_id else None

    def get_run(self, run_id: str, *, workspace_id: str) -> Optional[ScanRun]:
        with self._lock:
            run = self._runs.get(run_id)
            return run if run is not None and run.merchant_id == self._require_workspace(workspace_id) else None

    def list_runs(self, *, workspace_id: str) -> List[ScanRun]:
        with self._lock:
            return [r for r in self._runs.values() if r.merchant_id == self._require_workspace(workspace_id)]

    # ── transactions ─────────────────────────────────────────────────────
    def get_transaction_by_id(
        self, tx_id: str, run_id: Optional[str] = None, *, workspace_id: str
    ) -> Optional[Transaction]:
        with self._lock:
            rid = self._scope(workspace_id, None if run_id == ALL_RUNS else run_id)
            return self._tx_index.get(rid, {}).get(tx_id) if rid else None

    def get_all_transactions(self, run_id: Optional[str] = None, *, workspace_id: str) -> List[Transaction]:
        with self._lock:
            rid = self._scope(workspace_id, run_id)
            if rid is None:
                return []
            if rid == ALL_RUNS:
                return [tx for r in self._runs_of(workspace_id) for tx in self._tx_order.get(r, [])]
            return list(self._tx_order.get(rid, []))

    def update_transaction_analysis(
        self, run_id: str, transaction_id: str, model_recovery_prob: Optional[float], contacts_today: Optional[int],
        *, workspace_id: str,
    ) -> None:
        with self._lock:
            owned = self._scope(workspace_id, run_id)
            tx = self._tx_index.get(owned, {}).get(transaction_id) if owned and owned != ALL_RUNS else None
            if tx is None:
                raise KeyError(f"Unknown transaction {transaction_id} in run {run_id}.")
            tx.model_recovery_prob = model_recovery_prob
            if contacts_today is not None:
                tx.contacts_today = contacts_today

    def update_transaction_analyses(
        self, run_id: str, rows: Sequence[Tuple[str, Optional[float], Optional[int]]], *, workspace_id: str
    ) -> None:
        with self._lock:
            for transaction_id, prob, contacts in rows:
                self.update_transaction_analysis(run_id, transaction_id, prob, contacts, workspace_id=workspace_id)

    def lock_cases(self, run_id: str, transaction_ids: Sequence[str], *, workspace_id: str) -> List[RecoveryCase]:
        with self._lock:
            owned = self._scope(workspace_id, run_id)
            if owned is None or owned == ALL_RUNS:
                return []
            wanted = set(transaction_ids)
            return [
                self._cases[cid] for cid in self._cases_by_run.get(owned, [])
                if self._cases[cid].transaction_id in wanted
            ]

    # ── cases ────────────────────────────────────────────────────────────
    def save_case(self, case: RecoveryCase):
        with self._lock:
            existing = self._cases.get(case.case_id)
            if existing is None:
                raise KeyError(f"Unknown case {case.case_id}; cases are created by register_scan_run.")
            if (existing.merchant_id, existing.run_id) != (case.merchant_id, case.run_id):
                raise WorkspaceMismatch(
                    f"Case {case.case_id} cannot be saved under a different workspace or run than it belongs to.",
                    case.merchant_id,
                )
            self._cases[case.case_id] = case

    def get_case(self, case_id: str, *, workspace_id: str) -> Optional[RecoveryCase]:
        with self._lock:
            case = self._cases.get(case_id)
            return case if case is not None and case.merchant_id == self._require_workspace(workspace_id) else None

    def get_case_for_transaction(
        self, key: str, run_id: Optional[str] = None, *, workspace_id: str
    ) -> Optional[RecoveryCase]:
        with self._lock:
            rid = self._scope(workspace_id, None if run_id == ALL_RUNS else run_id)
            case_id = self._case_index.get((rid, key)) if rid else None
            return self._cases.get(case_id) if case_id else None

    def list_cases(self, run_id: Optional[str] = None, *, workspace_id: str) -> List[RecoveryCase]:
        with self._lock:
            rid = self._scope(workspace_id, run_id)
            if rid is None:
                return []
            if rid == ALL_RUNS:
                return [c for c in self._cases.values() if c.merchant_id == workspace_id]
            return [self._cases[cid] for cid in self._cases_by_run.get(rid, [])]

    # ── decisions ────────────────────────────────────────────────────────
    def save_decision(self, decision: Decision):
        with self._lock:
            case = self._cases.get(decision.case_id) if decision.case_id else None
            if case is not None and case.run_id != decision.run_id:
                raise WorkspaceMismatch(
                    f"Decision {decision.decision_id} names a different run than its case {case.case_id}.",
                    case.merchant_id,
                )
            self._decisions[decision.decision_id] = decision

    def _decision_workspace(self, decision: Decision) -> Optional[str]:
        """A decision belongs to a workspace through its case (or, failing that, its run); unknown -> nobody's."""
        case = self._cases.get(decision.case_id) if decision.case_id else None
        if case is not None:
            return case.merchant_id
        run = self._runs.get(decision.run_id) if decision.run_id else None
        return run.merchant_id if run is not None else None

    def get_decision(self, key: str, *, workspace_id: str) -> Optional[Decision]:
        with self._lock:
            decision = self._decisions.get(key)
            if decision is not None:
                return decision if self._decision_workspace(decision) == self._require_workspace(workspace_id) else None
            case = self.get_case_for_transaction(key, workspace_id=workspace_id)
            if case is not None and case.decision_id:
                return self._decisions.get(case.decision_id)
            return None

    def get_all_decisions(self, run_id: Optional[str] = None, *, workspace_id: str) -> List[Decision]:
        with self._lock:
            return [
                self._decisions[c.decision_id]
                for c in self.list_cases(run_id, workspace_id=workspace_id)
                if c.decision_id and c.decision_id in self._decisions
            ]

    def get_escalations(self, run_id: Optional[str] = None, *, workspace_id: str) -> List[Decision]:
        with self._lock:
            return [d for d in self.get_all_decisions(run_id, workspace_id=workspace_id) if d.final_action == "escalate"]

    # ── attempt ledger ───────────────────────────────────────────────────
    def save_attempt(self, attempt: ExecutionAttempt):
        with self._lock:
            self._case_workspace_check(attempt.merchant_id, attempt.case_id, attempt.run_id)
            first_save = attempt.attempt_id not in self._attempts
            if attempt.status.value != "denied" and first_save:
                # The in-memory form of the execution trigger of migration 0004: no attempt STARTS in a workspace
                # that is not `simulation` (a denied one is only the record of a refusal).
                workspace = self._workspaces.get(attempt.merchant_id)
                if workspace is None or workspace.execution_mode != ExecutionMode.SIMULATION.value:
                    raise ExecutionNotAvailable(
                        "This workspace does not allow execution; no attempt was started for it.", attempt.merchant_id
                    )
            self._attempts[attempt.attempt_id] = attempt
            if first_save:
                self._attempts_by_case.setdefault(attempt.case_id, []).append(attempt.attempt_id)
                self._attempts_by_run.setdefault(attempt.run_id, []).append(attempt.attempt_id)
                self._attempts_by_customer.setdefault(
                    (attempt.merchant_id, attempt.customer_id), []
                ).append(attempt.attempt_id)

    def get_attempt(self, attempt_id: str, *, workspace_id: str) -> Optional[ExecutionAttempt]:
        with self._lock:
            attempt = self._attempts.get(attempt_id)
            return attempt if attempt is not None and attempt.merchant_id == self._require_workspace(workspace_id) else None

    def list_attempts(
        self, case_id: Optional[str] = None, run_id: Optional[str] = None, *, workspace_id: str
    ) -> List[ExecutionAttempt]:
        with self._lock:
            self._require_workspace(workspace_id)
            if case_id is not None:
                return [
                    self._attempts[a] for a in self._attempts_by_case.get(case_id, [])
                    if self._attempts[a].merchant_id == workspace_id
                ]
            rid = self._scope(workspace_id, run_id)
            if rid is None:
                return []
            if rid == ALL_RUNS:
                return [a for a in self._attempts.values() if a.merchant_id == workspace_id]
            return [self._attempts[a] for a in self._attempts_by_run.get(rid, [])]

    def list_customer_attempts(self, merchant_id: str, customer_id: str) -> List[ExecutionAttempt]:
        with self._lock:
            return [self._attempts[a] for a in self._attempts_by_customer.get((merchant_id, customer_id), [])]

    def list_attempts_since(self, created_since: str, *, workspace_id: str) -> List[ExecutionAttempt]:
        cutoff = _parse(created_since)
        with self._lock:
            self._require_workspace(workspace_id)
            return [
                a for a in self._attempts.values()
                if a.merchant_id == workspace_id and _parse(a.created_at) >= cutoff
            ]

    def list_reserved_attempts(self, created_before: str) -> List[ExecutionAttempt]:
        cutoff = _parse(created_before)
        with self._lock:
            stale = [
                a for a in self._attempts.values()
                if a.status.value == "reserved" and _parse(a.created_at) < cutoff
            ]
            return sorted(stale, key=lambda a: _parse(a.created_at))

    # ── idempotency ──────────────────────────────────────────────────────
    def get_idempotency_record(self, merchant_id: str, operation: str, key: str) -> Optional[IdempotencyRecord]:
        with self._lock:
            return self._idempotency.get((merchant_id, operation, key))

    def insert_idempotency_record(self, record: IdempotencyRecord) -> None:
        with self._lock:
            self._case_workspace_check(record.merchant_id, record.case_id)
            if record.scope in self._idempotency:
                raise DuplicateIdempotencyKey(
                    f"Idempotency key already exists for {record.merchant_id}/{record.operation}."
                )
            self._idempotency[record.scope] = record

    def save_idempotency_record(self, record: IdempotencyRecord):
        with self._lock:
            self._case_workspace_check(record.merchant_id, record.case_id)
            existing = self._idempotency.get(record.scope)
            if existing is not None and existing.request_fingerprint != record.request_fingerprint:
                raise ValueError("An idempotency record's request fingerprint cannot be changed.")
            self._idempotency[record.scope] = record

    # ── interventions ────────────────────────────────────────────────────
    def save_intervention(self, intervention: Intervention):
        with self._lock:
            self._case_workspace_check(intervention.merchant_id, intervention.case_id, intervention.run_id)
            self._interventions[intervention.intervention_id] = intervention

    def get_intervention_by_id(self, intervention_id: str, *, workspace_id: str) -> Optional[Intervention]:
        with self._lock:
            item = self._interventions.get(intervention_id)
            return item if item is not None and item.merchant_id == self._require_workspace(workspace_id) else None

    def get_all_interventions(self, run_id: Optional[str] = None, *, workspace_id: str) -> List[Intervention]:
        with self._lock:
            rid = self._scope(workspace_id, run_id)
            if rid is None:
                return []
            items = [i for i in self._interventions.values() if i.merchant_id == workspace_id]
            if rid == ALL_RUNS:
                return items
            # Records written without a run (legacy callers) stay visible rather than vanishing.
            return [i for i in items if i.run_id is None or i.run_id == rid]

    # ── audit ────────────────────────────────────────────────────────────
    def save_audit_event(self, event: AuditEvent):
        with self._lock:
            self._require_registered(event.merchant_id)
            self._case_workspace_check(event.merchant_id, event.case_id, None)
            if event.run_id is not None:
                self._case_workspace_check(event.merchant_id, None, event.run_id)
            self._audit_log.append(event)

    def _filter_audit_log(
        self,
        leak_type: Optional[str],
        status: Optional[str],
        transaction_id: Optional[str],
        run_id: Optional[str],
        workspace_id: str,
    ) -> List[AuditEvent]:
        res = [e for e in self._audit_log if e.merchant_id == self._require_workspace(workspace_id)]
        rid = self._scope(workspace_id, run_id)
        if rid is None:
            return []
        if rid != ALL_RUNS:
            res = [e for e in res if e.run_id is None or e.run_id == rid]
        if leak_type:
            res = [e for e in res if e.leak_id.startswith(leak_type[:2]) or e.action == leak_type]
        if status:
            res = [e for e in res if e.event_type == status or (e.outcome and e.outcome.get("status") == status)]
        if transaction_id:
            res = [e for e in res if e.transaction_id == transaction_id]
        return res

    def get_audit_log(
        self,
        limit: int = 200,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        newest_first: bool = False,
        run_id: Optional[str] = None,
        *,
        workspace_id: str,
    ) -> List[AuditEvent]:
        with self._lock:
            res = self._filter_audit_log(leak_type, status, transaction_id, run_id, workspace_id)
            if newest_first:
                res = res[::-1]
            return res[:limit]

    def summarize_audit_log(
        self,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        run_id: Optional[str] = None,
        *,
        workspace_id: str,
    ) -> Dict[str, Any]:
        with self._lock:
            res = self._filter_audit_log(leak_type, status, transaction_id, run_id, workspace_id)
            counts_by_type: Dict[str, int] = {}
            for e in res:
                counts_by_type[e.event_type] = counts_by_type.get(e.event_type, 0) + 1
            return {"matched": len(res), "counts_by_type": counts_by_type}

    # ── source events, obligations, ingestion run (Phase 2) ──────────────
    def get_or_create_ingestion_run(self, merchant_id: str, now_iso: str) -> ScanRun:
        with self._lock:
            self._require_registered(merchant_id)  # never for an unverified claim, and never creating the workspace
            run_id = self._ingestion_runs.get(merchant_id)
            if run_id is not None:
                return self._runs[run_id]
            run = ScanRun(
                run_id=new_id("run", 16),
                merchant_id=merchant_id,
                source_fingerprint=f"ingest:{merchant_id}",
                n_total=0,
                seed=0,
                created_at=now_iso,
                last_scanned_at=now_iso,
                scan_count=1,
                status="standby",
                kind="ingestion",
            )
            self._runs[run.run_id] = run
            self._run_by_fingerprint[run.source_fingerprint] = run.run_id
            self._ingestion_runs[merchant_id] = run.run_id
            self._tx_order[run.run_id] = []
            self._tx_index[run.run_id] = {}
            self._cases_by_run[run.run_id] = []
            return run

    def _ingestion_run(self, run_id: Optional[str]) -> ScanRun:
        run = self._runs.get(run_id) if run_id else None
        if run is None:
            raise KeyError(f"Unknown scan run {run_id}.")
        if run.kind != "ingestion":
            raise ValueError(f"Run {run_id} is a {run.kind} run; only an ingestion run accepts event-derived records.")
        return run

    def create_case(self, case: RecoveryCase, transaction: Transaction) -> None:
        with self._lock:
            run = self._ingestion_run(case.run_id)
            if transaction.run_id != case.run_id or transaction.transaction_id != case.transaction_id:
                raise ValueError("Case and transaction do not describe the same record.")
            if case.merchant_id != run.merchant_id or transaction.merchant_id != run.merchant_id:
                raise WorkspaceMismatch(
                    f"Run {run.run_id} belongs to another workspace than the record being added to it.", case.merchant_id
                )
            if (run.run_id, case.transaction_id) in self._case_index:
                raise ValueError(f"Run {run.run_id} already has a case for {case.transaction_id}.")
            self._tx_order[run.run_id].append(transaction)
            self._tx_index[run.run_id][transaction.transaction_id] = transaction
            self._tx_index[run.run_id][transaction.leak_id] = transaction
            self._cases[case.case_id] = case
            self._cases_by_run[run.run_id].append(case.case_id)
            self._case_index[(run.run_id, case.transaction_id)] = case.case_id
            self._case_index[(run.run_id, case.leak_id)] = case.case_id
            run.transaction_count = len(self._tx_order[run.run_id])
            run.total_at_risk = round(sum(t.amount for t in self._tx_order[run.run_id]), 2)

    def update_source_transaction(self, transaction: Transaction) -> None:
        with self._lock:
            run = self._ingestion_run(transaction.run_id)
            if transaction.merchant_id != run.merchant_id:
                raise WorkspaceMismatch(
                    f"Run {run.run_id} belongs to another workspace than the record being added to it.",
                    transaction.merchant_id,
                )
            current = self._tx_index[run.run_id].get(transaction.transaction_id)
            if current is None:
                raise KeyError(f"Unknown transaction {transaction.transaction_id}.")
            order = self._tx_order[run.run_id]
            order[order.index(current)] = transaction
            self._tx_index[run.run_id][transaction.transaction_id] = transaction
            self._tx_index[run.run_id][transaction.leak_id] = transaction
            run.total_at_risk = round(sum(t.amount for t in order), 2)
            case = self._cases.get(self._case_index.get((run.run_id, transaction.transaction_id), ""))
            if case is not None:  # the case mirrors the facts it was opened on
                case.amount = transaction.amount
                case.customer_id = transaction.customer_id

    def insert_source_event(self, event: SourceEvent) -> Tuple[SourceEvent, bool]:
        with self._lock:
            self._require_registered(event.merchant_id)  # an event about an unknown workspace is never stored
            existing = self._events.get(event.event_id)
            if existing is not None:
                if existing.content_fingerprint != event.content_fingerprint:
                    raise EventIdentityConflict(event.event_id, existing.content_fingerprint, event.content_fingerprint)
                return existing, False
            self._events[event.event_id] = event
            self._event_order.append(event.event_id)
            return event, True

    def get_source_event(self, event_id: str, *, workspace_id: str) -> Optional[SourceEvent]:
        with self._lock:
            event = self._events.get(event_id)
            return event if event is not None and event.merchant_id == self._require_workspace(workspace_id) else None

    def list_source_events(
        self,
        processing_status: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 100,
        *,
        workspace_id: str,
    ) -> List[SourceEvent]:
        with self._lock:
            events = [
                self._events[i] for i in reversed(self._event_order)
                if self._events[i].merchant_id == self._require_workspace(workspace_id)
            ]
            if processing_status:
                events = [e for e in events if e.processing_status == processing_status]
            if source:
                events = [e for e in events if e.source == source]
            return events[:limit]

    def list_events_for_reference(self, merchant_id: str, reference_kind: str, reference_id: str) -> List[SourceEvent]:
        with self._lock:
            matching = [
                e for e in self._events.values()
                if e.merchant_id == merchant_id and e.reference_kind == reference_kind and e.reference_id == reference_id
            ]
            return sorted(matching, key=lambda e: (_parse(e.occurred_at), e.event_id))

    def mark_source_event(
        self, event_id: str, processing_status: str, failure_reason: Optional[str], processed_at: str,
        *, workspace_id: str,
    ) -> None:
        with self._lock:
            event = self._events.get(event_id)
            if event is None or event.merchant_id != self._require_workspace(workspace_id):
                raise KeyError(f"Unknown source event {event_id}.")
            event.processing_status = processing_status
            event.failure_reason = failure_reason
            event.processed_at = processed_at

    def lock_obligation(
        self, merchant_id: str, reference_kind: str, reference_id: str, leak_type: str, now_iso: str
    ) -> RevenueObligation:
        with self._lock:
            self._require_registered(merchant_id)
            obligation_id = obligation_internal_id(merchant_id, reference_kind, reference_id)
            obligation = self._obligations.get(obligation_id)
            if obligation is None:
                obligation = RevenueObligation(
                    obligation_id=obligation_id,
                    merchant_id=merchant_id,
                    reference_kind=reference_kind,
                    reference_id=reference_id,
                    leak_type=leak_type,
                    created_at=now_iso,
                )
                self._obligations[obligation_id] = obligation
            return obligation

    def save_obligation(self, obligation: RevenueObligation) -> None:
        with self._lock:
            self._case_workspace_check(obligation.merchant_id, obligation.case_id, obligation.run_id)
            self._obligations[obligation.obligation_id] = obligation

    def get_obligation(self, obligation_id: str, *, workspace_id: str) -> Optional[RevenueObligation]:
        with self._lock:
            item = self._obligations.get(obligation_id)
            return item if item is not None and item.merchant_id == self._require_workspace(workspace_id) else None

    def list_obligations(
        self, status: Optional[str] = None, limit: int = 100, *, workspace_id: str
    ) -> List[RevenueObligation]:
        with self._lock:
            items = [o for o in self._obligations.values() if o.merchant_id == self._require_workspace(workspace_id)]
            if status:
                items = [o for o in items if o.status == status]
            return items[:limit]

    def clear(self):
        with self._lock:
            self._events.clear()
            self._event_order.clear()
            self._obligations.clear()
            self._ingestion_runs.clear()
            self._runs.clear()
            self._run_by_fingerprint.clear()
            self._active_run_ids.clear()
            self._tx_order.clear()
            self._tx_index.clear()
            self._cases.clear()
            self._cases_by_run.clear()
            self._case_index.clear()
            self._decisions.clear()
            self._attempts.clear()
            self._attempts_by_case.clear()
            self._attempts_by_run.clear()
            self._attempts_by_customer.clear()
            self._idempotency.clear()
            self._interventions.clear()
            self._audit_log.clear()
            self.scanned = False
            self.analyzed = False
            self.recovered = False

