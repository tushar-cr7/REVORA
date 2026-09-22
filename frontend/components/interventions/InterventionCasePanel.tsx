'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  MousePointerClick,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { Decision, Intervention, Opportunity, PolicyLimits, Transaction } from '@/lib/types';
import { api } from '@/lib/api';
import { actionLabel, ACTION_PREVIEW, buildRationale, buildSafetyChecks, OUTCOME_LABEL } from '@/lib/actionMeta';
import { actionIcon } from './actionIcons';
import { Row, leakLabel, rowAction, rowAmount, rowLeakId, rowPolicyAllowed, rowPolicyReason } from './interventionSignals';

export interface CaseData {
  tx: Transaction | null;
  decision: Decision | null;
  policy: PolicyLimits | null;
  loading: boolean;
  loadError: boolean;
  reload: () => void;
}

/**
 * Loads everything the open case needs: its transaction, the decision
 * REVORA recorded for it, and the live policy limits the safety check is
 * measured against.
 *
 * Lives in the page rather than the panel because the panel is rendered
 * twice — once inline for wide screens, once as an overlay for narrow ones,
 * with CSS deciding which is visible. Fetching here keeps that to a single
 * set of requests no matter how many presentations exist.
 *
 * Keyed on the case's own identifiers, never the row object: live refresh
 * rebuilds row objects every poll, and depending on the object itself would
 * re-fetch this case on every cycle.
 */
export function useCaseData(caseId: string | null, caseLeakId: string | null): CaseData {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!caseId || !caseLeakId) {
      setTx(null);
      setDecision(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setTx(null);
    setDecision(null);

    (async () => {
      const [txRes, decRes, polRes] = await Promise.allSettled([
        api.getTransactionById(caseId),
        api.getDecisionById(caseLeakId),
        api.getPolicies(),
      ]);
      if (cancelled) return;
      if (txRes.status === 'fulfilled') setTx(txRes.value);
      else setLoadError(true);
      setDecision(decRes.status === 'fulfilled' ? decRes.value : null);
      setPolicy(polRes.status === 'fulfilled' ? polRes.value.active_policy : null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [caseId, caseLeakId, nonce]);

  return { tx, decision, policy, loading, loadError, reload: () => setNonce((n) => n + 1) };
}

interface Props {
  row: Row | null;
  caseData: CaseData;
  /**
   * `inline` sits in the workspace's second column; `overlay` covers the
   * screen. Which one shows is decided by CSS in the page, not by
   * JavaScript — a JS breakpoint here would render a different tree on the
   * server than on the client and break hydration.
   */
  variant: 'inline' | 'overlay';
  onClose: () => void;
  onExecute: (opp: Opportunity) => void;
  executingId: string | null;
  execError: string | null;
  /** Transaction records already loaded by the page, so the panel can render instantly before the case fetch lands. */
  txById: Map<string, Transaction>;
}

function absoluteTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * The right-hand half of the workspace: one recovery case, opened.
 *
 * Same real data path as before — transaction, decision and live policy
 * limits are fetched per case, and executing still goes through an explicit
 * confirm step into the real `/interventions/{id}/execute` call. What
 * changed is the container: at desktop width this is an inline panel beside
 * the queue rather than a modal over it, so selecting a row reads as
 * opening a case inside one system instead of covering it up.
 */
export const InterventionCasePanel: React.FC<Props> = ({
  row,
  caseData,
  variant,
  onClose,
  onExecute,
  executingId,
  execError,
  txById,
}) => {
  const reduceMotion = useReducedMotion();
  const [confirming, setConfirming] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  const { tx, decision, policy, loading, loadError, reload } = caseData;
  const caseId = row?.id ?? null;

  // Reset the local confirm/disclosure state whenever a different case opens.
  useEffect(() => {
    setConfirming(false);
    setShowTechnical(false);
  }, [caseId]);

  useEffect(() => {
    if (!row || variant !== 'overlay') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose, variant]);

  // Once execution resolves the parent re-derives this row from real data,
  // so it flips from queued to completed on its own — this only clears the
  // local confirm step.
  useEffect(() => {
    if (row?.kind === 'completed') setConfirming(false);
  }, [row?.kind]);

  const inner = row ? (
    <>
      <CaseHeader row={row} tx={tx} onClose={onClose} />
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <CaseBody
          row={row}
          tx={tx ?? txById.get(row.id) ?? null}
          decision={decision}
          policy={policy}
          loading={loading}
          loadError={loadError}
          onRetry={reload}
          showTechnical={showTechnical}
          onToggleTechnical={() => setShowTechnical((v) => !v)}
        />
      </div>
      <CaseFooter
        row={row}
        isExecuting={row.id === executingId}
        execError={execError}
        confirming={confirming}
        onConfirmStart={() => setConfirming(true)}
        onConfirmCancel={() => setConfirming(false)}
        onExecute={onExecute}
        hidden={loadError}
      />
    </>
  ) : null;

  /* ── Inline: second column of the workspace ── */
  if (variant === 'inline') {
    return (
      <div className="rounded-lg border border-border-subtle bg-panel overflow-hidden flex flex-col max-h-[calc(100vh-7rem)]">
        {row ? inner : <EmptyPanel />}
      </div>
    );
  }

  /* ── Overlay: bottom sheet on phones, right-hand drawer from sm up ── */
  return (
    <AnimatePresence>
      {row && (
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
            aria-label="Intervention details"
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

const CaseHeader: React.FC<{ row: Row; tx: Transaction | null; onClose: () => void }> = ({ row, tx, onClose }) => {
  const action = rowAction(row);
  const Icon = actionIcon(action);
  const recovered = row.kind === 'completed' && row.itv.recovered;
  const leakType = row.kind === 'queued' ? row.opp.leak_type : tx?.leak_type;

  return (
    <div className="border-b border-border-subtle bg-surface shrink-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-text-muted">Intervention details</div>
          <div className="font-mono text-[11.5px] text-text-secondary mt-1 truncate">{row.id}</div>
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
          <Icon strokeWidth={1.5} className="w-5 h-5 text-text-secondary shrink-0" />
          <div className="text-[18px] leading-tight font-semibold text-text-primary truncate">{actionLabel(action)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-[17px] font-semibold tabular-nums leading-none ${recovered ? 'text-success-200' : 'text-text-primary'}`}>
            {recovered ? `+${formatINR(row.itv.recovered_amount)}` : formatINR(rowAmount(row))}
          </div>
          <div className="text-[9.5px] font-mono uppercase tracking-wider text-text-muted mt-1.5">
            {recovered ? 'Recovered' : 'At risk'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-secondary">
        <span>{leakLabel(leakType)}</span>
        <span className="text-border-strong">·</span>
        <span className="font-mono text-text-muted truncate">
          {row.kind === 'queued' ? row.opp.customer_id : row.itv.customer_id}
        </span>
      </div>
    </div>
  );
};

/* ────────────────────────────── body ────────────────────────────── */

const CaseBody: React.FC<{
  row: Row;
  tx: Transaction | null;
  decision: Decision | null;
  policy: PolicyLimits | null;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  showTechnical: boolean;
  onToggleTechnical: () => void;
}> = ({ row, tx, decision, policy, loading, loadError, onRetry, showTechnical, onToggleTechnical }) => {
  if (loadError) {
    return (
      <div className="py-10 text-center">
        <CircleAlert strokeWidth={1.5} className="w-7 h-7 text-risk-400/70 mx-auto mb-3" />
        <p className="text-[13px] font-medium text-text-primary">Unable to open this action</p>
        <p className="text-[12px] text-text-muted mt-1.5 max-w-xs mx-auto leading-relaxed">
          REVORA couldn&apos;t load the record for this intervention.
        </p>
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-[12px] font-semibold transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading && !tx) return <BodySkeleton />;

  const action = rowAction(row);
  const allowed = rowPolicyAllowed(row);
  const reason = rowPolicyReason(row);
  const rationale = tx ? buildRationale(tx, decision) : null;
  const safetyChecks = tx ? buildSafetyChecks(tx, policy) : [];
  const preview = ACTION_PREVIEW[action];

  const probability =
    row.kind === 'queued'
      ? row.opp.recovery_probability
      : row.itv.execution_probability_used ?? tx?.model_recovery_prob ?? null;

  return (
    <div className="space-y-5">
      {/* Case facts */}
      <section className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Fact label="Status" value={<StatusText row={row} />} />
        {probability != null && <Fact label="Recovery probability" value={formatPct(probability)} />}
        {row.kind === 'queued' && <Fact label="Potential recovery" value={formatINR(row.opp.expected_recovery)} />}
        {row.kind === 'completed' && <Fact label="Outcome" value={OUTCOME_LABEL[row.itv.status] ?? row.itv.status} />}
        {tx && <Fact label="Leak detected" value={absoluteTime(tx.event_time)} />}
        {row.kind === 'completed' && <Fact label="Executed" value={absoluteTime(row.itv.timestamp)} />}
      </section>

      {/* Why this action */}
      <section>
        <SectionTitle>Why this action?</SectionTitle>
        {decision || rationale ? (
          <div className="rounded-md border border-ai-500/25 bg-ai-muted/15 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ai-300">
              <span className="w-1.5 h-1.5 rounded-full bg-ai-400 shrink-0" />
              REVORA recommends
            </div>
            <div className="text-[13px] font-medium text-text-primary mt-2">{actionLabel(action)}</div>
            <p className="text-[12.5px] text-text-secondary leading-relaxed mt-1.5">
              {rationale ?? `${actionLabel(action)} is the recovery path REVORA selected for this case.`}
            </p>
            {preview && <p className="text-[12px] text-text-muted leading-relaxed mt-2">{preview}</p>}
          </div>
        ) : (
          <p className="text-[12.5px] text-text-muted leading-relaxed">
            REVORA hasn&apos;t analyzed this case yet — a recommendation isn&apos;t available.
          </p>
        )}
      </section>

      {/* Safety check */}
      <section>
        <SectionTitle>Safety check</SectionTitle>
        <div
          className={`flex items-start gap-2.5 rounded-md border p-3 ${
            allowed ? 'bg-success-muted/30 border-success-500/25' : 'bg-warning-muted/30 border-warning-500/30'
          }`}
        >
          {allowed ? (
            <ShieldCheck className="w-4 h-4 text-success-400 shrink-0 mt-px" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-warning-400 shrink-0 mt-px" />
          )}
          <div className="min-w-0">
            <div
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                allowed ? 'text-success-300' : 'text-warning-300'
              }`}
            >
              {allowed ? 'Approved within recovery controls' : 'Action paused by recovery controls'}
            </div>
            <p className={`leading-relaxed mt-1 text-[12.5px] ${allowed ? 'text-text-secondary' : 'text-text-primary'}`}>
              {reason}
            </p>
            {!allowed && (
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

        {safetyChecks.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {safetyChecks.map((c) => (
              <div key={c.label} className="flex items-center gap-2 text-[11.5px]">
                {c.passed ? (
                  <Check className="w-3 h-3 text-success-400 shrink-0" />
                ) : (
                  <CircleAlert className="w-3 h-3 text-warning-400 shrink-0" />
                )}
                <span className={c.passed ? 'text-text-secondary' : 'text-warning-300'}>{c.label}</span>
                <span className="text-text-muted ml-auto text-[11px] text-right">{c.detail}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Timeline */}
      {tx && (
        <section>
          <SectionTitle>Recovery timeline</SectionTitle>
          <CaseTimeline tx={tx} decision={decision} itv={row.kind === 'completed' ? row.itv : null} allowed={allowed} />
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
            {decision ? (
              <>
                <TechRow label="decision_id" value={decision.decision_id} />
                <TechRow label="ai_proposed_action" value={decision.ai_proposed_action} />
                <TechRow label="ai_proposed_probability" value={decision.ai_proposed_probability.toFixed(6)} />
                <TechRow label="policy_allowed" value={String(decision.policy_allowed)} />
                <TechRow label="final_action" value={decision.final_action} />
              </>
            ) : (
              <p className="text-[11.5px] text-text-muted">No decision record for this transaction yet.</p>
            )}
            {row.kind === 'completed' && (
              <>
                <TechRow label="intervention_id" value={row.itv.intervention_id} />
                <TechRow label="provider" value={row.itv.provider} />
                {row.itv.idempotency_key && <TechRow label="idempotency_key" value={row.itv.idempotency_key} />}
                {row.itv.execution_probability_used != null && (
                  <TechRow label="execution_probability_used" value={row.itv.execution_probability_used.toFixed(6)} />
                )}
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
  row: Row;
  isExecuting: boolean;
  execError: string | null;
  confirming: boolean;
  onConfirmStart: () => void;
  onConfirmCancel: () => void;
  onExecute: (opp: Opportunity) => void;
  hidden: boolean;
}> = ({ row, isExecuting, execError, confirming, onConfirmStart, onConfirmCancel, onExecute, hidden }) => {
  if (hidden) return null;
  const action = rowAction(row);
  const allowed = rowPolicyAllowed(row);

  return (
    <div className="p-4 border-t border-border-subtle bg-surface shrink-0 space-y-2.5">
      {execError && !isExecuting && row.kind === 'queued' && (
        <div className="flex items-start gap-2 text-[11.5px] text-risk-300">
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{execError}</span>
        </div>
      )}

      {row.kind === 'completed' ? (
        <div className="rounded-md border border-border-strong bg-panel p-3">
          <div className="flex items-center gap-2">
            <CircleCheck className={`w-4 h-4 shrink-0 ${row.itv.recovered ? 'text-success-400' : 'text-text-muted'}`} />
            <span className="text-[12.5px] font-medium text-text-primary">
              {row.itv.recovered ? 'Recovery completed' : 'Action completed'}
            </span>
            <span className="ml-auto text-[11px] text-text-muted">{OUTCOME_LABEL[row.itv.status] ?? row.itv.status}</span>
          </div>
        </div>
      ) : isExecuting ? (
        <button
          disabled
          className="w-full py-2.5 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 bg-ai-700 text-text-primary opacity-90"
        >
          <Zap className="w-4 h-4 animate-pulse" />
          <span>Executing...</span>
        </button>
      ) : confirming ? (
        <div className="rounded-md border border-primary-500/40 bg-primary-muted/30 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-primary-300">Ready to execute</div>
          <div className="flex items-baseline justify-between gap-2 mt-1.5">
            <span className="text-[13.5px] font-semibold text-text-primary">{actionLabel(action)}</span>
            <span className="text-[12.5px] font-mono font-semibold text-text-primary tabular-nums">
              {formatINR(rowAmount(row))} at risk
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onConfirmCancel}
              className="flex-1 py-2 rounded-md border border-border-strong text-[12px] font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => row.kind === 'queued' && onExecute(row.opp)}
              className="flex-[2] py-2 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-[12px] font-semibold transition-colors"
            >
              Confirm recovery
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={onConfirmStart}
            className={`w-full py-2.5 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 transition-colors ${
              allowed
                ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-sm'
                : 'bg-transparent border border-warning-500/50 text-warning-300 hover:bg-warning-muted/50'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>{allowed ? 'Execute recovery' : 'Run safe alternative'}</span>
          </button>
          {!allowed && (
            <p className="text-[11px] text-text-muted leading-relaxed text-center">
              The originally proposed action is paused. Proceeding runs {actionLabel(action).toLowerCase()} — the safe
              alternative REVORA selected.
            </p>
          )}
        </>
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
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-40 w-40 -translate-x-1/2 rounded-full bg-primary-500/[0.07] blur-3xl" />

    <div className="relative">
      <div className="w-12 h-12 rounded-full border border-border-strong bg-surface flex items-center justify-center mx-auto">
        <MousePointerClick strokeWidth={1.5} className="w-5 h-5 text-text-muted" />
      </div>
      <h3 className="text-[14px] font-semibold text-text-primary mt-4">Select an intervention</h3>
      <p className="text-[12px] text-text-muted mt-2 max-w-[280px] mx-auto leading-relaxed">
        Choose an action from the queue to see customer information, REVORA&apos;s reasoning, the safety check against
        your recovery controls, and the recovery timeline.
      </p>
    </div>

    {/* Real brand line, not an invented tagline */}
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
  <h4 className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-text-muted pb-2 mb-2.5 border-b border-border-divider">
    {children}
  </h4>
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

const StatusText: React.FC<{ row: Row }> = ({ row }) => {
  if (row.kind === 'queued') {
    return row.opp.policy_allowed ? (
      <span className="text-primary-200">Ready to execute</span>
    ) : (
      <span className="text-warning-200">Action paused</span>
    );
  }
  return row.itv.recovered ? (
    <span className="text-success-200">Recovered</span>
  ) : (
    <span className="text-text-secondary">Completed</span>
  );
};

const CaseTimeline: React.FC<{
  tx: Transaction;
  decision: Decision | null;
  itv: Intervention | null;
  allowed: boolean;
}> = ({ tx, decision, itv, allowed }) => {
  const stages: { title: string; detail: string; time: string | null; tone: string }[] = [
    {
      title: 'Leak detected',
      detail: `${leakLabel(tx.leak_type)} · ${tx.failure_code}`,
      time: tx.event_time,
      tone: 'bg-risk-900/40 border-risk-500/50',
    },
  ];

  if (decision) {
    stages.push({
      title: 'REVORA decided',
      detail: `${actionLabel(decision.final_action)}${decision.policy_allowed ? '' : ' — rerouted by recovery controls'}`,
      time: decision.created_at,
      tone: decision.policy_allowed ? 'bg-ai-900/30 border-ai-500/50' : 'bg-warning-muted border-warning-500/50',
    });
  } else {
    stages.push({ title: 'REVORA decided', detail: 'Pending intelligence pass', time: null, tone: 'bg-panel border-border-strong border-dashed' });
  }

  if (itv) {
    stages.push({
      title: 'Action executed',
      detail: `${actionLabel(itv.final_action)} · ${OUTCOME_LABEL[itv.status] ?? itv.status}`,
      time: itv.timestamp,
      tone: itv.recovered ? 'bg-success-900/30 border-success-500/50' : 'bg-panel-raised border-border-strong',
    });
  } else {
    stages.push({
      title: 'Action',
      detail: allowed ? 'Available to run' : 'Held until recovery controls allow it',
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
            <div className="text-[10px] font-mono text-text-muted mt-0.5">
              {s.time ? absoluteTime(s.time) : 'No timestamp recorded'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const BodySkeleton: React.FC = () => (
  <div className="space-y-5 animate-pulse">
    <div className="grid grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-2 w-16 rounded bg-border-subtle" />
          <div className="h-2.5 w-20 rounded bg-border-strong/60" />
        </div>
      ))}
    </div>
    {[0, 1].map((s) => (
      <div key={s}>
        <div className="h-2 w-28 rounded bg-border-strong/60 mb-3" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-border-subtle" />
          <div className="h-3 w-4/5 rounded bg-border-subtle" />
        </div>
      </div>
    ))}
  </div>
);
