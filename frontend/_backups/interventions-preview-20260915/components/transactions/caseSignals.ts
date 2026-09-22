import { Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';

/** The overall state of a revenue case, derived only from real records. */
export type CaseState = 'completed' | 'paused' | 'ready' | 'unanalyzed';

export interface CaseStateMeta {
  state: CaseState;
  badge: string;
  badgeCls: string;
}

export function deriveCaseState(decision: Decision | null, intervention: Intervention | null): CaseStateMeta {
  if (intervention) {
    return intervention.recovered
      ? { state: 'completed', badge: 'Recovery completed', badgeCls: 'bg-success-muted text-success-300 border-success-500/40' }
      : { state: 'completed', badge: 'Action completed', badgeCls: 'bg-surface text-text-secondary border-border-strong' };
  }
  if (!decision) {
    return { state: 'unanalyzed', badge: 'Needs attention', badgeCls: 'bg-surface text-text-muted border-border-strong' };
  }
  if (!decision.policy_allowed) {
    return { state: 'paused', badge: 'Action paused', badgeCls: 'bg-warning-muted text-warning-300 border-warning-500/40' };
  }
  return { state: 'ready', badge: 'Ready for recovery', badgeCls: 'bg-success-muted text-success-300 border-success-500/40' };
}

export type EvidenceTone = 'neutral' | 'warning' | 'positive';

export interface Evidence {
  label: string;
  value: string;
  tone: EvidenceTone;
}

/**
 * The strongest signals this transaction actually carries. Every entry is a
 * real field off the transaction record — nothing is inferred or invented,
 * and entries are skipped entirely when the underlying field is absent.
 */
export function buildEvidence(tx: Transaction): Evidence[] {
  const out: Evidence[] = [];

  if (tx.age_days > 0) {
    out.push({
      label: 'Outstanding',
      value: `${tx.age_days} ${tx.age_days === 1 ? 'day' : 'days'}`,
      tone: tx.age_days >= 30 ? 'warning' : 'neutral',
    });
  } else {
    out.push({ label: 'Outstanding', value: `${tx.hours_since_event}h`, tone: 'neutral' });
  }

  out.push({
    label: 'Recovery attempts',
    value: `${tx.retries_so_far}`,
    tone: tx.retries_so_far >= 2 ? 'warning' : 'neutral',
  });

  out.push({
    label: 'Customer value',
    value: `${tx.ltv_bucket.toUpperCase()} LTV`,
    tone: tx.ltv_bucket === 'high' ? 'positive' : 'neutral',
  });

  out.push({
    label: 'Prior successful payments',
    value: `${tx.prior_successful_payments}`,
    tone: tx.prior_successful_payments >= 3 ? 'positive' : 'neutral',
  });

  if (tx.consecutive_failures != null && tx.consecutive_failures > 0) {
    out.push({
      label: 'Consecutive failures',
      value: `${tx.consecutive_failures}`,
      tone: tx.consecutive_failures >= 3 ? 'warning' : 'neutral',
    });
  }

  if (tx.leak_type === 'abandoned_checkout' && tx.visit_count != null) {
    out.push({ label: 'Checkout visits', value: `${tx.visit_count}`, tone: 'neutral' });
  }

  return out;
}

/**
 * One plain-language sentence assembled only from facts already present on
 * the transaction. Returns null rather than filler when nothing solid
 * applies, so the panel can simply omit the line.
 */
export function buildRationale(tx: Transaction, decision: Decision | null): string | null {
  if (!decision) return null;
  const facts: string[] = [];

  if (tx.retries_so_far === 0) {
    facts.push('no recovery attempt has been made yet');
  } else {
    facts.push(`${tx.retries_so_far} recovery ${tx.retries_so_far === 1 ? 'attempt has' : 'attempts have'} already been made`);
  }

  if (tx.prior_successful_payments >= 3) {
    facts.push(`this customer has ${tx.prior_successful_payments} prior successful payments`);
  } else if (tx.prior_successful_payments === 0) {
    facts.push('this customer has no prior successful payments on file');
  }

  if (tx.ltv_bucket === 'high') {
    facts.push('they sit in the high lifetime-value segment');
  }

  if (facts.length === 0) return null;
  const sentence = facts.join(', and ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

export interface SafetyCheck {
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Named recovery controls evaluated against the live policy limits returned
 * by the API. These are supporting detail only — the authoritative verdict
 * stays the backend's own policy_allowed / policy_reason on the decision.
 */
export function buildSafetyChecks(tx: Transaction, policy: PolicyLimits | null): SafetyCheck[] {
  if (!policy) return [];
  const checks: SafetyCheck[] = [];

  checks.push({
    label: 'Retry limit',
    passed: tx.retries_so_far < policy.max_retries,
    detail: `${tx.retries_so_far} of ${policy.max_retries} attempts used`,
  });

  if (tx.contacts_today != null) {
    checks.push({
      label: 'Contact window',
      passed: tx.contacts_today < policy.max_customer_contacts_per_day,
      detail: `${tx.contacts_today} of ${policy.max_customer_contacts_per_day} contacts today`,
    });
  }

  checks.push({
    label: 'Auto-recovery ceiling',
    passed: tx.amount <= policy.max_auto_recovery_value,
    detail: `Case value within the ₹${policy.max_auto_recovery_value.toLocaleString('en-IN')} limit`,
  });

  if (tx.leak_type === 'failed_subscription' && tx.consecutive_failures != null) {
    checks.push({
      label: 'Subscription health',
      passed: tx.consecutive_failures <= policy.max_subscription_consecutive_failures_for_retry,
      detail: `${tx.consecutive_failures} consecutive failures (limit ${policy.max_subscription_consecutive_failures_for_retry})`,
    });
  }

  return checks;
}

export type NodeState = 'done' | 'active' | 'blocked' | 'pending';

export interface SignalNode {
  key: string;
  label: string;
  state: NodeState;
}

/**
 * The four-stage signal path. Each node's state comes from whether the
 * underlying record actually exists, never from a guess.
 */
export function buildSignalPath(
  tx: Transaction,
  decision: Decision | null,
  intervention: Intervention | null
): SignalNode[] {
  const scored = tx.model_recovery_prob != null;

  let recoveryState: NodeState;
  if (intervention) recoveryState = intervention.recovered ? 'done' : 'blocked';
  else if (!decision) recoveryState = 'pending';
  else if (!decision.policy_allowed) recoveryState = 'blocked';
  else recoveryState = 'active';

  return [
    { key: 'event', label: 'Event', state: 'done' },
    { key: 'leak', label: 'Leak', state: 'done' },
    { key: 'signals', label: 'Signals', state: scored ? 'done' : 'pending' },
    { key: 'recovery', label: 'Recovery', state: recoveryState },
  ];
}

export const ACTION_LABEL: Record<string, string> = {
  retry: 'Retry payment',
  payment_link: 'Payment link',
  reminder: 'Reminder',
  escalate: 'Escalate',
  suppress: 'Suppress',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ');
}

export const OUTCOME_LABEL: Record<string, string> = {
  recovered: 'Recovered',
  attempted_no_recovery: 'Attempted — not recovered',
  suppressed: 'Suppressed',
  escalated_to_merchant: 'Escalated to merchant',
};
