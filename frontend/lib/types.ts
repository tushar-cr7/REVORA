export interface ScanResponse {
  total_transactions_scanned: number;
  total_at_risk: number;
  breakdown: Array<{
    leak_type: string;
    amount_at_risk: number;
    count: number;
  }>;
}

export interface AnalyzeResponse {
  total_at_risk: number;
  realistically_recoverable: number;
  explanation: string;
  proposed_action_counts: Record<string, number>;
  policy_blocked_count: number;
  avg_recovery_probability: number;
  model_metadata: {
    model_version: string;
    dataset_type: string;
    metrics: {
      auc: number;
      brier: number;
    };
  };
}

export interface RecoverResponse {
  total_at_risk: number;
  total_recovered: number;
  recovery_rate_pct: number;
  actions_executed: {
    retry: number;
    payment_link: number;
    reminder: number;
    escalate: number;
    suppress: number;
  };
  recovered_count: number;
  attempted_count: number;
  avg_recovery_value: number;
  intervention_success_rate_pct: number;
  policy_violations: number;
}

export interface Transaction {
  transaction_id: string;
  leak_id: string;
  merchant_id: string;
  customer_id: string;
  amount: number;
  leak_type: 'failed_payment' | 'abandoned_checkout' | 'failed_subscription' | 'overdue_invoice';
  payment_method: string;
  failure_code: string;
  prior_successful_payments: number;
  ltv_bucket: 'high' | 'medium' | 'low';
  retries_so_far: number;
  hours_since_event: number;
  age_days: number;
  event_time: string;
  merchant_segment: string;
  payment_id?: string | null;
  visit_count?: number;
  reached_payment_page?: boolean;
  consecutive_failures?: number;
  subscription_age_days?: number;
  contacts_today?: number;
  model_recovery_prob?: number;
}

export interface CandidateEvaluation {
  action: string;
  probability: number;
  expected_value: number;
  cost: number;
  friction: number;
}

export interface Decision {
  decision_id: string;
  leak_id: string;
  transaction_id: string;
  candidates_evaluated: CandidateEvaluation[];
  ai_proposed_action: string;
  ai_proposed_ev: number;
  ai_proposed_probability: number;
  policy_allowed: boolean;
  policy_reason: string;
  final_action: string;
  created_at: string;
}

export interface Intervention {
  intervention_id: string;
  decision_id: string;
  leak_id: string;
  transaction_id: string;
  customer_id: string;
  merchant_id: string;
  amount: number;
  ai_proposed_action: string;
  policy_allowed: boolean;
  policy_reason: string;
  final_action: string;
  provider: string;
  status: 'recovered' | 'attempted_no_recovery' | 'suppressed' | 'escalated_to_merchant';
  recovered: boolean;
  recovered_amount: number;
  timestamp: string;
  execution_probability_used?: number;
  idempotency_key?: string;
}

export interface AuditEvent {
  event_id: string;
  merchant_id: string;
  transaction_id: string;
  leak_id: string;
  decision_id?: string;
  intervention_id?: string;
  timestamp: string;
  event_type: string;
  action: string;
  policy_result: {
    allowed: boolean;
    reason: string;
    final_action?: string;
  };
  policy_version: string;
  model_version: string;
  provider: string;
  outcome?: {
    status?: string;
    recovered?: boolean;
    recovered_amount?: number;
  };
  correlation_id?: string;
  idempotency_key?: string;
}

export interface Opportunity {
  transaction_id: string;
  leak_id: string;
  customer_id: string;
  leak_type: 'failed_payment' | 'abandoned_checkout' | 'failed_subscription' | 'overdue_invoice';
  amount: number;
  recovery_probability: number;
  expected_recovery: number;
  recommended_action: string;
  policy_allowed: boolean;
  policy_reason: string;
}

export interface PolicyLimits {
  max_retries: number;
  min_cooldown_hours: number;
  max_customer_contacts_per_day: number;
  max_auto_recovery_value: number;
  max_subscription_consecutive_failures_for_retry: number;
  invoice_escalation_age_days: number;
}

export interface SimulateResponse {
  total_transactions: number;
  policy_applied: PolicyLimits;
  proposed_action_counts: Record<string, number>;
  blocked_count: number;
  simulated_total_expected_value: number;
}

export interface ForceRetryBlockResponse {
  leak_id: string;
  transaction_id: string;
  leak_type: string;
  amount: number;
  attempted_action: string;
  policy_allowed: boolean;
  policy_reason: string;
  final_action: string;
}

export interface InterventionsResponse {
  total: number;
  interventions: Intervention[];
}

export interface EscalationsResponse {
  total: number;
  escalations: Decision[];
}

export interface AnalyticsResponse {
  total_at_risk: number;
  total_recovered: number;
  recovery_rate_pct: number;
  recovered_count: number;
  attempted_count: number;
  intervention_success_rate_pct: number;
  policy_blocked_count: number;
  escalation_count: number;
}

export interface CopilotResponse {
  query: string;
  headline: string;
  answer: string;
  key_metrics: Record<string, any>;
  recommendations: string[];
  guardrail_status: string;
  model_attribution?: Record<string, any> | null;
}

