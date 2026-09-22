import { Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';
import { ACTION_LABEL, actionLabel, OUTCOME_LABEL, buildSafetyChecks, buildRationale, SafetyCheck } from '@/lib/actionMeta';

// Re-exported for existing importers (TransactionDrawer.tsx) — these are
// now shared with Interventions via lib/actionMeta.ts, defined once there.
export { ACTION_LABEL, actionLabel, OUTCOME_LABEL, buildSafetyChecks, buildRationale };
export type { SafetyCheck };

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

