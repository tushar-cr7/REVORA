"""
Decision engine.

For each leak, estimates expected value of each candidate intervention
(probability * amount - cost - friction) and proposes the best one,
then passes it to the policy engine.
"""
from typing import Dict, Any, List, Union
import uuid
from backend.app.domain.models import Action, Decision
from backend.app.domain.policy import PolicyLimits, DEFAULT_POLICY, evaluate_policy

INTERVENTION_COST = {
    Action.RETRY: 5,
    Action.PAYMENT_LINK: 15,
    Action.REMINDER: 8,
    Action.ESCALATE: 40,
    Action.SUPPRESS: 0,
}

INTERVENTION_FRICTION = {
    Action.RETRY: 10,
    Action.PAYMENT_LINK: 25,
    Action.REMINDER: 20,
    Action.ESCALATE: 5,
    Action.SUPPRESS: 0,
}

CANDIDATE_ACTIONS = {
    "failed_payment": [Action.RETRY, Action.PAYMENT_LINK, Action.REMINDER, Action.SUPPRESS],
    "abandoned_checkout": [Action.REMINDER, Action.PAYMENT_LINK, Action.SUPPRESS],
    "failed_subscription": [Action.RETRY, Action.PAYMENT_LINK, Action.ESCALATE, Action.SUPPRESS],
    "overdue_invoice": [Action.REMINDER, Action.PAYMENT_LINK, Action.ESCALATE, Action.SUPPRESS],
}

ACTION_PROB_MULTIPLIER = {
    Action.RETRY: 1.0,
    Action.PAYMENT_LINK: 0.85,
    Action.REMINDER: 0.55,
    Action.ESCALATE: 0.35,
    Action.SUPPRESS: 0.0,
}


def decide_intervention(
    leak: Union[Dict[str, Any], Any],
    base_recovery_prob: float,
    policy: PolicyLimits = DEFAULT_POLICY,
) -> Decision:
    if isinstance(leak, dict):
        leak_data = leak
    elif hasattr(leak, "to_dict"):
        leak_data = leak.to_dict()
    else:
        leak_data = vars(leak)

    leak_id = leak_data["leak_id"]
    transaction_id = leak_data.get("transaction_id", f"tx_{leak_id}")
    leak_type = leak_data["leak_type"]
    amount = float(leak_data["amount"])

    candidates = CANDIDATE_ACTIONS.get(leak_type, [Action.SUPPRESS])

    scored: List[Dict[str, Any]] = []
    for action in candidates:
        prob = base_recovery_prob * ACTION_PROB_MULTIPLIER[action]
        prob = max(0.0, min(1.0, prob))
        cost = INTERVENTION_COST[action]
        friction = INTERVENTION_FRICTION[action]
        ev = prob * amount - cost - friction
        scored.append({
            "action": action.value,
            "probability": round(prob, 4),
            "expected_value": round(ev, 2),
            "cost": cost,
            "friction": friction,
        })

    scored.sort(key=lambda x: x["expected_value"], reverse=True)
    best = scored[0]
    proposed_action = Action(best["action"])

    policy_result = evaluate_policy(leak_data, proposed_action, policy)

    decision_id = f"dec_{uuid.uuid4().hex[:8]}"

    return Decision(
        decision_id=decision_id,
        leak_id=leak_id,
        transaction_id=transaction_id,
        candidates_evaluated=scored,
        ai_proposed_action=proposed_action.value,
        ai_proposed_ev=best["expected_value"],
        ai_proposed_probability=best["probability"],
        policy_allowed=policy_result.allowed,
        policy_reason=policy_result.reason,
        final_action=policy_result.final_action,
    )
