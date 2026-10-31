import pytest
from backend.app.domain.models import Action
from backend.app.domain.policy import PolicyLimits, evaluate_policy, DEFAULT_POLICY


def test_retry_limit_policy_rule():
    leak = {"retries_so_far": 2, "hours_since_event": 24, "amount": 1000.0, "leak_type": "failed_payment"}
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    
    assert not result.allowed
    assert "Retry limit exceeded" in result.reason
    assert result.final_action == Action.ESCALATE.value


def test_cooldown_period_policy_rule():
    leak = {"retries_so_far": 0, "hours_since_event": 2, "amount": 1000.0, "leak_type": "failed_payment"}
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    
    assert not result.allowed
    assert "Cooldown not elapsed" in result.reason
    assert result.final_action == Action.SUPPRESS.value


def test_customer_contact_frequency_rule():
    leak = {"contacts_today": 1, "amount": 2000.0, "leak_type": "abandoned_checkout"}
    result_link = evaluate_policy(leak, Action.PAYMENT_LINK, DEFAULT_POLICY)
    result_rem = evaluate_policy(leak, Action.REMINDER, DEFAULT_POLICY)
    
    assert not result_link.allowed
    assert result_link.final_action == Action.SUPPRESS.value
    assert not result_rem.allowed
    assert result_rem.final_action == Action.SUPPRESS.value


def test_high_value_transaction_auto_recovery_ceiling():
    leak = {"amount": 50000.0, "retries_so_far": 0, "hours_since_event": 12, "leak_type": "failed_payment"}
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    
    assert not result.allowed
    assert "exceeds auto-recovery ceiling" in result.reason
    assert result.final_action == Action.ESCALATE.value


def test_subscription_consecutive_failures_rule():
    leak = {
        "leak_type": "failed_subscription",
        "consecutive_failures": 3,
        "retries_so_far": 1,
        "hours_since_event": 24,
        "amount": 2000.0,
    }
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    
    assert not result.allowed
    assert "Consecutive subscription failures exceed retry threshold" in result.reason
    assert result.final_action == Action.ESCALATE.value


def test_overdue_invoice_age_escalation_rule():
    leak = {
        "leak_type": "overdue_invoice",
        "age_days": 45,
        "hours_since_event": 45 * 24,
        "amount": 5000.0,
    }
    result = evaluate_policy(leak, Action.REMINDER, DEFAULT_POLICY)
    
    assert not result.allowed
    assert "older than 30 days" in result.reason
    assert result.final_action == Action.ESCALATE.value


def test_within_policy_action_allowed():
    leak = {
        "leak_type": "failed_payment",
        "retries_so_far": 0,
        "hours_since_event": 12,
        "amount": 5000.0,
        "contacts_today": 0,
    }
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    
    assert result.allowed
    assert result.reason == "Within policy."
    assert result.final_action == Action.RETRY.value
