import pytest
from backend.app.integrations.simulation import SimulationProvider


def test_simulation_provider_suppression():
    provider = SimulationProvider()
    leak = {"leak_id": "fp_100", "amount": 5000.0, "customer_id": "cust_1", "merchant_id": "merch_1"}
    decision = {
        "ai_proposed_action": "suppress",
        "final_action": "suppress",
        "policy_allowed": True,
        "policy_reason": "Within policy.",
    }
    
    itv = provider.execute(leak, decision, idempotency_key="idemp_suppress_1")
    assert itv.status == "suppressed"
    assert not itv.recovered
    assert itv.recovered_amount == 0.0
    assert itv.idempotency_key == "idemp_suppress_1"


def test_simulation_provider_escalation():
    provider = SimulationProvider()
    leak = {"leak_id": "fs_100", "amount": 35000.0, "customer_id": "cust_2", "merchant_id": "merch_1"}
    decision = {
        "ai_proposed_action": "retry",
        "final_action": "escalate",
        "policy_allowed": False,
        "policy_reason": "Amount exceeds auto-recovery ceiling.",
    }
    
    itv = provider.execute(leak, decision, idempotency_key="idemp_escalate_1")
    assert itv.status == "escalated_to_merchant"
    assert not itv.recovered
    assert itv.recovered_amount == 0.0
    assert itv.idempotency_key == "idemp_escalate_1"


def test_simulation_provider_action_execution():
    provider = SimulationProvider()
    leak = {"leak_id": "fp_101", "amount": 1000.0, "customer_id": "cust_3", "merchant_id": "merch_1"}
    decision = {
        "ai_proposed_action": "retry",
        "final_action": "retry",
        "policy_allowed": True,
        "policy_reason": "Within policy.",
        "candidates_evaluated": [{"action": "retry", "probability": 1.0}],
    }
    
    # Prob = 1.0 guarantees recovery in simulation
    itv = provider.execute(leak, decision)
    assert itv.status == "recovered"
    assert itv.recovered
    assert itv.recovered_amount == 1000.0
