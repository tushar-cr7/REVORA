from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
import uuid


class Action(str, Enum):
    RETRY = "retry"
    PAYMENT_LINK = "payment_link"
    REMINDER = "reminder"
    ESCALATE = "escalate"
    SUPPRESS = "suppress"


class AuditEventType(str, Enum):
    DECISION_CREATED = "DECISION_CREATED"
    POLICY_EVALUATED = "POLICY_EVALUATED"
    ACTION_AUTHORIZED = "ACTION_AUTHORIZED"
    ACTION_BLOCKED = "ACTION_BLOCKED"
    EXECUTION_STARTED = "EXECUTION_STARTED"
    EXECUTION_SUCCEEDED = "EXECUTION_SUCCEEDED"
    EXECUTION_FAILED = "EXECUTION_FAILED"
    ESCALATION_CREATED = "ESCALATION_CREATED"
    SUPPRESSION_CREATED = "SUPPRESSION_CREATED"


@dataclass
class Transaction:
    transaction_id: str
    leak_id: str
    merchant_id: str
    customer_id: str
    amount: float
    leak_type: str
    payment_method: str
    failure_code: str
    prior_successful_payments: int
    ltv_bucket: str
    retries_so_far: int
    hours_since_event: int
    age_days: int
    event_time: str
    merchant_segment: str
    payment_id: Optional[str] = None
    visit_count: Optional[int] = 0
    reached_payment_page: Optional[bool] = False
    consecutive_failures: Optional[int] = 0
    subscription_age_days: Optional[int] = 0
    contacts_today: int = 0
    model_recovery_prob: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "transaction_id": self.transaction_id,
            "leak_id": self.leak_id,
            "merchant_id": self.merchant_id,
            "customer_id": self.customer_id,
            "amount": self.amount,
            "leak_type": self.leak_type,
            "payment_method": self.payment_method,
            "failure_code": self.failure_code,
            "prior_successful_payments": self.prior_successful_payments,
            "ltv_bucket": self.ltv_bucket,
            "retries_so_far": self.retries_so_far,
            "hours_since_event": self.hours_since_event,
            "age_days": self.age_days,
            "event_time": self.event_time,
            "merchant_segment": self.merchant_segment,
            "payment_id": self.payment_id,
            "visit_count": self.visit_count,
            "reached_payment_page": self.reached_payment_page,
            "consecutive_failures": self.consecutive_failures,
            "subscription_age_days": self.subscription_age_days,
            "contacts_today": self.contacts_today,
            "model_recovery_prob": self.model_recovery_prob,
        }


@dataclass
class Decision:
    decision_id: str
    leak_id: str
    transaction_id: str
    candidates_evaluated: List[Dict[str, Any]]
    ai_proposed_action: str
    ai_proposed_ev: float
    ai_proposed_probability: float
    policy_allowed: bool
    policy_reason: str
    final_action: str
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "leak_id": self.leak_id,
            "transaction_id": self.transaction_id,
            "candidates_evaluated": self.candidates_evaluated,
            "ai_proposed_action": self.ai_proposed_action,
            "ai_proposed_ev": self.ai_proposed_ev,
            "ai_proposed_probability": self.ai_proposed_probability,
            "policy_allowed": self.policy_allowed,
            "policy_reason": self.policy_reason,
            "final_action": self.final_action,
            "created_at": self.created_at,
        }


@dataclass
class Intervention:
    intervention_id: str
    decision_id: str
    leak_id: str
    transaction_id: str
    customer_id: str
    merchant_id: str
    amount: float
    ai_proposed_action: str
    policy_allowed: bool
    policy_reason: str
    final_action: str
    provider: str
    status: str
    recovered: bool
    recovered_amount: float
    timestamp: str
    execution_probability_used: Optional[float] = None
    idempotency_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intervention_id": self.intervention_id,
            "decision_id": self.decision_id,
            "leak_id": self.leak_id,
            "transaction_id": self.transaction_id,
            "customer_id": self.customer_id,
            "merchant_id": self.merchant_id,
            "amount": self.amount,
            "ai_proposed_action": self.ai_proposed_action,
            "policy_allowed": self.policy_allowed,
            "policy_reason": self.policy_reason,
            "final_action": self.final_action,
            "provider": self.provider,
            "status": self.status,
            "recovered": self.recovered,
            "recovered_amount": self.recovered_amount,
            "timestamp": self.timestamp,
            "execution_probability_used": self.execution_probability_used,
            "idempotency_key": self.idempotency_key,
        }


@dataclass
class AuditEvent:
    event_id: str
    merchant_id: str
    transaction_id: str
    leak_id: str
    decision_id: Optional[str]
    intervention_id: Optional[str]
    timestamp: str
    event_type: str
    action: str
    policy_result: Dict[str, Any]
    policy_version: str = "1.0.0"
    model_version: str = "1.0.0"
    provider: str = "SimulationProvider"
    outcome: Optional[Dict[str, Any]] = None
    correlation_id: Optional[str] = None
    idempotency_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "merchant_id": self.merchant_id,
            "transaction_id": self.transaction_id,
            "leak_id": self.leak_id,
            "decision_id": self.decision_id,
            "intervention_id": self.intervention_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "action": self.action,
            "policy_result": self.policy_result,
            "policy_version": self.policy_version,
            "model_version": self.model_version,
            "provider": self.provider,
            "outcome": self.outcome,
            "correlation_id": self.correlation_id,
            "idempotency_key": self.idempotency_key,
        }
