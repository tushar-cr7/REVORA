from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class ScanRequest(BaseModel):
    n_total: int = Field(default=10000, ge=10, le=50000)
    seed: int = Field(default=42)
    merchant_id: str = Field(default="merch_001")


class ScanResponse(BaseModel):
    total_transactions_scanned: int
    total_at_risk: float
    breakdown: List[Dict[str, Any]]


class AnalyzeResponse(BaseModel):
    total_at_risk: float
    realistically_recoverable: float
    explanation: str
    proposed_action_counts: Dict[str, int]
    policy_blocked_count: int
    avg_recovery_probability: float
    model_metadata: Dict[str, Any]


class RecoverResponse(BaseModel):
    total_at_risk: float
    total_recovered: float
    recovery_rate_pct: float
    actions_executed: Dict[str, int]
    recovered_count: int
    attempted_count: int
    avg_recovery_value: float
    intervention_success_rate_pct: float
    policy_violations: int


class AuditLogResponse(BaseModel):
    total: int
    entries: List[Dict[str, Any]]


class PolicySimulateRequest(BaseModel):
    max_retries: Optional[int] = 2
    min_cooldown_hours: Optional[int] = 6
    max_customer_contacts_per_day: Optional[int] = 1
    max_auto_recovery_value: Optional[float] = 25000.0
    max_subscription_consecutive_failures_for_retry: Optional[int] = 2
    invoice_escalation_age_days: Optional[int] = 30


class PolicySimulateResponse(BaseModel):
    total_transactions: int
    policy_applied: Dict[str, Any]
    proposed_action_counts: Dict[str, int]
    blocked_count: int
    simulated_total_expected_value: float


class ForceRetryBlockResponse(BaseModel):
    leak_id: str
    transaction_id: str
    leak_type: str
    amount: float
    attempted_action: str
    policy_allowed: bool
    policy_reason: str
    final_action: str


class InterventionsResponse(BaseModel):
    total: int
    interventions: List[Dict[str, Any]]


class EscalationsResponse(BaseModel):
    total: int
    escalations: List[Dict[str, Any]]


class AnalyticsResponse(BaseModel):
    total_at_risk: float
    total_recovered: float
    recovery_rate_pct: float
    recovered_count: int
    attempted_count: int
    intervention_success_rate_pct: float
    policy_blocked_count: int
    escalation_count: int


class CopilotQueryRequest(BaseModel):
    query: str
    transaction_id: Optional[str] = None


class CopilotQueryResponse(BaseModel):
    query: str
    headline: str
    answer: str
    key_metrics: Dict[str, Any]
    recommendations: List[str]
    guardrail_status: str
    model_attribution: Optional[Dict[str, Any]] = None

