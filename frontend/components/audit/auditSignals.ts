import { AuditEvent, Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { actionLabel } from '@/lib/actionMeta';
import { latestByTransaction } from '@/components/interventions/interventionSignals';
import { decisionVerdict, eventTypeMeta, type Layer, type Verdict as GrammarVerdict } from '@/lib/grammar';
import type { EventKind } from '@/components/ui/eventKinds';

/**
 * Presentation-only derivations for the Audit Trail ("Revenue Chain of
 * Custody"). Everything here is computed from records the API already
 * returned — audit events, the decision record, the transaction, the live
 * policy limits. The backend remains the only authority on whether an action
 * was authorized: the verdict is read from `Decision.policy_allowed` /
 * `policy_reason`, never recomputed.
 */

/* ────────────────────────────── tones ────────────────────────────── */

export type Tone = 'ai' | 'system' | 'success' | 'risk' | 'warning' | 'neutral';

interface ToneClasses {
  text: string;
  border: string;
  borderStrong: string;
  bg: string;
  dot: string;
  chip: string;
  hex: string;
}

/** One semantic accent per layer: violet = AI, blue = system, green = recovered, red = risk, amber = human attention. */
export const TONE: Record<Tone, ToneClasses> = {
  ai: {
    text: 'text-ai-300',
    border: 'border-ai-500/30',
    borderStrong: 'border-ai-500/60',
    bg: 'bg-ai-muted/40',
    dot: 'bg-ai-500',
    chip: 'bg-ai-muted/60 text-ai-300 border-ai-500/30',
    hex: '#8B5CF6',
  },
  system: {
    text: 'text-primary-300',
    border: 'border-primary-500/30',
    borderStrong: 'border-primary-500/60',
    bg: 'bg-primary-muted/60',
    dot: 'bg-primary-500',
    chip: 'bg-primary-muted/70 text-primary-300 border-primary-500/30',
    hex: '#4F6EF7',
  },
  success: {
    text: 'text-success-300',
    border: 'border-success-500/30',
    borderStrong: 'border-success-500/60',
    bg: 'bg-success-muted/60',
    dot: 'bg-success-500',
    chip: 'bg-success-muted/70 text-success-300 border-success-500/30',
    hex: '#10B981',
  },
  risk: {
    text: 'text-risk-300',
    border: 'border-risk-500/30',
    borderStrong: 'border-risk-500/60',
    bg: 'bg-risk-muted/60',
    dot: 'bg-risk-500',
    chip: 'bg-risk-muted/70 text-risk-300 border-risk-500/30',
    hex: '#F5484F',
  },
  warning: {
    text: 'text-warning-300',
    border: 'border-warning-500/30',
    borderStrong: 'border-warning-500/60',
    bg: 'bg-warning-muted/60',
    dot: 'bg-warning-500',
    chip: 'bg-warning-muted/70 text-warning-300 border-warning-500/30',
    hex: '#F5A623',
  },
  neutral: {
    text: 'text-text-secondary',
    border: 'border-border-strong',
    borderStrong: 'border-text-muted',
    bg: 'bg-surface',
    dot: 'bg-text-muted',
    chip: 'bg-surface text-text-secondary border-border-strong',
    hex: '#6C7789',
  },
};

/* ────────────────────────────── formatting ────────────────────────────── */

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Time of day for something that happened today; date + time for anything older, so an old event never reads as recent. */
export function formatStageTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (d.toDateString() === new Date().toDateString()) return formatClock(iso);
  const day = d.toLocaleDateString([], { month: 'short', day: '2-digit' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = ms / 1000;
  if (sec < 1) return '< 1 sec';
  if (sec < 60) return `${Math.round(sec)} sec`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)} min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1)} hr`;
  return `${Math.round(hr / 24)} days`;
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

export function providerLabel(provider: string | undefined | null): string {
  if (!provider) return '—';
  return provider.replace(/Provider$/, '');
}

export function humanize(code: string | undefined | null): string {
  if (!code) return '—';
  const specials: Record<string, string> = { '3ds_failed': '3-D Secure failed', upi_timeout: 'UPI timeout', invalid_vpa: 'Invalid UPI address', psp_down: 'Payment service unavailable', emi_not_approved: 'EMI not approved' };
  if (specials[code]) return specials[code];
  const s = code.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ────────────────────────────── events ────────────────────────────── */

export const EXECUTION_EVENT_TYPES = ['EXECUTION_SUCCEEDED', 'EXECUTION_FAILED', 'ESCALATION_CREATED', 'SUPPRESSION_CREATED'];
export const DECISION_EVENT_TYPES = ['DECISION_CREATED', 'ACTION_BLOCKED'];

/**
 * The business name of each event the log records. The ledger's row titles and the
 * event-type filter both read this, so a person sees the same words wherever an
 * event appears; the constant itself (ACTION_BLOCKED) is only ever metadata.
 */
export const EVENT_HEADLINE = {
  DECISION_CREATED: 'Recovery decision created',
  ACTION_BLOCKED: 'Recovery blocked',
  POLICY_AUTHORIZED: 'Policy authorization granted',
  EXECUTION_STARTED: 'Recovery action started',
  EXECUTION_SUCCEEDED: 'Recovery confirmed',
  EXECUTION_FAILED: 'Recovery attempt unsuccessful',
  ESCALATION_CREATED: 'Escalated for review',
  SUPPRESSION_CREATED: 'Action suppressed',
} as const;

export const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All events' },
  { value: 'DECISION_CREATED', label: EVENT_HEADLINE.DECISION_CREATED },
  { value: 'ACTION_BLOCKED', label: EVENT_HEADLINE.ACTION_BLOCKED },
  { value: 'EXECUTION_SUCCEEDED', label: EVENT_HEADLINE.EXECUTION_SUCCEEDED },
  { value: 'EXECUTION_FAILED', label: EVENT_HEADLINE.EXECUTION_FAILED },
  { value: 'ESCALATION_CREATED', label: EVENT_HEADLINE.ESCALATION_CREATED },
  { value: 'SUPPRESSION_CREATED', label: EVENT_HEADLINE.SUPPRESSION_CREATED },
];

export type StageId = 'event' | 'intelligence' | 'decision' | 'policy' | 'action' | 'outcome';

export interface EventView {
  category: string;
  /** The business event, in plain language: "Recovery blocked". The event constant is metadata, never this. */
  headline: string;
  /** One line on what the event was about: "Retry payment stopped by policy". */
  title: string;
  /** Why the rules stopped or rerouted the action — set only for events the policy engine actually acted on. */
  reason: string | null;
  /** What happens next as a consequence of this event itself (never a prediction about other records). */
  next: string | null;
  tone: Tone;
  chip: { text: string; tone: Tone } | null;
  stage: StageId;
  /** Which layer produced the event; null when it is a plain fact. */
  actor: Layer | null;
  kind: EventKind;
}

function recoveredVia(action: string): string {
  switch (action) {
    case 'retry':
      return 'Payment recovered via retry';
    case 'payment_link':
      return 'Payment recovered via payment link';
    case 'reminder':
      return 'Payment recovered after reminder';
    default:
      return `Recovered via ${actionLabel(action).toLowerCase()}`;
  }
}

/** Where a refused proposal went. Read from the event's own `final_action`. */
function rerouteNext(finalAction: string | undefined): string | null {
  if (finalAction === 'escalate') return 'Human review';
  if (finalAction === 'suppress') return 'No automated action';
  return finalAction ? `${actionLabel(finalAction)} instead` : null;
}

export function describeEvent(evt: AuditEvent): EventView {
  const action = actionLabel(evt.action);
  // Only a control that actually stopped something has a reason worth surfacing; "Within policy." is noise.
  const stopped = evt.policy_result?.allowed === false ? evt.policy_result.reason ?? null : null;
  const kind = eventTypeMeta(evt.event_type).kind;

  switch (evt.event_type) {
    case 'DECISION_CREATED':
      return { category: 'Decision', headline: EVENT_HEADLINE.DECISION_CREATED, title: `${action} recommended and authorized`, reason: null, next: null, tone: 'ai', chip: { text: 'Authorized', tone: 'success' }, stage: 'decision', actor: 'intelligence', kind };
    case 'ACTION_BLOCKED': {
      const final = evt.policy_result?.final_action;
      return {
        category: 'Blocked',
        headline: EVENT_HEADLINE.ACTION_BLOCKED,
        title: `${action} stopped by policy`,
        reason: stopped,
        next: rerouteNext(final),
        tone: 'risk',
        chip: final === 'escalate' ? { text: 'Rerouted', tone: 'warning' } : { text: 'Blocked', tone: 'risk' },
        stage: 'policy',
        actor: 'policy',
        kind,
      };
    }
    case 'POLICY_EVALUATED':
    case 'ACTION_AUTHORIZED':
      return { category: 'Policy', headline: EVENT_HEADLINE.POLICY_AUTHORIZED, title: 'Policy authorization granted', reason: null, next: null, tone: 'success', chip: { text: 'Approved', tone: 'success' }, stage: 'policy', actor: 'policy', kind };
    case 'EXECUTION_STARTED':
      return { category: 'Action', headline: EVENT_HEADLINE.EXECUTION_STARTED, title: `${action} started`, reason: null, next: null, tone: 'system', chip: null, stage: 'action', actor: 'system', kind };
    case 'EXECUTION_SUCCEEDED':
      return { category: 'Outcome', headline: EVENT_HEADLINE.EXECUTION_SUCCEEDED, title: recoveredVia(evt.action), reason: null, next: null, tone: 'success', chip: { text: 'Recovered', tone: 'success' }, stage: 'outcome', actor: 'system', kind };
    case 'EXECUTION_FAILED':
      return { category: 'Outcome', headline: EVENT_HEADLINE.EXECUTION_FAILED, title: `${action} attempted`, reason: null, next: null, tone: 'neutral', chip: { text: 'Not recovered', tone: 'neutral' }, stage: 'outcome', actor: 'system', kind };
    case 'ESCALATION_CREATED':
      return { category: 'Escalation', headline: EVENT_HEADLINE.ESCALATION_CREATED, title: 'Escalated to merchant review', reason: stopped, next: 'Awaiting a person', tone: 'warning', chip: { text: 'Escalated', tone: 'warning' }, stage: 'action', actor: 'human', kind };
    case 'SUPPRESSION_CREATED':
      return { category: 'Action', headline: EVENT_HEADLINE.SUPPRESSION_CREATED, title: 'Suppressed — no automated action', reason: stopped, next: null, tone: 'neutral', chip: { text: 'Suppressed', tone: 'neutral' }, stage: 'action', actor: 'system', kind };
    default: {
      const name = humanize(evt.event_type.toLowerCase());
      return { category: 'Event', headline: name, title: name, reason: null, next: null, tone: 'neutral', chip: null, stage: 'decision', actor: null, kind };
    }
  }
}

export function matchesSearch(evt: AuditEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    evt.event_id.toLowerCase().includes(q) ||
    evt.transaction_id.toLowerCase().includes(q) ||
    evt.action.toLowerCase().includes(q) ||
    evt.event_type.toLowerCase().includes(q)
  );
}

/** The event to open by default: the most recent real outcome if there is one, else the newest event. */
export function pickDefaultTransaction(newestFirst: AuditEvent[]): string | null {
  if (newestFirst.length === 0) return null;
  const withOutcome = newestFirst.find((e) => EXECUTION_EVENT_TYPES.includes(e.event_type));
  return (withOutcome ?? newestFirst[0]).transaction_id;
}

export interface TransactionGroup {
  transactionId: string;
  count: number;
  latest: AuditEvent;
}

/** Groups newest-first events by transaction, preserving recency order. */
export function groupByTransaction(newestFirst: AuditEvent[]): TransactionGroup[] {
  const groups = new Map<string, TransactionGroup>();
  for (const e of newestFirst) {
    const g = groups.get(e.transaction_id);
    if (g) g.count += 1;
    else groups.set(e.transaction_id, { transactionId: e.transaction_id, count: 1, latest: e });
  }
  return Array.from(groups.values());
}

/* ────────────────────────────── policy checks ────────────────────────────── */

/** `within` = the observed figure is inside the limit, but the engine stopped at an earlier control and never evaluated this one. */
export type CheckState = 'passed' | 'within' | 'blocked' | 'escalated' | 'not_reached';

export interface PolicyCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

interface RuleDef {
  key: string;
  label: string;
  /** Does this control govern the proposed action / leak type at all? */
  applies: (action: string, leakType: string) => boolean;
  /** Matches the backend's own policy_reason text when this control is the one that stopped an action. */
  reason: RegExp;
  within: (tx: Transaction, p: PolicyLimits) => boolean;
  observed: (tx: Transaction, p: PolicyLimits) => string;
  limit: (p: PolicyLimits) => string;
}

const RULES: RuleDef[] = [
  {
    key: 'retry_limit',
    label: 'Retry limit',
    applies: (a) => a === 'retry',
    reason: /^retry limit/i,
    within: (tx, p) => tx.retries_so_far < p.max_retries,
    observed: (tx, p) => `${tx.retries_so_far} of ${p.max_retries} attempts used`,
    limit: (p) => `Max ${p.max_retries} retries`,
  },
  {
    key: 'cooldown',
    label: 'Cooldown',
    applies: (a) => a === 'retry',
    reason: /^cooldown/i,
    within: (tx, p) => tx.hours_since_event >= p.min_cooldown_hours,
    observed: (tx, p) => `${formatHours(tx.hours_since_event)} since last event (min ${p.min_cooldown_hours}h)`,
    limit: (p) => `${p.min_cooldown_hours}h between retries`,
  },
  {
    key: 'subscription',
    label: 'Subscription health',
    applies: (a, leak) => a === 'retry' && leak === 'failed_subscription',
    reason: /subscription failures/i,
    within: (tx, p) => (tx.consecutive_failures ?? 0) <= p.max_subscription_consecutive_failures_for_retry,
    observed: (tx, p) => `${tx.consecutive_failures ?? 0} consecutive failures (limit ${p.max_subscription_consecutive_failures_for_retry})`,
    limit: (p) => `Up to ${p.max_subscription_consecutive_failures_for_retry} consecutive failures`,
  },
  {
    key: 'contact_limit',
    label: 'Contact limit',
    applies: (a) => a === 'reminder' || a === 'payment_link',
    reason: /contact limit/i,
    within: (tx, p) => (tx.contacts_today ?? 0) < p.max_customer_contacts_per_day,
    observed: (tx, p) => `${tx.contacts_today ?? 0} of ${p.max_customer_contacts_per_day} contacts today`,
    limit: (p) => `${p.max_customer_contacts_per_day} contact per customer per day`,
  },
  {
    key: 'amount_threshold',
    label: 'Amount threshold',
    applies: (a) => a !== 'escalate',
    reason: /auto-recovery ceiling/i,
    within: (tx, p) => tx.amount <= p.max_auto_recovery_value,
    observed: (tx, p) => `${formatINR(tx.amount)} (limit ${formatINR(p.max_auto_recovery_value)})`,
    limit: (p) => `${formatINR(p.max_auto_recovery_value)} autonomous ceiling`,
  },
  {
    key: 'invoice_age',
    label: 'Invoice age',
    applies: (a, leak) => leak === 'overdue_invoice' && a !== 'escalate',
    reason: /^invoice older/i,
    within: (tx, p) => tx.age_days <= p.invoice_escalation_age_days,
    observed: (tx, p) => `${tx.age_days} days old (limit ${p.invoice_escalation_age_days})`,
    limit: (p) => `${p.invoice_escalation_age_days} days before escalation`,
  },
];

export interface PolicyChecks {
  checks: PolicyCheck[];
  /** Controls that don't govern this action, listed so the panel can say what was *not* in play. */
  notApplicable: string[];
}

/**
 * Per-control view of the safety check for one transaction. The *verdict* is
 * the backend's: an authorized decision marks every applicable control as
 * passed; a blocked one marks the control named in `policy_reason`. The
 * observed-vs-limit figures are supporting detail read off the transaction
 * and the live limits — controls after the one that stopped the action were
 * never evaluated by the engine, so they read "within limit" or "not
 * reached", never "passed".
 */
export function buildPolicyChecks(tx: Transaction | null, decision: Decision | null, policy: PolicyLimits | null): PolicyChecks {
  if (!tx || !decision || !policy) return { checks: [], notApplicable: [] };

  const proposed = decision.ai_proposed_action;
  const applicable = RULES.filter((r) => r.applies(proposed, tx.leak_type));
  const notApplicable = RULES.filter((r) => !r.applies(proposed, tx.leak_type)).map((r) => r.label);

  const tripped = decision.policy_allowed ? null : applicable.find((r) => r.reason.test(decision.policy_reason)) ?? null;

  const checks: PolicyCheck[] = applicable.map((r) => {
    const detail = r.observed(tx, policy);
    if (decision.policy_allowed) return { key: r.key, label: r.label, state: 'passed', detail };
    if (r === tripped) {
      return { key: r.key, label: r.label, state: decision.final_action === 'escalate' ? 'escalated' : 'blocked', detail };
    }
    return { key: r.key, label: r.label, state: r.within(tx, policy) ? 'within' : 'not_reached', detail };
  });

  return { checks, notApplicable };
}

export function ruleFromReason(reason: string): { key: string; label: string } {
  const rule = RULES.find((r) => r.reason.test(reason));
  return rule ? { key: rule.key, label: rule.label } : { key: 'other', label: 'Other control' };
}

export function ruleCatalog(policy: PolicyLimits | null): { key: string; label: string; limit: string }[] {
  if (!policy) return [];
  return RULES.map((r) => ({ key: r.key, label: r.label, limit: r.limit(policy) }));
}

/* ────────────────────────────── custody ────────────────────────────── */

/**
 * The policy layer's verdict, in the grammar's own vocabulary
 * (authorized · rerouted · blocked · downgraded · pending).
 */
export type Verdict = GrammarVerdict;
export type OutcomeKind = 'recovered' | 'not_recovered' | 'escalated' | 'suppressed' | 'pending';

export interface Custody {
  aiAction: string | null;
  finalAction: string | null;
  verdict: Verdict;
  outcome: OutcomeKind;
  executed: boolean;
  question: string;
  decisionEvent: AuditEvent | null;
  executionEvent: AuditEvent | null;
  /** When the recommendation and the policy verdict were recorded — they are one audit record. */
  decisionTime: string | null;
  checks: PolicyChecks;
}

const EVENT_TITLE: Record<string, string> = {
  failed_payment: 'Payment failed',
  abandoned_checkout: 'Checkout abandoned',
  failed_subscription: 'Subscription renewal failed',
  overdue_invoice: 'Invoice overdue',
};

const LEAK_NOUN: Record<string, string> = {
  failed_payment: 'Payment',
  abandoned_checkout: 'Checkout',
  failed_subscription: 'Subscription',
  overdue_invoice: 'Invoice',
};

export function eventTitle(leakType: string | undefined): string {
  return (leakType && EVENT_TITLE[leakType]) || 'Revenue at risk';
}

function questionFor(action: string | null, leakType: string | undefined): string {
  const noun = (leakType && LEAK_NOUN[leakType]) || 'Transaction';
  switch (action) {
    case 'retry':
      return `Why did REVORA retry this ${noun.toLowerCase()}?`;
    case 'payment_link':
      return `Why did REVORA send a payment link for this ${noun.toLowerCase()}?`;
    case 'reminder':
      return `Why did REVORA send a reminder for this ${noun.toLowerCase()}?`;
    case 'escalate':
      return `Why did REVORA escalate this ${noun.toLowerCase()}?`;
    case 'suppress':
      return `Why did REVORA hold off on this ${noun.toLowerCase()}?`;
    default:
      return `What did REVORA decide for this ${noun.toLowerCase()}?`;
  }
}

/** What actually ran, as a business sentence. */
export function actionTitle(action: string): string {
  switch (action) {
    case 'retry':
      return 'Payment retry submitted';
    case 'payment_link':
      return 'Payment link sent';
    case 'reminder':
      return 'Reminder sent';
    case 'escalate':
      return 'Routed to merchant queue';
    case 'suppress':
      return 'No action taken';
    default:
      return actionLabel(action);
  }
}

function lastOf(events: AuditEvent[], pred: (e: AuditEvent) => boolean): AuditEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (pred(events[i])) return events[i];
  return null;
}

export interface CustodyInput {
  tx: Transaction | null;
  decision: Decision | null;
  /** This transaction's audit events, oldest first. */
  events: AuditEvent[];
  policy: PolicyLimits | null;
}

export function buildCustody({ tx, decision, events, policy }: CustodyInput): Custody {
  const decisionEvent =
    lastOf(events, (e) => DECISION_EVENT_TYPES.includes(e.event_type) && e.decision_id === decision?.decision_id) ??
    lastOf(events, (e) => DECISION_EVENT_TYPES.includes(e.event_type));
  const executionEvent = lastOf(events, (e) => EXECUTION_EVENT_TYPES.includes(e.event_type));

  const aiAction = decision?.ai_proposed_action ?? decisionEvent?.action ?? null;
  const finalAction =
    decision?.final_action ?? executionEvent?.action ?? decisionEvent?.policy_result?.final_action ?? decisionEvent?.action ?? null;

  // The verdict is the backend's: the decision record's own policy_allowed / final_action,
  // or — if only the audit event survives — the same two fields as recorded on it.
  const allowed = decision ? decision.policy_allowed : decisionEvent?.policy_result?.allowed;
  const verdict: Verdict =
    decision != null
      ? decisionVerdict(decision)
      : allowed === undefined
      ? 'pending'
      : decisionVerdict({ policy_allowed: allowed, final_action: finalAction ?? '' });

  const executed = executionEvent != null;
  const execStatus = executionEvent?.outcome?.status;
  const outcome: OutcomeKind = !executed
    ? 'pending'
    : execStatus === 'recovered' || executionEvent?.event_type === 'EXECUTION_SUCCEEDED'
    ? 'recovered'
    : execStatus === 'escalated_to_merchant' || executionEvent?.event_type === 'ESCALATION_CREATED'
    ? 'escalated'
    : execStatus === 'suppressed' || executionEvent?.event_type === 'SUPPRESSION_CREATED'
    ? 'suppressed'
    : 'not_recovered';

  return {
    aiAction,
    finalAction,
    verdict,
    outcome,
    executed,
    question: questionFor(finalAction ?? aiAction, tx?.leak_type),
    decisionEvent,
    executionEvent,
    decisionTime: decisionEvent?.timestamp ?? decision?.created_at ?? null,
    checks: buildPolicyChecks(tx, decision, policy),
  };
}

/* ────────────────────────────── impact ────────────────────────────── */

export interface Impact {
  amountAtRisk: number | null;
  recoveredAmount: number | null;
  decisionToOutcomeMs: number | null;
  probability: number | null;
  eventCount: number;
  statusLabel: string;
  statusTone: Tone;
}

export function buildImpact(custody: Custody, tx: Transaction | null, decision: Decision | null, events: AuditEvent[]): Impact {
  const { decisionEvent, executionEvent, outcome } = custody;
  const decisionMs = decisionEvent ? new Date(decisionEvent.timestamp).getTime() : NaN;
  const outcomeMs = executionEvent ? new Date(executionEvent.timestamp).getTime() : NaN;
  const diff = outcomeMs - decisionMs;

  const label: Record<OutcomeKind, [string, Tone]> = {
    recovered: ['Recovered', 'success'],
    not_recovered: ['Not recovered', 'warning'],
    escalated: ['Escalated', 'warning'],
    suppressed: ['Suppressed', 'neutral'],
    pending: [custody.verdict === 'blocked' ? 'Held by rules' : custody.verdict === 'rerouted' ? 'With a person' : 'Awaiting execution', custody.verdict === 'blocked' ? 'risk' : custody.verdict === 'rerouted' ? 'warning' : 'system'],
  };

  return {
    amountAtRisk: tx?.amount ?? null,
    recoveredAmount: outcome === 'recovered' ? executionEvent?.outcome?.recovered_amount ?? 0 : null,
    decisionToOutcomeMs: Number.isFinite(diff) && diff >= 0 ? diff : null,
    probability: decision?.ai_proposed_probability ?? null,
    eventCount: events.length,
    statusLabel: label[outcome][0],
    statusTone: label[outcome][1],
  };
}

/* ────────────────────────────── similar cases ────────────────────────────── */

export interface SimilarCase {
  transactionId: string;
  amount: number;
  status: Intervention['status'];
  recovered: boolean;
  recoveredAmount: number;
  timestamp: string;
}

export interface SimilarCases {
  cases: SimilarCase[];
  /** Comparable executed cases found in the loaded history (same leak type, same action). */
  total: number;
  recoveredCount: number;
}

/**
 * "Similar" is deliberately narrow and verifiable: another transaction with
 * the same leak type that REVORA handled with the same final action and that
 * has a recorded outcome. Nothing is estimated — the count and recovery tally
 * are read straight off the loaded intervention records.
 */
export function findSimilarCases(
  selectedId: string,
  leakType: string,
  finalAction: string,
  interventions: Intervention[],
  txsOfLeakType: Map<string, Transaction>
): SimilarCases {
  const comparable = latestByTransaction(interventions).filter(
    (i) => i.transaction_id !== selectedId && i.final_action === finalAction && txsOfLeakType.get(i.transaction_id)?.leak_type === leakType
  );
  comparable.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return {
    cases: comparable.slice(0, 3).map((i) => ({
      transactionId: i.transaction_id,
      amount: i.amount,
      status: i.status,
      recovered: i.recovered,
      recoveredAmount: i.recovered_amount,
      timestamp: i.timestamp,
    })),
    total: comparable.length,
    recoveredCount: comparable.filter((i) => i.recovered).length,
  };
}

/* ────────────────────────────── KPIs ────────────────────────────── */

export interface AuditKpis {
  totalEvents: number;
  decisions: number;
  authorized: number;
  blocked: number;
  /** Every action that ran: recovered, not recovered, escalated or suppressed. */
  actions: number;
  executed: number;
  recovered: number;
  notRecovered: number;
  escalated: number;
  suppressed: number;
}

export function buildKpis(matched: number | null | undefined, counts: Record<string, number> | undefined): AuditKpis {
  const c = counts ?? {};
  const n = (k: string) => c[k] ?? 0;
  return {
    totalEvents: matched ?? Object.values(c).reduce((s, v) => s + v, 0),
    decisions: n('DECISION_CREATED') + n('ACTION_BLOCKED'),
    authorized: n('DECISION_CREATED'),
    blocked: n('ACTION_BLOCKED'),
    actions: EXECUTION_EVENT_TYPES.reduce((sum, t) => sum + n(t), 0),
    executed: n('EXECUTION_SUCCEEDED') + n('EXECUTION_FAILED'),
    recovered: n('EXECUTION_SUCCEEDED'),
    notRecovered: n('EXECUTION_FAILED'),
    escalated: n('ESCALATION_CREATED'),
    suppressed: n('SUPPRESSION_CREATED'),
  };
}
