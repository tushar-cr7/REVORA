"""
PostgreSQL implementation of the repository contract.

Transaction model
  * `atomic()` opens ONE database transaction on one pooled connection (READ COMMITTED), joined
    by nested calls on the same thread, committed on a clean exit, rolled back on any exception.
  * Inside `atomic()`, a case read takes `SELECT ... FOR UPDATE`; the active-run read takes
    `FOR SHARE`. Those row locks, not a process-local mutex, are what serialize two requests
    (possibly in two processes) that touch the same case or race a new scan.
  * Outside `atomic()` every method is its own short transaction.

Safety is also enforced by constraints that do not depend on any caller being careful: see
migrations/0001 (one in-flight attempt per case, one recovery per case, one idempotency record
per scope) and 0002 (one event per source identity, one case per obligation).

Everything returned is a COPY. Persist changes with the matching `save_*` call.
"""
import json
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

import psycopg2
import psycopg2.extras
from psycopg2.extras import Json, RealDictCursor, execute_values

from backend.app.db import migrate
from backend.app.db.pool import ConnectionPool
from backend.app.domain.events import RevenueObligation, SourceEvent
from backend.app.domain.models import (
    ALL_RUNS,
    AttemptStatus,
    AuditEvent,
    CaseState,
    Decision,
    ExecutionAttempt,
    IdempotencyRecord,
    Intervention,
    RecoveryCase,
    ScanRun,
    Transaction,
)
from backend.app.repositories.base import BaseRepository
from backend.app.repositories.errors import (
    DuplicateIdempotencyKey,
    EventIdentityConflict,
    MoneyPrecisionError,
    StaleWrite,
    TransientStorageError,
)

_CENT = Decimal("0.01")
_MAX_MONEY = Decimal("99999999999999.99")  # NUMERIC(16,2)


# ── value conversion ─────────────────────────────────────────────────────
def to_money(value: Any) -> Decimal:
    """Exact two-decimal money, or MoneyPrecisionError. Never rounds."""
    if value is None or isinstance(value, bool):
        raise MoneyPrecisionError(f"{value!r} is not a money amount.")
    try:
        if isinstance(value, Decimal):
            exact = value
        elif isinstance(value, int):
            exact = Decimal(value)
        else:
            number = float(value)
            if number != number or number in (float("inf"), float("-inf")):
                raise MoneyPrecisionError(f"{value!r} is not a finite amount.")
            exact = Decimal(repr(number))  # the shortest decimal that round-trips the float
    except (InvalidOperation, TypeError, ValueError) as exc:
        if isinstance(exc, MoneyPrecisionError):
            raise
        raise MoneyPrecisionError(f"{value!r} is not a money amount.") from exc
    if not exact.is_finite():
        raise MoneyPrecisionError(f"{value!r} is not a finite amount.")
    quantized = exact.quantize(_CENT)
    if quantized != exact:
        raise MoneyPrecisionError(
            f"{value!r} has more than two decimal places; refusing to round money silently."
        )
    if abs(quantized) > _MAX_MONEY:
        raise MoneyPrecisionError(f"{value!r} is outside the supported range.")
    return quantized


def _f(value: Optional[Decimal]) -> Optional[float]:
    return None if value is None else float(value)


def _ts(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return None if value is None else value.astimezone(timezone.utc).isoformat()


def _json_default(obj: Any) -> Any:
    if hasattr(obj, "value") and isinstance(getattr(obj, "value"), (str, int)):  # Enum
        return obj.value
    if hasattr(obj, "item"):  # numpy scalar
        return obj.item()
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"{type(obj).__name__} is not JSON serializable")


def _dumps(obj: Any) -> str:
    # allow_nan=False: JSONB cannot hold NaN/Infinity, and a silent null would hide a bad figure.
    return json.dumps(obj, allow_nan=False, default=_json_default)


def _j(value: Any) -> Optional[Json]:
    return None if value is None else Json(value, dumps=_dumps)


# ── row mappers ──────────────────────────────────────────────────────────
def _run(r: Dict[str, Any]) -> ScanRun:
    return ScanRun(
        run_id=r["run_id"],
        merchant_id=r["merchant_id"],
        source_fingerprint=r["source_fingerprint"],
        n_total=r["n_total"],
        seed=r["seed"],
        created_at=_iso(r["created_at"]),
        last_scanned_at=_iso(r["last_scanned_at"]),
        scan_count=r["scan_count"],
        transaction_count=r["transaction_count"],
        total_at_risk=_f(r["total_at_risk"]),
        status=r["status"],
        superseded_at=_iso(r["superseded_at"]),
        kind=r["kind"],
    )


def _tx(r: Dict[str, Any]) -> Transaction:
    return Transaction(
        transaction_id=r["transaction_id"],
        leak_id=r["leak_id"],
        merchant_id=r["merchant_id"],
        customer_id=r["customer_id"],
        amount=_f(r["amount"]),
        leak_type=r["leak_type"],
        payment_method=r["payment_method"],
        failure_code=r["failure_code"],
        prior_successful_payments=r["prior_successful_payments"],
        ltv_bucket=r["ltv_bucket"],
        retries_so_far=r["retries_so_far"],
        hours_since_event=r["hours_since_event"],
        age_days=r["age_days"],
        event_time=r["event_time"],
        merchant_segment=r["merchant_segment"],
        payment_id=r["payment_id"],
        visit_count=r["visit_count"],
        reached_payment_page=r["reached_payment_page"],
        consecutive_failures=r["consecutive_failures"],
        subscription_age_days=r["subscription_age_days"],
        contacts_today=r["contacts_today"],
        model_recovery_prob=r["model_recovery_prob"],
        run_id=r["run_id"],
    )


def _case(r: Dict[str, Any]) -> RecoveryCase:
    return RecoveryCase(
        case_id=r["case_id"],
        run_id=r["run_id"],
        merchant_id=r["merchant_id"],
        transaction_id=r["transaction_id"],
        leak_id=r["leak_id"],
        customer_id=r["customer_id"],
        leak_type=r["leak_type"],
        amount=_f(r["amount"]),
        state=CaseState(r["state"]),
        decision_id=r["decision_id"],
        authorized_action=r["authorized_action"],
        authorization=r["authorization_snapshot"],
        policy_version=r["policy_version"],
        attempt_count=r["attempt_count"],
        active_attempt_id=r["active_attempt_id"],
        recovered_attempt_id=r["recovered_attempt_id"],
        recovered_amount=_f(r["recovered_amount"]),
        outcome_status=r["outcome_status"],
        blocked_reason=r["blocked_reason"],
        safe_alternative=r["safe_alternative"],
        history=r["history"] or [],
        created_at=_iso(r["created_at"]),
        updated_at=_iso(r["updated_at"]),
        version=r["version"],
    )


def _decision(r: Dict[str, Any]) -> Decision:
    return Decision(
        decision_id=r["decision_id"],
        leak_id=r["leak_id"],
        transaction_id=r["transaction_id"],
        candidates_evaluated=r["candidates_evaluated"],
        ai_proposed_action=r["ai_proposed_action"],
        ai_proposed_ev=r["ai_proposed_ev"],
        ai_proposed_probability=r["ai_proposed_probability"],
        policy_allowed=r["policy_allowed"],
        policy_reason=r["policy_reason"],
        final_action=r["final_action"],
        created_at=_iso(r["created_at"]),
        run_id=r["run_id"],
        case_id=r["case_id"],
        policy_version=r["policy_version"],
        policy_limits=r["policy_limits"],
    )


def _attempt(r: Dict[str, Any]) -> ExecutionAttempt:
    return ExecutionAttempt(
        attempt_id=r["attempt_id"],
        case_id=r["case_id"],
        run_id=r["run_id"],
        merchant_id=r["merchant_id"],
        transaction_id=r["transaction_id"],
        customer_id=r["customer_id"],
        sequence=r["sequence"],
        attempt_number=r["attempt_number"],
        requested_action=r["requested_action"],
        final_action=r["final_action"],
        decision_id=r["decision_id"],
        authorization=r["authorization_snapshot"],
        status=AttemptStatus(r["status"]),
        idempotency_key=r["idempotency_key"],
        request_fingerprint=r["request_fingerprint"],
        provider=r["provider"],
        execution_mode=r["execution_mode"],
        created_at=_iso(r["created_at"]),
        completed_at=_iso(r["completed_at"]),
        intervention_id=r["intervention_id"],
        outcome_status=r["outcome_status"],
        recovered=r["recovered"],
        recovered_amount=_f(r["recovered_amount"]),
        failure_reason=r["failure_reason"],
    )


def _intervention(r: Dict[str, Any]) -> Intervention:
    return Intervention(
        intervention_id=r["intervention_id"],
        decision_id=r["decision_id"],
        leak_id=r["leak_id"],
        transaction_id=r["transaction_id"],
        customer_id=r["customer_id"],
        merchant_id=r["merchant_id"],
        amount=_f(r["amount"]),
        ai_proposed_action=r["ai_proposed_action"],
        policy_allowed=r["policy_allowed"],
        policy_reason=r["policy_reason"],
        final_action=r["final_action"],
        provider=r["provider"],
        status=r["status"],
        recovered=r["recovered"],
        recovered_amount=_f(r["recovered_amount"]),
        timestamp=_iso(r["occurred_at"]),
        execution_probability_used=r["execution_probability_used"],
        idempotency_key=r["idempotency_key"],
        run_id=r["run_id"],
        case_id=r["case_id"],
        attempt_id=r["attempt_id"],
        execution_mode=r["execution_mode"],
    )


def _audit(r: Dict[str, Any]) -> AuditEvent:
    return AuditEvent(
        event_id=r["event_id"],
        merchant_id=r["merchant_id"],
        transaction_id=r["transaction_id"],
        leak_id=r["leak_id"],
        decision_id=r["decision_id"],
        intervention_id=r["intervention_id"],
        timestamp=_iso(r["occurred_at"]),
        event_type=r["event_type"],
        action=r["action"],
        policy_result=r["policy_result"],
        policy_version=r["policy_version"],
        model_version=r["model_version"],
        provider=r["provider"],
        outcome=r["outcome"],
        correlation_id=r["correlation_id"],
        idempotency_key=r["idempotency_key"],
        run_id=r["run_id"],
        case_id=r["case_id"],
        attempt_id=r["attempt_id"],
    )


def _idempotency(r: Dict[str, Any]) -> IdempotencyRecord:
    return IdempotencyRecord(
        merchant_id=r["merchant_id"],
        operation=r["operation"],
        key=r["key"],
        request_fingerprint=r["request_fingerprint"],
        case_id=r["case_id"],
        attempt_id=r["attempt_id"],
        status=r["status"],
        http_status=r["http_status"],
        response=r["response"],
        created_at=_iso(r["created_at"]),
        completed_at=_iso(r["completed_at"]),
    )


def _event(r: Dict[str, Any]) -> SourceEvent:
    return SourceEvent(
        event_id=r["event_id"],
        merchant_id=r["merchant_id"],
        merchant_assertion=r["merchant_assertion"],
        source=r["source"],
        source_event_id=r["source_event_id"],
        event_type=r["event_type"],
        reference_kind=r["reference_kind"],
        reference_id=r["reference_id"],
        customer_ref=r["customer_ref"],
        amount_minor=r["amount_minor"],
        currency=r["currency"],
        payload=r["payload"],
        content_fingerprint=r["content_fingerprint"],
        occurred_at=_iso(r["occurred_at"]),
        received_at=_iso(r["received_at"]),
        processing_status=r["processing_status"],
        failure_reason=r["failure_reason"],
        processed_at=_iso(r["processed_at"]),
    )


def _obligation(r: Dict[str, Any]) -> RevenueObligation:
    return RevenueObligation(
        obligation_id=r["obligation_id"],
        merchant_id=r["merchant_id"],
        reference_kind=r["reference_kind"],
        reference_id=r["reference_id"],
        leak_type=r["leak_type"],
        status=r["status"],
        customer_ref=r["customer_ref"],
        amount_minor=r["amount_minor"],
        currency=r["currency"],
        failure_count=r["failure_count"],
        reported_attempt_number=r["reported_attempt_number"],
        consecutive_failures=r["consecutive_failures"],
        latest_failure_code=r["latest_failure_code"],
        payment_method=r["payment_method"],
        first_at_risk_at=_iso(r["first_at_risk_at"]),
        last_at_risk_at=_iso(r["last_at_risk_at"]),
        due_at=_iso(r["due_at"]),
        settled_at=_iso(r["settled_at"]),
        event_count=r["event_count"],
        last_event_at=_iso(r["last_event_at"]),
        run_id=r["run_id"],
        case_id=r["case_id"],
        settled_while_frozen=r["settled_while_frozen"],
        created_at=_iso(r["created_at"]),
        last_evaluated_at=_iso(r["last_evaluated_at"]),
    )


_TX_COLUMNS = (
    "run_id", "transaction_id", "ordinal", "leak_id", "merchant_id", "customer_id", "amount", "leak_type",
    "payment_method", "failure_code", "prior_successful_payments", "ltv_bucket", "retries_so_far",
    "hours_since_event", "age_days", "event_time", "merchant_segment", "payment_id", "visit_count",
    "reached_payment_page", "consecutive_failures", "subscription_age_days", "contacts_today",
    "model_recovery_prob",
)

_CASE_COLUMNS = (
    "case_id", "run_id", "ordinal", "merchant_id", "transaction_id", "leak_id", "customer_id", "leak_type",
    "amount", "state", "decision_id", "authorized_action", "authorization_snapshot", "policy_version", "attempt_count",
    "active_attempt_id", "recovered_attempt_id", "recovered_amount", "outcome_status", "blocked_reason",
    "safe_alternative", "history", "created_at", "updated_at",
)

# SQLSTATEs the database raises when it aborts a transaction in a way a retry cures.
_TRANSIENT_SQLSTATES = frozenset({"40P01", "40001"})  # deadlock_detected, serialization_failure

_ACTIVE_RUN = "(SELECT run_id FROM scan_runs WHERE status = 'active')"
_SCAN_REGISTRY_LOCK = "revora:scan_registry"


def _tx_values(tx: Transaction, ordinal: int) -> Tuple[Any, ...]:
    return (
        tx.run_id, tx.transaction_id, ordinal, tx.leak_id, tx.merchant_id, tx.customer_id, to_money(tx.amount),
        tx.leak_type, tx.payment_method, tx.failure_code, tx.prior_successful_payments, tx.ltv_bucket,
        tx.retries_so_far, tx.hours_since_event, tx.age_days, tx.event_time, tx.merchant_segment, tx.payment_id,
        tx.visit_count, tx.reached_payment_page, tx.consecutive_failures, tx.subscription_age_days,
        tx.contacts_today or 0, tx.model_recovery_prob,
    )


def _case_values(case: RecoveryCase, ordinal: int) -> Tuple[Any, ...]:
    return (
        case.case_id, case.run_id, ordinal, case.merchant_id, case.transaction_id, case.leak_id, case.customer_id,
        case.leak_type, to_money(case.amount), case.state.value, case.decision_id, case.authorized_action,
        _j(case.authorization), case.policy_version, case.attempt_count, case.active_attempt_id,
        case.recovered_attempt_id, to_money(case.recovered_amount), case.outcome_status, case.blocked_reason,
        case.safe_alternative, _j(case.history), _ts(case.created_at), _ts(case.updated_at),
    )


class PostgresRepository(BaseRepository):
    def __init__(self, pool: ConnectionPool, *, allow_destructive: bool = False):
        self._pool = pool
        self._local = threading.local()
        self._allow_destructive = allow_destructive
        # Legacy progress flags (not persisted, never read by the application).
        self.scanned = False
        self.analyzed = False
        self.recovered = False

    # ── construction & health ────────────────────────────────────────────
    @classmethod
    def connect(
        cls,
        dsn: str,
        *,
        schema: Optional[str] = None,
        pool_size: int = 10,
        auto_migrate: bool = False,
        allow_destructive: bool = False,
        **pool_options: Any,
    ) -> "PostgresRepository":
        """Connect and verify the schema is at the version this code expects (migrating first if asked)."""
        if auto_migrate:
            migrate.upgrade(dsn, schema)
        pool = ConnectionPool(dsn, maxconn=pool_size, schema=schema, **pool_options)
        repository = cls(pool, allow_destructive=allow_destructive)
        try:
            repository.verify_ready()
        except Exception:
            pool.close()
            raise
        return repository

    def verify_ready(self) -> int:
        with self._pool.connection() as conn:
            return migrate.check_ready(conn)

    def describe(self) -> Dict[str, Any]:
        """Connectivity and schema version for the readiness endpoint."""
        version = self.verify_ready()
        return {
            "backend": "postgres",
            "durable": True,
            "schema_version": version,
            "schema_head": migrate.head_version(),
            "schema": self._pool.schema or "default",
        }

    def close(self) -> None:
        self._pool.close()

    # ── transaction plumbing ─────────────────────────────────────────────
    def _in_atomic(self) -> bool:
        return getattr(self._local, "conn", None) is not None

    @contextmanager
    def atomic(self) -> Iterator[None]:
        if self._in_atomic():
            self._local.depth += 1
            try:
                yield
            finally:
                self._local.depth -= 1
            return
        with self._pool.connection() as conn:
            self._local.conn = conn
            self._local.depth = 1
            try:
                yield
                conn.commit()
            except BaseException as exc:
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001 - the original error is the one to report
                    pass
                if isinstance(exc, psycopg2.Error) and getattr(exc, "pgcode", None) in _TRANSIENT_SQLSTATES:
                    raise TransientStorageError(
                        f"The database aborted this unit of work ({exc.pgcode}); it was rolled back and may be retried."
                    ) from exc
                raise
            finally:
                self._local.conn = None
                self._local.depth = 0

    @contextmanager
    def _cursor(self) -> Iterator[RealDictCursor]:
        with self.atomic():
            cur = self._local.conn.cursor(cursor_factory=RealDictCursor)
            try:
                yield cur
            finally:
                cur.close()

    def lock_customer(self, merchant_id: str, customer_id: str) -> None:
        if not self._in_atomic():
            raise RuntimeError("lock_customer must be called inside atomic().")
        with self._cursor() as cur:
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"revora:customer:{merchant_id}:{customer_id}",),
            )

    @staticmethod
    def _run_filter(run_id: Optional[str], column: str = "run_id") -> Tuple[str, List[Any]]:
        """None -> the active run; ALL_RUNS -> no filter; otherwise that run."""
        if run_id == ALL_RUNS:
            return "TRUE", []
        if run_id:
            return f"{column} = %s", [run_id]
        return f"{column} = {_ACTIVE_RUN}", []

    # ── scan runs ────────────────────────────────────────────────────────
    def register_scan_run(
        self, run: ScanRun, transactions: List[Transaction], cases: List[RecoveryCase]
    ) -> Tuple[ScanRun, bool]:
        for case in cases:
            if case.run_id != run.run_id:
                raise ValueError(f"Case {case.case_id} belongs to run {case.run_id}, not {run.run_id}.")
        with self._cursor() as cur:
            self._lock_registry(cur)
            cur.execute("SELECT run_id FROM scan_runs WHERE source_fingerprint = %s", (run.source_fingerprint,))
            existing = cur.fetchone()
            if existing is not None:
                return self._activate_locked(cur, existing["run_id"]), False

            for tx in transactions:
                tx.run_id = run.run_id
            # Validate every amount before writing anything (a refusal must leave no half-registered run).
            tx_rows = [_tx_values(tx, i) for i, tx in enumerate(transactions)]
            case_rows = [_case_values(case, i) for i, case in enumerate(cases)]

            self._supersede_active_locked(cur, run.created_at)
            cur.execute(
                """
                INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at,
                                       last_scanned_at, scan_count, transaction_count, total_at_risk, status, kind)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'active', %s)
                """,
                (
                    run.run_id, run.merchant_id, run.source_fingerprint, run.n_total, run.seed,
                    _ts(run.created_at), _ts(run.last_scanned_at), run.scan_count, run.transaction_count,
                    to_money(run.total_at_risk), run.kind,
                ),
            )
            run.status = "active"
            run.superseded_at = None
            if tx_rows:
                execute_values(
                    cur,
                    f"INSERT INTO transactions ({', '.join(_TX_COLUMNS)}) VALUES %s",
                    tx_rows,
                    page_size=1000,
                )
            if case_rows:
                execute_values(
                    cur,
                    f"INSERT INTO recovery_cases ({', '.join(_CASE_COLUMNS)}) VALUES %s",
                    case_rows,
                    page_size=1000,
                )
            self.scanned, self.analyzed, self.recovered = True, False, False
            return run, True

    def _lock_registry(self, cur) -> None:
        cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (_SCAN_REGISTRY_LOCK,))

    def _supersede_active_locked(self, cur, at_iso: str) -> None:
        cur.execute(
            "UPDATE scan_runs SET status = 'superseded', superseded_at = %s WHERE status = 'active'",
            (_ts(at_iso),),
        )

    def _activate_locked(self, cur, run_id: str) -> ScanRun:
        cur.execute("SELECT kind, status FROM scan_runs WHERE run_id = %s FOR UPDATE", (run_id,))
        row = cur.fetchone()
        if row is None:
            raise KeyError(f"Unknown scan run {run_id}.")
        if row["kind"] != "synthetic_scan":
            raise ValueError(f"Run {run_id} is an {row['kind']} run and cannot be activated.")
        now = datetime.now(timezone.utc)
        if row["status"] != "active":
            self._supersede_active_locked(cur, now.isoformat())
            cur.execute(
                "UPDATE scan_runs SET status = 'active', superseded_at = NULL WHERE run_id = %s", (run_id,)
            )
        cur.execute(
            "UPDATE scan_runs SET scan_count = scan_count + 1, last_scanned_at = %s WHERE run_id = %s RETURNING *",
            (now, run_id),
        )
        return _run(cur.fetchone())

    def find_run_by_fingerprint(self, fingerprint: str) -> Optional[ScanRun]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM scan_runs WHERE source_fingerprint = %s", (fingerprint,))
            row = cur.fetchone()
            return _run(row) if row else None

    def activate_run(self, run_id: str) -> ScanRun:
        with self._cursor() as cur:
            self._lock_registry(cur)
            return self._activate_locked(cur, run_id)

    def get_active_run(self) -> Optional[ScanRun]:
        # Inside atomic() take a shared lock: a scan that would supersede this run must wait for us.
        lock = " FOR SHARE" if self._in_atomic() else ""
        with self._cursor() as cur:
            cur.execute(f"SELECT * FROM scan_runs WHERE status = 'active'{lock}")
            row = cur.fetchone()
            return _run(row) if row else None

    def get_run(self, run_id: str) -> Optional[ScanRun]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM scan_runs WHERE run_id = %s", (run_id,))
            row = cur.fetchone()
            return _run(row) if row else None

    def list_runs(self) -> List[ScanRun]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM scan_runs ORDER BY seq")
            return [_run(r) for r in cur.fetchall()]

    # ── transactions ─────────────────────────────────────────────────────
    def get_transaction_by_id(self, tx_id: str, run_id: Optional[str] = None) -> Optional[Transaction]:
        scope = None if run_id == ALL_RUNS else run_id
        clause, params = self._run_filter(scope)
        with self._cursor() as cur:
            cur.execute(
                f"""
                SELECT * FROM transactions
                WHERE {clause} AND (transaction_id = %s OR leak_id = %s)
                ORDER BY (transaction_id = %s) DESC LIMIT 1
                """,
                params + [tx_id, tx_id, tx_id],
            )
            row = cur.fetchone()
            return _tx(row) if row else None

    def get_all_transactions(self, run_id: Optional[str] = None) -> List[Transaction]:
        clause, params = self._run_filter(run_id, "t.run_id")
        with self._cursor() as cur:
            cur.execute(
                f"""
                SELECT t.* FROM transactions t JOIN scan_runs s ON s.run_id = t.run_id
                WHERE {clause} ORDER BY s.seq, t.ordinal
                """,
                params,
            )
            return [_tx(r) for r in cur.fetchall()]

    def update_transaction_analysis(
        self, run_id: str, transaction_id: str, model_recovery_prob: Optional[float], contacts_today: Optional[int]
    ) -> None:
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE transactions
                SET model_recovery_prob = %s, contacts_today = COALESCE(%s, contacts_today)
                WHERE run_id = %s AND transaction_id = %s
                """,
                (model_recovery_prob, contacts_today, run_id, transaction_id),
            )
            if cur.rowcount == 0:
                raise KeyError(f"Unknown transaction {transaction_id} in run {run_id}.")

    def update_transaction_analyses(
        self, run_id: str, rows: Sequence[Tuple[str, Optional[float], Optional[int]]]
    ) -> None:
        rows = list(rows)
        if not rows:
            return
        values_sql = ", ".join(["(%s, %s::double precision, %s::integer)"] * len(rows))
        params: List[Any] = []
        for tx_id, prob, contacts in rows:
            params += [tx_id, prob, contacts]
        with self._cursor() as cur:
            cur.execute(
                f"""
                UPDATE transactions AS t
                SET model_recovery_prob = v.prob, contacts_today = COALESCE(v.contacts, t.contacts_today)
                FROM (VALUES {values_sql}) AS v (transaction_id, prob, contacts)
                WHERE t.run_id = %s AND t.transaction_id = v.transaction_id
                """,
                params + [run_id],
            )
            if cur.rowcount != len(rows):
                raise KeyError(f"Expected to update {len(rows)} transactions in run {run_id}, updated {cur.rowcount}.")

    def lock_cases(self, run_id: str, transaction_ids: Sequence[str]) -> List[RecoveryCase]:
        ids = list(transaction_ids)
        if not ids:
            return []
        if not self._in_atomic():
            raise RuntimeError("lock_cases must be called inside atomic().")
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM recovery_cases WHERE run_id = %s AND transaction_id = ANY(%s) ORDER BY ordinal FOR UPDATE",
                (run_id, ids),
            )
            return [_case(r) for r in cur.fetchall()]

    # ── cases ────────────────────────────────────────────────────────────
    def save_case(self, case: RecoveryCase):
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE recovery_cases SET
                    state = %s, decision_id = %s, authorized_action = %s, authorization_snapshot = %s, policy_version = %s,
                    attempt_count = %s, active_attempt_id = %s, recovered_attempt_id = %s, recovered_amount = %s,
                    outcome_status = %s, blocked_reason = %s, safe_alternative = %s, history = %s, updated_at = %s,
                    version = version + 1
                WHERE case_id = %s AND version = %s
                """,
                (
                    case.state.value, case.decision_id, case.authorized_action, _j(case.authorization),
                    case.policy_version, case.attempt_count, case.active_attempt_id, case.recovered_attempt_id,
                    to_money(case.recovered_amount), case.outcome_status, case.blocked_reason,
                    case.safe_alternative, _j(case.history), _ts(case.updated_at), case.case_id, case.version,
                ),
            )
            if cur.rowcount == 0:
                cur.execute("SELECT version FROM recovery_cases WHERE case_id = %s", (case.case_id,))
                current = cur.fetchone()
                if current is None:
                    raise KeyError(f"Unknown case {case.case_id}; cases are created by register_scan_run.")
                raise StaleWrite(
                    f"Case {case.case_id} was changed by another unit of work (read version {case.version}, "
                    f"stored version {current['version']}); the save was refused."
                )
            case.version += 1  # the object now matches what is stored, so a later save in the same unit is valid

    def get_case(self, case_id: str) -> Optional[RecoveryCase]:
        lock = " FOR UPDATE" if self._in_atomic() else ""
        with self._cursor() as cur:
            cur.execute(f"SELECT * FROM recovery_cases WHERE case_id = %s{lock}", (case_id,))
            row = cur.fetchone()
            return _case(row) if row else None

    def get_case_for_transaction(self, key: str, run_id: Optional[str] = None) -> Optional[RecoveryCase]:
        scope = None if run_id == ALL_RUNS else run_id
        clause, params = self._run_filter(scope)
        lock = " FOR UPDATE" if self._in_atomic() else ""
        with self._cursor() as cur:
            cur.execute(
                f"""
                SELECT * FROM recovery_cases
                WHERE {clause} AND (transaction_id = %s OR leak_id = %s)
                ORDER BY (transaction_id = %s) DESC LIMIT 1{lock}
                """,
                params + [key, key, key],
            )
            row = cur.fetchone()
            return _case(row) if row else None

    def list_cases(self, run_id: Optional[str] = None) -> List[RecoveryCase]:
        clause, params = self._run_filter(run_id, "c.run_id")
        with self._cursor() as cur:
            cur.execute(
                f"""
                SELECT c.* FROM recovery_cases c JOIN scan_runs s ON s.run_id = c.run_id
                WHERE {clause} ORDER BY s.seq, c.ordinal
                """,
                params,
            )
            return [_case(r) for r in cur.fetchall()]

    # ── decisions ────────────────────────────────────────────────────────
    def save_decision(self, decision: Decision):
        if decision.run_id is None or decision.case_id is None:
            raise ValueError("A decision must carry the run and case it was made for.")
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO decisions (decision_id, run_id, case_id, leak_id, transaction_id, candidates_evaluated,
                                       ai_proposed_action, ai_proposed_ev, ai_proposed_probability, policy_allowed,
                                       policy_reason, final_action, created_at, policy_version, policy_limits)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (decision_id) DO NOTHING
                """,
                (
                    decision.decision_id, decision.run_id, decision.case_id, decision.leak_id,
                    decision.transaction_id, _j(decision.candidates_evaluated), decision.ai_proposed_action,
                    decision.ai_proposed_ev, decision.ai_proposed_probability, decision.policy_allowed,
                    decision.policy_reason, decision.final_action, _ts(decision.created_at),
                    decision.policy_version, _j(decision.policy_limits),
                ),
            )
            # DO NOTHING: a decision is immutable once written. A re-save is a no-op, never a rewrite.

    def get_decision(self, key: str) -> Optional[Decision]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM decisions WHERE decision_id = %s", (key,))
            row = cur.fetchone()
            if row:
                return _decision(row)
            cur.execute(
                f"""
                SELECT d.* FROM decisions d JOIN recovery_cases c ON c.decision_id = d.decision_id
                WHERE c.run_id = {_ACTIVE_RUN} AND (c.transaction_id = %s OR c.leak_id = %s)
                ORDER BY (c.transaction_id = %s) DESC LIMIT 1
                """,
                (key, key, key),
            )
            row = cur.fetchone()
            return _decision(row) if row else None

    def get_all_decisions(self, run_id: Optional[str] = None) -> List[Decision]:
        clause, params = self._run_filter(run_id, "c.run_id")
        with self._cursor() as cur:
            cur.execute(
                f"""
                SELECT d.* FROM recovery_cases c
                JOIN decisions d ON d.decision_id = c.decision_id
                JOIN scan_runs s ON s.run_id = c.run_id
                WHERE {clause} ORDER BY s.seq, c.ordinal
                """,
                params,
            )
            return [_decision(r) for r in cur.fetchall()]

    def get_escalations(self, run_id: Optional[str] = None) -> List[Decision]:
        return [d for d in self.get_all_decisions(run_id) if d.final_action == "escalate"]

    # ── attempt ledger ───────────────────────────────────────────────────
    def save_attempt(self, attempt: ExecutionAttempt):
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO execution_attempts (
                    attempt_id, case_id, run_id, merchant_id, transaction_id, customer_id, sequence, attempt_number,
                    requested_action, final_action, decision_id, authorization_snapshot, status, idempotency_key,
                    request_fingerprint, provider, execution_mode, created_at, completed_at, intervention_id,
                    outcome_status, recovered, recovered_amount, failure_reason)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (attempt_id) DO UPDATE SET
                    status = EXCLUDED.status, completed_at = EXCLUDED.completed_at,
                    intervention_id = EXCLUDED.intervention_id, outcome_status = EXCLUDED.outcome_status,
                    recovered = EXCLUDED.recovered, recovered_amount = EXCLUDED.recovered_amount,
                    failure_reason = EXCLUDED.failure_reason
                """,
                (
                    attempt.attempt_id, attempt.case_id, attempt.run_id, attempt.merchant_id,
                    attempt.transaction_id, attempt.customer_id, attempt.sequence, attempt.attempt_number,
                    attempt.requested_action, attempt.final_action, attempt.decision_id,
                    _j(attempt.authorization), attempt.status.value, attempt.idempotency_key,
                    attempt.request_fingerprint, attempt.provider, attempt.execution_mode,
                    _ts(attempt.created_at), _ts(attempt.completed_at), attempt.intervention_id,
                    attempt.outcome_status, attempt.recovered, to_money(attempt.recovered_amount),
                    attempt.failure_reason,
                ),
            )
            # Identity columns (case, action, authorization, numbering) are written once and never
            # remapped; only the outcome columns above move.

    def get_attempt(self, attempt_id: str) -> Optional[ExecutionAttempt]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM execution_attempts WHERE attempt_id = %s", (attempt_id,))
            row = cur.fetchone()
            return _attempt(row) if row else None

    def list_attempts(
        self, case_id: Optional[str] = None, run_id: Optional[str] = None
    ) -> List[ExecutionAttempt]:
        with self._cursor() as cur:
            if case_id is not None:
                cur.execute("SELECT * FROM execution_attempts WHERE case_id = %s ORDER BY sequence", (case_id,))
            else:
                clause, params = self._run_filter(run_id)
                cur.execute(f"SELECT * FROM execution_attempts WHERE {clause} ORDER BY seq", params)
            return [_attempt(r) for r in cur.fetchall()]

    def list_customer_attempts(self, merchant_id: str, customer_id: str) -> List[ExecutionAttempt]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM execution_attempts WHERE merchant_id = %s AND customer_id = %s ORDER BY seq",
                (merchant_id, customer_id),
            )
            return [_attempt(r) for r in cur.fetchall()]

    def list_attempts_since(self, created_since: str) -> List[ExecutionAttempt]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM execution_attempts WHERE created_at >= %s ORDER BY seq", (_ts(created_since),)
            )
            return [_attempt(r) for r in cur.fetchall()]

    def list_reserved_attempts(self, created_before: str) -> List[ExecutionAttempt]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM execution_attempts WHERE status = 'reserved' AND created_at < %s ORDER BY created_at",
                (_ts(created_before),),
            )
            return [_attempt(r) for r in cur.fetchall()]

    # ── idempotency ──────────────────────────────────────────────────────
    def get_idempotency_record(self, merchant_id: str, operation: str, key: str) -> Optional[IdempotencyRecord]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM idempotency_records WHERE merchant_id = %s AND operation = %s AND key = %s",
                (merchant_id, operation, key),
            )
            row = cur.fetchone()
            return _idempotency(row) if row else None

    def insert_idempotency_record(self, record: IdempotencyRecord) -> None:
        with self._cursor() as cur:
            # ON CONFLICT DO NOTHING rather than catching the violation: a racing twin blocks here until the
            # winner commits, and the loser's transaction stays usable long enough to be rolled back cleanly.
            cur.execute(
                """
                INSERT INTO idempotency_records (merchant_id, operation, key, request_fingerprint, case_id,
                                                 attempt_id, status, http_status, response, created_at, completed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (merchant_id, operation, key) DO NOTHING
                """,
                (
                    record.merchant_id, record.operation, record.key, record.request_fingerprint, record.case_id,
                    record.attempt_id, record.status, record.http_status, _j(record.response),
                    _ts(record.created_at), _ts(record.completed_at),
                ),
            )
            if cur.rowcount == 0:
                raise DuplicateIdempotencyKey(
                    f"Idempotency key already exists for {record.merchant_id}/{record.operation}."
                )

    def save_idempotency_record(self, record: IdempotencyRecord):
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO idempotency_records (merchant_id, operation, key, request_fingerprint, case_id,
                                                 attempt_id, status, http_status, response, created_at, completed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (merchant_id, operation, key) DO UPDATE SET
                    status = EXCLUDED.status, http_status = EXCLUDED.http_status,
                    response = EXCLUDED.response, completed_at = EXCLUDED.completed_at
                WHERE idempotency_records.request_fingerprint = EXCLUDED.request_fingerprint
                """,
                (
                    record.merchant_id, record.operation, record.key, record.request_fingerprint, record.case_id,
                    record.attempt_id, record.status, record.http_status, _j(record.response),
                    _ts(record.created_at), _ts(record.completed_at),
                ),
            )
            if cur.rowcount == 0:
                raise ValueError("An idempotency record's request fingerprint cannot be changed.")

    # ── interventions ────────────────────────────────────────────────────
    def save_intervention(self, intervention: Intervention):
        if not (intervention.run_id and intervention.case_id and intervention.attempt_id):
            raise ValueError("An intervention must carry its run, case and attempt.")
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO interventions (
                    intervention_id, decision_id, leak_id, transaction_id, customer_id, merchant_id, amount,
                    ai_proposed_action, policy_allowed, policy_reason, final_action, provider, status, recovered,
                    recovered_amount, occurred_at, execution_probability_used, idempotency_key, run_id, case_id,
                    attempt_id, execution_mode)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    intervention.intervention_id, intervention.decision_id, intervention.leak_id,
                    intervention.transaction_id, intervention.customer_id, intervention.merchant_id,
                    to_money(intervention.amount), intervention.ai_proposed_action, intervention.policy_allowed,
                    intervention.policy_reason, intervention.final_action, intervention.provider,
                    intervention.status, intervention.recovered, to_money(intervention.recovered_amount),
                    _ts(intervention.timestamp), intervention.execution_probability_used,
                    intervention.idempotency_key, intervention.run_id, intervention.case_id,
                    intervention.attempt_id, intervention.execution_mode,
                ),
            )

    def get_intervention_by_id(self, intervention_id: str) -> Optional[Intervention]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM interventions WHERE intervention_id = %s", (intervention_id,))
            row = cur.fetchone()
            return _intervention(row) if row else None

    def get_all_interventions(self, run_id: Optional[str] = None) -> List[Intervention]:
        clause, params = self._run_filter(run_id)
        with self._cursor() as cur:
            cur.execute(f"SELECT * FROM interventions WHERE {clause} ORDER BY seq", params)
            return [_intervention(r) for r in cur.fetchall()]

    # ── audit ────────────────────────────────────────────────────────────
    def save_audit_event(self, event: AuditEvent):
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO audit_events (
                    event_id, merchant_id, transaction_id, leak_id, decision_id, intervention_id, occurred_at,
                    event_type, action, policy_result, policy_version, model_version, provider, outcome,
                    correlation_id, idempotency_key, run_id, case_id, attempt_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.event_id, event.merchant_id, event.transaction_id, event.leak_id, event.decision_id,
                    event.intervention_id, _ts(event.timestamp), event.event_type, event.action,
                    _j(event.policy_result), event.policy_version, event.model_version, event.provider,
                    _j(event.outcome), event.correlation_id, event.idempotency_key, event.run_id,
                    event.case_id, event.attempt_id,
                ),
            )

    def _audit_where(
        self,
        leak_type: Optional[str],
        status: Optional[str],
        transaction_id: Optional[str],
        run_id: Optional[str],
    ) -> Tuple[str, List[Any]]:
        clauses: List[str] = []
        params: List[Any] = []
        if run_id != ALL_RUNS:
            # Events written without a run stay visible, as in the in-memory repository.
            if run_id:
                clauses.append("(run_id IS NULL OR run_id = %s)")
                params.append(run_id)
            else:
                clauses.append(f"(run_id IS NULL OR run_id = {_ACTIVE_RUN})")
            # No active run at all -> nothing to show (in-memory returns []), but run-less events remain.
        if leak_type:
            clauses.append("(starts_with(leak_id, %s) OR action = %s)")
            params += [leak_type[:2], leak_type]
        if status:
            clauses.append("(event_type = %s OR outcome ->> 'status' = %s)")
            params += [status, status]
        if transaction_id:
            clauses.append("transaction_id = %s")
            params.append(transaction_id)
        return (" AND ".join(clauses) or "TRUE"), params

    def _no_scope(self, run_id: Optional[str]) -> bool:
        """True when the caller asked for the active run and there is none."""
        if run_id:
            return False
        with self._cursor() as cur:
            cur.execute("SELECT 1 FROM scan_runs WHERE status = 'active'")
            return cur.fetchone() is None

    def get_audit_log(
        self,
        limit: int = 200,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        newest_first: bool = False,
        run_id: Optional[str] = None,
    ) -> List[AuditEvent]:
        if self._no_scope(run_id):
            return []
        where, params = self._audit_where(leak_type, status, transaction_id, run_id)
        order = "DESC" if newest_first else "ASC"
        with self._cursor() as cur:
            cur.execute(f"SELECT * FROM audit_events WHERE {where} ORDER BY seq {order} LIMIT %s", params + [limit])
            return [_audit(r) for r in cur.fetchall()]

    def summarize_audit_log(
        self,
        leak_type: Optional[str] = None,
        status: Optional[str] = None,
        transaction_id: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self._no_scope(run_id):
            return {"matched": 0, "counts_by_type": {}}
        where, params = self._audit_where(leak_type, status, transaction_id, run_id)
        with self._cursor() as cur:
            cur.execute(
                f"SELECT event_type, count(*) AS n FROM audit_events WHERE {where} GROUP BY event_type", params
            )
            counts = {r["event_type"]: int(r["n"]) for r in cur.fetchall()}
        return {"matched": sum(counts.values()), "counts_by_type": counts}

    # ── ingestion run, cases and transactions from events ────────────────
    def get_or_create_ingestion_run(self, merchant_id: str, now_iso: str) -> ScanRun:
        fingerprint = f"ingest:{merchant_id}"
        with self._cursor() as cur:
            cur.execute("SELECT * FROM scan_runs WHERE source_fingerprint = %s", (fingerprint,))
            row = cur.fetchone()
            if row is None:
                from backend.app.domain.models import new_id  # local: avoids an import cycle at module load

                cur.execute(
                    """
                    INSERT INTO scan_runs (run_id, merchant_id, source_fingerprint, n_total, seed, created_at,
                                           last_scanned_at, scan_count, status, kind)
                    VALUES (%s, %s, %s, 0, 0, %s, %s, 1, 'standby', 'ingestion')
                    ON CONFLICT DO NOTHING
                    """,
                    (new_id("run", 16), merchant_id, fingerprint, _ts(now_iso), _ts(now_iso)),
                )
                cur.execute("SELECT * FROM scan_runs WHERE source_fingerprint = %s", (fingerprint,))
                row = cur.fetchone()
            if row["kind"] != "ingestion":
                raise ValueError(f"Fingerprint {fingerprint} belongs to a {row['kind']} run.")
            return _run(row)

    def _lock_ingestion_run(self, cur, run_id: str) -> None:
        cur.execute("SELECT kind FROM scan_runs WHERE run_id = %s FOR UPDATE", (run_id,))
        row = cur.fetchone()
        if row is None:
            raise KeyError(f"Unknown scan run {run_id}.")
        if row["kind"] != "ingestion":
            raise ValueError(f"Run {run_id} is a {row['kind']} run; only an ingestion run accepts event-derived records.")

    def create_case(self, case: RecoveryCase, transaction: Transaction) -> None:
        if transaction.run_id != case.run_id or transaction.transaction_id != case.transaction_id:
            raise ValueError("Case and transaction do not describe the same record.")
        with self._cursor() as cur:
            self._lock_ingestion_run(cur, case.run_id)
            cur.execute(
                "SELECT COALESCE(MAX(ordinal) + 1, 0) AS n FROM transactions WHERE run_id = %s", (case.run_id,)
            )
            ordinal = cur.fetchone()["n"]
            cur.execute(
                f"INSERT INTO transactions ({', '.join(_TX_COLUMNS)}) VALUES ({', '.join(['%s'] * len(_TX_COLUMNS))})",
                _tx_values(transaction, ordinal),
            )
            cur.execute(
                f"INSERT INTO recovery_cases ({', '.join(_CASE_COLUMNS)}) "
                f"VALUES ({', '.join(['%s'] * len(_CASE_COLUMNS))})",
                _case_values(case, ordinal),
            )
            self._refresh_run_totals(cur, case.run_id)

    def update_source_transaction(self, transaction: Transaction) -> None:
        with self._cursor() as cur:
            self._lock_ingestion_run(cur, transaction.run_id)
            cur.execute(
                """
                UPDATE transactions SET
                    customer_id = %s, amount = %s, payment_method = %s, failure_code = %s,
                    retries_so_far = %s, hours_since_event = %s, age_days = %s, event_time = %s,
                    payment_id = %s, consecutive_failures = %s
                WHERE run_id = %s AND transaction_id = %s
                """,
                (
                    transaction.customer_id, to_money(transaction.amount), transaction.payment_method,
                    transaction.failure_code, transaction.retries_so_far, transaction.hours_since_event,
                    transaction.age_days, transaction.event_time, transaction.payment_id,
                    transaction.consecutive_failures, transaction.run_id, transaction.transaction_id,
                ),
            )
            if cur.rowcount == 0:
                raise KeyError(f"Unknown transaction {transaction.transaction_id}.")
            cur.execute(  # the case mirrors the facts it was opened on
                "UPDATE recovery_cases SET amount = %s, customer_id = %s, version = version + 1 "
                "WHERE run_id = %s AND transaction_id = %s",
                (to_money(transaction.amount), transaction.customer_id, transaction.run_id, transaction.transaction_id),
            )
            self._refresh_run_totals(cur, transaction.run_id)

    @staticmethod
    def _refresh_run_totals(cur, run_id: str) -> None:
        cur.execute(
            """
            UPDATE scan_runs SET
                transaction_count = (SELECT count(*) FROM transactions WHERE run_id = %s),
                total_at_risk = (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE run_id = %s)
            WHERE run_id = %s
            """,
            (run_id, run_id, run_id),
        )

    # ── source events ────────────────────────────────────────────────────
    def insert_source_event(self, event: SourceEvent) -> Tuple[SourceEvent, bool]:
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO source_events (
                    event_id, merchant_id, merchant_assertion, source, source_event_id, event_type, reference_kind,
                    reference_id, customer_ref, amount_minor, currency, payload, content_fingerprint, occurred_at,
                    received_at, processing_status, failure_reason, processed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING *
                """,
                (
                    event.event_id, event.merchant_id, event.merchant_assertion, event.source,
                    event.source_event_id, event.event_type, event.reference_kind, event.reference_id,
                    event.customer_ref, event.amount_minor, event.currency, _j(event.payload),
                    event.content_fingerprint, _ts(event.occurred_at), _ts(event.received_at),
                    event.processing_status, event.failure_reason, _ts(event.processed_at),
                ),
            )
            row = cur.fetchone()
            if row is not None:
                if event.raw_payload is not None:
                    cur.execute(
                        "INSERT INTO source_event_raw (event_id, payload, stored_at) VALUES (%s, %s, %s)",
                        (event.event_id, _j(event.raw_payload), _ts(event.received_at)),
                    )
                return _event(row), True
            cur.execute(
                "SELECT * FROM source_events WHERE merchant_id = %s AND source = %s AND source_event_id = %s",
                (event.merchant_id, event.source, event.source_event_id),
            )
            existing = cur.fetchone()
            if existing is None:  # a different unique constraint tripped: surface it, do not guess
                raise RuntimeError(f"Source event {event.event_id} conflicted but no existing row was found.")
            if existing["content_fingerprint"] != event.content_fingerprint:
                raise EventIdentityConflict(
                    existing["event_id"], existing["content_fingerprint"], event.content_fingerprint
                )
            return _event(existing), False

    def get_source_event(self, event_id: str) -> Optional[SourceEvent]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM source_events WHERE event_id = %s", (event_id,))
            row = cur.fetchone()
            return _event(row) if row else None

    def list_source_events(
        self,
        merchant_id: Optional[str] = None,
        processing_status: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 100,
    ) -> List[SourceEvent]:
        clauses, params = ["TRUE"], []  # type: List[str], List[Any]
        if merchant_id:
            clauses.append("merchant_id = %s")
            params.append(merchant_id)
        if processing_status:
            clauses.append("processing_status = %s")
            params.append(processing_status)
        if source:
            clauses.append("source = %s")
            params.append(source)
        with self._cursor() as cur:
            cur.execute(
                f"SELECT * FROM source_events WHERE {' AND '.join(clauses)} ORDER BY seq DESC LIMIT %s",
                params + [limit],
            )
            return [_event(r) for r in cur.fetchall()]

    def list_events_for_reference(self, merchant_id: str, reference_kind: str, reference_id: str) -> List[SourceEvent]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT * FROM source_events
                WHERE merchant_id = %s AND reference_kind = %s AND reference_id = %s
                ORDER BY occurred_at, event_id
                """,
                (merchant_id, reference_kind, reference_id),
            )
            return [_event(r) for r in cur.fetchall()]

    def mark_source_event(
        self, event_id: str, processing_status: str, failure_reason: Optional[str], processed_at: str
    ) -> None:
        with self._cursor() as cur:
            cur.execute(
                "UPDATE source_events SET processing_status = %s, failure_reason = %s, processed_at = %s "
                "WHERE event_id = %s",
                (processing_status, failure_reason, _ts(processed_at), event_id),
            )
            if cur.rowcount == 0:
                raise KeyError(f"Unknown source event {event_id}.")

    # ── obligations ──────────────────────────────────────────────────────
    def lock_obligation(
        self, merchant_id: str, reference_kind: str, reference_id: str, leak_type: str, now_iso: str
    ) -> RevenueObligation:
        if not self._in_atomic():
            raise RuntimeError("lock_obligation must be called inside atomic().")
        from backend.app.domain.events import obligation_internal_id

        obligation_id = obligation_internal_id(merchant_id, reference_kind, reference_id)
        with self._cursor() as cur:
            # Serialize everything about one object FIRST, by an advisory lock held to the end of the unit.
            # Without it, two first events for a brand-new object insert the same row at once, and because the
            # row has two unique indexes (the key and the natural reference) PostgreSQL can deadlock the
            # speculative inserts against each other. With it exactly one inserter exists at a time; the unique
            # constraints remain as the backstop.
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"revora:obligation:{obligation_id}",)
            )
            cur.execute(
                """
                INSERT INTO revenue_obligations (obligation_id, merchant_id, reference_kind, reference_id,
                                                 leak_type, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (obligation_id, merchant_id, reference_kind, reference_id, leak_type, _ts(now_iso)),
            )
            cur.execute("SELECT * FROM revenue_obligations WHERE obligation_id = %s FOR UPDATE", (obligation_id,))
            return _obligation(cur.fetchone())

    def save_obligation(self, obligation: RevenueObligation) -> None:
        with self._cursor() as cur:
            cur.execute(
                """
                UPDATE revenue_obligations SET
                    status = %s, customer_ref = %s, amount_minor = %s, currency = %s, failure_count = %s,
                    reported_attempt_number = %s, consecutive_failures = %s, latest_failure_code = %s,
                    payment_method = %s, first_at_risk_at = %s, last_at_risk_at = %s, due_at = %s,
                    settled_at = %s, event_count = %s, last_event_at = %s, run_id = %s, case_id = %s,
                    settled_while_frozen = %s, last_evaluated_at = %s
                WHERE obligation_id = %s
                """,
                (
                    obligation.status, obligation.customer_ref, obligation.amount_minor, obligation.currency,
                    obligation.failure_count, obligation.reported_attempt_number, obligation.consecutive_failures,
                    obligation.latest_failure_code, obligation.payment_method, _ts(obligation.first_at_risk_at),
                    _ts(obligation.last_at_risk_at), _ts(obligation.due_at), _ts(obligation.settled_at),
                    obligation.event_count, _ts(obligation.last_event_at), obligation.run_id, obligation.case_id,
                    obligation.settled_while_frozen, _ts(obligation.last_evaluated_at), obligation.obligation_id,
                ),
            )
            if cur.rowcount == 0:
                raise KeyError(f"Unknown obligation {obligation.obligation_id}.")

    def get_obligation(self, obligation_id: str) -> Optional[RevenueObligation]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM revenue_obligations WHERE obligation_id = %s", (obligation_id,))
            row = cur.fetchone()
            return _obligation(row) if row else None

    def list_obligations(
        self, merchant_id: Optional[str] = None, status: Optional[str] = None, limit: int = 100
    ) -> List[RevenueObligation]:
        clauses, params = ["TRUE"], []  # type: List[str], List[Any]
        if merchant_id:
            clauses.append("merchant_id = %s")
            params.append(merchant_id)
        if status:
            clauses.append("status = %s")
            params.append(status)
        with self._cursor() as cur:
            cur.execute(
                f"SELECT * FROM revenue_obligations WHERE {' AND '.join(clauses)} ORDER BY created_at, obligation_id LIMIT %s",
                params + [limit],
            )
            return [_obligation(r) for r in cur.fetchall()]

    # ── maintenance ──────────────────────────────────────────────────────
    def clear(self):
        if not self._allow_destructive:
            raise RuntimeError(
                "PostgresRepository.clear() deletes every record and is disabled unless the repository was "
                "created with allow_destructive=True (tests only)."
            )
        tables = (
            "source_event_raw, source_events, revenue_obligations, audit_events, idempotency_records, "
            "interventions, execution_attempts, decisions, recovery_cases, transactions, scan_runs"
        )
        with self._cursor() as cur:
            cur.execute(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
        self.scanned = self.analyzed = self.recovered = False
