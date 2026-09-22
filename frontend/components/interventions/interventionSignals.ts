import { Intervention, Opportunity, Transaction } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { actionLabel, OUTCOME_LABEL } from '@/lib/actionMeta';

export const ACTION_KEYS = ['retry', 'payment_link', 'reminder', 'escalate', 'suppress'] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

export function leakLabel(leakType?: string | null): string {
  if (!leakType) return '—';
  return LEAK_LABEL[leakType] ?? leakType.replace(/_/g, ' ');
}

/** One row of the action queue: either decided-but-not-executed work, or a completed intervention. */
export type Row =
  | { kind: 'queued'; id: string; opp: Opportunity }
  | { kind: 'completed'; id: string; itv: Intervention };

export function rowAction(row: Row): string {
  return row.kind === 'queued' ? row.opp.recommended_action : row.itv.final_action;
}

export function rowAmount(row: Row): number {
  return row.kind === 'queued' ? row.opp.amount : row.itv.amount;
}

export function rowCustomerId(row: Row): string {
  return row.kind === 'queued' ? row.opp.customer_id : row.itv.customer_id;
}

export function rowPolicyAllowed(row: Row): boolean {
  return row.kind === 'queued' ? row.opp.policy_allowed : row.itv.policy_allowed;
}

export function rowPolicyReason(row: Row): string {
  return row.kind === 'queued' ? row.opp.policy_reason : row.itv.policy_reason;
}

export function rowLeakId(row: Row): string {
  return row.kind === 'queued' ? row.opp.leak_id : row.itv.leak_id;
}

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

/* ────────────────────────────── priority ────────────────────────────── */

export type Priority = 'high' | 'medium' | 'low';

/**
 * Priority is not an invented attribute — it surfaces the ranking the
 * backend already applies. `GET /api/opportunities` computes
 * `expected_recovery` (recovery probability x amount) per case and returns
 * the list sorted by it descending (see recovery_service.get_opportunities).
 * This maps each queued case's position in that real ranking onto a
 * three-band label so the queue can be read at a glance. The underlying
 * figure stays visible in the case panel, so the label is always traceable
 * back to real data. Completed rows get no priority — the work is done, so
 * ranking it would be meaningless.
 */
export function buildPriorityMap(opportunities: Opportunity[]): Map<string, Priority> {
  const sorted = [...opportunities].sort((a, b) => b.expected_recovery - a.expected_recovery);
  const map = new Map<string, Priority>();
  const n = sorted.length;
  sorted.forEach((opp, i) => {
    const percentile = n <= 1 ? 0 : i / (n - 1);
    map.set(opp.transaction_id, percentile <= 0.25 ? 'high' : percentile <= 0.65 ? 'medium' : 'low');
  });
  return map;
}

/* ────────────────────────────── summary ────────────────────────────── */

export interface OperationalSummary {
  revenueAtRisk: number;
  recoveredAmount: number;
  decided: number;
  completedToday: number;
  inProgress: number;
  queued: number;
  completed: number;
  recoveredCount: number;
  notRecoveredCount: number;
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
  const recovered = interventions.filter((i) => i.recovered);
  return {
    revenueAtRisk: queue.reduce((s, o) => s + o.amount, 0),
    recoveredAmount: recovered.reduce((s, i) => s + i.recovered_amount, 0),
    decided: opportunities.length,
    completedToday: interventions.filter((i) => isToday(i.timestamp)).length,
    inProgress: isExecuting ? 1 : 0,
    queued: queue.length,
    completed: interventions.length,
    recoveredCount: recovered.length,
    notRecoveredCount: interventions.length - recovered.length,
    blocked: queue.filter((o) => !o.policy_allowed).length + interventions.filter((i) => !i.policy_allowed).length,
    needsAttention: needsAttentionItems(queue, interventions).length,
  };
}

/** Real per-action counts across the current row set, for filter labels like "Retry (56)". */
export function actionCounts(rows: { action: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = (counts[r.action] ?? 0) + 1;
  return counts;
}

export type AttentionItem =
  | { kind: 'queued'; opp: Opportunity }
  | { kind: 'completed'; itv: Intervention };

/** What actually needs a human right now: blocked queued work, plus completed actions that didn't recover. */
export function needsAttentionItems(queue: Opportunity[], interventions: Intervention[], limit = 50): AttentionItem[] {
  const blockedQueued: AttentionItem[] = queue
    .filter((o) => !o.policy_allowed)
    .map((opp) => ({ kind: 'queued' as const, opp }));

  const unresolvedCompleted: AttentionItem[] = interventions
    .filter((i) => i.status === 'escalated_to_merchant' || i.status === 'attempted_no_recovery')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((itv) => ({ kind: 'completed' as const, itv }));

  return [...blockedQueued, ...unresolvedCompleted].slice(0, limit);
}

/** True when this row is one of the cases a human needs to look at. */
export function rowNeedsAttention(row: Row): boolean {
  if (row.kind === 'queued') return !row.opp.policy_allowed;
  return row.itv.status === 'escalated_to_merchant' || row.itv.status === 'attempted_no_recovery';
}

/* ────────────────────────────── filtering ────────────────────────────── */

export function matchesAction(action: string, filter: ActionKey | 'all'): boolean {
  return filter === 'all' || action === filter;
}

/** The four workspace tabs. Each is a real slice of the loaded data. */
export type QueueTab = 'queue' | 'in_progress' | 'completed' | 'attention';

export function matchesTab(row: Row, tab: QueueTab, executingId: string | null): boolean {
  switch (tab) {
    case 'queue':
      return row.kind === 'queued';
    case 'in_progress':
      return row.id === executingId;
    case 'completed':
      return row.kind === 'completed';
    case 'attention':
      return rowNeedsAttention(row);
  }
}

export function matchesSearch(id: string, customerId: string, search: string): boolean {
  if (search === '') return true;
  const q = search.trim().toLowerCase();
  return id.toLowerCase().includes(q) || customerId.toLowerCase().includes(q);
}

/* ─────────────────────── KPI micro-visualisations ─────────────────────── */

/** Queued revenue at risk broken down by leak type — a real composition, not a trend line. */
export function riskComposition(queue: Opportunity[]): { leakType: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const o of queue) totals.set(o.leak_type, (totals.get(o.leak_type) ?? 0) + o.amount);
  return Array.from(totals.entries())
    .map(([leakType, amount]) => ({ leakType, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Real counts of executed interventions per hour over the last 12 hours.
 * Empty buckets stay empty — this is a histogram of what actually happened,
 * never a smoothed or invented curve.
 */
export function activityByHour(interventions: Intervention[], hours = 12): number[] {
  const buckets = new Array(hours).fill(0);
  const now = Date.now();
  for (const i of interventions) {
    const t = new Date(i.timestamp).getTime();
    if (Number.isNaN(t)) continue;
    const hoursAgo = Math.floor((now - t) / 3_600_000);
    if (hoursAgo >= 0 && hoursAgo < hours) buckets[hours - 1 - hoursAgo] += 1;
  }
  return buckets;
}

/* ─────────────────────────── recovery journey ─────────────────────────── */

export type JourneyStageId = 'opportunity' | 'decision' | 'action' | 'outcome' | 'recovered';
export type JourneyStageState = 'complete' | 'active' | 'pending' | 'blocked';

export interface JourneyStage {
  id: JourneyStageId;
  label: string;
  detail: string;
  state: JourneyStageState;
}

export interface JourneyState {
  scope: 'system' | 'case';
  stages: JourneyStage[];
  /** Index of the furthest stage the work has actually reached. */
  reachedIndex: number;
  /** Set when recovery controls stopped this case, with the real policy reason. */
  boundary: { atIndex: number; reason: string } | null;
  /** Headline for the terminal readout on the right of the journey. */
  outcomeLabel: string;
  outcomeValue: string;
  outcomeCaption: string;
  /** Drives the terminal readout's colour, so money still at risk never reads as recovered. */
  outcomeTone: 'success' | 'warning' | 'neutral';
}

const STAGE_LABELS: Record<JourneyStageId, string> = {
  opportunity: 'Opportunity',
  decision: 'REVORA decision',
  action: 'Recovery action',
  outcome: 'Customer outcome',
  recovered: 'Recovered revenue',
};

function stageStates(reachedIndex: number, boundaryIndex: number | null): JourneyStageState[] {
  return [0, 1, 2, 3, 4].map((i) => {
    if (boundaryIndex != null && i === boundaryIndex) return 'blocked';
    if (i < reachedIndex) return 'complete';
    if (i === reachedIndex) return 'active';
    return 'pending';
  });
}

/**
 * The whole operation at a glance, counted from loaded records only.
 * `decided` is every non-suppressed case REVORA has ruled on; `queue` is
 * the part still waiting; `interventions` are the executed outcomes.
 */
export function buildSystemJourney(
  opportunities: Opportunity[],
  queue: Opportunity[],
  interventions: Intervention[],
  summary: OperationalSummary
): JourneyState {
  const blockedQueued = queue.filter((o) => !o.policy_allowed).length;
  const readyQueued = queue.length - blockedQueued;

  const reachedIndex =
    opportunities.length === 0
      ? 0
      : interventions.length === 0
      ? 2
      : summary.recoveredCount === 0
      ? 3
      : 4;

  const states = stageStates(reachedIndex, null);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const stages: JourneyStage[] = [
    {
      id: 'opportunity',
      label: STAGE_LABELS.opportunity,
      detail: opportunities.length ? `${plural(opportunities.length, 'leak', 'leaks')} identified` : 'No leaks detected yet',
      state: states[0],
    },
    {
      id: 'decision',
      label: STAGE_LABELS.decision,
      detail: opportunities.length
        ? `${plural(opportunities.length, 'action', 'actions')} selected`
        : 'Awaiting an intelligence pass',
      state: states[1],
    },
    {
      id: 'action',
      label: STAGE_LABELS.action,
      detail: blockedQueued > 0 ? `${readyQueued} ready · ${blockedQueued} paused` : `${readyQueued} ready to execute`,
      state: states[2],
    },
    {
      id: 'outcome',
      label: STAGE_LABELS.outcome,
      detail: interventions.length
        ? `${plural(interventions.length, 'outcome', 'outcomes')} recorded`
        : 'No actions executed yet',
      state: states[3],
    },
    {
      id: 'recovered',
      label: STAGE_LABELS.recovered,
      detail: summary.recoveredCount
        ? `from ${plural(summary.recoveredCount, 'successful action', 'successful actions')}`
        : 'Nothing recovered yet',
      state: states[4],
    },
  ];

  return {
    scope: 'system',
    stages,
    reachedIndex,
    boundary: null,
    outcomeLabel: 'Recovered revenue',
    outcomeValue: formatINR(summary.recoveredAmount, true),
    outcomeCaption: summary.recoveredCount
      ? `Across ${plural(summary.recoveredCount, 'recovery', 'recoveries')}`
      : 'Every action brings you closer',
    outcomeTone: summary.recoveredAmount > 0 ? 'success' : 'neutral',
  };
}

/**
 * One selected case, stage by stage. Everything below comes off the
 * opportunity/intervention record itself — the leak it started as, the
 * action REVORA settled on, whether recovery controls let it run, and the
 * outcome the executor actually returned.
 */
export function buildCaseJourney(row: Row, isExecuting: boolean, tx: Transaction | null): JourneyState {
  const action = rowAction(row);
  const amount = rowAmount(row);
  const allowed = rowPolicyAllowed(row);
  const leakType = row.kind === 'queued' ? row.opp.leak_type : tx?.leak_type;

  let reachedIndex: number;
  let boundaryIndex: number | null = null;

  if (row.kind === 'queued') {
    reachedIndex = isExecuting ? 2 : allowed ? 2 : 2;
    if (!allowed) boundaryIndex = 2;
  } else {
    reachedIndex = row.itv.recovered ? 4 : 3;
  }

  const states = stageStates(reachedIndex, boundaryIndex);

  const actionDetail = (() => {
    if (row.kind === 'completed') return `${actionLabel(row.itv.final_action)} executed`;
    if (isExecuting) return `${actionLabel(action)} running now`;
    if (!allowed) return 'Held at the control boundary';
    return `${actionLabel(action)} ready to run`;
  })();

  const outcomeDetail = (() => {
    if (row.kind === 'completed') return OUTCOME_LABEL[row.itv.status] ?? row.itv.status;
    if (isExecuting) return 'Awaiting response';
    if (!allowed) return 'Needs your review';
    return 'Not executed yet';
  })();

  const recoveredDetail = (() => {
    if (row.kind === 'completed') {
      return row.itv.recovered ? `${formatINR(row.itv.recovered_amount)} recovered` : 'No recovery this attempt';
    }
    return 'Tracking pending';
  })();

  const stages: JourneyStage[] = [
    {
      id: 'opportunity',
      label: STAGE_LABELS.opportunity,
      detail: `${leakLabel(leakType)} · ${formatINR(amount)}`,
      state: states[0],
    },
    {
      id: 'decision',
      label: STAGE_LABELS.decision,
      detail: allowed ? `${actionLabel(action)} selected` : `Rerouted to ${actionLabel(action).toLowerCase()}`,
      state: states[1],
    },
    { id: 'action', label: STAGE_LABELS.action, detail: actionDetail, state: states[2] },
    { id: 'outcome', label: STAGE_LABELS.outcome, detail: outcomeDetail, state: states[3] },
    { id: 'recovered', label: STAGE_LABELS.recovered, detail: recoveredDetail, state: states[4] },
  ];

  const recoveredNow = row.kind === 'completed' && row.itv.recovered;

  /**
   * The destination readout never claims money has come back while the
   * backend still has it at risk. Only a completed, genuinely recovered
   * intervention reads "Recovered"; anything still in flight reads as
   * potential or in-progress, and a failed attempt says so plainly.
   *
   * For work that hasn't executed, the figure shown is the backend's own
   * `expected_recovery` (probability x amount) rather than the full
   * exposure — the same number the case panel labels "Potential recovery" —
   * so the destination never overstates what is realistically recoverable.
   */
  const destination = (() => {
    if (recoveredNow) {
      return {
        label: 'Recovered',
        value: formatINR(row.itv.recovered_amount),
        tone: 'success' as const,
      };
    }
    if (row.kind === 'completed') {
      return { label: 'Not recovered', value: formatINR(amount), tone: 'neutral' as const };
    }
    return {
      label: isExecuting ? 'Recovery in progress' : 'Potential recovery',
      value: formatINR(row.opp.expected_recovery),
      tone: boundaryIndex != null ? ('warning' as const) : ('neutral' as const),
    };
  })();

  return {
    scope: 'case',
    stages,
    reachedIndex,
    boundary: boundaryIndex != null ? { atIndex: boundaryIndex, reason: rowPolicyReason(row) } : null,
    outcomeLabel: destination.label,
    outcomeValue: destination.value,
    outcomeCaption:
      row.kind === 'completed'
        ? OUTCOME_LABEL[row.itv.status] ?? row.itv.status
        : isExecuting
        ? 'Executing now'
        : allowed
        ? 'Awaiting execution'
        : 'Paused by recovery controls',
    outcomeTone: destination.tone,
  };
}
