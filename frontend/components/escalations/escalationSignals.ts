import { Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';
import { leakLabel } from '@/components/interventions/interventionSignals';

/**
 * Escalations are the subset of REVORA's decisions where the deterministic
 * policy engine (or the AI's own expected-value scoring) settled on
 * `final_action === "escalate"` — see `backend/app/domain/policy.py` and
 * `backend/app/intelligence/decision_engine.py`. `GET /api/escalations`
 * returns exactly those `Decision` records. Everything in this file is a
 * transparent, documented derivation over that real data plus the joined
 * `Transaction` and `Intervention` records — nothing here is invented.
 */

/**
 * `POST /api/analyze` can be run more than once, and each run writes a
 * fresh `Decision` (with its own `decision_id`) for every transaction —
 * the in-memory repo keys decisions by `decision_id`, `leak_id` *and*
 * `transaction_id`, so an earlier decision's `decision_id` entry survives
 * even after a re-analyze overwrites the `leak_id`/`transaction_id`
 * lookups. `GET /api/escalations` dedupes by `decision_id`, so if an
 * earlier analysis pass also escalated the same transaction, both records
 * can come back. This mirrors the documented multi-`Intervention`-per-
 * transaction case for Interventions (see
 * `interventionSignals.ts#latestByTransaction`): for every display
 * purpose here, "this transaction's escalation" means the most recent
 * decision, so a case is never shown or counted twice.
 */
export function latestDecisionsByTransaction(decisions: Decision[]): Decision[] {
  const latest = new Map<string, Decision>();
  for (const d of decisions) {
    const existing = latest.get(d.transaction_id);
    if (!existing || new Date(d.created_at).getTime() > new Date(existing.created_at).getTime()) {
      latest.set(d.transaction_id, d);
    }
  }
  return Array.from(latest.values());
}

/* ─────────────────────────────── case join ─────────────────────────────── */

export interface EscalationCase {
  decision: Decision;
  tx: Transaction | null;
  /** The Intervention record if this case has already been formally routed to the merchant queue, else null. */
  intervention: Intervention | null;
}

/**
 * `Decision` alone carries no amount, leak type or customer — those live on
 * the `Transaction`. `Intervention` tells us whether this case has already
 * been executed: per `SimulationProvider.execute`, running an `escalate`
 * decision produces a record with `status === "escalated_to_merchant"` and
 * `recovered: false` (never a real payment) — the closest thing this
 * architecture has to "this case has been formally handed to a human."
 */
export function buildEscalationCases(
  decisions: Decision[],
  txById: Map<string, Transaction>,
  latestInterventionByTx: Map<string, Intervention>
): EscalationCase[] {
  return decisions.map((decision) => ({
    decision,
    tx: txById.get(decision.transaction_id) ?? txById.get(decision.leak_id) ?? null,
    intervention: latestInterventionByTx.get(decision.transaction_id) ?? null,
  }));
}

export function caseAmount(c: EscalationCase): number {
  return c.tx?.amount ?? 0;
}

export function caseLeakType(c: EscalationCase): string | undefined {
  return c.tx?.leak_type;
}

export function caseCustomerId(c: EscalationCase): string {
  return c.tx?.customer_id ?? c.decision.transaction_id;
}

/** Hours since the underlying leak occurred — the one age signal every leak type carries (see data_gen.py). */
export function caseAgeHours(c: EscalationCase): number | null {
  return c.tx?.hours_since_event ?? null;
}

export function isRoutedToMerchant(c: EscalationCase): boolean {
  return c.intervention?.status === 'escalated_to_merchant';
}

/* ─────────────────────────────── reason ─────────────────────────────── */

export type ReasonKey =
  | 'retry_limit'
  | 'auto_recovery_ceiling'
  | 'subscription_threshold'
  | 'invoice_age'
  | 'manual_review'
  | 'policy_controlled';

export const REASON_LABEL: Record<ReasonKey, string> = {
  retry_limit: 'Retry limit reached',
  auto_recovery_ceiling: 'Autonomous recovery ceiling exceeded',
  subscription_threshold: 'Subscription failure threshold reached',
  invoice_age: 'Invoice age threshold reached',
  manual_review: 'Action requires manual review',
  policy_controlled: 'Policy-controlled escalation',
};

/**
 * `evaluate_policy()` in `backend/app/domain/policy.py` produces exactly
 * four distinct block reasons that reroute a case to `escalate`, each with
 * a fixed, recognizable message. This maps those known strings back to a
 * business-readable category — string-matched, not invented. A decision
 * can also reach `final_action === "escalate"` because the AI's own
 * expected-value scoring picked `escalate` as the best candidate for a
 * `failed_subscription` or `overdue_invoice` case (see `CANDIDATE_ACTIONS`
 * in `decision_engine.py`) — in that case `policy_allowed` is `true` and
 * `policy_reason` is the generic `"Within policy."`, meaning no control
 * boundary was hit; REVORA itself decided this needs a human. Anything
 * that doesn't match a known pattern falls back to a generic, still-honest
 * label rather than guessing.
 */
export function reasonKey(decision: Decision): ReasonKey {
  const r = decision.policy_reason || '';
  if (!decision.policy_allowed) {
    if (r.startsWith('Retry limit exceeded')) return 'retry_limit';
    if (r.startsWith('Amount exceeds auto-recovery ceiling')) return 'auto_recovery_ceiling';
    if (r.startsWith('Consecutive subscription failures')) return 'subscription_threshold';
    if (r.startsWith('Invoice older than')) return 'invoice_age';
    return 'policy_controlled';
  }
  return 'manual_review';
}

export function reasonLabel(decision: Decision): string {
  return REASON_LABEL[reasonKey(decision)];
}

/**
 * One static, honest sentence per reason category — what REVORA suggests
 * a person actually do next. These describe the category in general, the
 * same way `ACTION_PREVIEW` in `lib/actionMeta.ts` describes what each
 * recovery action does; they are not generated per-case and never claim
 * anything about a specific customer.
 */
export const REASON_RECOMMENDATION: Record<ReasonKey, string> = {
  retry_limit:
    'REVORA has used up its automated retry attempts on this payment. A direct message to the customer, or offering an alternate payment method, is the most likely path to recovery now.',
  auto_recovery_ceiling:
    'This amount is above what REVORA is permitted to recover without a person involved. Review the case and follow up with the customer directly, or route it to your finance team.',
  subscription_threshold:
    'This subscription has failed too many times in a row for REVORA to keep retrying automatically. Reaching out before the subscription lapses gives the best chance of keeping it.',
  invoice_age:
    'This invoice has been outstanding longer than your policy allows for automated reminders. A direct follow-up, or escalation to collections, is the next step.',
  manual_review:
    "REVORA's own analysis found no automated action likely to recover this case cleanly, so it proposed escalation itself. A direct conversation with the customer is the most promising next step.",
  policy_controlled:
    'This case was rerouted by a recovery control. Review the details below before deciding how to proceed.',
};

/* ─────────────────────────────── priority ─────────────────────────────── */

export type Priority = 'critical' | 'high' | 'standard';

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  standard: 'Standard',
};

/**
 * No numeric priority score exists in the backend, so this ranks cases by
 * the one real, always-present signal that varies meaningfully across an
 * escalation queue: amount at risk relative to the rest of the current
 * queue. This is the same percentile technique Interventions already uses
 * for its own priority indicator (see
 * `interventionSignals.ts#buildPriorityMap`) — recomputed fresh from
 * whatever's actually loaded, rather than a fixed rupee threshold that
 * would drift meaningless as the mix of cases changes.
 *
 * `policy_allowed === false` (a control boundary actually stopped an
 * autonomous action — the "blocked" condition the product brief calls
 * out) is folded in as a floor rather than the primary signal: on a real
 * queue nearly every escalation is blocked for one control reason or
 * another, so treating "blocked" alone as CRITICAL would label the whole
 * queue identically and defeat the point of a priority column. A blocked
 * case can never rank below STANDARD, and the auto-recovery ceiling
 * breach — blocked *and* high-value by construction — always ranks
 * CRITICAL regardless of where it falls in the queue's amount spread.
 */
export function buildPriorityMap(cases: EscalationCase[]): Map<string, Priority> {
  const sorted = [...cases].sort((a, b) => caseAmount(a) - caseAmount(b));
  const n = sorted.length;

  const map = new Map<string, Priority>();
  sorted.forEach((c, i) => {
    const percentile = n <= 1 ? 1 : i / (n - 1);
    const blocked = !c.decision.policy_allowed;
    const ceilingBreach = reasonKey(c.decision) === 'auto_recovery_ceiling';

    let priority: Priority = percentile >= 0.75 ? 'critical' : percentile >= 0.35 ? 'high' : 'standard';
    if (ceilingBreach) priority = 'critical';
    else if (blocked && priority === 'standard') priority = 'high';

    map.set(c.decision.decision_id, priority);
  });
  return map;
}

/* ─────────────────────────────── aging ─────────────────────────────── */

/**
 * A case is "aging" once the underlying leak has been open for more than
 * three days without being routed to the merchant queue. This is a UI
 * severity bucket for scanability, not a backend-reported SLA — REVORA's
 * policy engine defines no general aging threshold outside the
 * invoice-specific 30-day escalation rule, so this stays a clearly
 * documented product choice rather than a claimed system figure.
 */
export const AGING_THRESHOLD_HOURS = 72;

export function isAging(c: EscalationCase): boolean {
  const hours = caseAgeHours(c);
  return hours != null && hours >= AGING_THRESHOLD_HOURS && !isRoutedToMerchant(c);
}

export function formatAge(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* ─────────────────────────────── summary ─────────────────────────────── */

export interface AttentionSummary {
  revenueRequiringAttention: number;
  totalCases: number;
  pendingCases: number;
  routedCases: number;
  highValueCases: number;
  agingCases: number;
  byReason: Record<ReasonKey, { count: number; amount: number }>;
}

/**
 * Every figure here is counted directly from the loaded, joined case set.
 * "High-value" reuses the same `max_auto_recovery_value` ceiling the
 * policy engine itself enforces, so the count always means the same thing
 * as the CRITICAL/ceiling-breach reason category above.
 */
export function summarize(cases: EscalationCase[], policy: PolicyLimits | null): AttentionSummary {
  const byReason = {} as Record<ReasonKey, { count: number; amount: number }>;
  (Object.keys(REASON_LABEL) as ReasonKey[]).forEach((k) => (byReason[k] = { count: 0, amount: 0 }));

  let revenueRequiringAttention = 0;
  let pendingCases = 0;
  let routedCases = 0;
  let highValueCases = 0;
  let agingCases = 0;

  for (const c of cases) {
    const amount = caseAmount(c);
    const routed = isRoutedToMerchant(c);
    revenueRequiringAttention += amount;
    if (routed) routedCases += 1;
    else pendingCases += 1;
    if (policy && amount > policy.max_auto_recovery_value) highValueCases += 1;
    if (isAging(c)) agingCases += 1;

    const key = reasonKey(c.decision);
    byReason[key].count += 1;
    byReason[key].amount += amount;
  }

  return {
    revenueRequiringAttention,
    totalCases: cases.length,
    pendingCases,
    routedCases,
    highValueCases,
    agingCases,
    byReason,
  };
}

/* ─────────────────────────────── filtering ─────────────────────────────── */

export type StatusFilter = 'all' | 'pending' | 'routed';

export function matchesStatus(c: EscalationCase, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'routed' ? isRoutedToMerchant(c) : !isRoutedToMerchant(c);
}

export function matchesReason(c: EscalationCase, filter: ReasonKey | 'all'): boolean {
  return filter === 'all' || reasonKey(c.decision) === filter;
}

export function matchesSearch(c: EscalationCase, search: string): boolean {
  if (search === '') return true;
  const q = search.trim().toLowerCase();
  return (
    c.decision.transaction_id.toLowerCase().includes(q) ||
    caseCustomerId(c).toLowerCase().includes(q) ||
    c.decision.decision_id.toLowerCase().includes(q)
  );
}

export { leakLabel };
