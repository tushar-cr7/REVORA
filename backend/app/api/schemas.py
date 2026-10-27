from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from backend.app.domain.models import Action


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
    # Scan run identity. `reused_existing_run` is true when this scan's source data (merchant,
    # size, seed) matched an earlier run, which was re-activated with its state intact.
    run_id: Optional[str] = None
    reused_existing_run: bool = False
    superseded_run_id: Optional[str] = None


class AnalyzeResponse(BaseModel):
    total_at_risk: float
    realistically_recoverable: float
    explanation: str
    proposed_action_counts: Dict[str, int]
    policy_blocked_count: int
    avg_recovery_probability: float
    model_metadata: Dict[str, Any]
    run_id: Optional[str] = None


class RecoverResponse(BaseModel):
    total_at_risk: float
    total_recovered: float
    recovery_rate_pct: float
    actions_executed: Dict[str, int]
    recovered_count: int
    attempted_count: int
    avg_recovery_value: float
    intervention_success_rate_pct: float
    # Computed from the attempt ledger: attempts that ran without an allowed execution-time authorization.
    policy_violations: int
    # Totals above are for the whole active run (unique outcomes). The *_now fields describe this call only.
    run_id: Optional[str] = None
    execution_mode: Optional[str] = None
    executed_now: int = 0
    recovered_now: int = 0
    not_recovered_now: int = 0
    suppressed_now: int = 0
    escalated_now: int = 0
    failed_now: int = 0
    blocked_now: int = 0
    skipped_now: int = 0


class AuditLogResponse(BaseModel):
    # `total` is the number of entries returned (after `limit`); `matched` and
    # `counts_by_type` describe the full filtered log before the limit.
    total: int
    entries: List[Dict[str, Any]]
    matched: Optional[int] = None
    counts_by_type: Dict[str, int] = Field(default_factory=dict)


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
    # Amount of cases that had at least one recovery attempt (not the same as recovered).
    attempted_amount: float = 0.0
    run_id: Optional[str] = None
    execution_mode: Optional[str] = None  # "simulation": nothing was sent to a payment network


class ExecuteRequest(BaseModel):
    """Optional body for POST /interventions/{id}/execute."""
    # Guard: execute only if the case's currently authorized action is this one.
    expected_action: Optional[Action] = None


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

