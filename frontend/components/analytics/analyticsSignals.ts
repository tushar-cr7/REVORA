import { AnalyticsResponse, Intervention, Opportunity, Transaction } from '@/lib/types';
import { actionLabel } from '@/lib/actionMeta';
import { LEAK_TYPES } from '@/components/transactions/transactionSignals';
import {
  deriveQueue,
  latestByTransaction,
  leakLabel,
  riskComposition,
} from '@/components/interventions/interventionSignals';

export { deriveQueue, latestByTransaction, leakLabel, riskComposition };

/**
 * Every figure below is derived from the same records the rest of the app
 * already trusts (`GET /api/analytics`, `/api/interventions`,
 * `/api/opportunities`, `/api/transactions`) — nothing here is invented.
 * `interventions` passed in must already be deduped with
 * `latestByTransaction` (see CLAUDE.md §7/§17: the same transaction can be
 * executed more than once, and the raw `/api/analytics` aggregate does not
 * account for that).
 */

/* ────────────────────────────── outcome totals ────────────────────────────── */

export interface OutcomeTotals {
  totalAtRisk: number;
  recoveredAmount: number;
  recoveredCount: number;
  attemptedCount: number;
  notRecoveredAmount: number;
  notRecoveredCount: number;
  stillAtRiskAmount: number;
  recoveryRatePct: number;
  queueReadyAmount: number;
  queueBlockedAmount: number;
  needsAttentionCount: number;
  policyBlockedCount: number;
  escalationCount: number;
}

const ATTEMPT_ACTIONS = new Set(['retry', 'payment_link', 'reminder']);

export function computeOutcomeTotals(
  analytics: AnalyticsResponse,
  queue: Opportunity[],
  interventions: Intervention[]
): OutcomeTotals {
  const recovered = interventions.filter((i) => i.recovered);
  const attempted = interventions.filter((i) => ATTEMPT_ACTIONS.has(i.final_action));
  const notRecovered = attempted.filter((i) => !i.recovered);

  const recoveredAmount = recovered.reduce((s, i) => s + i.recovered_amount, 0);
  const notRecoveredAmount = notRecovered.reduce((s, i) => s + i.amount, 0);
  const queueReadyAmount = queue.filter((o) => o.policy_allowed).reduce((s, o) => s + o.amount, 0);
  const queueBlockedAmount = queue.filter((o) => !o.policy_allowed).reduce((s, o) => s + o.amount, 0);

  const totalAtRisk = analytics.total_at_risk;
  const stillAtRiskAmount = Math.max(0, totalAtRisk - recoveredAmount);

  return {
    totalAtRisk,
    recoveredAmount,
    recoveredCount: recovered.length,
    attemptedCount: attempted.length,
    notRecoveredAmount,
    notRecoveredCount: notRecovered.length,
    stillAtRiskAmount,
    recoveryRatePct: totalAtRisk > 0 ? (recoveredAmount / totalAtRisk) * 100 : 0,
    queueReadyAmount,
    queueBlockedAmount,
    needsAttentionCount:
      queue.filter((o) => !o.policy_allowed).length +
      interventions.filter((i) => i.status === 'escalated_to_merchant' || i.status === 'attempted_no_recovery').length,
    policyBlockedCount: analytics.policy_blocked_count,
    escalationCount: analytics.escalation_count,
  };
}

/* ────────────────────────────── composition ────────────────────────────── */

export type CompositionTone = 'success' | 'risk' | 'primary' | 'warning' | 'neutral';

export interface CompositionSegment {
  key: string;
  label: string;
  amount: number;
  count: number | null;
  tone: CompositionTone;
  caption: string;
}

/**
 * The entire scanned revenue universe (`total_at_risk`), accounted for
 * segment by segment. The last segment is a deliberate remainder, not a
 * directly-fetched figure: there is no endpoint that returns suppressed
 * transactions on their own (`/api/opportunities` excludes them by design,
 * per CLAUDE.md §7), so what's left after every other real bucket is
 * captioned honestly rather than asserting false precision.
 */
export function buildRecoveryComposition(totals: OutcomeTotals): CompositionSegment[] {
  const accounted =
    totals.recoveredAmount + totals.notRecoveredAmount + totals.queueReadyAmount + totals.queueBlockedAmount;
  const remainder = Math.max(0, totals.totalAtRisk - accounted);

  return [
    {
      key: 'recovered',
      label: 'Recovered',
      amount: totals.recoveredAmount,
      count: totals.recoveredCount,
      tone: 'success',
      caption: 'Revenue REVORA actually brought back.',
    },
    {
      key: 'not_recovered',
      label: 'Attempted, not recovered',
      amount: totals.notRecoveredAmount,
      count: totals.notRecoveredCount,
      tone: 'risk',
      caption: 'REVORA tried; the customer did not pay.',
    },
    {
      key: 'queue_ready',
      label: 'Ready to recover',
      amount: totals.queueReadyAmount,
      count: null,
      tone: 'primary',
      caption: 'Decided, within safety limits, not yet executed.',
    },
    {
      key: 'queue_blocked',
      label: 'Held by recovery controls',
      amount: totals.queueBlockedAmount,
      count: null,
      tone: 'warning',
      caption: 'Paused for merchant review before any action runs.',
    },
    {
      key: 'remainder',
      label: 'Not yet in the recovery queue',
      amount: remainder,
      count: null,
      tone: 'neutral',
      caption: "Suppressed by REVORA's safety rules, or not yet reached by a decision pass.",
    },
  ];
}

/* ────────────────────────────── recovery by action ────────────────────────────── */

export const RECOVERY_ACTIONS = ['retry', 'payment_link', 'reminder', 'escalate', 'suppress'] as const;

export interface ActionOutcomeRow {
  action: string;
  label: string;
  recoveredAmount: number;
  recoveredCount: number;
  notRecoveredAmount: number;
  attemptedCount: number;
  notRecoveredCount: number;
  successRatePct: number | null;
  isAttemptType: boolean;
}

export function buildActionOutcomes(interventions: Intervention[]): ActionOutcomeRow[] {
  return RECOVERY_ACTIONS.map((action) => {
    const rows = interventions.filter((i) => i.final_action === action);
    const isAttemptType = ATTEMPT_ACTIONS.has(action);
    const recoveredRows = rows.filter((i) => i.recovered);
    const notRecoveredRows = rows.filter((i) => !i.recovered);
    const recoveredAmount = recoveredRows.reduce((s, i) => s + i.recovered_amount, 0);
    const notRecoveredAmount = notRecoveredRows.reduce((s, i) => s + i.amount, 0);

    return {
      action,
      label: actionLabel(action),
      recoveredAmount,
      recoveredCount: recoveredRows.length,
      notRecoveredAmount,
      attemptedCount: rows.length,
      notRecoveredCount: notRecoveredRows.length,
      successRatePct: isAttemptType && rows.length > 0 ? (recoveredRows.length / rows.length) * 100 : null,
      isAttemptType,
    };
  }).filter((row) => row.attemptedCount > 0);
}

/* ────────────────────────────── recovery by leak type ────────────────────────────── */

export interface LeakOutcomeRow {
  leakType: string;
  label: string;
  recoveredAmount: number;
  recoveredCount: number;
  stillAtRiskAmount: number;
}

/**
 * Pairs recovered revenue (from executed interventions) against revenue
 * still in the live queue (`riskComposition`, already shared with
 * Interventions), one row per leak type. `txById` classifies each
 * intervention's leak type — `Intervention` carries no `leak_type` field of
 * its own, only `transaction_id` — so this is only as complete as the
 * transaction map passed in. Unclassifiable interventions are reported
 * separately by the caller rather than silently attributed to the wrong type.
 */
export function buildLeakOutcomes(
  interventions: Intervention[],
  queue: Opportunity[],
  txById: Map<string, Transaction>
): { rows: LeakOutcomeRow[]; unclassifiedRecoveredAmount: number; unclassifiedCount: number } {
  const atRisk = riskComposition(queue);
  const atRiskByType = new Map(atRisk.map((s) => [s.leakType, s.amount]));

  let unclassifiedRecoveredAmount = 0;
  let unclassifiedCount = 0;

  const recoveredByType = new Map<string, { amount: number; count: number }>();
  for (const i of interventions) {
    if (!i.recovered) continue;
    const leakType = txById.get(i.transaction_id)?.leak_type;
    if (!leakType) {
      unclassifiedRecoveredAmount += i.recovered_amount;
      unclassifiedCount += 1;
      continue;
    }
    const existing = recoveredByType.get(leakType) ?? { amount: 0, count: 0 };
    existing.amount += i.recovered_amount;
    existing.count += 1;
    recoveredByType.set(leakType, existing);
  }

  const rows = LEAK_TYPES.map((leakType) => {
    const recovered = recoveredByType.get(leakType);
    return {
      leakType,
      label: leakLabel(leakType),
      recoveredAmount: recovered?.amount ?? 0,
      recoveredCount: recovered?.count ?? 0,
      stillAtRiskAmount: atRiskByType.get(leakType) ?? 0,
    };
  }).filter((row) => row.recoveredAmount > 0 || row.stillAtRiskAmount > 0);

  return { rows, unclassifiedRecoveredAmount, unclassifiedCount };
}

/* ────────────────────────────── insights ────────────────────────────── */

export interface Insight {
  id: string;
  text: string;
}

/** What's genuinely working, stated only from computed facts — never AI-generated prose. */
export function buildWhatsWorking(actionRows: ActionOutcomeRow[], leakRows: LeakOutcomeRow[]): Insight[] {
  const insights: Insight[] = [];

  const bestAction = [...actionRows]
    .filter((r) => r.isAttemptType && r.successRatePct != null && r.attemptedCount >= 1)
    .sort((a, b) => (b.successRatePct ?? 0) - (a.successRatePct ?? 0))[0];
  if (bestAction) {
    insights.push({
      id: 'best-action',
      text: `${bestAction.label} is REVORA's most effective recovery method right now, converting ${bestAction.successRatePct!.toFixed(0)}% of ${bestAction.attemptedCount} attempt${bestAction.attemptedCount === 1 ? '' : 's'}.`,
    });
  }

  const bestLeak = [...leakRows].filter((r) => r.recoveredAmount > 0).sort((a, b) => b.recoveredAmount - a.recoveredAmount)[0];
  if (bestLeak) {
    insights.push({
      id: 'best-leak',
      text: `${bestLeak.label} recoveries lead by value — ${bestLeak.recoveredCount} case${bestLeak.recoveredCount === 1 ? '' : 's'} recovered from this leak type so far.`,
    });
  }

  if (insights.length === 0) {
    insights.push({ id: 'none', text: 'No recovery actions have completed yet — execute a case from Interventions to see what works.' });
  }

  return insights;
}

/** Where a human is still needed, stated only from computed facts. */
export function buildWhereAttentionRemains(totals: OutcomeTotals): Insight[] {
  const insights: Insight[] = [];

  if (totals.queueBlockedAmount > 0) {
    insights.push({
      id: 'blocked',
      text: `${formatCount(totals.policyBlockedCount)} decisions have been blocked or downgraded by recovery controls and are waiting on merchant review.`,
    });
  }
  if (totals.escalationCount > 0) {
    insights.push({
      id: 'escalations',
      text: `${formatCount(totals.escalationCount)} cases have been rerouted to escalation — see the Escalations page to act on them.`,
    });
  }
  if (totals.notRecoveredCount > 0) {
    insights.push({
      id: 'not-recovered',
      text: `${formatCount(totals.notRecoveredCount)} recovery attempts did not succeed, representing ₹${Math.round(totals.notRecoveredAmount).toLocaleString('en-IN')} still unresolved.`,
    });
  }
  if (insights.length === 0) {
    insights.push({ id: 'clear', text: 'Nothing is currently blocked, escalated, or unresolved.' });
  }

  return insights;
}

function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}
