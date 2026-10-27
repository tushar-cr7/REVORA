import math
import numbers
from dataclasses import dataclass
from typing import Dict, Any, List, Union
from backend.app.domain.models import Action

# Version stamped on decisions, authorizations, attempts and audit events so a
# record can be tied to the rule set that produced it.
POLICY_VERSION = "1.0.0"


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


def _as_dict(leak: Union[Dict[str, Any], Any]) -> Dict[str, Any]:
    if isinstance(leak, dict):
        return leak
    if hasattr(leak, "to_dict"):
        return leak.to_dict()
    return vars(leak)


def evaluate_policy(
    leak: Union[Dict[str, Any], Any],
    proposed_action: Union[Action, str],
    policy: PolicyLimits = DEFAULT_POLICY,
) -> PolicyResult:
    """
    Deterministic guardrail check. Runs AFTER the AI proposes an action, and can only
    downgrade/block it — never expand what the AI is allowed to do.

    This is the lenient evaluator: an absent field falls back to a default so
    partially populated records can still be scored. Anything that moves money
    must go through `evaluate_policy_strict`, which fails closed on absent inputs.
    """
    leak_data = _as_dict(leak)

    action_enum = Action(proposed_action) if isinstance(proposed_action, str) else proposed_action

    # Rule: retry limit
    if action_enum == Action.RETRY and leak_data.get("retries_so_far", 0) >= policy.max_retries:
        return PolicyResult(
            False,
            f"Retry limit exceeded ({leak_data.get('retries_so_far')}/{policy.max_retries}).",
            Action.ESCALATE.value,
        )

    # Rule: subscription-specific — too many consecutive failures blocks further retries.
    # Evaluated before the cooldown rules: a subscription that needs a human must be
    # escalated, not quietly suppressed because its last event happened to be recent.
    if leak_data.get("leak_type") == "failed_subscription" and action_enum == Action.RETRY:
        if leak_data.get("consecutive_failures", 0) > policy.max_subscription_consecutive_failures_for_retry:
            return PolicyResult(
                False,
                "Consecutive subscription failures exceed retry threshold.",
                Action.ESCALATE.value,
            )

    # Rule: cooldown between retries
    if action_enum == Action.RETRY and leak_data.get("hours_since_event", 999) < policy.min_cooldown_hours:
        return PolicyResult(
            False,
            f"Cooldown not elapsed (<{policy.min_cooldown_hours}h since last event).",
            Action.SUPPRESS.value,
        )

    # Rule: cooldown since REVORA's own most recent retry attempt on this case. The
    # execution layer derives `hours_since_last_attempt` from the attempt ledger
    # (None / absent = no prior attempt), so back-to-back retries cannot slip through.
    hours_since_last_attempt = leak_data.get("hours_since_last_attempt")
    if (
        action_enum == Action.RETRY
        and hours_since_last_attempt is not None
        and hours_since_last_attempt < policy.min_cooldown_hours
    ):
        return PolicyResult(
            False,
            f"Cooldown not elapsed (<{policy.min_cooldown_hours}h since the last retry attempt).",
            Action.SUPPRESS.value,
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


def _is_valid_number(value: Any) -> bool:
    """A usable safety figure: a real, finite, non-negative number (bools and NaN are not)."""
    return (
        isinstance(value, numbers.Real)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def missing_policy_inputs(
    leak: Union[Dict[str, Any], Any],
    proposed_action: Union[Action, str],
) -> List[str]:
    """
    Names of the safety-critical inputs that the rules for `proposed_action` need
    but that are absent or unusable (None, NaN, negative, non-numeric).

    `escalate` is exempt: handing a case to a person is the fail-closed destination
    itself, so it must never be blocked by missing data.
    """
    leak_data = _as_dict(leak)
    action_enum = Action(proposed_action) if isinstance(proposed_action, str) else proposed_action
    if action_enum == Action.ESCALATE:
        return []

    missing: List[str] = []

    def need_number(name: str) -> None:
        if not _is_valid_number(leak_data.get(name)):
            missing.append(name)

    leak_type = leak_data.get("leak_type")
    if not isinstance(leak_type, str) or not leak_type:
        missing.append("leak_type")
    need_number("amount")

    if action_enum == Action.RETRY:
        need_number("retries_so_far")
        need_number("hours_since_event")
        # Presence is mandatory, the value may be None ("no earlier retry attempt").
        if "hours_since_last_attempt" not in leak_data:
            missing.append("hours_since_last_attempt")
        elif leak_data["hours_since_last_attempt"] is not None:
            need_number("hours_since_last_attempt")
        if leak_type == "failed_subscription":
            need_number("consecutive_failures")

    if action_enum in (Action.REMINDER, Action.PAYMENT_LINK):
        need_number("contacts_today")

    if leak_type == "overdue_invoice":
        need_number("age_days")

    return missing


def evaluate_policy_strict(
    leak: Union[Dict[str, Any], Any],
    proposed_action: Union[Action, str],
    policy: PolicyLimits = DEFAULT_POLICY,
) -> PolicyResult:
    """
    The evaluator used wherever an action is about to be executed. Identical rules
    to `evaluate_policy`, but if any input the rules depend on is missing or
    unusable it denies and reroutes to escalation instead of assuming a default.
    """
    try:
        action_enum = Action(proposed_action) if isinstance(proposed_action, str) else proposed_action
    except ValueError:
        return PolicyResult(False, f"Unknown action '{proposed_action}'.", Action.ESCALATE.value)

    missing = missing_policy_inputs(leak, action_enum)
    if missing:
        return PolicyResult(
            False,
            f"Missing or invalid safety-critical input ({', '.join(missing)}); failing closed.",
            Action.ESCALATE.value,
        )
    return evaluate_policy(leak, action_enum, policy)
