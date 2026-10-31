"""
Safe execution pathway.

AI recommends. Deterministic policy authorizes. This module enforces that
authorization against *current* state immediately before anything is executed:

    resolve case -> idempotency check -> state guard
        -> current ledger facts -> strict policy re-evaluation
        -> DENIED: record + audit, never reaches the provider
        -> ALLOWED: reserve the attempt atomically
    -> provider call (outside any transaction)
    -> complete: attempt ledger, case state, intervention, idempotency record, audit

Individual execution and bulk recovery both go through `ExecutionService.execute`.

Workspace gate (Phase 3.1). Before ANYTHING else (before a decision is recorded for an undecided case, before a
reservation, before a provider) the request must name a registered workspace whose execution mode is `simulation`
and matches the provider that would run. A `recommend_only` workspace (every merchant workspace) is refused with
ExecutionNotAvailable, an unknown one with UnknownWorkspace; neither writes a thing. The case is then resolved INSIDE
that workspace only (another workspace's case id is "not found"), and the check is repeated authoritatively inside the
reservation unit of work together with the case / run / transaction ownership. PostgreSQL adds a trigger on
execution_attempts (migration 0004) as the last line of defence. The workspace id is what the caller selected; it is
not authentication.

Atomic boundaries (each is one `repo.atomic()` unit of work; on PostgreSQL, one transaction)
  1. RESERVE  - lock the case; idempotency lookup + request fingerprint; state guard; lock the
                customer; current ledger facts; strict policy; insert the attempt (reserved, or
                denied) with its authorization snapshot; move the case; insert the idempotency
                record; write the audit events. All of it commits together or none of it does.
  2. PROVIDER - no transaction and no connection held, so a slow provider cannot pin the database.
  3. COMPLETE - lock the case; close the attempt; save the intervention; move the case; complete
                the idempotency record; write the audit event. Together or not at all.
  4. ABORT    - only if COMPLETE itself fails: a separate transaction that closes the reservation
                as a failed, still-counted attempt so neither the case nor the key stays stuck.

A request is REFUSED by returning the error from inside the unit of work and raising it after
the unit has committed. Raising inside would roll back the very record of the refusal.

If the process dies between 1 and 3 the attempt stays `reserved` and the case `executing`.
That state is recoverable: a reservation older than `reservation_timeout` is closed as a failed,
counted attempt (the provider outcome is unknown) either lazily by the next request for that
case/key, or by `recover_interrupted()`, which runs at startup.

Guarantees come from the repository: `atomic()` is a process-local lock for the in-memory
repository and a database transaction with row locks plus unique constraints for PostgreSQL.
"""
import hashlib
import json
import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Union

from backend.app.domain.models import (
    COUNTED_ATTEMPT_STATUSES,
    CUSTOMER_CONTACT_ACTIONS,
    RECOVERY_ACTIONS,
    CLOSED_CASE_STATES,
    Action,
    AttemptStatus,
    AuditEventType,
    CaseState,
    ExecutionAttempt,
    IdempotencyRecord,
    Intervention,
    RecoveryCase,
    Transaction,
    new_id,
)
from backend.app.domain.policy import POLICY_VERSION, PolicyLimits, PolicyResult, evaluate_policy_strict
from backend.app.domain.workspaces import ExecutionMode, ExecutionNotAvailable, UnknownWorkspace, Workspace
from backend.app.integrations.base import PaymentExecutionProvider
from backend.app.repositories.base import BaseRepository
from backend.app.repositories.errors import DuplicateIdempotencyKey, run_with_retry
from backend.app.services.audit_service import AuditService

logger = logging.getLogger("revora.execution")

OPERATION_EXECUTE = "execute_intervention"

# "Contacts per day" is a trailing 24-hour window, which is never looser than a calendar day.
CONTACT_WINDOW = timedelta(hours=24)

MAX_IDEMPOTENCY_KEY_LENGTH = 255

# How long a reservation may stay open before it is presumed dead. It must comfortably exceed the
# slowest legitimate provider call, otherwise a live attempt could be closed underneath its worker.
DEFAULT_RESERVATION_TIMEOUT = timedelta(minutes=15)

# Re-evaluations after losing a race on a new idempotency key (the winner commits, we look again).
_MAX_RESERVE_ROUNDS = 3

# Provider-reported status -> the case state it moves the case to.
_STATUS_TO_STATE = {
    "recovered": CaseState.RECOVERED,
    "attempted_no_recovery": CaseState.ATTEMPTED_NO_RECOVERY,
    "suppressed": CaseState.SUPPRESSED,
    "escalated_to_merchant": CaseState.ESCALATED,
}

# Which provider statuses are credible for which executed action.
_VALID_STATUSES_FOR_ACTION = {
    Action.SUPPRESS.value: {"suppressed"},
    Action.ESCALATE.value: {"escalated_to_merchant"},
    **{a: {"recovered", "attempted_no_recovery"} for a in RECOVERY_ACTIONS},
}


# ── errors ───────────────────────────────────────────────────────────────
class ExecutionError(Exception):
    """An execution request that did not (or could not) take effect. Maps 1:1 to an HTTP error."""

    status_code = 400
    code = "execution_error"

    def __init__(self, message: str, **extra: Any):
        super().__init__(message)
        self.message = message
        self.extra = extra
        self.replayed = False

    def to_body(self) -> Dict[str, Any]:
        # `detail` stays a plain string: the dashboard's fetch wrapper surfaces it verbatim.
        return {"detail": self.message, "code": self.code, **self.extra}


class CaseNotFound(ExecutionError, ValueError):
    status_code = 404
    code = "case_not_found"


class StaleRun(ExecutionError):
    status_code = 409
    code = "run_superseded"


class IdempotencyKeyInvalid(ExecutionError):
    status_code = 422
    code = "idempotency_key_invalid"


class IdempotencyKeyReuse(ExecutionError):
    status_code = 422
    code = "idempotency_key_reuse"


class IdempotencyInProgress(ExecutionError):
    status_code = 409
    code = "request_in_progress"


class CaseConflict(ExecutionError):
    status_code = 409
    code = "case_not_executable"


class ActionMismatch(ExecutionError):
    status_code = 409
    code = "action_mismatch"


class PolicyDenied(ExecutionError):
    status_code = 409
    code = "policy_denied"


class ProviderFailure(ExecutionError):
    status_code = 502
    code = "provider_failure"


class ReservationExpired(ExecutionError):
    """The provider returned after the reservation had already been closed as interrupted."""

    status_code = 409
    code = "reservation_expired"


class ReplayedExecutionError(ExecutionError):
    """A stored failure (denial / provider failure) returned again for a repeated idempotency key."""

    def __init__(self, status_code: int, body: Dict[str, Any]):
        body = dict(body)
        super().__init__(body.pop("detail", "Execution failed."))
        self.status_code = status_code
        self.code = body.pop("code", "execution_error")
        self.extra = body
        self.replayed = True


@dataclass
class ExecutionOutcome:
    intervention: Dict[str, Any]
    replayed: bool
    case_id: str
    attempt_id: str
    case_state: str


@dataclass
class _Reservation:
    workspace_id: str
    case_id: str
    attempt_id: str
    decision: Any
    tx: Transaction


@dataclass
class _Refusal:
    """A refusal whose record has been committed; the caller raises `error` afterwards."""

    error: ExecutionError


# ── helpers ──────────────────────────────────────────────────────────────
def _finite_or_none(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def request_fingerprint(merchant_id: str, case_id: str, expected_action: Optional[str]) -> str:
    """Canonical digest of what the caller asked for. The same key must always mean the same request."""
    canonical = json.dumps(
        {
            "operation": OPERATION_EXECUTE,
            "merchant_id": merchant_id,
            "case_id": case_id,
            "expected_action": expected_action,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _parse(ts: str) -> datetime:
    parsed = datetime.fromisoformat(ts)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class ExecutionService:
    def __init__(
        self,
        repo: BaseRepository,
        audit_service: AuditService,
        provider_source: Callable[[], PaymentExecutionProvider],
        policy_source: Callable[[], PolicyLimits],
        decide_case: Callable[[RecoveryCase], RecoveryCase],
        clock: Optional[Callable[[], datetime]] = None,
        reservation_timeout: Optional[timedelta] = None,
    ):
        self.repo = repo
        self.audit_service = audit_service
        self._provider_source = provider_source
        self._policy_source = policy_source
        self._decide_case = decide_case
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.reservation_timeout = reservation_timeout or DEFAULT_RESERVATION_TIMEOUT

    # ── authoritative state ──────────────────────────────────────────────
    def policy_facts(
        self,
        tx: Transaction,
        case: RecoveryCase,
        planned_contacts: int = 0,
        ledger: Optional[List[ExecutionAttempt]] = None,
        customer_attempts: Optional[List[ExecutionAttempt]] = None,
    ) -> Dict[str, Any]:
        """
        The inputs policy is evaluated on: the immutable transaction record with the
        counters that change over time (retries made, recent customer contacts,
        time since the last retry) replaced by values derived from the attempt
        ledger. Anything the source did not supply stays None so the strict
        evaluator fails closed on it.

        `ledger` / `customer_attempts` let a batch caller (analysis) pass attempts it already read
        in bulk; the execution path never does, so it always reads the ledger itself, under lock.
        """
        now = self.clock()
        facts = tx.to_dict()

        if ledger is None:
            ledger = self.repo.list_attempts(case_id=case.case_id, workspace_id=case.merchant_id)
        counted = [a for a in ledger if a.status in COUNTED_ATTEMPT_STATUSES]
        retries = [a for a in counted if a.final_action == Action.RETRY.value]
        facts["retries_so_far"] = None if tx.retries_so_far is None else tx.retries_so_far + len(retries)
        if retries:
            last = max(_parse(a.created_at) for a in retries)
            facts["hours_since_last_attempt"] = max(0.0, (now - last).total_seconds() / 3600.0)
        else:
            facts["hours_since_last_attempt"] = None

        window_start = now - CONTACT_WINDOW
        if customer_attempts is None:
            customer_attempts = self.repo.list_customer_attempts(case.merchant_id, case.customer_id)
        contacts = sum(
            1
            for a in customer_attempts
            if a.status in COUNTED_ATTEMPT_STATUSES
            and a.final_action in CUSTOMER_CONTACT_ACTIONS
            and _parse(a.created_at) >= window_start
        )
        facts["contacts_today"] = contacts + planned_contacts
        return facts

    @staticmethod
    def _authorization_record(
        requested_action: str, verdict, limits: PolicyLimits, facts: Dict[str, Any], at: str
    ) -> Dict[str, Any]:
        input_names = (
            "amount", "leak_type", "retries_so_far", "hours_since_event", "hours_since_last_attempt",
            "contacts_today", "consecutive_failures", "age_days",
        )
        return {
            "source": "execution_time",
            "allowed": verdict.allowed,
            "reason": verdict.reason,
            "final_action": verdict.final_action,
            "requested_action": requested_action,
            "policy_version": POLICY_VERSION,
            "evaluated_at": at,
            "limits": limits.to_dict(),
            "inputs": {k: _finite_or_none(facts.get(k)) for k in input_names},
        }

    # ── entry point ──────────────────────────────────────────────────────
    def require_executable_workspace(self, workspace_id: str) -> Workspace:
        """
        The workspace gate. Returns the workspace only if it is registered, in `simulation` mode, and that mode is
        the one of the provider that would run; otherwise raises (UnknownWorkspace / ExecutionNotAvailable). It
        fails CLOSED: anything that cannot be verified is a refusal. Writes nothing, so it is safe to call first.
        """
        workspace = self.repo.get_workspace(workspace_id) if workspace_id else None
        if workspace is None:
            raise UnknownWorkspace(
                f"Workspace {workspace_id!r} does not exist. Workspaces are never created implicitly.", workspace_id
            )
        if workspace.execution_mode != ExecutionMode.SIMULATION.value:
            raise ExecutionNotAvailable(
                f"Workspace {workspace_id!r} is {workspace.execution_mode}: REVORA recommends and explains here, "
                "but nothing is executed for it (no provider is connected).",
                workspace_id,
            )
        provider_mode = self._provider_source().execution_mode
        if provider_mode != workspace.execution_mode:
            raise ExecutionNotAvailable(
                f"The provider runs in {provider_mode!r} mode but workspace {workspace_id!r} is "
                f"{workspace.execution_mode!r}; execution is refused rather than guessed.",
                workspace_id,
            )
        return workspace

    def execute(
        self,
        workspace_id: str,
        target_id: str,
        idempotency_key: Optional[str] = None,
        expected_action: Optional[str] = None,
    ) -> ExecutionOutcome:
        self.require_executable_workspace(workspace_id)  # first: before a key is read, a case is found or decided
        key = self._normalize_key(idempotency_key)
        case = self._resolve_case(workspace_id, target_id)
        if case.state == CaseState.OPEN:
            case = self._decide_case(case)  # model inference, deliberately outside any transaction

        reserved = self._reserve_with_retry(workspace_id, case.case_id, key, expected_action)
        if isinstance(reserved, _Refusal):  # committed first, raised now
            raise reserved.error
        if isinstance(reserved, ExecutionOutcome):  # idempotent replay
            return reserved
        return self._run_and_complete(reserved, key)

    @staticmethod
    def _normalize_key(key: Optional[str]) -> Optional[str]:
        if key is None:
            return None
        key = key.strip()
        if not key:
            return None
        if len(key) > MAX_IDEMPOTENCY_KEY_LENGTH:
            raise IdempotencyKeyInvalid(f"Idempotency key longer than {MAX_IDEMPOTENCY_KEY_LENGTH} characters.")
        return key

    def _resolve_case(self, workspace_id: str, target_id: str) -> RecoveryCase:
        """
        A transaction id or leak id (resolved in the workspace's active run) or a case id (any run of the
        workspace). Another workspace's ids are not found: the answer is the same as for an id that never existed.
        """
        with self.repo.atomic():
            case = (
                self.repo.get_case_for_transaction(target_id, workspace_id=workspace_id)
                or self.repo.get_case(target_id, workspace_id=workspace_id)
            )
            if case is None or case.merchant_id != workspace_id:
                raise CaseNotFound(f"Transaction/leak ID {target_id} not found.")
            active = self.repo.get_active_run(workspace_id=workspace_id)
            if active is None or case.run_id != active.run_id:
                raise StaleRun(
                    f"Case {case.case_id} belongs to scan run {case.run_id}, which is no longer the active run.",
                    case_id=case.case_id,
                    run_id=case.run_id,
                )
            return case

    # ── phase 1: validate, authorize, reserve (one unit of work) ─────────
    def _reserve_with_retry(self, workspace_id: str, case_id: str, key: Optional[str], expected_action: Optional[str]):
        # A dead reservation is closed in its OWN unit of work, committed before the reservation is
        # attempted: if it shared the reservation's, any refusal raised afterwards (a replay of the
        # stored failure, say) would roll the recovery back and it would never stick.
        with self.repo.atomic():
            self._reclaim_if_stale(self.repo.get_case(case_id, workspace_id=workspace_id))
        for _ in range(_MAX_RESERVE_ROUNDS):
            try:
                return run_with_retry(lambda: self._reserve(workspace_id, case_id, key, expected_action))
            except DuplicateIdempotencyKey:
                # Another request created this key between our lookup and our insert. Our unit of
                # work was rolled back whole (no attempt, no case change, no audit event survives);
                # the winner has committed, so look again and answer against its record.
                continue
        raise IdempotencyInProgress(
            "A request with this Idempotency-Key is still being processed.", case_id=case_id
        )

    def _reserve(self, workspace_id: str, case_id: str, key: Optional[str], expected_action: Optional[str]):
        with self.repo.atomic():
            # Authoritative gate, inside the unit that reserves: the mode is read again under the same
            # transaction that will write the attempt, and the case / run / transaction must all agree on the
            # workspace. Anything that does not is refused before an attempt exists, never repaired.
            self.require_executable_workspace(workspace_id)
            case = self.repo.get_case(case_id, workspace_id=workspace_id)  # row-locked on a database
            if case is None:
                raise CaseNotFound(f"Case {case_id} not found.")
            active = self.repo.get_active_run(workspace_id=workspace_id)
            if active is None or case.run_id != active.run_id:  # a scan landed after resolution
                raise StaleRun(
                    f"Case {case.case_id} belongs to scan run {case.run_id}, which is no longer the active run.",
                    case_id=case.case_id,
                    run_id=case.run_id,
                )
            tx = self.repo.get_transaction_by_id(case.transaction_id, case.run_id, workspace_id=workspace_id)
            if tx is None or not (case.merchant_id == active.merchant_id == tx.merchant_id == workspace_id):
                raise ExecutionNotAvailable(
                    "The workspace, run and case of this request do not agree; execution is refused rather than guessed.",
                    workspace_id,
                )
            fingerprint = request_fingerprint(case.merchant_id, case.case_id, expected_action)

            # 1. Idempotency: the same key + same request replays; the same key + a
            #    different request is refused; an in-flight twin is refused for now.
            if key:
                record = self.repo.get_idempotency_record(case.merchant_id, OPERATION_EXECUTE, key)
                if record is not None:
                    if record.request_fingerprint != fingerprint:
                        raise IdempotencyKeyReuse(
                            "Idempotency-Key was already used for a different request "
                            "(different target or action); use a new key.",
                            case_id=case.case_id,
                        )
                    if record.status != "completed":
                        raise IdempotencyInProgress(
                            "A request with this Idempotency-Key is still being processed.",
                            case_id=case.case_id,
                            attempt_id=record.attempt_id,
                        )
                    return self._replay(record)

            # 2. The case must be in a state that accepts a new attempt.
            if case.state == CaseState.EXECUTING:
                raise CaseConflict(
                    "An execution attempt for this case is already in progress.",
                    case_id=case.case_id, case_state=case.state.value, attempt_id=case.active_attempt_id,
                )
            if case.state in CLOSED_CASE_STATES:
                raise CaseConflict(
                    f"Case is already {case.state.value}; no further automated action is allowed.",
                    case_id=case.case_id, case_state=case.state.value,
                )
            decision = self.repo.get_decision(case.decision_id, workspace_id=workspace_id) if case.decision_id else None
            if case.state == CaseState.OPEN or decision is None:
                raise CaseConflict(
                    "Case has no decision yet; run /api/analyze first.",
                    case_id=case.case_id, case_state=case.state.value,
                )

            requested_action = decision.final_action
            if expected_action and expected_action != requested_action:
                raise ActionMismatch(
                    f"Case's authorized action is '{requested_action}', not '{expected_action}'.",
                    case_id=case.case_id, requested_action=expected_action, authorized_action=requested_action,
                )

            # 3. Current state, strict policy. A stale decision is never trusted on its own.
            #    Contact limits span a customer's cases, so serialize on the customer first.
            self.repo.lock_customer(case.merchant_id, case.customer_id)
            limits = self._policy_source()
            ledger = self.repo.list_attempts(case_id=case.case_id, workspace_id=workspace_id)
            facts = self.policy_facts(tx, case, ledger=ledger)
            if requested_action in (Action.SUPPRESS.value, Action.ESCALATE.value):
                # A hand-off to the merchant or a deliberate no-action moves no money and contacts no
                # one: they are the policy-sanctioned safe sinks, so they are always executable.
                # (Gating them would strand cases the decision layer rerouted *to* them, e.g. a
                # high-value item suppressed by the cooldown rule, which outranks the ceiling rule.)
                verdict = PolicyResult(
                    True, "No money moves and no customer is contacted; always executable.", requested_action
                )
            else:
                verdict = evaluate_policy_strict(facts, requested_action, limits)
            now_iso = self.clock().isoformat()
            authorization = self._authorization_record(requested_action, verdict, limits, facts, now_iso)
            provider = self._provider_source()

            attempt = ExecutionAttempt(
                attempt_id=new_id("att", 12),
                case_id=case.case_id,
                run_id=case.run_id,
                merchant_id=case.merchant_id,
                transaction_id=case.transaction_id,
                customer_id=case.customer_id,
                sequence=len(ledger) + 1,
                attempt_number=None,
                requested_action=requested_action,
                final_action=None,
                decision_id=decision.decision_id,
                authorization=authorization,
                status=AttemptStatus.DENIED,
                idempotency_key=key,
                request_fingerprint=fingerprint,
                provider=provider.name,
                execution_mode=provider.execution_mode,
                created_at=now_iso,
            )

            if not verdict.allowed:
                return self._record_denial(case, attempt, verdict, key, now_iso)

            # 4. Reserve: from here the attempt counts against retry / contact limits.
            attempt.status = AttemptStatus.RESERVED
            attempt.final_action = verdict.final_action
            attempt.attempt_number = sum(1 for a in ledger if a.status in COUNTED_ATTEMPT_STATUSES) + 1
            case.transition(
                CaseState.EXECUTING,
                f"attempt {attempt.attempt_number} authorized ({verdict.final_action}) and reserved",
                at=now_iso,
            )
            case.attempt_count = attempt.attempt_number
            case.active_attempt_id = attempt.attempt_id
            case.blocked_reason = None
            case.safe_alternative = None
            self.repo.save_attempt(attempt)
            self.repo.save_case(case)
            if key:
                self.repo.insert_idempotency_record(
                    IdempotencyRecord(
                        merchant_id=case.merchant_id,
                        operation=OPERATION_EXECUTE,
                        key=key,
                        request_fingerprint=fingerprint,
                        case_id=case.case_id,
                        attempt_id=attempt.attempt_id,
                        created_at=now_iso,
                    )
                )

            common = dict(
                merchant_id=case.merchant_id, transaction_id=case.transaction_id, leak_id=case.leak_id,
                decision_id=decision.decision_id, idempotency_key=key, run_id=case.run_id,
                case_id=case.case_id, attempt_id=attempt.attempt_id, provider=provider.name,
            )
            self.audit_service.log_event(
                event_type=AuditEventType.ACTION_AUTHORIZED,
                action=verdict.final_action,
                policy_result=verdict.to_dict(),
                outcome={"status": "authorized", "attempt_number": attempt.attempt_number},
                **common,
            )
            self.audit_service.log_event(
                event_type=AuditEventType.EXECUTION_STARTED,
                action=verdict.final_action,
                policy_result=verdict.to_dict(),
                outcome={"status": "started", "attempt_number": attempt.attempt_number},
                **common,
            )
            return _Reservation(
                workspace_id=workspace_id, case_id=case.case_id, attempt_id=attempt.attempt_id, decision=decision, tx=tx
            )

    def _replay(self, record: IdempotencyRecord) -> ExecutionOutcome:
        if record.http_status == 200 and record.response is not None:
            case = self.repo.get_case(record.case_id, workspace_id=record.merchant_id)
            return ExecutionOutcome(
                intervention=dict(record.response),
                replayed=True,
                case_id=record.case_id,
                attempt_id=record.attempt_id,
                case_state=case.state.value if case else "unknown",
            )
        raise ReplayedExecutionError(record.http_status or 409, record.response or {})

    def _record_denial(self, case, attempt, verdict, key, now_iso) -> _Refusal:
        """Inside the unit of work. Records the refusal and RETURNS it; the caller raises it after commit."""
        attempt.completed_at = now_iso
        attempt.failure_reason = verdict.reason
        case.blocked_reason = verdict.reason
        case.safe_alternative = verdict.final_action
        if case.state in (CaseState.AUTHORIZED, CaseState.ATTEMPTED_NO_RECOVERY):
            case.transition(CaseState.BLOCKED, f"execution-time policy denial: {verdict.reason}", at=now_iso)
        self.repo.save_attempt(attempt)
        self.repo.save_case(case)

        body = {
            "detail": f"Execution blocked by policy: {verdict.reason}",
            "code": PolicyDenied.code,
            "case_id": case.case_id,
            "attempt_id": attempt.attempt_id,
            "requested_action": attempt.requested_action,
            "policy": verdict.to_dict(),
            "safe_alternative": verdict.final_action,
            "next_step": "Re-run /api/analyze to refresh this case's decision, then execute the rerouted action.",
        }
        if key:
            self.repo.insert_idempotency_record(
                IdempotencyRecord(
                    merchant_id=case.merchant_id,
                    operation=OPERATION_EXECUTE,
                    key=key,
                    request_fingerprint=attempt.request_fingerprint,
                    case_id=case.case_id,
                    attempt_id=attempt.attempt_id,
                    status="completed",
                    http_status=PolicyDenied.status_code,
                    response=body,
                    created_at=now_iso,
                    completed_at=now_iso,
                )
            )
        self.audit_service.log_event(
            merchant_id=case.merchant_id,
            transaction_id=case.transaction_id,
            leak_id=case.leak_id,
            event_type=AuditEventType.ACTION_BLOCKED,
            action=attempt.requested_action,
            policy_result=verdict.to_dict(),
            decision_id=attempt.decision_id,
            outcome={"status": "denied_at_execution", "recovered": False, "recovered_amount": 0.0},
            idempotency_key=key,
            run_id=case.run_id,
            case_id=case.case_id,
            attempt_id=attempt.attempt_id,
            provider=attempt.provider,
        )
        extra = {k: v for k, v in body.items() if k not in ("detail", "code")}
        return _Refusal(PolicyDenied(body["detail"], **extra))

    # ── interrupted reservations ─────────────────────────────────────────
    def _reclaim_if_stale(self, case: RecoveryCase) -> RecoveryCase:
        """
        Inside the unit of work. If the case is `executing` on a reservation that has outlived the
        timeout, close that reservation as an interrupted (failed, counted) attempt so the case and
        its idempotency key are usable again. A live reservation is left alone.
        """
        if case.state != CaseState.EXECUTING or not case.active_attempt_id:
            return case
        attempt = self.repo.get_attempt(case.active_attempt_id, workspace_id=case.merchant_id)
        if attempt is None or attempt.status != AttemptStatus.RESERVED:
            return case
        if self.clock() - _parse(attempt.created_at) < self.reservation_timeout:
            return case
        self._interrupt_attempt(
            case, attempt,
            failure_reason=(
                f"interrupted: the reservation was not completed within {int(self.reservation_timeout.total_seconds())}s; "
                "the provider outcome is unknown and the attempt still counts"
            ),
            code="execution_interrupted",
            detail="The execution was interrupted before it completed; the attempt is recorded as failed and still counts.",
            audit_status="interrupted",
        )
        return case

    def recover_interrupted(self, max_age: Optional[timedelta] = None) -> List[str]:
        """
        Close every reservation older than `max_age` (default: the reservation timeout) as an
        interrupted attempt. Safe to call repeatedly and from several processes: each reservation is
        re-checked under its case lock. Returns the attempt ids that were closed.

        The attempt keeps counting against retry and contact limits because the provider may have
        acted. With a live provider, reconcile against it (by idempotency key) before allowing
        another attempt on an interrupted case.
        """
        age = self.reservation_timeout if max_age is None else max_age
        cutoff = (self.clock() - age).isoformat()
        closed: List[str] = []
        for stale in self.repo.list_reserved_attempts(cutoff):  # spans workspaces: each attempt names its own
            try:
                with self.repo.atomic():
                    case = self.repo.get_case(stale.case_id, workspace_id=stale.merchant_id)
                    attempt = self.repo.get_attempt(stale.attempt_id, workspace_id=stale.merchant_id)
                    if attempt is None or attempt.status != AttemptStatus.RESERVED:
                        continue
                    self._interrupt_attempt(
                        case, attempt,
                        failure_reason=(
                            "interrupted: the reservation was found open at recovery time; "
                            "the provider outcome is unknown and the attempt still counts"
                        ),
                        code="execution_interrupted",
                        detail="The execution was interrupted before it completed; the attempt is recorded as failed and still counts.",
                        audit_status="interrupted",
                    )
                closed.append(stale.attempt_id)
            except Exception:  # noqa: BLE001 - one bad row must not block the rest
                logger.exception("could not recover interrupted attempt %s", stale.attempt_id)
        return closed

    def _interrupt_attempt(
        self, case: RecoveryCase, attempt: ExecutionAttempt, *, failure_reason: str, code: str, detail: str,
        audit_status: str,
    ) -> None:
        """
        Inside the unit of work. Turn an open reservation into a FAILED, still-counted attempt,
        release the case and close the idempotency record, and say so in the audit log.
        """
        now_iso = self.clock().isoformat()
        attempt.status = AttemptStatus.FAILED
        attempt.failure_reason = failure_reason
        attempt.completed_at = now_iso
        if case.state == CaseState.EXECUTING:
            case.transition(
                CaseState.ATTEMPTED_NO_RECOVERY, f"attempt {attempt.attempt_number} {audit_status}", at=now_iso
            )
        case.active_attempt_id = None
        self.repo.save_attempt(attempt)
        self.repo.save_case(case)
        if attempt.idempotency_key:
            self._complete_idempotency(
                case, attempt.idempotency_key, attempt, 500,
                {"detail": detail, "code": code, "case_id": case.case_id, "attempt_id": attempt.attempt_id},
                now_iso,
            )
        self.audit_service.log_event(
            merchant_id=case.merchant_id,
            transaction_id=case.transaction_id,
            leak_id=case.leak_id,
            event_type=AuditEventType.EXECUTION_FAILED,
            action=attempt.final_action or attempt.requested_action,
            policy_result={"allowed": True, "reason": "Authorized at execution time."},
            decision_id=attempt.decision_id,
            outcome={
                "status": audit_status,
                "recovered": False,
                "recovered_amount": 0.0,
                "attempt_number": attempt.attempt_number,
                "error": failure_reason,
            },
            idempotency_key=attempt.idempotency_key,
            run_id=case.run_id,
            case_id=case.case_id,
            attempt_id=attempt.attempt_id,
            provider=attempt.provider,
        )

    # ── phase 2 + 3: call the provider outside any transaction, then complete ──
    def _run_and_complete(self, reservation: _Reservation, key: Optional[str]) -> ExecutionOutcome:
        tx, decision = reservation.tx, reservation.decision
        attempt = self.repo.get_attempt(reservation.attempt_id, workspace_id=reservation.workspace_id)
        final_action = attempt.final_action

        intervention: Optional[Intervention] = None
        problem: Optional[str] = None
        try:
            decision_payload = decision.to_dict()
            decision_payload["final_action"] = final_action
            intervention = self._provider_source().execute(tx.to_dict(), decision_payload, key)
            problem = self._validate_provider_result(intervention, tx, final_action)
        except Exception as exc:  # the provider is outside our control; never leave a case "executing"
            problem = f"{type(exc).__name__}: {exc}"
            logger.exception(
                "provider raised case=%s attempt=%s action=%s", reservation.case_id, reservation.attempt_id, final_action
            )

        try:
            # The provider has already acted, so a deadlock while booking the result is retried (the unit rolled back
            # whole) rather than abandoned; only a persistent failure falls through to the abort below.
            if problem is not None:
                result = run_with_retry(lambda: self._complete_failure(reservation, key, problem))
            else:
                result = run_with_retry(lambda: self._complete_success(reservation, key, intervention))
        except Exception as exc:  # bookkeeping failed: release the reservation rather than strand the case
            logger.exception(
                "execution bookkeeping failed case=%s attempt=%s", reservation.case_id, reservation.attempt_id
            )
            self._abort_reservation(reservation, f"{type(exc).__name__}: {exc}")
            raise
        if isinstance(result, ExecutionError):  # committed first, raised now
            raise result
        return result

    @staticmethod
    def _validate_provider_result(intervention: Any, tx: Transaction, final_action: str) -> Optional[str]:
        if not isinstance(intervention, Intervention):
            return "provider returned no intervention record"
        if intervention.transaction_id != tx.transaction_id:
            return f"provider result is for transaction {intervention.transaction_id}, not {tx.transaction_id}"
        if intervention.final_action != final_action:
            return f"provider executed '{intervention.final_action}' but '{final_action}' was authorized"
        if intervention.status not in _VALID_STATUSES_FOR_ACTION.get(final_action, set()):
            return f"provider status '{intervention.status}' is not valid for action '{final_action}'"
        if bool(intervention.recovered) != (intervention.status == "recovered"):
            return "provider recovered flag disagrees with its status"
        amount = intervention.recovered_amount
        if not isinstance(amount, (int, float)) or not math.isfinite(amount):
            return "provider recovered_amount is not a number"
        if intervention.recovered:
            if amount <= 0 or amount > tx.amount + 0.005:
                return f"provider recovered_amount {amount} is outside (0, {tx.amount}]"
        elif amount != 0:
            return "provider reported a recovered amount without a recovery"
        return None

    def _expired(self, case: RecoveryCase, attempt: ExecutionAttempt) -> ReservationExpired:
        logger.error(
            "provider returned for an attempt already closed as %s case=%s attempt=%s; its result is NOT recorded",
            attempt.status.value, case.case_id, attempt.attempt_id,
        )
        return ReservationExpired(
            "The reservation for this execution was closed as interrupted before the provider returned, "
            "so its result was not recorded. Reconcile with the provider before trying again.",
            case_id=case.case_id, attempt_id=attempt.attempt_id,
        )

    def _complete_success(self, reservation, key, intervention: Intervention) -> Union[ExecutionOutcome, ExecutionError]:
        with self.repo.atomic():
            case = self.repo.get_case(reservation.case_id, workspace_id=reservation.workspace_id)
            attempt = self.repo.get_attempt(reservation.attempt_id, workspace_id=reservation.workspace_id)
            if attempt.status != AttemptStatus.RESERVED:  # reclaimed while the provider call was in flight
                return self._expired(case, attempt)
            now_iso = self.clock().isoformat()

            intervention.run_id = case.run_id
            intervention.case_id = case.case_id
            intervention.attempt_id = attempt.attempt_id
            intervention.execution_mode = attempt.execution_mode
            self.repo.save_intervention(intervention)

            attempt.status = AttemptStatus.COMPLETED
            attempt.completed_at = now_iso
            attempt.intervention_id = intervention.intervention_id
            attempt.outcome_status = intervention.status
            attempt.recovered = bool(intervention.recovered)
            attempt.recovered_amount = float(intervention.recovered_amount)

            new_state = _STATUS_TO_STATE[intervention.status]
            case.transition(new_state, f"attempt {attempt.attempt_number}: {intervention.status}", at=now_iso)
            case.active_attempt_id = None
            case.outcome_status = intervention.status
            if intervention.recovered:
                case.recovered_attempt_id = attempt.attempt_id
                case.recovered_amount = float(intervention.recovered_amount)
            self.repo.save_attempt(attempt)
            self.repo.save_case(case)

            response = intervention.to_dict()
            if key:
                self._complete_idempotency(case, key, attempt, 200, response, now_iso)

            decision = reservation.decision
            event_type = (
                AuditEventType.SUPPRESSION_CREATED if intervention.final_action == Action.SUPPRESS.value
                else AuditEventType.ESCALATION_CREATED if intervention.final_action == Action.ESCALATE.value
                else AuditEventType.EXECUTION_SUCCEEDED if intervention.recovered
                else AuditEventType.EXECUTION_FAILED
            )
            self.audit_service.log_event(
                merchant_id=case.merchant_id,
                transaction_id=case.transaction_id,
                leak_id=case.leak_id,
                event_type=event_type,
                action=intervention.final_action,
                policy_result={"allowed": decision.policy_allowed, "reason": decision.policy_reason},
                decision_id=decision.decision_id,
                intervention_id=intervention.intervention_id,
                outcome={
                    "status": intervention.status,
                    "recovered": intervention.recovered,
                    "recovered_amount": intervention.recovered_amount,
                    "attempt_number": attempt.attempt_number,
                    "execution_mode": attempt.execution_mode,
                },
                idempotency_key=key,
                run_id=case.run_id,
                case_id=case.case_id,
                attempt_id=attempt.attempt_id,
                provider=attempt.provider,
            )
            return ExecutionOutcome(
                intervention=response,
                replayed=False,
                case_id=case.case_id,
                attempt_id=attempt.attempt_id,
                case_state=case.state.value,
            )

    def _complete_failure(self, reservation, key, problem: str) -> Union[ExecutionOutcome, ExecutionError]:
        with self.repo.atomic():
            case = self.repo.get_case(reservation.case_id, workspace_id=reservation.workspace_id)
            attempt = self.repo.get_attempt(reservation.attempt_id, workspace_id=reservation.workspace_id)
            if attempt.status != AttemptStatus.RESERVED:
                return self._expired(case, attempt)
            now_iso = self.clock().isoformat()

            # The attempt stays counted: a provider that failed midway may still have acted.
            attempt.status = AttemptStatus.FAILED
            attempt.completed_at = now_iso
            attempt.failure_reason = problem
            case.transition(
                CaseState.ATTEMPTED_NO_RECOVERY, f"attempt {attempt.attempt_number} failed: {problem}", at=now_iso
            )
            case.active_attempt_id = None
            self.repo.save_attempt(attempt)
            self.repo.save_case(case)

            body = {
                "detail": f"Execution provider failed: {problem}",
                "code": ProviderFailure.code,
                "case_id": case.case_id,
                "attempt_id": attempt.attempt_id,
            }
            if key:
                self._complete_idempotency(case, key, attempt, ProviderFailure.status_code, body, now_iso)
            self.audit_service.log_event(
                merchant_id=case.merchant_id,
                transaction_id=case.transaction_id,
                leak_id=case.leak_id,
                event_type=AuditEventType.EXECUTION_FAILED,
                action=attempt.final_action,
                policy_result={"allowed": True, "reason": "Authorized at execution time."},
                decision_id=attempt.decision_id,
                outcome={
                    "status": "provider_failure",
                    "recovered": False,
                    "recovered_amount": 0.0,
                    "attempt_number": attempt.attempt_number,
                    "error": problem,
                },
                idempotency_key=key,
                run_id=case.run_id,
                case_id=case.case_id,
                attempt_id=attempt.attempt_id,
                provider=attempt.provider,
            )
            return ProviderFailure(body["detail"], case_id=case.case_id, attempt_id=attempt.attempt_id)

    def _complete_idempotency(self, case, key, attempt, http_status, response, now_iso) -> None:
        record = self.repo.get_idempotency_record(case.merchant_id, OPERATION_EXECUTE, key)
        if record is None:  # defensive: reservation always created it
            record = IdempotencyRecord(
                merchant_id=case.merchant_id, operation=OPERATION_EXECUTE, key=key,
                request_fingerprint=attempt.request_fingerprint, case_id=case.case_id,
                attempt_id=attempt.attempt_id, created_at=now_iso,
            )
        record.status = "completed"
        record.http_status = http_status
        record.response = response
        record.completed_at = now_iso
        self.repo.save_idempotency_record(record)

    def _abort_reservation(self, reservation, reason: str) -> None:
        """
        Best effort after an internal bookkeeping error: in a NEW unit of work (the failed one has
        rolled back), turn the stranded reservation into a failed, counted attempt and close its
        idempotency record, so neither the case nor the key stays "in progress" forever. The
        attempt stays counted because the provider call may have taken effect. If even this fails
        (e.g. the database is unreachable) the reservation is recovered later by
        `recover_interrupted()` / the next request after the reservation timeout.
        """
        try:
            with self.repo.atomic():
                case = self.repo.get_case(reservation.case_id, workspace_id=reservation.workspace_id)
                attempt = self.repo.get_attempt(reservation.attempt_id, workspace_id=reservation.workspace_id)
                if attempt.status != AttemptStatus.RESERVED:
                    return
                self._interrupt_attempt(
                    case, attempt,
                    failure_reason=f"bookkeeping error after provider call: {reason}",
                    code="execution_bookkeeping_error",
                    detail="Execution bookkeeping failed after the provider call; the attempt is recorded as failed.",
                    audit_status="bookkeeping_error",
                )
        except Exception:
            logger.exception(
                "could not release reservation case=%s attempt=%s", reservation.case_id, reservation.attempt_id
            )
