from collections import defaultdict
from datetime import datetime, timedelta
import hashlib
import os
from typing import Callable, Dict, Any, List, Optional
import pandas as pd
from backend.app.config import settings
from backend.app.domain.models import (
    COUNTED_ATTEMPT_STATUSES,
    CUSTOMER_CONTACT_ACTIONS,
    FROZEN_CASE_STATES,
    RECOVERY_ACTIONS,
    AttemptStatus,
    AuditEventType,
    CaseState,
    Decision,
    RecoveryCase,
    ScanRun,
    Transaction,
    new_id,
    utc_now_iso,
)
from backend.app.domain.policy import DEFAULT_POLICY, POLICY_VERSION, PolicyLimits, evaluate_policy_strict
from backend.app.domain.workspaces import require_demo_workspace
from backend.app.intelligence.data_gen import generate_dataset
from backend.app.intelligence.model import RecoveryModel
from backend.app.intelligence.decision_engine import decide_intervention
from backend.app.integrations.base import PaymentExecutionProvider
from backend.app.integrations.simulation import SimulationProvider
from backend.app.repositories.base import BaseRepository
from backend.app.services.audit_service import AuditService
from backend.app.services.execution_service import (
    CONTACT_WINDOW,
    CaseConflict,
    ExecutionOutcome,
    ExecutionService,
    IdempotencyInProgress,
    PolicyDenied,
    ProviderFailure,
    ReplayedExecutionError,
    StaleRun,
)


# Cases analysed per unit of work. A unit holds row locks on its cases, so it stays small enough that
# an execution request waits well under a second; large enough that round trips are amortised.
ANALYZE_CHUNK = 200


def _safe_int(val, default: int = 0) -> int:
    if val is None or pd.isna(val):
        return default
    return int(val)


def _opt_int(val) -> Optional[int]:
    """Like _safe_int, but a missing value stays None instead of becoming 0 (it must fail closed later)."""
    if val is None or pd.isna(val):
        return None
    return int(val)


def _safe_bool(val, default: bool = False) -> bool:
    if val is None or pd.isna(val):
        return default
    return bool(val)


def scan_fingerprint(merchant_id: str, n_total: int, seed: int) -> str:
    """
    Identity of a scan's source data. The synthetic generator is a pure function of
    (merchant, size, seed), so equal fingerprints mean equal data: repeating such a
    scan re-activates the existing run rather than creating a look-alike with fresh state.
    """
    return hashlib.sha256(f"{merchant_id}|{n_total}|{seed}".encode("utf-8")).hexdigest()[:16]


class RecoveryService:
    def __init__(
        self,
        repo: BaseRepository,
        audit_service: AuditService,
        provider: Optional[PaymentExecutionProvider] = None,
        model_path: Optional[str] = None,
        policy: Optional[PolicyLimits] = None,
        clock: Optional[Callable[[], datetime]] = None,
        reservation_timeout: Optional[timedelta] = None,
    ):
        self.repo = repo
        self.audit_service = audit_service
        self.provider = provider or SimulationProvider()
        self.policy = policy or DEFAULT_POLICY
        self.model_path = model_path or settings.MODEL_PATH
        self.model: Optional[RecoveryModel] = None
        # One safe execution pathway, shared by individual and bulk execution.
        self.executor = ExecutionService(
            repo=repo,
            audit_service=audit_service,
            provider_source=lambda: self.provider,
            policy_source=lambda: self.policy,
            decide_case=self._decide_single_case,
            clock=clock,
            reservation_timeout=reservation_timeout,
        )

    def _ensure_model(self) -> RecoveryModel:
        if self.model is None:
            if os.path.exists(self.model_path):
                try:
                    self.model = RecoveryModel.load(self.model_path)
                except Exception:
                    df, _ = generate_dataset()
                    m = RecoveryModel()
                    m.fit(df)
                    m.save(self.model_path)
                    self.model = m
            else:
                df, _ = generate_dataset()
                m = RecoveryModel()
                m.fit(df)
                m.save(self.model_path)
                self.model = m
        return self.model

    # ── scan ─────────────────────────────────────────────────────────────
    def scan_revenue(self, n_total: int = 10000, seed: int = 42, merchant_id: str = "merch_001") -> Dict[str, Any]:
        """
        Ingest a dataset as a scan run.

        * New source data (merchant, size, seed not seen before) creates a new run with
          fresh cases and makes it the active run. The previously active run is marked
          `superseded` — never deleted — so its decisions, attempts, interventions and
          audit events keep pointing at the transactions they were made for.
        * Identical source data re-activates the existing run with all of its state, so
          repeating a scan (the dashboard does, on every page load) cannot reset history
          or reopen cases that already ran.
        * The data is synthetic, so `merchant_id` must name a registered DEMO workspace. An unknown
          workspace is refused (UnknownWorkspace), never created; a merchant workspace is refused
          (SyntheticDataNotAllowed). Both before anything is generated or stored.
        """
        require_demo_workspace(self.repo.get_workspace(merchant_id), merchant_id)
        fingerprint = scan_fingerprint(merchant_id, n_total, seed)
        previous = self.repo.get_active_run()

        existing = self.repo.find_run_by_fingerprint(fingerprint)
        if existing is not None:
            run = self.repo.activate_run(existing.run_id)
            return self._scan_summary(run, reused=True, previous=previous)

        df, _ = generate_dataset(n_total=n_total, seed=seed, merchant_id=merchant_id)
        run_id = new_id("run", 8)

        transactions: List[Transaction] = []
        for _, row in df.iterrows():
            d = row.to_dict()
            is_subscription = d["leak_type"] == "failed_subscription"
            tx = Transaction(
                transaction_id=d["transaction_id"],
                leak_id=d["leak_id"],
                merchant_id=d.get("merchant_id", merchant_id),
                customer_id=d["customer_id"],
                amount=float(d["amount"]),
                leak_type=d["leak_type"],
                payment_method=d["payment_method"],
                failure_code=d["failure_code"],
                prior_successful_payments=_safe_int(d.get("prior_successful_payments")),
                ltv_bucket=d["ltv_bucket"],
                retries_so_far=_opt_int(d.get("retries_so_far")),
                hours_since_event=_opt_int(d.get("hours_since_event")),
                age_days=_opt_int(d.get("age_days")) if d["leak_type"] == "overdue_invoice" else _safe_int(d.get("age_days")),
                event_time=d["event_time"],
                merchant_segment=d["merchant_segment"],
                payment_id=None if pd.isna(d.get("payment_id")) else str(d.get("payment_id")),
                visit_count=_safe_int(d.get("visit_count")),
                reached_payment_page=_safe_bool(d.get("reached_payment_page")),
                consecutive_failures=_opt_int(d.get("consecutive_failures")) if is_subscription else _safe_int(d.get("consecutive_failures")),
                subscription_age_days=_safe_int(d.get("subscription_age_days")),
                run_id=run_id,
            )
            transactions.append(tx)

        suffix = run_id.split("_", 1)[1]
        cases = [
            RecoveryCase(
                case_id=f"case_{suffix}_{tx.leak_id}",
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
        now = utc_now_iso()
        run = ScanRun(
            run_id=run_id,
            merchant_id=merchant_id,
            source_fingerprint=fingerprint,
            n_total=n_total,
            seed=seed,
            created_at=now,
            last_scanned_at=now,
            transaction_count=len(transactions),
            total_at_risk=round(sum(tx.amount for tx in transactions), 2),
        )
        run, created = self.repo.register_scan_run(run, transactions, cases)
        return self._scan_summary(run, reused=not created, previous=previous)

    def _scan_summary(self, run: ScanRun, reused: bool, previous: Optional[ScanRun]) -> Dict[str, Any]:
        transactions = self.repo.get_all_transactions(run.run_id)
        by_type: Dict[str, Dict[str, float]] = defaultdict(lambda: {"sum": 0.0, "count": 0})
        for tx in transactions:
            by_type[tx.leak_type]["sum"] += tx.amount
            by_type[tx.leak_type]["count"] += 1
        breakdown = [
            {"leak_type": lt, "amount_at_risk": round(v["sum"], 2), "count": int(v["count"])}
            for lt, v in sorted(by_type.items())
        ]
        return {
            "total_transactions_scanned": run.transaction_count,
            "total_at_risk": round(sum(tx.amount for tx in transactions), 2),
            "breakdown": breakdown,
            "run_id": run.run_id,
            "reused_existing_run": reused,
            "superseded_run_id": previous.run_id if previous is not None and previous.run_id != run.run_id else None,
        }

    # ── analyze ──────────────────────────────────────────────────────────
    @staticmethod
    def _same_decision(a: Decision, b: Decision) -> bool:
        return (
            a.ai_proposed_action, a.final_action, a.policy_allowed, a.policy_reason,
            a.ai_proposed_ev, a.ai_proposed_probability,
        ) == (
            b.ai_proposed_action, b.final_action, b.policy_allowed, b.policy_reason,
            b.ai_proposed_ev, b.ai_proposed_probability,
        )

    def _record_decision(self, case: RecoveryCase, decision: Decision, reason: str, limits: PolicyLimits) -> None:
        """
        Persist a decision as the case's current one, move the case, audit it. Call inside atomic().
        The limits the verdict was computed under are stored with it: policy can change later, and
        the record must still show which numbers allowed or blocked the action.
        """
        now = utc_now_iso()
        decision.run_id = case.run_id
        decision.case_id = case.case_id
        decision.policy_version = POLICY_VERSION
        decision.policy_limits = limits.to_dict()
        self.repo.save_decision(decision)

        case.decision_id = decision.decision_id
        case.authorized_action = decision.final_action
        case.policy_version = POLICY_VERSION
        case.authorization = {
            "source": "decision",
            "allowed": decision.policy_allowed,
            "reason": decision.policy_reason,
            "final_action": decision.final_action,
            "ai_proposed_action": decision.ai_proposed_action,
            "policy_version": POLICY_VERSION,
            "evaluated_at": now,
        }
        case.blocked_reason = None if decision.policy_allowed else decision.policy_reason
        case.safe_alternative = None if decision.policy_allowed else decision.final_action
        desired = CaseState.AUTHORIZED if decision.policy_allowed else CaseState.BLOCKED
        if case.state != desired:
            case.transition(desired, reason, at=now)
        else:
            case.updated_at = now
        self.repo.save_case(case)

        if decision.policy_allowed:
            self.audit_service.log_event(
                merchant_id=case.merchant_id,
                transaction_id=case.transaction_id,
                leak_id=case.leak_id,
                event_type=AuditEventType.DECISION_CREATED,
                action=decision.final_action,
                policy_result={"allowed": True, "reason": decision.policy_reason, "final_action": decision.final_action},
                decision_id=decision.decision_id,
                run_id=case.run_id,
                case_id=case.case_id,
            )
        else:
            self.audit_service.log_event(
                merchant_id=case.merchant_id,
                transaction_id=case.transaction_id,
                leak_id=case.leak_id,
                event_type=AuditEventType.ACTION_BLOCKED,
                action=decision.ai_proposed_action,
                policy_result={"allowed": False, "reason": decision.policy_reason, "final_action": decision.final_action},
                decision_id=decision.decision_id,
                run_id=case.run_id,
                case_id=case.case_id,
            )

    def _decide_single_case(self, case: RecoveryCase) -> RecoveryCase:
        """Decide one not-yet-analyzed case on demand (model inference runs outside the lock)."""
        tx = self.repo.get_transaction_by_id(case.transaction_id, case.run_id)
        prob = tx.model_recovery_prob
        if prob is None:
            prob = float(self._ensure_model().predict_proba(pd.DataFrame([tx.to_dict()]))[0])
        with self.repo.atomic():
            live = self.repo.get_case(case.case_id)
            if live.decision_id:  # another request decided it first
                return live
            tx.model_recovery_prob = prob
            self.repo.update_transaction_analysis(live.run_id, tx.transaction_id, prob, None)
            facts = self.executor.policy_facts(tx, live)
            decision = decide_intervention(facts, prob, self.policy, evaluator=evaluate_policy_strict)
            self._record_decision(live, decision, "decision created on demand at execution request", self.policy)
            return live

    def analyze_revenue(self, policy: Optional[PolicyLimits] = None) -> Dict[str, Any]:
        """
        Score and decide every case in the active run. Idempotent: a case whose outcome is
        already recorded keeps its decision, and a case whose fresh decision equals the
        current one is left alone (no new decision id, no duplicate audit event). Decisions
        are computed from the attempt ledger, not from the ingested counters alone.
        """
        policy = policy or self.policy
        run = self.repo.get_active_run()
        transactions = self.repo.get_all_transactions(run.run_id) if run else []
        if not transactions:
            raise ValueError("Call /api/scan first.")

        model = self._ensure_model()
        rows = [tx.to_dict() for tx in transactions]
        df = pd.DataFrame(rows)
        probs = model.predict_proba(df)

        planned_contacts: Dict[str, int] = defaultdict(int)
        blocked_count = 0
        action_counts: Dict[str, int] = defaultdict(int)
        decisions: Dict[str, Decision] = {}

        # Read once, in bulk, before taking any lock: the run's current decisions and attempt ledger, and the
        # contact attempts inside the trailing window (any run). They are hints that save thousands of round
        # trips; every case is re-checked under its row lock below, and execution never relies on them.
        decisions_by_id = {d.decision_id: d for d in self.repo.get_all_decisions(run.run_id)}
        ledger_by_case: Dict[str, list] = defaultdict(list)
        for attempt in self.repo.list_attempts(run_id=run.run_id):
            ledger_by_case[attempt.case_id].append(attempt)
        contact_attempts: Dict[tuple, list] = defaultdict(list)
        window_start = (self.executor.clock() - CONTACT_WINDOW).isoformat()
        for attempt in self.repo.list_attempts_since(window_start):
            if attempt.status in COUNTED_ATTEMPT_STATUSES and attempt.final_action in CUSTOMER_CONTACT_ACTIONS:
                contact_attempts[(attempt.merchant_id, attempt.customer_id)].append(attempt)

        for start in range(0, len(transactions), ANALYZE_CHUNK):
            chunk = transactions[start:start + ANALYZE_CHUNK]
            with self.repo.atomic():  # one unit of work (and one lock acquisition) per chunk of cases
                locked = {c.transaction_id: c for c in self.repo.lock_cases(run.run_id, [t.transaction_id for t in chunk])}
                score_rows = []
                for offset, tx in enumerate(chunk):
                    prob = float(probs[start + offset])
                    tx.model_recovery_prob = prob
                    case = locked[tx.transaction_id]
                    current = None
                    if case.decision_id:
                        current = decisions_by_id.get(case.decision_id) or self.repo.get_decision(case.decision_id)
                    if current is not None and case.state in FROZEN_CASE_STATES:
                        decision = current  # outcome (or an in-flight attempt) already recorded
                        score_rows.append((tx.transaction_id, prob, None))
                    else:
                        ledger = ledger_by_case.get(case.case_id, [])
                        if sum(1 for a in ledger if a.status in COUNTED_ATTEMPT_STATUSES) != case.attempt_count:
                            ledger = self.repo.list_attempts(case_id=case.case_id)  # an attempt landed after the bulk read
                        facts = self.executor.policy_facts(
                            tx, case,
                            planned_contacts=planned_contacts[tx.customer_id],
                            ledger=ledger,
                            customer_attempts=contact_attempts.get((case.merchant_id, case.customer_id), []),
                        )
                        tx.contacts_today = facts["contacts_today"]  # decision-time view; policy re-reads the ledger at execution
                        score_rows.append((tx.transaction_id, prob, tx.contacts_today))
                        fresh = decide_intervention(facts, prob, policy, evaluator=evaluate_policy_strict)
                        if current is not None and self._same_decision(current, fresh):
                            decision = current
                        else:
                            decision = fresh
                            self._record_decision(case, decision, "decision refreshed by analysis", policy)
                        if decision.final_action in CUSTOMER_CONTACT_ACTIONS:
                            planned_contacts[tx.customer_id] += 1

                    decisions[tx.transaction_id] = decision
                    if not decision.policy_allowed:
                        blocked_count += 1
                    action_counts[decision.final_action] += 1
                self.repo.update_transaction_analyses(run.run_id, score_rows)

        self.repo.analyzed = True

        total_at_risk = round(sum(tx.amount for tx in transactions), 2)
        realistically_recoverable = round(
            sum(
                tx.amount * (tx.model_recovery_prob or 0.0)
                for tx in transactions
                if decisions[tx.transaction_id].final_action != "suppress"
            ),
            2,
        )

        root_causes = df.groupby("leak_type")["amount"].sum().sort_values(ascending=False)
        top_cause = root_causes.index[0]
        explanation = (
            f"₹{root_causes.iloc[0]/1e5:.1f}L is primarily caused by {top_cause.replace('_', ' ')}. "
            f"Customers with more prior successful payments and fewer existing retries show materially "
            f"higher recovery probability in the model."
        )

        avg_prob = float(probs.mean())

        return {
            "total_at_risk": total_at_risk,
            "realistically_recoverable": realistically_recoverable,
            "explanation": explanation,
            "proposed_action_counts": dict(action_counts),
            "policy_blocked_count": blocked_count,
            "avg_recovery_probability": round(avg_prob, 4),
            "model_metadata": model.get_metadata(),
            "run_id": run.run_id,
        }

    # ── reads ────────────────────────────────────────────────────────────
    def get_transactions(self, limit: int = 100, leak_type: Optional[str] = None) -> List[Dict[str, Any]]:
        transactions = self.repo.get_all_transactions()
        if leak_type:
            transactions = [tx for tx in transactions if tx.leak_type == leak_type]
        return [tx.to_dict() for tx in transactions[:limit]]

    def get_transaction_by_id(self, tx_id: str) -> Optional[Dict[str, Any]]:
        tx = self.repo.get_transaction_by_id(tx_id)
        return tx.to_dict() if tx else None

    def get_opportunities(self, limit: int = 20) -> List[Dict[str, Any]]:
        transactions = self.repo.get_all_transactions()
        # Two bulk reads rather than a case and a decision lookup per transaction.
        cases_by_tx = {c.transaction_id: c for c in self.repo.list_cases()}
        decisions_by_id = {d.decision_id: d for d in self.repo.get_all_decisions()}
        results = []
        for tx in transactions:
            case = cases_by_tx.get(tx.transaction_id)
            decision = decisions_by_id.get(case.decision_id) if case and case.decision_id else None
            if decision and decision.final_action not in ("suppress",):
                prob = tx.model_recovery_prob or 0.0
                expected_recovery = round(tx.amount * prob, 2)
                results.append({
                    "transaction_id": tx.transaction_id,
                    "leak_id": tx.leak_id,
                    "customer_id": tx.customer_id,
                    "leak_type": tx.leak_type,
                    "amount": tx.amount,
                    "recovery_probability": round(prob, 4),
                    "expected_recovery": expected_recovery,
                    "recommended_action": decision.final_action,
                    "policy_allowed": decision.policy_allowed,
                    "policy_reason": decision.policy_reason,
                    "run_id": tx.run_id,
                    "case_id": case.case_id,
                    "case_state": case.state.value,
                })
        results.sort(key=lambda x: x["expected_recovery"], reverse=True)
        return results[:limit]

    def get_decision_by_id(self, key: str) -> Optional[Dict[str, Any]]:
        decision = self.repo.get_decision(key)
        return decision.to_dict() if decision else None

    def get_interventions(self, limit: int = 100, run_id: Optional[str] = None) -> List[Dict[str, Any]]:
        interventions = self.repo.get_all_interventions(run_id)
        return [i.to_dict() for i in interventions[:limit]]

    def get_escalations(self, limit: int = 50) -> List[Dict[str, Any]]:
        escalations = self.repo.get_escalations()
        return [e.to_dict() for e in escalations[:limit]]

    def get_runs(self) -> List[Dict[str, Any]]:
        return [r.to_dict() for r in self.repo.list_runs()]

    def get_cases(self, limit: int = 100, state: Optional[str] = None, run_id: Optional[str] = None) -> List[Dict[str, Any]]:
        cases = self.repo.list_cases(run_id)
        if state:
            cases = [c for c in cases if c.state.value == state]
        return [c.to_dict() for c in cases[:limit]]

    def get_case_detail(self, case_id: str) -> Optional[Dict[str, Any]]:
        case = self.repo.get_case(case_id)
        if case is None:
            return None
        detail = case.to_dict()
        detail["attempts"] = [a.to_dict() for a in self.repo.list_attempts(case_id=case.case_id)]
        return detail

    # ── ledger-derived totals ────────────────────────────────────────────
    def _ledger_totals(self) -> Dict[str, Any]:
        """
        Recovery figures for the active run, derived from the case and attempt ledgers:
        one recovered amount per recovered case, regardless of how many requests,
        replays or attempts touched it.
        """
        run = self.repo.get_active_run()
        transactions = self.repo.get_all_transactions()
        cases = self.repo.list_cases()
        attempts = self.repo.list_attempts()

        ran = [a for a in attempts if a.status in (AttemptStatus.COMPLETED, AttemptStatus.FAILED)]
        recovery_attempts = [a for a in ran if a.final_action in RECOVERY_ACTIONS]
        recovered_cases = [c for c in cases if c.state == CaseState.RECOVERED]
        attempted_case_ids = {a.case_id for a in recovery_attempts}

        actions: Dict[str, int] = {a: 0 for a in ("retry", "payment_link", "reminder", "escalate", "suppress")}
        for a in ran:
            if a.status == AttemptStatus.COMPLETED and a.final_action in actions:
                actions[a.final_action] += 1

        # An attempt must carry an allowed execution-time authorization for the action it ran.
        violations = 0
        for a in attempts:
            if a.status == AttemptStatus.DENIED:
                continue
            auth = a.authorization or {}
            if not (auth.get("allowed") is True and auth.get("final_action") == a.final_action):
                violations += 1

        return {
            "run_id": run.run_id if run else None,
            "total_at_risk": round(sum(tx.amount for tx in transactions), 2),
            "total_recovered": round(sum(c.recovered_amount for c in recovered_cases), 2),
            "recovered_count": len(recovered_cases),
            "attempted_count": len(recovery_attempts),
            "attempted_amount": round(sum(c.amount for c in cases if c.case_id in attempted_case_ids), 2),
            "actions_executed": actions,
            "policy_violations": violations,
        }

    def get_analytics_summary(self) -> Dict[str, Any]:
        t = self._ledger_totals()
        decisions = self.repo.get_all_decisions()
        blocked_count = sum(1 for d in decisions if not d.policy_allowed)
        escalation_count = len(self.repo.get_escalations())
        total_at_risk, total_recovered = t["total_at_risk"], t["total_recovered"]
        recovered_count, attempted_count = t["recovered_count"], t["attempted_count"]

        return {
            "total_at_risk": total_at_risk,
            "total_recovered": total_recovered,
            "recovery_rate_pct": round(100 * total_recovered / total_at_risk, 2) if total_at_risk else 0,
            "recovered_count": recovered_count,
            "attempted_count": attempted_count,
            "intervention_success_rate_pct": round(100 * recovered_count / attempted_count, 2) if attempted_count else 0,
            "policy_blocked_count": blocked_count,
            "escalation_count": escalation_count,
            "attempted_amount": t["attempted_amount"],
            "run_id": t["run_id"],
            "execution_mode": self.provider.execution_mode,
        }

    # ── execution ────────────────────────────────────────────────────────
    def execute_case(
        self, target_id: str, idempotency_key: Optional[str] = None, expected_action: Optional[str] = None
    ) -> ExecutionOutcome:
        return self.executor.execute(target_id, idempotency_key, expected_action)

    def execute_individual_intervention(
        self, target_id: str, idempotency_key: Optional[str] = None, expected_action: Optional[str] = None
    ) -> Dict[str, Any]:
        return self.executor.execute(target_id, idempotency_key, expected_action).intervention

    def recover_revenue(self) -> Dict[str, Any]:
        """
        Bulk recovery over the active run, through the same `ExecutionService.execute`
        as a single request. Eligible = never attempted and currently authorized (or
        blocked, whose executable action is the policy-sanctioned alternative). Cases
        that already ran, are in flight, or have no decision are skipped, so calling it
        twice executes nothing the second time. A failed attempt is never auto-retried
        in bulk: that takes an explicit single request.
        """
        run = self.repo.get_active_run()
        if run is None or not self.repo.get_all_transactions(run.run_id):
            raise ValueError("Call /api/analyze first.")

        tally = {k: 0 for k in (
            "executed", "recovered", "not_recovered", "suppressed", "escalated", "failed", "blocked", "skipped",
        )}
        for case in self.repo.list_cases(run.run_id):
            eligible = (
                case.state in (CaseState.AUTHORIZED, CaseState.BLOCKED)
                and case.attempt_count == 0
                and case.decision_id is not None
            )
            if not eligible:
                tally["skipped"] += 1
                continue
            # Deterministic per (case, decision): a repeated bulk call replays a stored
            # denial instead of writing a new one.
            key = f"bulk:{case.case_id}:{case.decision_id}"
            try:
                outcome = self.executor.execute(case.case_id, key)
            except (PolicyDenied, ReplayedExecutionError) as e:
                tally["blocked" if e.code == PolicyDenied.code else "failed"] += 1
                continue
            except ProviderFailure:
                tally["failed"] += 1
                continue
            except (CaseConflict, IdempotencyInProgress, StaleRun):
                tally["skipped"] += 1
                continue
            if outcome.replayed:
                tally["skipped"] += 1
                continue
            tally["executed"] += 1
            status = outcome.intervention["status"]
            key_for = {
                "recovered": "recovered",
                "attempted_no_recovery": "not_recovered",
                "suppressed": "suppressed",
                "escalated_to_merchant": "escalated",
            }[status]
            tally[key_for] += 1

        self.repo.recovered = True

        t = self._ledger_totals()
        total_at_risk, total_recovered = t["total_at_risk"], t["total_recovered"]
        recovered_count, attempted_count = t["recovered_count"], t["attempted_count"]
        return {
            "total_at_risk": total_at_risk,
            "total_recovered": total_recovered,
            "recovery_rate_pct": round(100 * total_recovered / total_at_risk, 2) if total_at_risk else 0,
            "actions_executed": t["actions_executed"],
            "recovered_count": recovered_count,
            "attempted_count": attempted_count,
            "avg_recovery_value": round(total_recovered / recovered_count, 2) if recovered_count else 0,
            "intervention_success_rate_pct": round(100 * recovered_count / attempted_count, 2) if attempted_count else 0,
            "policy_violations": t["policy_violations"],
            "run_id": run.run_id,
            "execution_mode": self.provider.execution_mode,
            "executed_now": tally["executed"],
            "recovered_now": tally["recovered"],
            "not_recovered_now": tally["not_recovered"],
            "suppressed_now": tally["suppressed"],
            "escalated_now": tally["escalated"],
            "failed_now": tally["failed"],
            "blocked_now": tally["blocked"],
            "skipped_now": tally["skipped"],
        }

    def simulate_policy(self, custom_policy: PolicyLimits) -> Dict[str, Any]:
        transactions = self.repo.get_all_transactions()
        if not transactions:
            raise ValueError("Call /api/scan first.")

        model = self._ensure_model()
        rows = [tx.to_dict() for tx in transactions]
        df = pd.DataFrame(rows)
        probs = model.predict_proba(df)

        action_counts = defaultdict(int)
        blocked_count = 0
        total_ev = 0.0

        for i, tx in enumerate(transactions):
            prob = float(probs[i])
            # Same rules as execution, so a record with a gap counts as blocked instead of crashing the simulation.
            facts = tx.to_dict()
            facts["hours_since_last_attempt"] = None
            dec = decide_intervention(facts, prob, custom_policy, evaluator=evaluate_policy_strict)
            action_counts[dec.final_action] += 1
            if not dec.policy_allowed:
                blocked_count += 1
            total_ev += dec.ai_proposed_ev

        return {
            "total_transactions": len(transactions),
            "policy_applied": custom_policy.to_dict(),
            "proposed_action_counts": dict(action_counts),
            "blocked_count": blocked_count,
            "simulated_total_expected_value": round(total_ev, 2),
        }

    def get_demo_blocked_case(self) -> Dict[str, Any]:
        from backend.app.domain.policy import evaluate_policy
        from backend.app.domain.models import Action
        
        txs = self.repo.get_all_transactions()
        if not txs:
            raise ValueError("Call /api/scan first.")

        candidates = [tx for tx in txs if tx.leak_type == "failed_subscription" and (tx.consecutive_failures or 0) >= 3]
        if not candidates:
            candidates = [tx for tx in txs if (tx.retries_so_far or 0) >= self.policy.max_retries]
        if not candidates:
            raise ValueError("No eligible leak found for demo force retry block beat.")

        tx = candidates[0]
        policy_result = evaluate_policy(tx.to_dict(), Action.RETRY, self.policy)

        return {
            "leak_id": tx.leak_id,
            "transaction_id": tx.transaction_id,
            "leak_type": tx.leak_type,
            "amount": tx.amount,
            "attempted_action": "retry",
            "policy_allowed": policy_result.allowed,
            "policy_reason": policy_result.reason,
            "final_action": policy_result.final_action,
        }

    def copilot_query(self, query: str, transaction_id: Optional[str] = None) -> Dict[str, Any]:
        txs = self.repo.get_all_transactions()
        q_lower = query.lower().strip()

        # If specific transaction requested
        target_tx = None
        if transaction_id:
            target_tx = self.repo.get_transaction_by_id(transaction_id)
        elif any(token.startswith("tx_") for token in q_lower.split()):
            for token in q_lower.split():
                if token.startswith("tx_"):
                    clean_id = token.strip(",.!?")
                    target_tx = self.repo.get_transaction_by_id(clean_id)
                    if target_tx:
                        break

        if target_tx:
            dec = self.repo.get_decision(target_tx.leak_id)
            prob_pct = f"{(target_tx.model_recovery_prob or 0.0) * 100:.1f}%"
            candidates_str = ", ".join([f"{c['action']} (EV: ₹{c['expected_value']:.2f}, P: {c['probability']*100:.0f}%)" for c in (dec.candidates_evaluated if dec else [])])
            
            headline = f"Transaction Diagnosis: {target_tx.transaction_id} (₹{target_tx.amount:,.2f})"
            answer = (
                f"Transaction {target_tx.transaction_id} is classified under leak type '{target_tx.leak_type.replace('_', ' ')}'. "
                f"The predictive model computed a baseline recovery probability of {prob_pct} based on customer history "
                f"({target_tx.prior_successful_payments} prior successful payments, {target_tx.retries_so_far} prior retries, "
                f"{'unknown' if target_tx.hours_since_event is None else format(target_tx.hours_since_event, '.1f')}h elapsed). "
            )
            if dec:
                if dec.policy_allowed:
                    answer += f"The decision engine proposed '{dec.ai_proposed_action}' (EV: ₹{dec.ai_proposed_ev:.2f}) which was APPROVED by deterministic policy limits."
                    guardrail_status = "Approved by Policy Engine"
                else:
                    answer += f"The decision engine proposed '{dec.ai_proposed_action}' (EV: ₹{dec.ai_proposed_ev:.2f}), but the deterministic policy engine INTERCEPTED it: {dec.policy_reason}. The final action was rerouted to '{dec.final_action}'."
                    guardrail_status = f"Blocked / Downgraded: {dec.policy_reason}"
            else:
                answer += "This transaction has not yet been processed by an intelligence pass."
                guardrail_status = "Awaiting Intelligence Pass"

            return {
                "query": query,
                "headline": headline,
                "answer": answer,
                "key_metrics": {
                    "transaction_id": target_tx.transaction_id,
                    "amount": target_tx.amount,
                    "leak_type": target_tx.leak_type,
                    "recovery_probability": target_tx.model_recovery_prob or 0.0,
                    "proposed_action": dec.ai_proposed_action if dec else "none",
                    "final_action": dec.final_action if dec else "none",
                    "policy_allowed": dec.policy_allowed if dec else True,
                },
                "recommendations": [
                    f"Candidate actions evaluated: {candidates_str or 'None'}",
                    f"Customer Segment: {target_tx.merchant_segment} | LTV Bucket: {target_tx.ltv_bucket.upper()}",
                    "Policy rule strictly enforced: ML estimates recovery EV, but deterministic policy limits retain sole execution authorization.",
                ],
                "guardrail_status": guardrail_status,
                "model_attribution": {
                    "prior_successful_payments": target_tx.prior_successful_payments,
                    "retries_so_far": target_tx.retries_so_far,
                    "hours_since_event": target_tx.hours_since_event,
                    "consecutive_failures": getattr(target_tx, "consecutive_failures", 0),
                },
            }

        # Aggregate analysis across repo
        if not txs:
            return {
                "query": query,
                "headline": "Pipeline Uninitialized",
                "answer": "No transactions have been scanned into REVORA yet. Run a Revenue Scanner pass to populate transactions and run model evaluation.",
                "key_metrics": {
                    "total_transactions": 0,
                    "total_at_risk": 0.0,
                    "status": "awaiting_scan",
                },
                "recommendations": [
                    "Click 'Scan Revenue' in Mission Control or Revenue Scanner.",
                    "Run an Intelligence Pass to calculate recovery probabilities and proposed interventions.",
                ],
                "guardrail_status": "Idle",
                "model_attribution": None,
            }

        total_amount = sum(t.amount for t in txs)
        decisions = self.repo.get_all_decisions()  # the current decision of each case in the active run
        blocked_decs = [d for d in decisions if d and not d.policy_allowed]
        interventions = self.repo.get_all_interventions()
        recovered_txs = [i for i in interventions if i.recovered]
        total_recovered = sum(i.recovered_amount for i in recovered_txs)

        if "block" in q_lower or "guardrail" in q_lower or "policy" in q_lower:
            headline = f"Policy Guardrail Report: {len(blocked_decs)} Actions Intercepted"
            reasons = {}
            for d in blocked_decs:
                reasons[d.policy_reason] = reasons.get(d.policy_reason, 0) + 1
            reason_summary = "; ".join([f"{k} ({v} occurrences)" for k, v in reasons.items()]) or "No blocks recorded"
            answer = (
                f"REVORA's deterministic policy engine intercepted {len(blocked_decs)} AI-proposed actions. "
                f"Root guardrail triggers: {reason_summary}. "
                "In all cases, autonomous payment execution was prevented to protect customer relationship and avoid gateway exhaustion."
            )
            recommendations = [
                "Review high-retry transactions in Escalations queue for manual customer outreach.",
                "Verify that subscription cooling-off periods meet merchant compliance.",
                "Simulate relaxed thresholds in Settings > Policy Simulator to view recovery vs fatigue tradeoff.",
            ]
            guardrail_status = f"{len(blocked_decs)} Enforcements Active"
        elif "brief" in q_lower or "summary" in q_lower or "overview" in q_lower or "executive" in q_lower:
            headline = "Executive Revenue Recovery Briefing"
            recoverable_amt = sum(t.amount * (t.model_recovery_prob or 0.0) for t in txs if t.model_recovery_prob)
            answer = (
                f"REVORA is monitoring {len(txs)} leakage events representing ₹{total_amount:,.2f} total revenue at risk. "
                f"The XGBoost model identifies ₹{recoverable_amt:,.2f} as realistically recoverable. "
                f"To date, {len(recovered_txs)} interventions have succeeded, capturing ₹{total_recovered:,.2f} in net revenue. "
                f"The policy engine has enforced {len(blocked_decs)} safety blocks to ensure zero fatigue and strict compliance."
            )
            recommendations = [
                "Prioritize top opportunities with recovery probability > 70% for instant payment links.",
                "Inspect the Escalations queue for high-value subscription accounts requiring white-glove follow-up.",
                "Audit log records every proposed vs executed intervention for this scan run (in-memory; cleared on restart).",
            ]
            guardrail_status = "Nominal — System Guardrails Active"
        elif "escalat" in q_lower:
            escalations = [d for d in decisions if d and d.final_action == "escalate"]
            headline = f"Escalation Analysis: {len(escalations)} Cases Requiring Merchant Review"
            answer = (
                f"{len(escalations)} transactions have been rerouted to merchant review. "
                "These transactions exceed automated retry limits or invoice age thresholds where automated AI outreach carries churn risk."
            )
            recommendations = [
                "Check Escalations dashboard for accounts with high lifetime value.",
                "Send direct account manager emails rather than automated gateway retries.",
            ]
            guardrail_status = "Merchant Queue Guarded"
        else:
            headline = f"Revenue Operations Intelligence: {len(txs)} Monitored Events"
            answer = (
                f"REVORA pipeline is active across {len(txs)} transactions totaling ₹{total_amount:,.2f} at risk. "
                f"Model evaluation has yielded {len(decisions)} autonomous intervention decisions, with {len(blocked_decs)} "
                f"intercepted by policy limits and {len(recovered_txs)} successful recoveries totaling ₹{total_recovered:,.2f}."
            )
            recommendations = [
                "Query any transaction directly by ID (e.g. 'tx_...') for full ML attribution and guardrail trace.",
                "Ask 'Explain policy blocks' or 'Show executive brief' for targeted operational deep dives.",
            ]
            guardrail_status = "Active & Enforced"

        return {
            "query": query,
            "headline": headline,
            "answer": answer,
            "key_metrics": {
                "total_transactions": len(txs),
                "total_at_risk": total_amount,
                "total_recovered": total_recovered,
                "blocked_by_policy": len(blocked_decs),
                "active_decisions": len(decisions),
            },
            "recommendations": recommendations,
            "guardrail_status": guardrail_status,
            "model_attribution": None,
        }

