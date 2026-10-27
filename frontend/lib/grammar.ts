import type { ReactNode } from 'react';
import type { Decision, Intervention } from './types';
import type { EventKind } from '@/components/ui/eventKinds';
import { formatINR } from './format';

/**
 * REVORA visual grammar — vocabulary and presentation-only derivations.
 *
 * The grammar answers one question for every element on screen: *what kind of
 * thing is this?* — money, an event, a state, intelligence, policy, an action,
 * an outcome, or a person. Colour, silhouette and type for each answer are
 * defined once in globals.css (`rv-*`); this file holds the vocabulary that
 * maps real product records onto them.
 *
 * Nothing here decides anything. Verdicts are read from `Decision.policy_allowed`
 * / `final_action` and `Intervention.status`; the backend remains the only
 * authority on what was allowed, blocked or recovered.
 */

/* ───────────────────────────── tone ───────────────────────────── */

/**
 * One semantic accent per meaning. Blue = system / active · violet =
 * intelligence · green = recovered · red = risk, failure, blocked ·
 * amber = human attention · neutral = inactive / historical.
 * Applied with `data-tone` (see globals.css).
 */
export type Tone = 'neutral' | 'system' | 'ai' | 'success' | 'risk' | 'warning';

/* ──────────────────────── layers (who is acting) ──────────────────────── */

/**
 * The authority axis. AI recommends; rules authorize. Keeping the four layers
 * visually distinct is what makes that claim legible:
 *
 *   intelligence  advisory — a recessed, violet surface; it proposes
 *   policy        binding  — a raised, silver surface; it allows or blocks
 *   system        action   — blue; carries out what policy authorized
 *   human         review   — amber; a person looks at or changes the result
 */
export type Layer = 'intelligence' | 'policy' | 'system' | 'human';

export interface LayerMeta {
  label: string;
  /** What this layer is permitted to do — the verb is part of the grammar. */
  verb: string;
  /** The event kind whose silhouette this layer wears. */
  kind: EventKind;
  meaning: string;
}

export const LAYERS: Record<Layer, LayerMeta> = {
  intelligence: { label: 'Intelligence', verb: 'recommends', kind: 'decision',   meaning: 'Analyses and recommends. Cannot authorize.' },
  policy:       { label: 'Policy',       verb: 'authorizes', kind: 'policy',     meaning: 'Deterministic rules. The only authority that can allow, downgrade or block.' },
  system:       { label: 'System',       verb: 'executes',   kind: 'action',     meaning: 'Carries out what policy authorized.' },
  human:        { label: 'Human',        verb: 'decides',    kind: 'escalation', meaning: 'A person reviews or changes the result.' },
};

/** Event kinds that belong to a layer. `event` and `outcome` are facts, not actors. */
export const LAYER_OF_KIND: Partial<Record<EventKind, Layer>> = {
  signal: 'intelligence',
  decision: 'intelligence',
  policy: 'policy',
  block: 'policy',
  action: 'system',
  escalation: 'human',
  override: 'human',
};

/* ─────────────────────────── financial state ─────────────────────────── */

/**
 * What state a sum of money is in. Money is marked with a vertical *tick* (a
 * ledger column), never a node, so a figure and an event are different shapes
 * at a glance.
 */
export type FinancialState =
  | 'at_risk'
  | 'potential'
  | 'recovered'
  | 'blocked'
  | 'failed'
  | 'pending'
  | 'suppressed'
  | 'escalated';

/** solid = real · outline = estimate / not yet money · dashed = in flight or withheld · striped = prevented */
export type TickFill = 'solid' | 'outline' | 'dashed' | 'striped';

export interface FinancialStateMeta {
  /** Metric label: business language, sentence case. */
  label: string;
  /** Status chip text: mono caps. */
  short: string;
  tone: Tone;
  fill: TickFill;
  meaning: string;
}

export const FINANCIAL_STATES: Record<FinancialState, FinancialStateMeta> = {
  at_risk:    { label: 'Revenue at risk',      short: 'AT RISK',    tone: 'risk',    fill: 'solid',   meaning: 'Money that is silently slipping away' },
  potential:  { label: 'Potential recovery',   short: 'POTENTIAL',  tone: 'ai',      fill: 'outline', meaning: 'An estimate of what could be recovered' },
  recovered:  { label: 'Recovered revenue',    short: 'RECOVERED',  tone: 'success', fill: 'solid',   meaning: 'Money confirmed back' },
  blocked:    { label: 'Blocked revenue',      short: 'BLOCKED',    tone: 'risk',    fill: 'striped', meaning: 'Recovery prevented by Recovery Controls' },
  failed:     { label: 'Failed revenue event', short: 'FAILED',     tone: 'risk',    fill: 'outline', meaning: 'A payment event that did not complete' },
  pending:    { label: 'Pending recovery',     short: 'PENDING',    tone: 'system',  fill: 'dashed',  meaning: 'An action is in flight' },
  suppressed: { label: 'Suppressed action',    short: 'SUPPRESSED', tone: 'neutral', fill: 'dashed',  meaning: 'Deliberately left alone' },
  escalated:  { label: 'Escalated case',       short: 'ESCALATED',  tone: 'warning', fill: 'solid',   meaning: 'Handed to a person' },
};

/* ───────────────────────────── event types ───────────────────────────── */

export interface EventTypeMeta {
  kind: EventKind;
  /** Overrides the kind's tone where the kind alone would mislead (e.g. a failed execution). */
  tone?: Tone;
}

/**
 * The event vocabulary. Keys are the literal event names rendered in mono caps.
 * Backend audit types (`AuditEventType`) are keyed as-is; revenue events come
 * from `leak_type`; action and outcome names are derived from the intervention.
 */
export const EVENT_TYPES: Record<string, EventTypeMeta> = {
  // Revenue events — something happened to money
  PAYMENT_FAILED:        { kind: 'event' },
  CHECKOUT_ABANDONED:    { kind: 'event' },
  SUBSCRIPTION_FAILED:   { kind: 'event' },
  INVOICE_OVERDUE:       { kind: 'event' },
  // Intelligence
  DECISION_CREATED:      { kind: 'decision' },
  // Policy — the authorization boundary
  POLICY_EVALUATED:      { kind: 'policy' },
  ACTION_AUTHORIZED:     { kind: 'policy', tone: 'success' },
  ACTION_BLOCKED:        { kind: 'block' },
  // System action
  EXECUTION_STARTED:     { kind: 'action' },
  RETRY_ATTEMPTED:       { kind: 'action' },
  PAYMENT_LINK_SENT:     { kind: 'action' },
  REMINDER_SENT:         { kind: 'action' },
  // Measured outcome
  EXECUTION_SUCCEEDED:   { kind: 'outcome', tone: 'success' },
  RECOVERY_CONFIRMED:    { kind: 'outcome', tone: 'success' },
  EXECUTION_FAILED:      { kind: 'outcome', tone: 'neutral' },
  // Human attention
  ESCALATION_CREATED:    { kind: 'escalation' },
  // Deliberate no-action (backend: SUPPRESSION_CREATED)
  ACTION_SUPPRESSED:     { kind: 'outcome', tone: 'neutral' },
  SUPPRESSION_CREATED:   { kind: 'outcome', tone: 'neutral' },
};

export function eventTypeMeta(type: string): EventTypeMeta {
  return EVENT_TYPES[type] ?? { kind: 'event' };
}

const REVENUE_EVENT: Record<string, string> = {
  failed_payment: 'PAYMENT_FAILED',
  abandoned_checkout: 'CHECKOUT_ABANDONED',
  failed_subscription: 'SUBSCRIPTION_FAILED',
  overdue_invoice: 'INVOICE_OVERDUE',
};

/** The revenue event a leak represents. */
export function revenueEventType(leakType: string): string {
  return REVENUE_EVENT[leakType] ?? leakType.toUpperCase();
}

const ACTION_EVENT: Record<string, string> = {
  retry: 'RETRY_ATTEMPTED',
  payment_link: 'PAYMENT_LINK_SENT',
  reminder: 'REMINDER_SENT',
  escalate: 'ESCALATION_CREATED',
  suppress: 'ACTION_SUPPRESSED',
};

/** The event an executed action produced. */
export function actionEventType(finalAction: string): string {
  return ACTION_EVENT[finalAction] ?? finalAction.toUpperCase();
}

/* ─────────────────────── decision / authorization ─────────────────────── */

/**
 * What the policy layer did with the AI's recommendation.
 *
 *   authorized   the recommendation was allowed as proposed
 *   rerouted     policy sent the case to a person (final action = escalate)
 *   blocked      policy withheld action entirely (final action = suppress)
 *   downgraded   policy swapped in a different, safer action
 *   pending      not evaluated yet
 */
export type Verdict = 'authorized' | 'rerouted' | 'blocked' | 'downgraded' | 'pending';

export interface VerdictMeta {
  /** Verdict word, mono caps. */
  label: string;
  tone: Tone;
  /** The kind whose silhouette marks this verdict. */
  kind: EventKind;
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
  authorized: { label: 'AUTHORIZED', tone: 'success', kind: 'policy' },
  rerouted:   { label: 'REROUTED',   tone: 'warning', kind: 'escalation' },
  blocked:    { label: 'BLOCKED',    tone: 'risk',    kind: 'block' },
  downgraded: { label: 'DOWNGRADED', tone: 'warning', kind: 'policy' },
  pending:    { label: 'PENDING',    tone: 'neutral', kind: 'policy' },
};

/**
 * Reads the verdict straight from the decision record. `policy_allowed` is the
 * backend's own answer; `final_action` says where a refused proposal went.
 */
export function decisionVerdict(decision: Pick<Decision, 'policy_allowed' | 'final_action'> | null | undefined): Verdict {
  if (!decision) return 'pending';
  if (decision.policy_allowed) return 'authorized';
  if (decision.final_action === 'escalate') return 'rerouted';
  if (decision.final_action === 'suppress') return 'blocked';
  return 'downgraded';
}

/* ───────────────────────────── outcome ───────────────────────────── */

export type OutcomeKey = 'recovered' | 'not_recovered' | 'suppressed' | 'escalated' | 'pending';

export interface OutcomeMeta {
  label: string;
  tone: Tone;
  kind: EventKind;
  financial: FinancialState;
}

export const OUTCOMES: Record<OutcomeKey, OutcomeMeta> = {
  recovered:     { label: 'Recovery confirmed',    tone: 'success', kind: 'outcome',    financial: 'recovered' },
  not_recovered: { label: 'Attempted, not recovered', tone: 'neutral', kind: 'outcome', financial: 'at_risk' },
  suppressed:    { label: 'Action suppressed',     tone: 'neutral', kind: 'outcome',    financial: 'suppressed' },
  escalated:     { label: 'Escalated to merchant', tone: 'warning', kind: 'escalation', financial: 'escalated' },
  pending:       { label: 'Awaiting outcome',      tone: 'neutral', kind: 'outcome',    financial: 'pending' },
};

const OUTCOME_OF_STATUS: Record<Intervention['status'], OutcomeKey> = {
  recovered: 'recovered',
  attempted_no_recovery: 'not_recovered',
  suppressed: 'suppressed',
  escalated_to_merchant: 'escalated',
};

export function outcomeFromStatus(status: Intervention['status'] | null | undefined): OutcomeKey {
  return status ? OUTCOME_OF_STATUS[status] ?? 'pending' : 'pending';
}

/* ───────────────────────── recovery flow stages ───────────────────────── */

/** DETECT → DIAGNOSE → DECIDE → ACT → OUTCOME, each wearing its event kind. */
export type RecoveryStageKey = 'detect' | 'diagnose' | 'decide' | 'act' | 'outcome';

/**
 * reached  happened · active  happening now · pending  not yet ·
 * halted   stopped at the policy boundary
 */
export type StageState = 'reached' | 'active' | 'pending' | 'halted';

export interface RecoveryStageDef {
  key: RecoveryStageKey;
  label: string;
  kind: EventKind;
}

export const RECOVERY_STAGES: RecoveryStageDef[] = [
  { key: 'detect',   label: 'Detect',   kind: 'event' },
  { key: 'diagnose', label: 'Diagnose', kind: 'signal' },
  { key: 'decide',   label: 'Decide',   kind: 'decision' },
  { key: 'act',      label: 'Act',      kind: 'action' },
  { key: 'outcome',  label: 'Outcome',  kind: 'outcome' },
];

export interface RecoveryStageData extends RecoveryStageDef {
  state: StageState;
  /** One short line under the label: a timestamp, an amount, an action. */
  value?: ReactNode;
}

/**
 * Stage states from the records that actually exist. A transaction that has
 * been scanned is detected and diagnosed; a decision record means REVORA has
 * decided; an intervention means the action ran and an outcome was measured.
 * A refused recommendation halts the flow at the boundary: if policy blocked
 * the proposal and nothing ran, ACT is `halted`.
 */
export function recoveryStageStates(input: {
  hasTransaction?: boolean;
  decision?: Pick<Decision, 'policy_allowed' | 'final_action'> | null;
  intervention?: Pick<Intervention, 'status'> | null;
}): Record<RecoveryStageKey, StageState> {
  const { hasTransaction = true, decision, intervention } = input;
  const decided = !!decision;
  const acted = !!intervention;
  const verdict = decisionVerdict(decision);
  const stoppedAtPolicy = decided && !acted && (verdict === 'blocked' || verdict === 'rerouted');

  return {
    detect: hasTransaction ? 'reached' : 'pending',
    diagnose: hasTransaction ? 'reached' : 'pending',
    decide: decided ? 'reached' : 'pending',
    act: acted ? 'reached' : stoppedAtPolicy ? 'halted' : 'pending',
    outcome: acted ? 'reached' : 'pending',
  };
}

/* ───────────────────────────── money + time ───────────────────────────── */

/**
 * Splits a formatted rupee amount so the ₹ can be dimmed: "₹2.39L" → ["₹", "2.39L"].
 * Delegates to formatINR so figures read identically across the product.
 */
export function splitINR(amount: number, compact = false): { currency: string; figure: string } {
  const formatted = formatINR(amount, compact);
  const match = /^(₹)\s?(.*)$/.exec(formatted);
  return match ? { currency: match[1], figure: match[2] } : { currency: '', figure: formatted };
}

/** HH:MM:SS (local, 24h) — the precise clock used for event ordering. */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** "04 Oct 14:32:08" — for chronology that spans days. */
export function formatClockDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  return `${day} ${formatClockTime(iso)}`;
}

/**
 * The clock for something that happened today; date + clock for anything older,
 * so an old event never reads as if it just happened.
 */
export function formatClockAuto(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toDateString() === new Date().toDateString() ? formatClockTime(iso) : formatClockDate(iso);
}

/** A duration as HH:MM:SS (hours may exceed 24) — cooldowns and elapsed time. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
