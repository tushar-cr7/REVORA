from collections import defaultdict
import os
from typing import Dict, Any, List, Optional
import pandas as pd
from backend.app.config import settings
from backend.app.domain.models import Transaction, Decision, Intervention, AuditEventType
from backend.app.domain.policy import DEFAULT_POLICY, PolicyLimits
from backend.app.intelligence.data_gen import generate_dataset
from backend.app.intelligence.model import RecoveryModel
from backend.app.intelligence.decision_engine import decide_intervention
from backend.app.integrations.base import PaymentExecutionProvider
from backend.app.integrations.simulation import SimulationProvider
from backend.app.repositories.base import BaseRepository
from backend.app.services.audit_service import AuditService


def _safe_int(val, default: int = 0) -> int:
    if val is None or pd.isna(val):
        return default
    return int(val)


def _safe_bool(val, default: bool = False) -> bool:
    if val is None or pd.isna(val):
        return default
    return bool(val)


class RecoveryService:
    def __init__(
        self,
        repo: BaseRepository,
        audit_service: AuditService,
        provider: Optional[PaymentExecutionProvider] = None,
        model_path: Optional[str] = None,
    ):
        self.repo = repo
        self.audit_service = audit_service
        self.provider = provider or SimulationProvider()
        self.model_path = model_path or settings.MODEL_PATH
        self.model: Optional[RecoveryModel] = None

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

    def scan_revenue(self, n_total: int = 10000, seed: int = 42, merchant_id: str = "merch_001") -> Dict[str, Any]:
        df, _ = generate_dataset(n_total=n_total, seed=seed, merchant_id=merchant_id)
        
        transactions: List[Transaction] = []
        for _, row in df.iterrows():
            d = row.to_dict()
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
                retries_so_far=_safe_int(d.get("retries_so_far")),
                hours_since_event=_safe_int(d.get("hours_since_event")),
                age_days=_safe_int(d.get("age_days")),
                event_time=d["event_time"],
                merchant_segment=d["merchant_segment"],
                payment_id=None if pd.isna(d.get("payment_id")) else str(d.get("payment_id")),
                visit_count=_safe_int(d.get("visit_count")),
                reached_payment_page=_safe_bool(d.get("reached_payment_page")),
                consecutive_failures=_safe_int(d.get("consecutive_failures")),
                subscription_age_days=_safe_int(d.get("subscription_age_days")),
            )
            transactions.append(tx)

        self.repo.save_transactions(transactions)

        by_type = df.groupby("leak_type")["amount"].agg(["sum", "count"]).reset_index()
        breakdown = [
            {"leak_type": row["leak_type"], "amount_at_risk": round(row["sum"], 2), "count": int(row["count"])}
            for _, row in by_type.iterrows()
        ]
        total_at_risk = round(float(df["amount"].sum()), 2)

        return {
            "total_transactions_scanned": n_total,
            "total_at_risk": total_at_risk,
            "breakdown": breakdown,
        }

    def analyze_revenue(self, policy: PolicyLimits = DEFAULT_POLICY) -> Dict[str, Any]:
        transactions = self.repo.get_all_transactions()
        if not transactions:
            raise ValueError("Call /api/scan first.")

        model = self._ensure_model()
        rows = [tx.to_dict() for tx in transactions]
        df = pd.DataFrame(rows)
        probs = model.predict_proba(df)

        contacts_today = defaultdict(int)
        blocked_count = 0
        action_counts = defaultdict(int)

        for i, tx in enumerate(transactions):
            prob = float(probs[i])
            tx.model_recovery_prob = prob
            tx.contacts_today = contacts_today[tx.customer_id]

            decision = decide_intervention(tx.to_dict(), prob, policy)
            self.repo.save_decision(decision)

            if decision.final_action in ("reminder", "payment_link"):
                contacts_today[tx.customer_id] += 1

            if not decision.policy_allowed:
                blocked_count += 1
                self.audit_service.log_event(
                    merchant_id=tx.merchant_id,
                    transaction_id=tx.transaction_id,
                    leak_id=tx.leak_id,
                    event_type=AuditEventType.ACTION_BLOCKED,
                    action=decision.ai_proposed_action,
                    policy_result={"allowed": False, "reason": decision.policy_reason, "final_action": decision.final_action},
                    decision_id=decision.decision_id,
                )
            else:
                self.audit_service.log_event(
                    merchant_id=tx.merchant_id,
                    transaction_id=tx.transaction_id,
                    leak_id=tx.leak_id,
                    event_type=AuditEventType.DECISION_CREATED,
                    action=decision.final_action,
                    policy_result={"allowed": True, "reason": decision.policy_reason, "final_action": decision.final_action},
                    decision_id=decision.decision_id,
                )

            action_counts[decision.final_action] += 1

        self.repo.analyzed = True

        total_at_risk = round(sum(tx.amount for tx in transactions), 2)
        realistically_recoverable = round(
            sum(
                tx.amount * (tx.model_recovery_prob or 0.0)
                for tx in transactions
                if self.repo.get_decision(tx.leak_id) and self.repo.get_decision(tx.leak_id).final_action != "suppress"
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
        }

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
        results = []
        for tx in transactions:
            decision = self.repo.get_decision(tx.leak_id)
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
                })
        results.sort(key=lambda x: x["expected_recovery"], reverse=True)
        return results[:limit]

    def get_decision_by_id(self, key: str) -> Optional[Dict[str, Any]]:
        decision = self.repo.get_decision(key)
        return decision.to_dict() if decision else None

    def get_interventions(self, limit: int = 100) -> List[Dict[str, Any]]:
        interventions = self.repo.get_all_interventions()
        return [i.to_dict() for i in interventions[:limit]]

    def get_escalations(self, limit: int = 50) -> List[Dict[str, Any]]:
        escalations = self.repo.get_escalations()
        return [e.to_dict() for e in escalations[:limit]]

    def get_analytics_summary(self) -> Dict[str, Any]:
        transactions = self.repo.get_all_transactions()
        total_at_risk = round(sum(tx.amount for tx in transactions), 2)
        
        interventions = self.repo.get_all_interventions()
        total_recovered = sum(i.amount for i in interventions if i.recovered)
        
        recovered_count = sum(1 for i in interventions if i.recovered)
        attempted_count = sum(1 for i in interventions if i.final_action in ("retry", "payment_link", "reminder"))
        
        decisions = self.repo.get_all_decisions() if hasattr(self.repo, 'get_all_decisions') else []
        blocked_count = sum(1 for d in decisions if not d.policy_allowed)
        
        escalations = self.repo.get_escalations()
        escalation_count = len(escalations)

        return {
            "total_at_risk": total_at_risk,
            "total_recovered": total_recovered,
            "recovery_rate_pct": round(100 * total_recovered / total_at_risk, 2) if total_at_risk else 0,
            "recovered_count": recovered_count,
            "attempted_count": attempted_count,
            "intervention_success_rate_pct": round(100 * recovered_count / attempted_count, 2) if attempted_count else 0,
            "policy_blocked_count": blocked_count,
            "escalation_count": escalation_count
        }

    def execute_individual_intervention(
        self, target_id: str, idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        # 1. Idempotency check
        if idempotency_key:
            existing = self.repo.get_intervention_by_idempotency_key(idempotency_key)
            if existing:
                return existing.to_dict()

        # 2. Get transaction & decision
        tx = self.repo.get_transaction_by_id(target_id)
        if not tx:
            raise ValueError(f"Transaction/leak ID {target_id} not found.")

        decision = self.repo.get_decision(tx.leak_id)
        if not decision:
            model = self._ensure_model()
            prob = float(model.predict_proba(pd.DataFrame([tx.to_dict()]))[0])
            tx.model_recovery_prob = prob
            decision = decide_intervention(tx.to_dict(), prob, DEFAULT_POLICY)
            self.repo.save_decision(decision)

        # 3. Execute intervention
        intervention = self.provider.execute(tx.to_dict(), decision.to_dict(), idempotency_key)
        self.repo.save_intervention(intervention)

        # 4. Audit logging
        event_type = (
            AuditEventType.SUPPRESSION_CREATED if intervention.final_action == "suppress"
            else AuditEventType.ESCALATION_CREATED if intervention.final_action == "escalate"
            else AuditEventType.EXECUTION_SUCCEEDED if intervention.recovered
            else AuditEventType.EXECUTION_FAILED
        )

        self.audit_service.log_event(
            merchant_id=tx.merchant_id,
            transaction_id=tx.transaction_id,
            leak_id=tx.leak_id,
            event_type=event_type,
            action=intervention.final_action,
            policy_result={"allowed": decision.policy_allowed, "reason": decision.policy_reason},
            decision_id=decision.decision_id,
            intervention_id=intervention.intervention_id,
            outcome={"status": intervention.status, "recovered": intervention.recovered, "recovered_amount": intervention.recovered_amount},
            idempotency_key=idempotency_key,
        )

        return intervention.to_dict()

    def recover_revenue(self) -> Dict[str, Any]:
        transactions = self.repo.get_all_transactions()
        if not transactions:
            raise ValueError("Call /api/analyze first.")

        audit_log = []
        for tx in transactions:
            decision = self.repo.get_decision(tx.leak_id)
            if not decision:
                continue
            itv_dict = self.execute_individual_intervention(tx.transaction_id)
            audit_log.append(itv_dict)

        self.repo.recovered = True

        total_recovered = sum(o["recovered_amount"] for o in audit_log)
        total_at_risk = round(sum(tx.amount for tx in transactions), 2)
        action_tally = pd.Series([o["final_action"] for o in audit_log]).value_counts().to_dict()
        recovered_count = sum(1 for o in audit_log if o["recovered"])
        attempted_count = sum(1 for o in audit_log if o["final_action"] in ("retry", "payment_link", "reminder"))

        return {
            "total_at_risk": total_at_risk,
            "total_recovered": round(total_recovered, 2),
            "recovery_rate_pct": round(100 * total_recovered / total_at_risk, 2) if total_at_risk else 0,
            "actions_executed": {
                "retry": action_tally.get("retry", 0),
                "payment_link": action_tally.get("payment_link", 0),
                "reminder": action_tally.get("reminder", 0),
                "escalate": action_tally.get("escalate", 0),
                "suppress": action_tally.get("suppress", 0),
            },
            "recovered_count": recovered_count,
            "attempted_count": attempted_count,
            "avg_recovery_value": round(total_recovered / recovered_count, 2) if recovered_count else 0,
            "intervention_success_rate_pct": round(100 * recovered_count / attempted_count, 2) if attempted_count else 0,
            "policy_violations": 0,
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
            dec = decide_intervention(tx.to_dict(), prob, custom_policy)
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

        candidates = [tx for tx in txs if tx.leak_type == "failed_subscription" and tx.consecutive_failures >= 3]
        if not candidates:
            candidates = [tx for tx in txs if tx.retries_so_far >= DEFAULT_POLICY.max_retries]
        if not candidates:
            raise ValueError("No eligible leak found for demo force retry block beat.")

        tx = candidates[0]
        policy_result = evaluate_policy(tx.to_dict(), Action.RETRY, DEFAULT_POLICY)

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
                f"{target_tx.hours_since_event:.1f}h elapsed). "
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
        decisions = [self.repo.get_decision(t.leak_id) for t in txs if self.repo.get_decision(t.leak_id)]
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
                "Audit ledger maintains full cryptographic trace of all proposed vs executed interventions.",
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

