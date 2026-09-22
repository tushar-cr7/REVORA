import { Intervention, Opportunity } from '@/lib/types';

export const ACTION_KEYS = ['retry', 'payment_link', 'reminder', 'escalate', 'suppress'] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

/**
 * The backend lets the same transaction be executed more than once (each
 * call with a fresh idempotency key creates its own record), so a
 * transaction can legitimately have several intervention records. For
 * every display and summary purpose here, "this transaction's status" means
 * its most recent one — this keeps row identities unique and avoids
 * double-counting recovered revenue from an earlier attempt.
 */
export function latestByTransaction(interventions: Intervention[]): Intervention[] {
  const latest = new Map<string, Intervention>();
  for (const i of interventions) {
    const existing = latest.get(i.transaction_id);
    if (!existing || new Date(i.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latest.set(i.transaction_id, i);
    }
  }
  return Array.from(latest.values());
}

/**
 * The backend only ever persists *completed* interventions — there is no
 * "queued" or "in progress" record in the data model. The real queue is
 * therefore every decided opportunity that doesn't yet have a matching
 * intervention: work REVORA has already evaluated but nothing has executed.
 */
export function deriveQueue(opportunities: Opportunity[], interventions: Intervention[]): Opportunity[] {
  const done = new Set(interventions.map((i) => i.transaction_id));
  return opportunities.filter((o) => !done.has(o.transaction_id));
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export interface OperationalSummary {
  revenueAtRisk: number;
  recoveredAmount: number;
  decided: number;
  completedToday: number;
  inProgress: number;
  queued: number;
  completed: number;
  blocked: number;
  needsAttention: number;
}

/**
 * Every figure here is counted from the already-loaded opportunity/
 * intervention records — nothing is invented. `opportunities` is the raw
 * decided set as the backend actually returns it (it does not exclude
 * transactions that have since been executed), so it's a true "everything
 * REVORA has ever decided on" count — distinct from `queue`, which is only
 * the ones still waiting. `isExecuting` reflects the one real transient
 * in-progress state this UI ever produces; there is no persisted
 * concurrent-in-progress count in the data model.
 */
export function summarize(
  opportunities: Opportunity[],
  queue: Opportunity[],
  interventions: Intervention[],
  isExecuting: boolean
): OperationalSummary {
  return {
    revenueAtRisk: queue.reduce((s, o) => s + o.amount, 0),
    recoveredAmount: interventions.filter((i) => i.recovered).reduce((s, i) => s + i.recovered_amount, 0),
    decided: opportunities.length,
    completedToday: interventions.filter((i) => isToday(i.timestamp)).length,
    inProgress: isExecuting ? 1 : 0,
    queued: queue.length,
    completed: interventions.length,
    blocked: queue.filter((o) => !o.policy_allowed).length + interventions.filter((i) => !i.policy_allowed).length,
    needsAttention: needsAttentionItems(queue, interventions).length,
  };
}

/** Real per-action counts across the current row set, for filter chip labels like "Retry (56)". */
export function actionCounts(rows: { action: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = (counts[r.action] ?? 0) + 1;
  return counts;
}

export type AttentionItem =
  | { kind: 'queued'; opp: Opportunity }
  | { kind: 'completed'; itv: Intervention };

/** What actually needs a human right now: blocked queued work, plus completed actions that didn't recover. */
export function needsAttentionItems(queue: Opportunity[], interventions: Intervention[], limit = 8): AttentionItem[] {
  const blockedQueued: AttentionItem[] = queue
    .filter((o) => !o.policy_allowed)
    .map((opp) => ({ kind: 'queued' as const, opp }));

  const unresolvedCompleted: AttentionItem[] = interventions
    .filter((i) => i.status === 'escalated_to_merchant' || i.status === 'attempted_no_recovery')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((itv) => ({ kind: 'completed' as const, itv }));

  return [...blockedQueued, ...unresolvedCompleted].slice(0, limit);
}

export function matchesAction(action: string, filter: ActionKey | 'all'): boolean {
  return filter === 'all' || action === filter;
}

export type StatusFilter = 'all' | 'queued' | 'completed' | 'blocked';

export function matchesStatus(row: { kind: 'queued' | 'completed'; policyAllowed: boolean }, filter: StatusFilter): boolean {
  switch (filter) {
    case 'queued':
      return row.kind === 'queued';
    case 'completed':
      return row.kind === 'completed';
    case 'blocked':
      return !row.policyAllowed;
    default:
      return true;
  }
}

export function matchesSearch(id: string, customerId: string, search: string): boolean {
  if (search === '') return true;
  const q = search.toLowerCase();
  return id.toLowerCase().includes(q) || customerId.toLowerCase().includes(q);
}
