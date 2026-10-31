import pytest
from backend.app.domain.models import Action
from backend.app.domain.policy import DEFAULT_POLICY
from backend.app.intelligence.decision_engine import decide_intervention, CANDIDATE_ACTIONS


def test_candidate_action_generation():
    assert "failed_payment" in CANDIDATE_ACTIONS
    assert Action.RETRY in CANDIDATE_ACTIONS["failed_payment"]
    assert Action.PAYMENT_LINK in CANDIDATE_ACTIONS["failed_payment"]
    assert Action.SUPPRESS in CANDIDATE_ACTIONS["failed_payment"]


def test_decision_picks_highest_expected_value():
    leak = {
        "leak_id": "fp_000001",
        "transaction_id": "tx_fp_000001",
        "leak_type": "failed_payment",
        "amount": 10000.0,
        "retries_so_far": 0,
        "hours_since_event": 12,
        "prior_successful_payments": 5,
        "customer_id": "cust_001",
    }
    # High base recovery prob -> retry should yield highest expected value
    decision = decide_intervention(leak, base_recovery_prob=0.85, policy=DEFAULT_POLICY)
    
    assert decision.leak_id == "fp_000001"
    assert decision.ai_proposed_action == Action.RETRY.value
    assert decision.ai_proposed_ev > 0
    assert len(decision.candidates_evaluated) == 4


def test_zero_probability_prefers_suppress():
    leak = {
        "leak_id": "ac_000001",
        "transaction_id": "tx_ac_000001",
        "leak_type": "abandoned_checkout",
        "amount": 500.0,
        "retries_so_far": 0,
        "hours_since_event": 10,
        "prior_successful_payments": 0,
        "customer_id": "cust_002",
    }
    decision = decide_intervention(leak, base_recovery_prob=0.0, policy=DEFAULT_POLICY)
    
    # Expected value for suppress = 0.0 * 500 - 0 - 0 = 0.0
    # Any other action with prob 0.0 has negative EV due to cost + friction
    assert decision.ai_proposed_action == Action.SUPPRESS.value
    assert decision.ai_proposed_ev == 0.0


def test_low_probability_scoring():
    leak = {
        "leak_id": "fp_000002",
        "transaction_id": "tx_fp_000002",
        "leak_type": "failed_payment",
        "amount": 100.0,
        "retries_so_far": 0,
        "hours_since_event": 24,
        "prior_successful_payments": 1,
        "customer_id": "cust_003",
    }
    # Very low amount + low prob -> costs outweigh expected gain -> SUPPRESS
    decision = decide_intervention(leak, base_recovery_prob=0.05, policy=DEFAULT_POLICY)
    assert decision.ai_proposed_action == Action.SUPPRESS.value
