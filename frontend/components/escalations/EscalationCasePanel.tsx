'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, CircleAlert, CircleCheck, MousePointerClick, ShieldAlert, SlidersHorizontal, X, Send } from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { PolicyLimits } from '@/lib/types';
import { actionLabel, ACTION_PREVIEW, buildSafetyChecks } from '@/lib/actionMeta';
import {
  EscalationCase,
  Priority,
  PRIORITY_LABEL,
  REASON_RECOMMENDATION,
  caseAgeHours,
  caseAmount,
  caseCustomerId,
  caseLeakType,
  formatAge,
  isRoutedToMerchant,
  leakLabel,
  reasonKey,
  reasonLabel,
} from './escalationSignals';
import { reasonIcon } from './reasonIcons';

interface Props {
  escCase: EscalationCase | null;
  policy: PolicyLimits | null;
  priority: Priority | null;
  variant: 'inline' | 'overlay';
  onClose: () => void;
  onRoute: (c: EscalationCase) => void;
  routingId: string | null;
  routeError: string | null;
}

function absoluteTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * "Open a case" for Escalations — the same drawer pattern Interventions
 * and Transactions already use (see `InterventionCasePanel.tsx`), reused
 * rather than reinvented: an inline panel at desktop width, a bottom-sheet
 * overlay below it. What differs is the content and the action: this case
 * is already fully loaded from the page's bulk fetch (no per-case network
 * round trip), and the action isn't "execute a recovery attempt" — it's
 * "confirm this case has been formally routed to your merchant queue,"
 * which is what `POST /interventions/{id}/execute` actually does for an
 * `escalate` decision (see `SimulationProvider.execute`): it never
 * attempts a real payment.
 */
export const EscalationCasePanel: React.FC<Props> = ({ escCase, policy, priority, variant, onClose, onRoute, routingId, routeError }) => {
  const reduceMotion = useReducedMotion();
  const [confirming, setConfirming] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  const caseId = escCase?.decision.decision_id ?? null;

  useEffect(() => {
    setConfirming(false);
    setShowTechnical(false);
  }, [caseId]);

  useEffect(() => {
    if (!escCase || variant !== 'overlay') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escCase, onClose, variant]);

  useEffect(() => {
    if (escCase && isRoutedToMerchant(escCase)) setConfirming(false);
  }, [escCase]);

  const inner = escCase ? (
    <>
      <CaseHeader c={escCase} priority={priority} onClose={onClose} />
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <CaseBody c={escCase} policy={policy} showTechnical={showTechnical} onToggleTechnical={() => setShowTechnical((v) => !v)} />
      </div>
      <CaseFooter
        c={escCase}
        isRouting={escCase.decision.decision_id === routingId}
        routeError={routeError}
        confirming={confirming}
        onConfirmStart={() => setConfirming(true)}
        onConfirmCancel={() => setConfirming(false)}
        onRoute={onRoute}
      />
    </>
  ) : null;

  if (variant === 'inline') {
    return (
      <div className="rounded-lg border border-border-subtle bg-panel overflow-hidden flex flex-col max-h-[calc(100vh-7rem)]">
        {escCase ? inner : <EmptyPanel />}
      </div>
    );
  }

  return (
    <AnimatePresence>
      {escCase && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-hidden bg-canvas/80 backdrop-blur-sm flex items-end sm:items-stretch sm:justify-end"
          onClick={onClose}
        >
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 28 }}
            transition={reduceMotion ? { duration: 0.01 } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Escalation case details"
            className="bg-panel border-border-strong shadow-drawer flex flex-col overflow-hidden w-full max-h-[92vh] rounded-t-lg border-t sm:max-w-[520px] sm:h-full sm:max-h-none sm:rounded-t-none sm:border-t-0 sm:border-l"
          >
            {inner}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ────────────────────────────── header ────────────────────────────── */

const CaseHeader: React.FC<{ c: EscalationCase; priority: Priority | null; onClose: () => void }> = ({ c, priority, onClose }) => {
  const routed = isRoutedToMerchant(c);
  const rKey = reasonKey(c.decision);
  const Icon = reasonIcon(rKey);

  return (
    <div className="border-b border-border-subtle bg-surface shrink-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-text-muted">Escalation case</div>
          <div className="font-mono text-[11.5px] text-text-secondary mt-1 truncate">{c.decision.transaction_id}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close case"
          className="p-1.5 -m-1 rounded-md hover:bg-panel-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon strokeWidth={1.5} className="w-5 h-5 text-warning-300 shrink-0" />
          <div className="text-[16px] leading-tight font-semibold text-text-primary truncate">{reasonLabel(c.decision)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[17px] font-semibold tabular-nums leading-none text-text-primary">{formatINR(caseAmount(c))}</div>
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-text-muted mt-1.5">Revenue at risk</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-secondary">
        <span>{leakLabel(caseLeakType(c))}</span>
        <span className="text-border-strong">·</span>
        <span className="font-mono text-text-muted truncate">{caseCustomerId(c)}</span>
        {priority && (
          <>
            <span className="text-border-strong">·</span>
            <span
              className={
                priority === 'critical' ? 'text-risk-300' : priority === 'high' ? 'text-warning-300' : 'text-text-muted'
              }
            >
              {PRIORITY_LABEL[priority]} priority
            </span>
          </>
        )}
        {routed && (
          <>
            <span className="text-border-strong">·</span>
            <span className="text-success-300">Routed to merchant</span>
          </>
        )}
      </div>
    </div>
  );
};

/* ────────────────────────────── body ────────────────────────────── */

const CaseBody: React.FC<{
  c: EscalationCase;
  policy: PolicyLimits | null;
  showTechnical: boolean;
  onToggleTechnical: () => void;
}> = ({ c, policy, showTechnical, onToggleTechnical }) => {
  const { decision, tx, intervention } = c;
  const rKey = reasonKey(decision);
  const routed = isRoutedToMerchant(c);
  const safetyChecks = tx ? buildSafetyChecks(tx, policy) : [];

  const potentialRecovery = tx?.model_recovery_prob != null ? tx.amount * tx.model_recovery_prob : null;

  return (
    <div className="space-y-5">
      {/* Case facts */}
      <section className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Fact label="Status" value={routed ? <span className="text-success-200">Routed to merchant</span> : <span className="text-warning-200">Awaiting review</span>} />
        {tx?.model_recovery_prob != null && <Fact label="Recovery probability" value={formatPct(tx.model_recovery_prob)} />}
        {potentialRecovery != null && <Fact label="Potential recovery" value={formatINR(potentialRecovery)} />}
        <Fact label="Escalated" value={absoluteTime(decision.created_at)} />
        {tx && <Fact label="Leak detected" value={absoluteTime(tx.event_time)} />}
        {routed && intervention && <Fact label="Routed" value={absoluteTime(intervention.timestamp)} />}
      </section>

      {/* Why this needs attention */}
      <section>
        <SectionTitle>Why this needs attention</SectionTitle>
        <div
          className={`flex items-start gap-2.5 rounded-md border p-3 ${
            decision.policy_allowed ? 'bg-ai-muted/15 border-ai-500/25' : 'bg-warning-muted/30 border-warning-500/30'
          }`}
        >
          {decision.policy_allowed ? (
            <ShieldAlert className="w-4 h-4 text-ai-400 shrink-0 mt-px" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-warning-400 shrink-0 mt-px" />
          )}
          <div className="min-w-0">
            <div className={`text-[11px] font-semibold uppercase tracking-wider ${decision.policy_allowed ? 'text-ai-300' : 'text-warning-300'}`}>
              {decision.policy_allowed ? 'REVORA proposed escalation itself' : 'Stopped at a recovery control boundary'}
            </div>
            <p className="leading-relaxed mt-1 text-[12.5px] text-text-primary">{decision.policy_reason}</p>
            {!decision.policy_allowed && (
              <Link
                href="/policies"
                className="inline-flex items-center gap-1.5 mt-2.5 text-[11.5px] font-medium text-warning-200 hover:text-warning-100 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Review Recovery Controls
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* What REVORA already attempted */}
      <section>
        <SectionTitle>What REVORA already attempted</SectionTitle>
        <div className="rounded-md border border-ai-500/25 bg-ai-muted/15 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ai-300">
            <span className="w-1.5 h-1.5 rounded-full bg-ai-400 shrink-0" />
            REVORA recommends
          </div>
          <div className="text-[13px] font-medium text-text-primary mt-2">{actionLabel(decision.ai_proposed_action)}</div>
          <p className="text-[12.5px] text-text-secondary leading-relaxed mt-1.5">
            {ACTION_PREVIEW[decision.ai_proposed_action] ?? `${actionLabel(decision.ai_proposed_action)} was REVORA's top-scoring option before recovery controls reviewed it.`}
          </p>
        </div>
      </section>

      {/* Recommended next step */}
      <section>
        <SectionTitle>Recommended next step</SectionTitle>
        <p className="text-[12.5px] text-text-secondary leading-relaxed">{REASON_RECOMMENDATION[rKey]}</p>
      </section>

      {/* Relevant recovery controls */}
      {safetyChecks.length > 0 && (
        <section>
          <SectionTitle>Relevant recovery controls</SectionTitle>
          <div className="space-y-1.5">
            {safetyChecks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 text-[11.5px]">
                {check.passed ? (
                  <Check className="w-3 h-3 text-success-400 shrink-0" />
                ) : (
                  <CircleAlert className="w-3 h-3 text-warning-400 shrink-0" />
                )}
                <span className={check.passed ? 'text-text-secondary' : 'text-warning-300'}>{check.label}</span>
                <span className="text-text-muted ml-auto text-[11px] text-right">{check.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      {tx && (
        <section>
          <SectionTitle>Case timeline</SectionTitle>
          <CaseTimeline c={c} />
        </section>
      )}

      {/* Technical detail stays collapsed by default */}
      <section>
        <button
          onClick={onToggleTechnical}
          aria-expanded={showTechnical}
          className="flex items-center gap-1.5 text-[11.5px] text-text-muted hover:text-text-secondary transition-colors"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
          View technical details
        </button>
        {showTechnical && (
          <div className="mt-2.5 space-y-0.5 rounded-md border border-border-subtle bg-surface p-3">
            <TechRow label="decision_id" value={decision.decision_id} />
            <TechRow label="ai_proposed_action" value={decision.ai_proposed_action} />
            <TechRow label="ai_proposed_probability" value={decision.ai_proposed_probability.toFixed(6)} />
            <TechRow label="ai_proposed_ev" value={decision.ai_proposed_ev.toFixed(2)} />
            <TechRow label="policy_allowed" value={String(decision.policy_allowed)} />
            <TechRow label="final_action" value={decision.final_action} />
            {intervention && (
              <>
                <TechRow label="intervention_id" value={intervention.intervention_id} />
                <TechRow label="provider" value={intervention.provider} />
                <TechRow label="status" value={intervention.status} />
              </>
            )}
            {tx && (
              <>
                <TechRow label="failure_code" value={tx.failure_code} />
                <TechRow label="retries_so_far" value={String(tx.retries_so_far)} />
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

/* ────────────────────────────── footer ────────────────────────────── */

const CaseFooter: React.FC<{
  c: EscalationCase;
  isRouting: boolean;
  routeError: string | null;
  confirming: boolean;
  onConfirmStart: () => void;
  onConfirmCancel: () => void;
  onRoute: (c: EscalationCase) => void;
}> = ({ c, isRouting, routeError, confirming, onConfirmStart, onConfirmCancel, onRoute }) => {
  const routed = isRoutedToMerchant(c);

  return (
    <div className="p-4 border-t border-border-subtle bg-surface shrink-0 space-y-2.5">
      {routeError && !isRouting && !routed && (
        <div className="flex items-start gap-2 text-[11.5px] text-risk-300">
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{routeError}</span>
        </div>
      )}

      {routed ? (
        <div className="rounded-md border border-border-strong bg-panel p-3">
          <div className="flex items-center gap-2">
            <CircleCheck className="w-4 h-4 shrink-0 text-success-400" />
            <span className="text-[12.5px] font-medium text-text-primary">Routed to your merchant queue</span>
          </div>
          <p className="text-[11.5px] text-text-muted mt-1.5 leading-relaxed">
            REVORA&apos;s part ends here — what happens next is between you and the customer. This case is not tracked
            further by REVORA.
          </p>
        </div>
      ) : isRouting ? (
        <button
          disabled
          className="w-full py-2.5 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 bg-warning-700 text-text-primary opacity-90"
        >
          <Send className="w-4 h-4 animate-pulse" />
          <span>Routing...</span>
        </button>
      ) : confirming ? (
        <div className="rounded-md border border-warning-500/40 bg-warning-muted/30 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-warning-300">Ready to route</div>
          <p className="text-[12px] text-text-secondary leading-relaxed mt-1.5">
            This marks the case as formally routed to your merchant queue for manual follow-up. REVORA will not
            attempt any further automated action on it.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onConfirmCancel}
              className="flex-1 py-2 rounded-md border border-border-strong text-[12px] font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onRoute(c)}
              className="flex-[2] py-2 rounded-md bg-warning-600 hover:bg-warning-500 text-white text-[12px] font-semibold transition-colors"
            >
              Confirm hand-off
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onConfirmStart}
          className="w-full py-2.5 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 bg-warning-600 hover:bg-warning-500 text-white shadow-sm transition-colors"
        >
          <Send className="w-4 h-4" />
          <span>Route to merchant queue</span>
        </button>
      )}
    </div>
  );
};

/* ────────────────────────────── empty ────────────────────────────── */

const EmptyPanel: React.FC = () => (
  <div className="relative flex-1 min-h-[420px] flex flex-col items-center justify-center text-center px-6 overflow-hidden">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-60"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(42,54,70,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(42,54,70,0.2) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 20%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 20%, transparent 100%)',
      }}
    />
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-40 w-40 -translate-x-1/2 rounded-full bg-warning-500/[0.07] blur-3xl" />

    <div className="relative">
      <div className="w-12 h-12 rounded-full border border-border-strong bg-surface flex items-center justify-center mx-auto">
        <MousePointerClick strokeWidth={1.5} className="w-5 h-5 text-text-muted" />
      </div>
      <h3 className="text-[14px] font-semibold text-text-primary mt-4">Select a case</h3>
      <p className="text-[12px] text-text-muted mt-2 max-w-[280px] mx-auto leading-relaxed">
        Choose an escalation from the queue to see why it needs attention, what REVORA already tried, and REVORA&apos;s
        recommended next step.
      </p>
    </div>

    <div className="relative mt-8 pt-5 border-t border-border-divider w-full max-w-[260px]">
      <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-disabled leading-relaxed">
        AI for intelligence.
        <br />
        Rules for control.
      </p>
    </div>
  </div>
);

/* ────────────────────────────── bits ────────────────────────────── */

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-text-muted pb-2 mb-2.5 border-b border-border-divider">{children}</h4>
);

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <div className="text-[9.5px] font-mono uppercase tracking-wider text-text-muted">{label}</div>
    <div className="text-[12.5px] text-text-primary mt-0.5 truncate">{value}</div>
  </div>
);

const TechRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3 py-0.5">
    <span className="font-mono text-[10.5px] text-text-muted shrink-0">{label}</span>
    <span className="font-mono text-[10.5px] text-text-secondary text-right break-all">{value}</span>
  </div>
);

const CaseTimeline: React.FC<{ c: EscalationCase }> = ({ c }) => {
  const { decision, tx, intervention } = c;
  if (!tx) return null;

  const stages: { title: string; detail: string; time: string | null; tone: string }[] = [
    {
      title: 'Leak detected',
      detail: `${leakLabel(tx.leak_type)} · ${tx.failure_code}`,
      time: tx.event_time,
      tone: 'bg-risk-900/40 border-risk-500/50',
    },
    {
      title: 'REVORA escalated',
      detail: `${reasonLabel(decision)}${decision.policy_allowed ? ' (REVORA-initiated)' : ' (recovery control)'}`,
      time: decision.created_at,
      tone: 'bg-warning-muted border-warning-500/50',
    },
  ];

  if (intervention) {
    stages.push({
      title: 'Routed to merchant',
      detail: 'Formally handed to the merchant queue for manual follow-up',
      time: intervention.timestamp,
      tone: 'bg-success-900/30 border-success-500/50',
    });
  } else {
    stages.push({
      title: 'Awaiting hand-off',
      detail: 'Not yet routed to your merchant queue',
      time: null,
      tone: 'bg-panel border-border-strong border-dashed',
    });
  }

  return (
    <div>
      {stages.map((s, i) => (
        <div key={`${s.title}-${i}`} className="flex gap-2.5">
          <div className="flex flex-col items-center shrink-0">
            <span className={`w-2 h-2 rounded-full border ${s.tone} mt-1.5`} />
            {i < stages.length - 1 && <span className="w-px flex-1 bg-border-subtle my-1" />}
          </div>
          <div className={i < stages.length - 1 ? 'pb-3.5' : ''}>
            <div className="text-[12px] font-medium text-text-primary">{s.title}</div>
            <div className="text-[11.5px] text-text-secondary mt-0.5 leading-relaxed">{s.detail}</div>
            <div className="text-[10px] font-mono text-text-muted mt-0.5">{s.time ? absoluteTime(s.time) : 'No timestamp recorded'}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* age helper kept for parity with the queue table's column, exported for reuse if needed */
export function caseAgeLabel(c: EscalationCase): string {
  return formatAge(caseAgeHours(c));
}
