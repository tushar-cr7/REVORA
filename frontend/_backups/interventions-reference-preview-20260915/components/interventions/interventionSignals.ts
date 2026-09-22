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
  recoveredAmount: number;
  completedToday: number;
  queued: number;
  blocked: number;
  needsAttention: number;
}

/** Every figure here is counted from the already-loaded queue/intervention records — nothing is invented. */
export function summarize(queue: Opportunity[], interventions: Intervention[]): OperationalSummary {
  return {
    recoveredAmount: interventions.filter((i) => i.recovered).reduce((s, i) => s + i.recovered_amount, 0),
    completedToday: interventions.filter((i) => isToday(i.timestamp)).length,
    queued: queue.length,
    blocked: queue.filter((o) => !o.policy_allowed).length + interventions.filter((i) => !i.policy_allowed).length,
    needsAttention: needsAttentionItems(queue, interventions).length,
  };
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
