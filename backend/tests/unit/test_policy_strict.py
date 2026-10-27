import math

import pytest

from backend.app.domain.models import Action
from backend.app.domain.policy import (
    DEFAULT_POLICY,
    PolicyLimits,
    evaluate_policy,
    evaluate_policy_strict,
    missing_policy_inputs,
)


def _complete_retry_leak(**overrides):
    leak = {
        "leak_type": "failed_payment",
        "amount": 2000.0,
        "retries_so_far": 0,
        "hours_since_event": 48,
        "hours_since_last_attempt": None,
        "contacts_today": 0,
        "consecutive_failures": 0,
        "age_days": 0,
    }
    leak.update(overrides)
    return leak


# ── rule ordering ────────────────────────────────────────────────────────
def test_subscription_escalation_is_not_preempted_by_the_cooldown_rule():
    """
    Audit R-policy: a subscription with too many consecutive failures must be
    escalated. Before the fix, a recent last event made the weaker cooldown rule
    fire first and the case was quietly suppressed instead.
    """
    leak = {
        "leak_type": "failed_subscription",
        "consecutive_failures": 4,
        "retries_so_far": 0,   # retry cap not reached, so only the subscription rule applies
        "hours_since_event": 2,  # inside the cooldown window
        "amount": 900.0,
    }
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    assert not result.allowed
    assert result.final_action == Action.ESCALATE.value
    assert "Consecutive subscription failures" in result.reason


def test_retry_cap_is_still_reported_first_when_both_rules_apply():
    leak = {
        "leak_type": "failed_subscription",
        "consecutive_failures": 3,
        "retries_so_far": 2,
        "hours_since_event": 24,
        "amount": 900.0,
    }
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    assert "Retry limit exceeded" in result.reason
    assert result.final_action == Action.ESCALATE.value


def test_cooldown_still_suppresses_a_healthy_subscription():
    leak = {"leak_type": "failed_subscription", "consecutive_failures": 1, "retries_so_far": 0,
            "hours_since_event": 2, "amount": 900.0}
    result = evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY)
    assert result.final_action == Action.SUPPRESS.value
    assert result.reason.startswith("Cooldown not elapsed")


def test_back_to_back_retries_are_blocked_by_cooldown_since_the_last_attempt():
    leak = _complete_retry_leak(retries_so_far=1, hours_since_last_attempt=0.5)
    result = evaluate_policy_strict(leak, Action.RETRY, DEFAULT_POLICY)
    assert not result.allowed
    assert result.final_action == Action.SUPPRESS.value
    assert result.reason.startswith("Cooldown not elapsed")

    later = _complete_retry_leak(retries_so_far=1, hours_since_last_attempt=6.0)
    assert evaluate_policy_strict(later, Action.RETRY, DEFAULT_POLICY).allowed


def test_lenient_evaluator_ignores_the_new_input_when_it_is_absent():
    # Existing callers that never supply hours_since_last_attempt behave exactly as before.
    leak = {"leak_type": "failed_payment", "retries_so_far": 0, "hours_since_event": 12, "amount": 5000.0}
    assert evaluate_policy(leak, Action.RETRY, DEFAULT_POLICY).allowed


# ── fail-closed strict evaluation ────────────────────────────────────────
@pytest.mark.parametrize("field", ["retries_so_far", "hours_since_event", "amount", "leak_type"])
def test_retry_fails_closed_when_a_required_input_is_absent(field):
    leak = _complete_retry_leak()
    del leak[field]
    result = evaluate_policy_strict(leak, Action.RETRY, DEFAULT_POLICY)
    assert not result.allowed
    assert result.final_action == Action.ESCALATE.value
    assert field in result.reason
    # The lenient evaluator is what used to wave this through.
    if field in ("retries_so_far", "hours_since_event"):
        assert evaluate_policy({k: v for k, v in leak.items()}, Action.RETRY, DEFAULT_POLICY).allowed


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), -1, "2", True])
def test_retry_fails_closed_on_unusable_values(bad):
    result = evaluate_policy_strict(_complete_retry_leak(retries_so_far=bad), Action.RETRY, DEFAULT_POLICY)
    assert not result.allowed
    assert "retries_so_far" in result.reason


def test_retry_requires_the_attempt_ledger_field_to_be_present():
    leak = _complete_retry_leak()
    del leak["hours_since_last_attempt"]
    result = evaluate_policy_strict(leak, Action.RETRY, DEFAULT_POLICY)
    assert not result.allowed and "hours_since_last_attempt" in result.reason


def test_contact_actions_require_contacts_today():
    for action in (Action.REMINDER, Action.PAYMENT_LINK):
        leak = _complete_retry_leak(leak_type="abandoned_checkout")
        del leak["contacts_today"]
        result = evaluate_policy_strict(leak, action, DEFAULT_POLICY)
        assert not result.allowed and "contacts_today" in result.reason
        assert missing_policy_inputs(leak, action) == ["contacts_today"]


def test_subscription_retry_requires_consecutive_failures():
    leak = _complete_retry_leak(leak_type="failed_subscription", consecutive_failures=None)
    result = evaluate_policy_strict(leak, Action.RETRY, DEFAULT_POLICY)
    assert not result.allowed and "consecutive_failures" in result.reason


def test_overdue_invoice_requires_age_days_for_any_non_escalation():
    leak = _complete_retry_leak(leak_type="overdue_invoice", age_days=None)
    for action in (Action.REMINDER, Action.PAYMENT_LINK, Action.SUPPRESS):
        assert "age_days" in missing_policy_inputs(leak, action)


def test_escalation_is_never_blocked_by_missing_inputs():
    # Handing a case to a person is the fail-closed destination itself.
    result = evaluate_policy_strict({}, Action.ESCALATE, DEFAULT_POLICY)
    assert result.allowed and result.final_action == Action.ESCALATE.value


def test_unknown_action_is_denied_and_rerouted_to_escalation():
    result = evaluate_policy_strict(_complete_retry_leak(), "wire_transfer", DEFAULT_POLICY)
    assert not result.allowed and result.final_action == Action.ESCALATE.value


@pytest.mark.parametrize("action", list(Action))
def test_strict_agrees_with_lenient_when_every_input_is_present(action):
    for leak in (
        _complete_retry_leak(),
        _complete_retry_leak(retries_so_far=2),
        _complete_retry_leak(amount=90000.0),
        _complete_retry_leak(contacts_today=1, leak_type="abandoned_checkout"),
        _complete_retry_leak(leak_type="overdue_invoice", age_days=45),
        _complete_retry_leak(leak_type="failed_subscription", consecutive_failures=5, hours_since_event=1),
    ):
        assert evaluate_policy_strict(leak, action, DEFAULT_POLICY) == evaluate_policy(leak, action, DEFAULT_POLICY)


def test_changed_limits_change_the_verdict():
    leak = _complete_retry_leak(amount=8000.0)
    assert evaluate_policy_strict(leak, Action.RETRY, DEFAULT_POLICY).allowed
    tighter = PolicyLimits(max_auto_recovery_value=5000.0)
    assert not evaluate_policy_strict(leak, Action.RETRY, tighter).allowed
    assert not math.isnan(tighter.max_auto_recovery_value)
