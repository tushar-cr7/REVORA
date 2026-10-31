"""
Deterministic fixtures for the recovery-lifecycle tests.

Safety properties are asserted against hand-built transactions, a scripted provider
and a fake clock — never against the random synthetic generator or SimulationProvider's
dice — so a pass or a failure means the same thing on every run.
"""
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Optional

import numpy as np

from backend.app.domain.models import (
    Action,
    Intervention,
    RecoveryCase,
    ScanRun,
    Transaction,
    new_id,
    utc_now_iso,
)
from backend.app.domain.workspaces import new_workspace
from backend.app.integrations.base import PaymentExecutionProvider
from backend.app.repositories.in_memory import InMemoryRepository
from backend.app.services.audit_service import AuditService
from backend.app.services.recovery_service import RecoveryService, scan_fingerprint


# The workspace every fixture transaction belongs to (make_tx's default merchant). Tests name it explicitly
# wherever they read or execute, because the repositories and services have no implicit workspace.
TEST_WS = "merch_test"


class FakeClock:
    """Controllable UTC clock, injected into the execution layer."""

    def __init__(self, start: Optional[datetime] = None):
        self.now = start or datetime(2026, 10, 14, 9, 0, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, hours: float = 0.0, minutes: float = 0.0) -> None:
        self.now += timedelta(hours=hours, minutes=minutes)


class FixedProbModel:
    """Stands in for the XGBoost model so the proposed action is the same every run."""

    def __init__(self, prob: float = 0.9):
        self.prob = prob

    def predict_proba(self, df) -> np.ndarray:
        return np.full(len(df), self.prob, dtype=float)

    def get_metadata(self) -> Dict[str, str]:
        return {"model": "fixed-test-model"}


class ScriptedProvider(PaymentExecutionProvider):
    """
    A provider whose outcomes the test dictates. `outcomes` is consumed one entry per
    recovery-class call: "recovered", "no_recovery" or "raise" (the last repeats).
    Optional `entered` / `gate` events let a test hold a call in flight.
    """

    def __init__(
        self,
        outcomes: Iterable[str] = ("recovered",),
        gate: Optional[threading.Event] = None,
        entered: Optional[threading.Event] = None,
    ):
        self._outcomes: List[str] = list(outcomes)
        self._gate = gate
        self._entered = entered
        self._lock = threading.Lock()
        self.calls: List[Dict] = []

    @property
    def name(self) -> str:
        return "ScriptedProvider"

    @property
    def execution_mode(self) -> str:
        return "simulation"

    def _next_outcome(self) -> str:
        with self._lock:
            return self._outcomes.pop(0) if len(self._outcomes) > 1 else self._outcomes[0]

    def execute(self, leak, decision, idempotency_key=None) -> Intervention:
        with self._lock:
            self.calls.append({"transaction_id": leak["transaction_id"], "action": decision["final_action"]})
        if self._entered is not None:
            self._entered.set()
        if self._gate is not None:
            assert self._gate.wait(timeout=10), "test gate was never released"

        action = decision["final_action"]
        amount = float(leak["amount"])
        if action == Action.SUPPRESS.value:
            status, recovered = "suppressed", False
        elif action == Action.ESCALATE.value:
            status, recovered = "escalated_to_merchant", False
        else:
            outcome = self._next_outcome()
            if outcome == "raise":
                raise RuntimeError("scripted provider outage")
            status = "recovered" if outcome == "recovered" else "attempted_no_recovery"
            recovered = outcome == "recovered"
        return Intervention(
            intervention_id=new_id("itv", 8),
            decision_id=decision["decision_id"],
            leak_id=leak["leak_id"],
            transaction_id=leak["transaction_id"],
            customer_id=leak["customer_id"],
            merchant_id=leak["merchant_id"],
            amount=amount,
            ai_proposed_action=decision["ai_proposed_action"],
            policy_allowed=decision["policy_allowed"],
            policy_reason=decision["policy_reason"],
            final_action=action,
            provider=self.name,
            status=status,
            recovered=recovered,
            recovered_amount=round(amount, 2) if recovered else 0.0,
            timestamp=utc_now_iso(),
            execution_probability_used=1.0,
            idempotency_key=idempotency_key,
            execution_mode=self.execution_mode,
        )


def make_tx(
    n: int,
    leak_type: str = "failed_payment",
    amount: float = 5000.0,
    customer_id: Optional[str] = None,
    retries_so_far: Optional[int] = 0,
    hours_since_event: Optional[int] = 48,
    merchant_id: str = "merch_test",
    **overrides,
) -> Transaction:
    prefix = {"failed_payment": "fp", "abandoned_checkout": "ac", "failed_subscription": "fs", "overdue_invoice": "oi"}[leak_type]
    leak_id = f"{prefix}_{n:06d}"
    fields = dict(
        transaction_id=f"tx_{leak_id}",
        leak_id=leak_id,
        merchant_id=merchant_id,
        customer_id=customer_id or f"cust_{n:05d}",
        amount=amount,
        leak_type=leak_type,
        payment_method="card",
        failure_code="card_declined",
        prior_successful_payments=5,
        ltv_bucket="medium",
        retries_so_far=retries_so_far,
        hours_since_event=hours_since_event,
        age_days=0,
        event_time="2026-10-12T09:00:00+00:00",
        merchant_segment="saas",
    )
    fields.update(overrides)
    return Transaction(**fields)


def build_service(
    transactions: List[Transaction],
    provider: Optional[PaymentExecutionProvider] = None,
    clock: Optional[FakeClock] = None,
    prob: float = 0.9,
    seed: int = 1,
    analyze: bool = True,
    repo: Optional[InMemoryRepository] = None,
) -> RecoveryService:
    """A service over a repository holding exactly `transactions` as the active scan run."""
    repo = repo or InMemoryRepository()
    service = RecoveryService(
        repo=repo,
        audit_service=AuditService(repo=repo),
        provider=provider or ScriptedProvider(),
        clock=clock or FakeClock(),
    )
    service.model = FixedProbModel(prob)
    register_run(service, transactions, seed=seed)
    if analyze:
        service.analyze_revenue(transactions[0].merchant_id)
    return service


def ensure_demo_workspace(repo, workspace_id: str) -> None:
    """Register `workspace_id` as a demo workspace if it is not one yet — explicitly, as the application never does."""
    if repo.get_workspace(workspace_id) is None:
        repo.create_workspace(new_workspace(workspace_id, "demo", f"Test workspace {workspace_id}"))


def register_run(service: RecoveryService, transactions: List[Transaction], seed: int = 1) -> ScanRun:
    merchant_id = transactions[0].merchant_id
    ensure_demo_workspace(service.repo, merchant_id)   # a synthetic run needs a registered demo workspace
    run_id = new_id("run", 8)
    now = utc_now_iso()
    for tx in transactions:
        tx.run_id = run_id
    cases = [
        RecoveryCase(
            case_id=f"case_{run_id.split('_', 1)[1]}_{tx.leak_id}",
            run_id=run_id,
            merchant_id=tx.merchant_id,
            transaction_id=tx.transaction_id,
            leak_id=tx.leak_id,
            customer_id=tx.customer_id,
            leak_type=tx.leak_type,
            amount=tx.amount,
        )
        for tx in transactions
    ]
    run = ScanRun(
        run_id=run_id,
        merchant_id=merchant_id,
        source_fingerprint=scan_fingerprint(merchant_id, len(transactions), seed),
        n_total=len(transactions),
        seed=seed,
        created_at=now,
        last_scanned_at=now,
        transaction_count=len(transactions),
        total_at_risk=round(sum(t.amount for t in transactions), 2),
    )
    run, _ = service.repo.register_scan_run(run, transactions, cases)
    return run


def case_of(service: RecoveryService, tx_id: str, workspace_id: str = TEST_WS) -> RecoveryCase:
    return service.repo.get_case_for_transaction(tx_id, workspace_id=workspace_id)


def ledger(service: RecoveryService, tx_id: str, workspace_id: str = TEST_WS):
    return service.repo.list_attempts(case_id=case_of(service, tx_id, workspace_id).case_id, workspace_id=workspace_id)
