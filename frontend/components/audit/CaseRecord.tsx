'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { AuditEvent, Decision, PolicyLimits, Transaction } from '@/lib/types';
import { actionLabel, buildRationale } from '@/lib/actionMeta';
import { formatINR, formatPct } from '@/lib/format';
import {
  Amount,
  LayerBlock,
  MetadataLine,
  MonetaryDelta,
  PolicyBoundary,
  RecoveryFlow,
  StateIndicator,
  Timeline,
  Timestamp,
  type MetaList,
  type NodeShape,
  type TimelineEntry,
} from '@/components/grammar';
// The official React Bits Stepper and StatusMark, set in REVORA's language (see reactbits-adapt.css).
import { OperationalMark, type MarkState } from './OperationalMark';
import { RecoveryStepper, type RecoveryStep } from './RecoveryStepper';
import { RECOVERY_STAGES, VERDICTS, type RecoveryStageData, type Tone } from '@/lib/grammar';
import { leakLabel } from '@/components/interventions/interventionSignals';
import { MoneyPath } from './MoneyPath';
import { SimilarCases } from './SimilarCases';
import {
  CheckState,
  Custody,
  Impact,
  OutcomeKind,
  SimilarCases as SimilarResult,
  StageId,
  actionTitle,
  describeEvent,
  eventTitle,
  formatDuration,
  formatHours,
  humanize,
  providerLabel,
} from './auditSignals';

/**
 * The recovery record: one transaction's whole story, in order, readable
 * without leaving the page.
 *
 *   revenue event → diagnosis → ┌ INTELLIGENCE recommends ┐
 *                               ── authorization boundary ──
 *                               └ POLICY authorizes ┘ → SYSTEM executes → outcome
 *
 * Everything is read from the transaction, the stored decision and the audit
 * events. The verdict is the backend's (`policy_allowed` / `final_action`); this
 * component displays it and never re-judges it. A step that has not happened is
 * drawn as not having happened — dashed, dimmed, or capped where the rules
 * stopped the flow — never as if it had.
 */

export interface RecordData {
  txId: string | null;
  tx: Transaction | null;
  decision: Decision | null;
  /** This transaction's audit events, oldest first. */
  events: AuditEvent[];
  custody: Custody | null;
  impact: Impact | null;
  policy: PolicyLimits | null;
  /** The step the viewer arrived from; scrolled into view and marked. */
  focusStage: StageId;
  tracing: boolean;
  similar: SimilarResult | null;
  similarLoading: boolean;
  onOpenCase: (txId: string) => void;
}

const PAYMENT_METHOD: Record<string, string> = { card: 'Card', upi: 'UPI', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI' };

/* ────────────────────────────── wrappers ────────────────────────────── */

/** Side panel at desktop width. */
export const CaseRecord: React.FC<RecordData> = (props) => (
  <aside aria-label="Recovery record" className="rv-surface flex flex-col overflow-hidden xl:max-h-[calc(100vh-6rem)]">
    <RecordContent {...props} />
  </aside>
);

/** Below desktop width the same record opens as a bottom sheet from the ledger. */
export const CaseRecordSheet: React.FC<RecordData & { open: boolean; onClose: () => void }> = ({ open, onClose, ...data }) => {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end bg-canvas/80 xl:hidden"
          onClick={onClose}
        >
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
            transition={reduceMotion ? { duration: 0.01 } : { duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Recovery record"
            className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-lg border-t border-border-strong bg-panel shadow-drawer"
          >
            <button
              onClick={onClose}
              aria-label="Close recovery record"
              className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-text-muted transition-colors hover:bg-panel-hover hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
            <RecordContent {...data} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ────────────────────────────── content ────────────────────────────── */

const RecordContent: React.FC<RecordData> = (props) => {
  const { txId, tx, decision, custody, impact, tracing, similar, similarLoading, onOpenCase, focusStage } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);

  // The step the viewer chose in the stepper, which wins over the one they arrived from
  // until they open another case or another event. `n` lets a step be chosen again to
  // scroll back to it after the timeline has been scrolled away.
  const [picked, setPicked] = useState<{ stage: StageId; n: number } | null>(null);
  useEffect(() => {
    setPicked(null);
  }, [txId, focusStage]);
  const activeStage = picked?.stage ?? focusStage;
  const scrollKey = `${txId}:${activeStage}:${picked?.n ?? 0}`;

  // Bring the active step into view inside this panel's own scroller — never scroll the
  // page itself — and only when the target actually changes.
  useEffect(() => {
    if (tracing) return;
    if (scrolledTo.current === scrollKey) return;
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>('[data-focus]');
    if (!box || !el) return;
    scrolledTo.current = scrollKey;
    box.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: 'smooth' });
  }, [scrollKey, tracing, custody]);

  const rows = custody ? buildRows({ ...props, focusStage: activeStage }, custody) : [];

  if (!txId || !custody) return <IdleRecord />;

  const method = tx ? PAYMENT_METHOD[tx.payment_method] ?? humanize(tx.payment_method) : null;
  const headerMeta: MetaList = [
    { value: txId, mono: true },
    tx && { label: 'Customer', value: tx.customer_id, mono: true },
    method ? { label: 'Method', value: method } : null,
    impact && { label: 'Audit events', value: impact.eventCount, mono: true },
  ];

  const finalLabel = custody.finalAction ? actionLabel(custody.finalAction) : null;
  const aiLabel = custody.aiAction ? actionLabel(custody.aiAction) : null;
  const actionNote =
    custody.verdict === 'authorized'
      ? finalLabel
      : custody.verdict === 'blocked'
      ? aiLabel && `${aiLabel} stopped`
      : custody.verdict === 'rerouted'
      ? 'Sent to a person'
      : custody.verdict === 'downgraded'
      ? finalLabel && `Changed to ${finalLabel.toLowerCase()}`
      : null;

  return (
    <>
      <div className="shrink-0 border-b border-border-subtle px-5 pb-4 pt-4 pr-12 xl:pr-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="rv-label">Recovery record</div>
            <h2 className="mt-1.5 text-[18px] font-semibold leading-tight tracking-tight text-text-primary">{eventTitle(tx?.leak_type)}</h2>
          </div>
          <div className="shrink-0 pt-0.5">
            {/* Keyed by case: a different record appears already in its state; only a change of state
                within the same record (pending → done, tracing → resolved) animates. */}
            {impact && <OperationalMark key={txId} chip {...recordMark(custody, impact, tracing)} />}
          </div>
        </div>
        <div className="mt-2">
          <MetadataLine items={headerMeta} />
        </div>
        <MoneyPath
          amount={tx?.amount ?? null}
          eventLabel={eventTitle(tx?.leak_type)}
          verdict={custody.verdict}
          actionNote={actionNote}
          outcome={custody.outcome}
          executed={custody.executed}
          recoveredAmount={impact?.recoveredAmount ?? null}
        />
        <RecoveryStepper
          className="mt-4 border-t border-border-divider pt-3"
          label="How REVORA reached this outcome"
          steps={buildSteps(props, custody)}
          initialKey={focusStage}
          resetKey={`${txId}:${focusStage}`}
          onSelect={(key) => setPicked((p) => ({ stage: key as StageId, n: (p?.n ?? 0) + 1 }))}
        />
      </div>

      <div ref={scrollRef} className={`relative flex-1 overflow-y-auto custom-scrollbar transition-opacity ${tracing ? 'opacity-60' : ''}`}>
        <div className="px-5 pb-5 pt-5">
          <Timeline items={rows} />
        </div>

        <div className="space-y-5 border-t border-border-subtle px-5 py-4">
          <SimilarCases result={similar} loading={similarLoading} leakType={tx?.leak_type ?? null} action={custody.finalAction} onSelect={onOpenCase} />
          <TechnicalDisclosure key={txId} custody={custody} decision={decision} />
        </div>
      </div>
    </>
  );
};

/* ────────────────────────────── chronology ────────────────────────────── */

function TitleLine({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="min-w-0">{left}</span>
      {right}
    </span>
  );
}

function eventSentence(tx: Transaction): string {
  const method = PAYMENT_METHOD[tx.payment_method] ?? humanize(tx.payment_method);
  switch (tx.leak_type) {
    case 'failed_payment':
      return `The customer's ${method} payment didn't go through.`;
    case 'abandoned_checkout':
      return `The customer left checkout ${tx.reached_payment_page ? 'after reaching the payment page' : 'before reaching the payment page'}.`;
    case 'failed_subscription':
      return 'A recurring subscription renewal was declined.';
    default:
      return `An invoice is ${tx.age_days} ${tx.age_days === 1 ? 'day' : 'days'} overdue.`;
  }
}

const OUTCOME_TITLE: Record<OutcomeKind, string> = {
  recovered: 'Recovery confirmed',
  not_recovered: 'Attempted, not recovered',
  escalated: 'Escalated to merchant',
  suppressed: 'Action suppressed',
  pending: 'No outcome yet',
};

const OUTCOME_TONE: Record<OutcomeKind, Tone> = {
  recovered: 'success',
  not_recovered: 'neutral',
  escalated: 'warning',
  suppressed: 'neutral',
  pending: 'neutral',
};

function policyCopy(custody: Custody, decision: Decision | null): { title: string; detail: string } {
  const reason = decision?.policy_reason ?? custody.decisionEvent?.policy_result?.reason ?? null;
  const proposed = custody.aiAction ? actionLabel(custody.aiAction) : 'The proposed action';
  const final = custody.finalAction ? actionLabel(custody.finalAction) : null;
  switch (custody.verdict) {
    case 'authorized':
      return { title: `${final ?? 'Action'} authorized`, detail: 'Recovery Controls approved this as proposed.' };
    case 'blocked':
      return { title: `${proposed} blocked`, detail: `${reason ?? 'A recovery control stopped this action.'} The AI cannot override this.` };
    case 'rerouted':
      return { title: 'Rerouted to a person', detail: `${reason ?? 'A recovery control sent this to a person.'} The AI cannot override this.` };
    case 'downgraded':
      return { title: `Changed to ${final?.toLowerCase() ?? 'a safer action'}`, detail: `${reason ?? 'A recovery control changed this action.'} The AI cannot override this.` };
    default:
      return { title: 'Awaiting policy check', detail: 'This transaction has no policy verdict on file yet.' };
  }
}

interface Mark {
  state: MarkState;
  label: string;
  tone: Tone;
}

/**
 * The record's overall operational state, in the vocabulary of a status mark. The label and
 * tone are the ones the record already showed (`Impact.statusLabel` / `statusTone`); only the
 * glyph is new, and it is read from the same outcome and verdict:
 *   recovered → done · attempted, not recovered → failed · suppressed or held by the rules →
 *   cancelled · handed to a person, or authorized and waiting → pending.
 * While the record is being fetched it is running — a real, brief state.
 */
function recordMark(custody: Custody, impact: Impact, tracing: boolean): Mark {
  if (tracing) return { state: 'running', label: 'Tracing', tone: 'neutral' };
  const { outcome, verdict } = custody;
  const state: MarkState =
    outcome === 'recovered' ? 'done' : outcome === 'not_recovered' ? 'failed' : outcome === 'suppressed' ? 'cancelled' : outcome === 'escalated' ? 'pending' : verdict === 'blocked' ? 'cancelled' : 'pending';
  return { state, label: impact.statusLabel, tone: impact.statusTone };
}

/** The action step's own state: did it run, and if not, why not — from the verdict and the execution event. */
function actionMark(custody: Custody): Mark {
  const { executed, finalAction, verdict } = custody;
  if (executed) {
    if (finalAction === 'escalate') return { state: 'done', label: 'Routed', tone: 'warning' };
    if (finalAction === 'suppress') return { state: 'cancelled', label: 'No action', tone: 'neutral' };
    return { state: 'done', label: 'Executed', tone: 'system' };
  }
  switch (verdict) {
    case 'blocked':
      return { state: 'cancelled', label: 'Not run', tone: 'risk' };
    case 'rerouted':
      return { state: 'pending', label: 'Awaiting review', tone: 'warning' };
    case 'pending':
      return { state: 'pending', label: 'Pending', tone: 'neutral' };
    default:
      return { state: 'pending', label: 'Not run yet', tone: 'system' };
  }
}

/** What the action slot shows when nothing has run — read from the verdict, never invented. */
function idleAction(custody: Custody): { layer: 'system' | 'human'; state: 'pending' | 'void'; title: string; detail: React.ReactNode } {
  switch (custody.verdict) {
    case 'blocked':
      return { layer: 'system', state: 'void', title: 'No action taken', detail: 'Recovery Controls withheld this action, so nothing was run.' };
    case 'rerouted':
      return { layer: 'human', state: 'pending', title: 'Awaiting review', detail: 'This case is waiting for a person to pick it up.' };
    case 'pending':
      return { layer: 'system', state: 'pending', title: 'Nothing queued', detail: 'No action is decided for this case yet.' };
    default:
      return {
        layer: 'system',
        state: 'pending',
        title: 'Authorized, not yet run',
        detail: (
          <>
            {custody.finalAction ? `${actionLabel(custody.finalAction)} is cleared to run. ` : ''}
            <Link href="/interventions" className="font-medium text-primary-300 transition-colors hover:text-primary-100">
              Open Interventions to run it
            </Link>
          </>
        ),
      };
  }
}

const CHECK: Record<CheckState, { word: string; shape: NodeShape; tone: Tone }> = {
  passed: { word: 'Passed', shape: 'disc', tone: 'success' },
  within: { word: 'Within limit', shape: 'ring', tone: 'neutral' },
  blocked: { word: 'Blocked', shape: 'slashed', tone: 'risk' },
  escalated: { word: 'Rerouted', shape: 'triangle', tone: 'warning' },
  not_reached: { word: 'Not reached', shape: 'dashed', tone: 'neutral' },
};

/** The outcome step's account of itself — one source for the timeline row and the stepper. */
function outcomeDetailFor(custody: Custody, tx: Transaction | null): Record<OutcomeKind, React.ReactNode> {
  const { verdict, executionEvent } = custody;
  return {
    recovered: executionEvent ? describeEvent(executionEvent).title : 'Revenue was recovered.',
    not_recovered: tx ? `The attempt didn't recover the payment. ${formatINR(tx.amount)} remains at risk.` : "The attempt didn't recover the payment.",
    escalated: "Handed to the merchant queue. REVORA's part ends here.",
    suppressed: 'REVORA chose not to take any further automated action on this case.',
    pending:
      verdict === 'blocked'
        ? 'Recovery did not proceed — it was held by Recovery Controls.'
        : verdict === 'rerouted'
        ? 'Waiting for a person to pick this case up.'
        : 'Appears here as soon as the action runs.',
  };
}

/**
 * The stepper's six steps — the same six the timeline below walks through, each with the
 * one-line account of itself that the audit record supports and no other. `reached` is
 * whether the flow actually got there: a step with nothing behind it is not reached (never
 * a guess), and where the rules stopped the flow the action was not reached, so it is never
 * given a check. Titles and details come from the same helpers the timeline rows use.
 */
function buildSteps(data: RecordData, custody: Custody): RecoveryStep[] {
  const { tx, decision, impact } = data;
  const { verdict, outcome, executed, aiAction, finalAction } = custody;
  const vmeta = VERDICTS[verdict];
  const hasIntel = tx?.model_recovery_prob != null || decision != null;
  const stopped = !executed && (verdict === 'blocked' || verdict === 'rerouted');
  const policyText = policyCopy(custody, decision);
  const idle = idleAction(custody);
  const optionCount = decision?.candidates_evaluated.length ?? 0;
  const rationale = tx ? buildRationale(tx, decision) : null;
  const likelihood = tx?.model_recovery_prob != null ? `${formatPct(tx.model_recovery_prob)} likely to recover.` : null;

  return [
    {
      key: 'event',
      label: 'Event',
      name: 'Event',
      reached: !!tx,
      title: tx ? eventTitle(tx.leak_type) : 'Not available',
      detail: tx ? eventSentence(tx) : "The transaction record couldn't be loaded, so the original event isn't available.",
    },
    {
      key: 'intelligence',
      label: 'Diagnosis',
      name: 'Diagnosis',
      reached: hasIntel,
      title: tx && hasIntel ? `Diagnosed: ${humanize(tx.failure_code)}` : 'Not yet diagnosed',
      detail: hasIntel ? [rationale, likelihood].filter(Boolean).join(' ') : 'Run an intelligence pass to diagnose this case.',
    },
    {
      key: 'decision',
      label: 'Recommend',
      name: 'Recommendation',
      reached: !!aiAction,
      title: aiAction ? actionLabel(aiAction) : 'No recommendation recorded',
      detail: decision
        ? optionCount > 1
          ? `Chosen as the best-value of the ${optionCount} options REVORA compared. ${formatPct(decision.ai_proposed_probability)} likely to recover.`
          : 'REVORA recommended this action.'
        : 'There is no stored decision for this transaction yet.',
    },
    {
      key: 'policy',
      label: 'Policy',
      name: 'Policy',
      reached: verdict !== 'pending',
      tone: verdict === 'pending' ? undefined : vmeta.tone,
      title: policyText.title,
      detail: policyText.detail,
    },
    {
      key: 'action',
      label: 'Action',
      name: 'Action',
      reached: executed,
      tone: stopped ? vmeta.tone : undefined,
      title: executed && finalAction ? actionTitle(finalAction) : idle.title,
      detail: executed
        ? finalAction === 'suppress'
          ? 'REVORA took no automated action on this case.'
          : finalAction === 'escalate'
          ? 'Handed to the merchant queue for a person to follow up.'
          : 'Execution is simulated in this build — no real payment network was contacted.'
        : idle.detail,
    },
    {
      key: 'outcome',
      label: 'Outcome',
      name: 'Outcome',
      reached: executed,
      tone: executed ? OUTCOME_TONE[outcome] : undefined,
      title: OUTCOME_TITLE[outcome],
      detail: outcomeDetailFor(custody, tx)[outcome],
    },
  ];
}

function buildRows(data: RecordData, custody: Custody): TimelineEntry[] {
  const { tx, decision, policy, impact, focusStage } = data;
  const { verdict, outcome, executed, executionEvent, decisionTime } = custody;
  const vmeta = VERDICTS[verdict];
  const focus = (s: StageId) => focusStage === s;
  const hasIntel = tx?.model_recovery_prob != null || decision != null;

  /* 1 · revenue event */
  const event: TimelineEntry = {
    id: 'event',
    kind: 'event',
    state: tx ? 'reached' : 'pending',
    focus: focus('event'),
    time: tx ? <Timestamp iso={tx.event_time} format="auto" /> : undefined,
    title: <TitleLine left={eventTitle(tx?.leak_type)} right={tx ? <Amount value={tx.amount} size="sm" compact={tx.amount >= 100000} /> : null} />,
    detail: tx ? eventSentence(tx) : "The transaction record couldn't be loaded, so the original event isn't available.",
    meta: tx ? [{ label: 'Failure', value: tx.failure_code, mono: true }, { label: 'Type', value: leakLabel(tx.leak_type) }] : undefined,
  };

  /* 2 · diagnosis */
  const rationale = tx ? buildRationale(tx, decision) : null;
  const likelihood = tx?.model_recovery_prob != null ? `${formatPct(tx.model_recovery_prob)} likely to recover.` : null;
  const diagnosis: TimelineEntry = {
    id: 'intelligence',
    kind: 'signal',
    state: hasIntel ? 'reached' : 'pending',
    focus: focus('intelligence'),
    time: hasIntel && decisionTime ? <Timestamp iso={decisionTime} format="auto" /> : undefined,
    title: tx && hasIntel ? `Diagnosed: ${humanize(tx.failure_code)}` : 'Not yet diagnosed',
    detail: hasIntel ? [rationale, likelihood].filter(Boolean).join(' ') || undefined : 'Run an intelligence pass to diagnose this case.',
    meta: tx && hasIntel
      ? [
          { label: 'Prior payments', value: tx.prior_successful_payments, mono: true },
          { label: 'Attempts so far', value: tx.retries_so_far, mono: true },
          { label: 'Since event', value: formatHours(tx.hours_since_event), mono: true },
          { label: 'Customer value', value: humanize(tx.ltv_bucket) },
          tx.leak_type === 'failed_subscription' && { label: 'Consecutive failures', value: tx.consecutive_failures ?? 0, mono: true },
        ]
      : undefined,
  };

  /* 3 · intelligence recommends — then the authorization boundary */
  const optionCount = decision?.candidates_evaluated.length ?? 0;
  const recommendation: TimelineEntry = {
    id: 'decision',
    kind: 'decision',
    block: true,
    state: custody.aiAction ? 'reached' : 'pending',
    focus: focus('decision'),
    time: custody.aiAction && decisionTime ? <Timestamp iso={decisionTime} format="auto" /> : undefined,
    children: (
      <>
        <LayerBlock
          layer="intelligence"
          state={custody.aiAction ? 'live' : 'pending'}
          title={custody.aiAction ? actionLabel(custody.aiAction) : 'No recommendation recorded'}
          detail={
            decision
              ? optionCount > 1
                ? `Chosen as the best-value of the ${optionCount} options REVORA compared.`
                : 'REVORA recommended this action.'
              : 'There is no stored decision for this transaction yet.'
          }
          meta={decision ? [{ label: 'Recovery likelihood', value: formatPct(decision.ai_proposed_probability), mono: true }] : undefined}
        >
          {decision && optionCount > 1 && <Options key={decision.decision_id} decision={decision} />}
        </LayerBlock>
        <PolicyBoundary verdict={verdict} className="mt-3.5" />
      </>
    ),
  };

  /* 4 · policy authorizes */
  const copy = policyCopy(custody, decision);
  const { checks, notApplicable } = custody.checks;
  const policyRow: TimelineEntry = {
    id: 'policy',
    kind: 'policy',
    block: true,
    state: verdict === 'pending' ? 'pending' : 'reached',
    focus: focus('policy'),
    time: verdict !== 'pending' && decisionTime ? <Timestamp iso={decisionTime} format="auto" /> : undefined,
    children: (
      <LayerBlock
        layer="policy"
        verdict={verdict}
        state={verdict === 'pending' ? 'pending' : 'live'}
        title={copy.title}
        detail={copy.detail}
        status={verdict === 'pending' ? undefined : <StateIndicator label={vmeta.label} kind={vmeta.kind} tone={vmeta.tone} />}
        meta={
          verdict === 'pending'
            ? undefined
            : [
                custody.decisionEvent && { label: 'Policy', value: `v${custody.decisionEvent.policy_version}`, mono: true },
                {
                  value: (
                    <Link href="/policies" className="inline-flex items-center gap-1.5 font-medium text-primary-300 transition-colors hover:text-primary-100">
                      <SlidersHorizontal aria-hidden className="h-3 w-3" />
                      Review Recovery Controls
                    </Link>
                  ),
                },
              ]
        }
      >
        {checks.length > 0 ? (
          <div>
            <div className="rv-label mt-1 pb-1.5">Controls in play</div>
            <div className="rv-checks">
              {checks.map((c) => {
                const m = CHECK[c.state];
                return (
                  <div key={c.key} className="rv-check">
                    <span aria-hidden className="rv-node" data-shape={m.shape} data-tone={m.tone} />
                    <div className="min-w-0">
                      <div className="rv-check-label">{c.label}</div>
                      <div className="rv-check-detail">{c.detail}</div>
                    </div>
                    <span className="rv-state" data-tone={m.tone}>
                      {m.word}
                    </span>
                  </div>
                );
              })}
            </div>
            {notApplicable.length > 0 && custody.aiAction && (
              <p className="rv-meta mt-2 leading-relaxed">
                Not applicable to {actionLabel(custody.aiAction).toLowerCase()}: {notApplicable.join(', ')}.
              </p>
            )}
          </div>
        ) : verdict !== 'pending' && !policy ? (
          <p className="rv-meta leading-relaxed">Live recovery-control limits couldn&apos;t be loaded, so the per-control breakdown is unavailable.</p>
        ) : null}
      </LayerBlock>
    ),
  };

  /* 5 · system executes (or doesn't) */
  const stopped = !executed && (verdict === 'blocked' || verdict === 'rerouted');
  const idle = idleAction(custody);
  const final = custody.finalAction;
  const actionRow: TimelineEntry = {
    id: 'action',
    kind: executed && final === 'escalate' ? 'escalation' : 'action',
    block: true,
    state: executed ? 'reached' : stopped ? 'halted' : 'pending',
    tone: stopped ? vmeta.tone : undefined,
    focus: focus('action'),
    time: executed && executionEvent ? <Timestamp iso={executionEvent.timestamp} format="auto" /> : undefined,
    children:
      executed && executionEvent && final ? (
        <LayerBlock
          layer={final === 'escalate' ? 'human' : 'system'}
          title={actionTitle(final)}
          detail={
            final === 'suppress'
              ? 'REVORA took no automated action on this case.'
              : final === 'escalate'
              ? 'Handed to the merchant queue for a person to follow up.'
              : 'Execution is simulated in this build — no real payment network was contacted.'
          }
          meta={[{ label: 'Provider', value: providerLabel(executionEvent.provider), mono: true }]}
          status={<OperationalMark key={data.txId} {...actionMark(custody)} />}
        />
      ) : (
        <LayerBlock layer={idle.layer} state={idle.state} title={idle.title} detail={idle.detail} status={<OperationalMark key={data.txId} {...actionMark(custody)} />} />
      ),
  };

  /* 6 · measured outcome */
  const recovered = impact?.recoveredAmount ?? null;
  const outcomeDetail = outcomeDetailFor(custody, tx);
  const outcomeRow: TimelineEntry = {
    id: 'outcome',
    kind: outcome === 'escalated' ? 'escalation' : 'outcome',
    state: executed ? 'reached' : 'pending',
    tone: executed ? OUTCOME_TONE[outcome] : undefined,
    focus: focus('outcome'),
    time: executed && executionEvent ? <Timestamp iso={executionEvent.timestamp} format="auto" /> : undefined,
    title: <TitleLine left={OUTCOME_TITLE[outcome]} right={outcome === 'recovered' && recovered ? <MonetaryDelta value={recovered} /> : null} />,
    detail: outcomeDetail[outcome],
    meta: executed && impact?.decisionToOutcomeMs != null ? [{ label: 'Decision to outcome', value: formatDuration(impact.decisionToOutcomeMs), mono: true }] : undefined,
  };

  return [event, diagnosis, recommendation, policyRow, actionRow, outcomeRow];
}

/* ────────────────────────────── options + technical ────────────────────────────── */

/**
 * Chosen action and the alternatives it beat, read from the stored decision's
 * `candidates_evaluated`. Collapsed by default: it is evidence, not the headline.
 */
const Options: React.FC<{ decision: Decision }> = ({ decision }) => {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => [...decision.candidates_evaluated].sort((a, b) => b.expected_value - a.expected_value), [decision]);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[11.5px] text-text-muted transition-colors hover:text-text-secondary"
      >
        <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        Options considered · {options.length}
      </button>
      {open && (
        <div className="mt-2">
          <div className="rv-option rv-label" aria-hidden>
            <span>Option</span>
            <span className="text-right">Likelihood</span>
            <span className="text-right">Value</span>
          </div>
          {options.map((o) => {
            const chosen = o.action === decision.ai_proposed_action;
            return (
              <div key={o.action} className="rv-option" data-chosen={chosen ? '' : undefined}>
                <span className="min-w-0 truncate">
                  {actionLabel(o.action)}
                  {chosen && <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ai-300">Chosen</span>}
                </span>
                <span className="rv-option-figure">{formatPct(o.probability)}</span>
                <span className="rv-option-figure">{formatINR(o.expected_value)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const TechnicalDisclosure: React.FC<{ custody: Custody; decision: Decision | null }> = ({ custody, decision }) => {
  const [open, setOpen] = useState(false);
  const dEvt = custody.decisionEvent;
  const xEvt = custody.executionEvent;
  const rows: [string, string][] = [];
  const add = (k: string, v: string | number | null | undefined) => {
    if (v != null && v !== '') rows.push([k, String(v)]);
  };

  add('decision_id', decision?.decision_id ?? dEvt?.decision_id);
  add('decision_event_id', dEvt?.event_id);
  add('intervention_id', xEvt?.intervention_id);
  add('execution_event_id', xEvt?.event_id);
  add('policy_version', dEvt?.policy_version ?? xEvt?.policy_version);
  add('model_version', dEvt?.model_version ?? xEvt?.model_version);
  add('provider', xEvt?.provider ?? dEvt?.provider);
  add('idempotency_key', xEvt?.idempotency_key);
  add('ai_proposed_ev', decision?.ai_proposed_ev.toFixed(2));
  decision?.candidates_evaluated.forEach((c) => add(`ev · ${c.action}`, `${c.expected_value.toFixed(2)} (p=${c.probability.toFixed(4)})`));

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[11.5px] text-text-muted transition-colors hover:text-text-secondary"
      >
        <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        View technical details
      </button>
      {open && (
        <div className="rv-well mt-2.5 space-y-0.5 p-3">
          {rows.length === 0 ? (
            <span className="rv-meta">No technical records for this case.</span>
          ) : (
            rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className="shrink-0 font-mono text-[10.5px] text-text-muted">{k}</span>
                <span className="break-all text-right font-mono text-[10.5px] text-text-secondary">{v}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* ────────────────────────────── idle ────────────────────────────── */

/** Before a case is chosen: the shape of a record, every step still open. Nothing is invented. */
const IdleRecord: React.FC = () => {
  const stages: RecoveryStageData[] = RECOVERY_STAGES.map((def) => ({ ...def, state: 'pending' }));
  return (
    <div className="flex-1 px-5 py-6">
      <div className="rv-label">Recovery record</div>
      <h2 className="mt-1.5 text-[18px] font-semibold leading-tight tracking-tight text-text-primary">Why did REVORA do that?</h2>
      <p className="mt-2 max-w-[34ch] text-[12.5px] leading-relaxed text-text-secondary">
        Choose an event from the ledger. This panel traces what happened, what REVORA recommended, what the rules allowed, what ran, and what came back.
      </p>
      <RecoveryFlow orientation="vertical" stages={stages} gate={{ verdict: 'pending' }} className="mt-6" />
      <p className="mt-8 border-t border-border-divider pt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-text-disabled">
        AI recommends.
        <br />
        Rules authorize.
      </p>
    </div>
  );
};
