from dataclasses import dataclass
from typing import Dict, Any, Union
from backend.app.domain.models import Action


@dataclass
class PolicyLimits:
    max_retries: int = 2
    min_cooldown_hours: int = 6
    max_customer_contacts_per_day: int = 1
    max_auto_recovery_value: float = 25000.0
    max_subscription_consecutive_failures_for_retry: int = 2
    invoice_escalation_age_days: int = 30

    def to_dict(self) -> Dict[str, Any]:
        return {
            "max_retries": self.max_retries,
            "min_cooldown_hours": self.min_cooldown_hours,
            "max_customer_contacts_per_day": self.max_customer_contacts_per_day,
            "max_auto_recovery_value": self.max_auto_recovery_value,
            "max_subscription_consecutive_failures_for_retry": self.max_subscription_consecutive_failures_for_retry,
            "invoice_escalation_age_days": self.invoice_escalation_age_days,
        }


DEFAULT_POLICY = PolicyLimits()


@dataclass
class PolicyResult:
    allowed: bool
    reason: str
    final_action: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "final_action": self.final_action,
        }


def evaluate_policy(
    leak: Union[Dict[str, Any], Any],
    proposed_action: Union[Action, str],
    policy: PolicyLimits = DEFAULT_POLICY,
) -> PolicyResult:
    """
    Deterministic guardrail check. Runs AFTER the AI proposes an action, and can only
    downgrade/block it — never expand what the AI is allowed to do.
    """
    if isinstance(leak, dict):
        leak_data = leak
    elif hasattr(leak, "to_dict"):
        leak_data = leak.to_dict()
    else:
        leak_data = vars(leak)

    action_enum = Action(proposed_action) if isinstance(proposed_action, str) else proposed_action

    # Rule: retry limit
    if action_enum == Action.RETRY and leak_data.get("retries_so_far", 0) >= policy.max_retries:
        return PolicyResult(
            False,
            f"Retry limit exceeded ({leak_data.get('retries_so_far')}/{policy.max_retries}).",
            Action.ESCALATE.value,
        )

    # Rule: cooldown between retries
    if action_enum == Action.RETRY and leak_data.get("hours_since_event", 999) < policy.min_cooldown_hours:
        return PolicyResult(
            False,
            f"Cooldown not elapsed (<{policy.min_cooldown_hours}h since last event).",
            Action.SUPPRESS.value,
        )

    # Rule: subscription-specific — too many consecutive failures blocks further retries
    if leak_data.get("leak_type") == "failed_subscription" and action_enum == Action.RETRY:
        if leak_data.get("consecutive_failures", 0) > policy.max_subscription_consecutive_failures_for_retry:
            return PolicyResult(
                False,
                "Consecutive subscription failures exceed retry threshold.",
                Action.ESCALATE.value,
            )

    # Rule: customer contact frequency (reminder/payment_link count as a "contact")
    if action_enum in (Action.REMINDER, Action.PAYMENT_LINK):
        contacts_today = leak_data.get("contacts_today", 0)
        if contacts_today >= policy.max_customer_contacts_per_day:
            return PolicyResult(
                False,
                "Daily customer contact limit reached.",
                Action.SUPPRESS.value,
            )

    # Rule: auto-recovery value ceiling — large amounts require human escalation, not autopilot
    if action_enum != Action.ESCALATE and leak_data.get("amount", 0) > policy.max_auto_recovery_value:
        return PolicyResult(
            False,
            f"Amount exceeds auto-recovery ceiling (₹{policy.max_auto_recovery_value:,.0f}).",
            Action.ESCALATE.value,
        )

    # Rule: stale invoices beyond threshold go to escalation, not automated reminders
    if leak_data.get("leak_type") == "overdue_invoice" and leak_data.get("age_days", 0) > policy.invoice_escalation_age_days:
        if action_enum != Action.ESCALATE:
            return PolicyResult(
                False,
                f"Invoice older than {policy.invoice_escalation_age_days} days — requires escalation.",
                Action.ESCALATE.value,
            )

    return PolicyResult(True, "Within policy.", action_enum.value)
