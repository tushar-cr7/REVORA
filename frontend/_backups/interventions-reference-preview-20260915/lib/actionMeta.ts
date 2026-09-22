import { Decision, PolicyLimits, Transaction } from './types';

/**
 * Shared, presentation-only derivations for REVORA's closed recovery-action
 * vocabulary (retry / payment_link / reminder / escalate / suppress) and
 * intervention outcomes. Used by both Transactions and Interventions so the
 * same action reads identically everywhere in the app.
 */

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

/** What each action type actually does in the product — static, honest, not per-instance data. */
export const ACTION_PREVIEW: Record<string, string> = {
  retry: 'REVORA attempts the payment again through the original payment method.',
  payment_link: 'The customer receives a new secure payment link to complete the transaction.',
  reminder: 'The customer receives a reminder to complete their pending payment.',
  escalate: 'This case moves to the escalation queue for manual follow-up.',
  suppress: 'REVORA will not attempt further automated recovery on this transaction.',
};

export interface SafetyCheck {
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Named recovery controls evaluated against the live policy limits returned
 * by the API. Supporting detail only — the authoritative verdict stays the
 * backend's own policy_allowed / policy_reason.
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

/**
 * One plain-language sentence assembled only from facts already present on
 * the transaction. Returns null rather than filler when nothing solid
 * applies, so a panel can simply omit the line.
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
