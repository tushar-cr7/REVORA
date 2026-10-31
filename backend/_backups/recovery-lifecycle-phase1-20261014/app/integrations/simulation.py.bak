import random
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from backend.app.domain.models import Intervention
from backend.app.integrations.base import PaymentExecutionProvider

random.seed(7)

RAZORPAY_ENDPOINT_MAP = {
    "retry": "POST /v1/payments/{id}/capture (retry)",
    "payment_link": "POST /v1/payment_links",
    "reminder": "POST /v1/invoices/{id}/notify",
    "escalate": "internal: merchant_escalation_queue",
    "suppress": "no_call",
}


class SimulationProvider(PaymentExecutionProvider):
    @property
    def name(self) -> str:
        return "SimulationProvider"

    def execute(
        self,
        leak: Dict[str, Any],
        decision: Dict[str, Any],
        idempotency_key: Optional[str] = None,
    ) -> Intervention:
        final_action = decision["final_action"]
        amount = float(leak["amount"])
        intervention_id = f"itv_{uuid.uuid4().hex[:8]}"
        timestamp = datetime.now(timezone.utc).isoformat()

        customer_id = leak.get("customer_id", "cust_unknown")
        merchant_id = leak.get("merchant_id", "merch_001")
        transaction_id = leak.get("transaction_id", f"tx_{leak['leak_id']}")
        leak_id = leak["leak_id"]
        decision_id = decision.get("decision_id", f"dec_{leak_id}")

        if final_action == "suppress":
            return Intervention(
                intervention_id=intervention_id,
                decision_id=decision_id,
                leak_id=leak_id,
                transaction_id=transaction_id,
                customer_id=customer_id,
                merchant_id=merchant_id,
                amount=amount,
                ai_proposed_action=decision["ai_proposed_action"],
                policy_allowed=decision["policy_allowed"],
                policy_reason=decision["policy_reason"],
                final_action=final_action,
                provider=self.name,
                status="suppressed",
                recovered=False,
                recovered_amount=0.0,
                timestamp=timestamp,
                execution_probability_used=0.0,
                idempotency_key=idempotency_key,
            )

        if final_action == "escalate":
            return Intervention(
                intervention_id=intervention_id,
                decision_id=decision_id,
                leak_id=leak_id,
                transaction_id=transaction_id,
                customer_id=customer_id,
                merchant_id=merchant_id,
                amount=amount,
                ai_proposed_action=decision["ai_proposed_action"],
                policy_allowed=decision["policy_allowed"],
                policy_reason=decision["policy_reason"],
                final_action=final_action,
                provider=self.name,
                status="escalated_to_merchant",
                recovered=False,
                recovered_amount=0.0,
                timestamp=timestamp,
                execution_probability_used=0.0,
                idempotency_key=idempotency_key,
            )

        matching = next((c for c in decision.get("candidates_evaluated", []) if c["action"] == final_action), None)
        prob = matching["probability"] if matching else decision.get("ai_proposed_probability", 0.5)

        success = random.random() < prob
        status = "recovered" if success else "attempted_no_recovery"
        recovered_amount = round(amount, 2) if success else 0.0

        return Intervention(
            intervention_id=intervention_id,
            decision_id=decision_id,
            leak_id=leak_id,
            transaction_id=transaction_id,
            customer_id=customer_id,
            merchant_id=merchant_id,
            amount=amount,
            ai_proposed_action=decision["ai_proposed_action"],
            policy_allowed=decision["policy_allowed"],
            policy_reason=decision["policy_reason"],
            final_action=final_action,
            provider=self.name,
            status=status,
            recovered=success,
            recovered_amount=recovered_amount,
            timestamp=timestamp,
            execution_probability_used=round(prob, 4),
            idempotency_key=idempotency_key,
        )
