'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, Variants } from 'framer-motion';
import { X, ShieldCheck, ShieldAlert, Check, ChevronRight, CircleAlert, Zap, CircleCheck } from 'lucide-react';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import { Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';
import { api } from '@/lib/api';
import { SignalPath } from '@/components/transactions/SignalPath';
import {
  OUTCOME_LABEL,
  actionLabel,
  buildEvidence,
  buildRationale,
  buildSafetyChecks,
  buildSignalPath,
  deriveCaseState,
} from '@/components/transactions/caseSignals';

interface TransactionDrawerProps {
  transactionId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

function tierOf(prob: number | null | undefined) {
  if (prob == null) return { label: 'Unscored', text: 'text-text-muted', bar: 'bg-border-strong' };
  if (prob >= 0.7) return { label: 'High', text: 'text-success-300', bar: 'bg-success-500' };
  if (prob >= 0.4) return { label: 'Medium', text: 'text-ai-300', bar: 'bg-ai-500' };
  return { label: 'Low', text: 'text-risk-300', bar: 'bg-risk-500' };
}

/** Only ever rendered after a row is clicked, so this never runs during SSR. */
function absoluteTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const TransactionDrawer: React.FC<TransactionDrawerProps> = ({ transactionId, onClose, onRefresh }) => {
  const reduceMotion = useReducedMotion();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [intervention, setIntervention] = useState<Intervention | null>(null);
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  // Computed synchronously (not via effect) so it's correct from the very
  // first render — Framer Motion only reads `initial` at mount, so a
  // false-then-corrected value risks capturing the desktop x-axis slide-in
  // as the mount animation and then getting stuck off-screen.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setIsMobile(mq.matches);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const loadCase = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(false);
    setExecError(null);
    setTx(null);
    setDecision(null);
    setIntervention(null);
    try {
      const txData = await api.getTransactionById(id);
      setTx(txData);

      const [decRes, intRes, polRes] = await Promise.allSettled([
        api.getDecisionById(txData.leak_id),
        api.getInterventions(1000),
        api.getPolicies(),
      ]);

      setDecision(decRes.status === 'fulfilled' ? decRes.value : null);
      setIntervention(
        intRes.status === 'fulfilled'
          ? intRes.value.interventions.find((i) => i.transaction_id === txData.transaction_id) ?? null
          : null
      );
      setPolicy(polRes.status === 'fulfilled' ? polRes.value.active_policy : null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!transactionId) return;
    loadCase(transactionId);
  }, [transactionId, loadCase]);

  useEffect(() => {
    if (!transactionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [transactionId, onClose]);

  const handleExecute = async () => {
    if (!tx) return;
    setExecuting(true);
    setExecError(null);
    try {
      const idempotencyKey = `drawer_exec_${tx.transaction_id}_${Date.now()}`;
      const result = await api.executeIntervention(tx.transaction_id, idempotencyKey);
      // The executed intervention comes straight back from the API, so the
      // completed state below is real outcome data, not an assumption.
      setIntervention(result);
      onRefresh();
    } catch (err: unknown) {
      setExecError(err instanceof Error ? err.message : 'Recovery action could not be completed.');
    } finally {
      setExecuting(false);
    }
  };

  const prob = tx?.model_recovery_prob;
  const tier = tierOf(prob);
  const caseState = deriveCaseState(decision, intervention);
  const evidence = tx ? buildEvidence(tx) : [];
  const rationale = tx ? buildRationale(tx, decision) : null;
  const safetyChecks = tx ? buildSafetyChecks(tx, policy) : [];
  const nodes = tx ? buildSignalPath(tx, decision, intervention) : [];
  const rerouted = decision ? decision.ai_proposed_action !== decision.final_action : false;

  // Same variant shape either way; reduced motion simply resolves to no
  // offset, no stagger and no duration.
  const container: Variants = reduceMotion
    ? { hidden: {}, show: {} }
    : { hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } } };
  const item: Variants = reduceMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } } };

  const panelMotion = isMobile
    ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } };

  return (
    <AnimatePresence>
      {transactionId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-50 overflow-hidden bg-canvas/80 backdrop-blur-sm flex ${
            isMobile ? 'items-end' : 'justify-end'
          }`}
          onClick={onClose}
        >
          <motion.div
            {...panelMotion}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Revenue case"
            className={`bg-panel border-border-strong shadow-drawer flex flex-col overflow-hidden ${
              isMobile
                ? 'w-full max-h-[92vh] rounded-t-lg border-t'
                : 'w-full max-w-[580px] h-full border-l'
            }`}
          >
            {/* ── Case header ── */}
            <div className="border-b border-border-subtle bg-surface shrink-0 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">Revenue case</div>
                  <div className="font-mono text-[12.5px] text-text-secondary mt-1 truncate">
                    {tx?.transaction_id || transactionId}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close case"
                  className="p-2 -m-1 rounded-md hover:bg-panel-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {tx && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-[32px] leading-none font-display font-semibold text-text-primary tabular-nums">
                        {formatINR(tx.amount)}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted mt-2">At risk</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-[19px] font-semibold tabular-nums leading-none ${tier.text}`}>
                        {prob != null ? formatPct(prob) : '—'}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mt-1.5">
                        {prob != null ? `${tier.label} recovery` : 'Unscored'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-secondary">
                    <span>{LEAK_LABEL[tx.leak_type] || tx.leak_type.replace(/_/g, ' ')}</span>
                    <span className="text-border-strong">·</span>
                    <span className="uppercase">{tx.payment_method}</span>
                    <span className="text-border-strong">·</span>
                    <span className="text-text-muted">{formatTimeAgo(tx.event_time)}</span>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border-divider">
                    <SignalPath nodes={nodes} />
                  </div>
                </motion.div>
              )}
            </div>

            {/* ── Case body ── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
              {loadError ? (
                <CaseError onRetry={() => transactionId && loadCase(transactionId)} />
              ) : loading || !tx ? (
                <CaseSkeleton />
              ) : (
                <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
                  {/* Why this needs attention */}
                  <motion.section variants={item}>
                    <SectionTitle>Why this needs attention</SectionTitle>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                      {evidence.map((e) => (
                        <div key={e.label} className="min-w-0">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted truncate">
                            {e.label}
                          </div>
                          <div
                            className={`text-[13px] font-medium mt-0.5 ${
                              e.tone === 'warning'
                                ? 'text-warning-300'
                                : e.tone === 'positive'
                                ? 'text-success-300'
                                : 'text-text-primary'
                            }`}
                          >
                            {e.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.section>

                  {/* REVORA recommends */}
                  <motion.section variants={item}>
                    <SectionTitle>REVORA recommends</SectionTitle>
                    {decision ? (
                      <div
                        className={`rounded-md border p-4 ${
                          caseState.state === 'paused'
                            ? 'bg-warning-muted/30 border-warning-500/30'
                            : caseState.state === 'completed'
                            ? 'bg-surface border-border-strong'
                            : 'bg-ai-muted/25 border-ai-500/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-[19px] font-semibold tracking-tight text-text-primary">
                            {actionLabel(decision.final_action)}
                          </div>
                          <span
                            className={`text-[9.5px] font-semibold uppercase tracking-wider px-2 py-1 rounded border shrink-0 ${caseState.badgeCls}`}
                          >
                            {caseState.badge}
                          </span>
                        </div>
                        {rationale && (
                          <p className="text-[12.5px] text-text-secondary leading-relaxed mt-2.5">{rationale}</p>
                        )}
                        {rerouted && (
                          <p className="text-[11.5px] text-warning-300 leading-relaxed mt-2.5">
                            Originally proposed {actionLabel(decision.ai_proposed_action).toLowerCase()} — rerouted by
                            recovery controls.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-md border border-border-strong bg-surface p-4">
                        <div className="text-[13px] font-medium text-text-primary">Awaiting analysis</div>
                        <p className="text-[12.5px] text-text-muted leading-relaxed mt-1.5">
                          REVORA hasn&apos;t analyzed this case yet. Run an intelligence pass from Recovery Brain to
                          generate a recommendation and safety verdict.
                        </p>
                      </div>
                    )}
                  </motion.section>

                  {/* Safety check */}
                  <motion.section variants={item}>
                    <SectionTitle>Safety check</SectionTitle>
                    {decision ? (
                      <>
                        <div
                          className={`flex items-start gap-2.5 rounded-md border p-3 ${
                            decision.policy_allowed
                              ? 'bg-success-muted/30 border-success-500/25'
                              : 'bg-warning-muted/30 border-warning-500/30'
                          }`}
                        >
                          {decision.policy_allowed ? (
                            <ShieldCheck className="w-4 h-4 text-success-400 shrink-0 mt-px" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-warning-400 shrink-0 mt-px" />
                          )}
                          <div className="min-w-0">
                            <div
                              className={`text-[11px] font-semibold uppercase tracking-wider ${
                                decision.policy_allowed ? 'text-success-300' : 'text-warning-300'
                              }`}
                            >
                              {decision.policy_allowed ? 'Recovery controls satisfied' : 'Action paused'}
                            </div>
                            <p
                              className={`leading-relaxed mt-1 ${
                                decision.policy_allowed
                                  ? 'text-[12px] text-text-secondary'
                                  : 'text-[13px] text-text-primary'
                              }`}
                            >
                              {decision.policy_reason}
                            </p>
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

                        <Disclosure label="View technical details">
                          <DetailRow label="decision_id" value={decision.decision_id} mono />
                          <DetailRow label="ai_proposed_action" value={decision.ai_proposed_action} mono />
                          <DetailRow label="final_action" value={decision.final_action} mono />
                          <DetailRow label="policy_allowed" value={String(decision.policy_allowed)} mono />
                          <DetailRow label="recovery_probability" value={prob != null ? prob.toFixed(6) : '—'} mono />
                        </Disclosure>
                      </>
                    ) : (
                      <p className="text-[12.5px] text-text-muted leading-relaxed">
                        Safety verdicts become available once REVORA has analyzed this case.
                      </p>
                    )}
                  </motion.section>

                  {/* Case timeline */}
                  <motion.section variants={item}>
                    <SectionTitle>Case timeline</SectionTitle>
                    <CaseTimeline tx={tx} decision={decision} intervention={intervention} />
                  </motion.section>

                  {/* Subordinate detail */}
                  <motion.section variants={item} className="space-y-1">
                    <Disclosure label="Transaction details">
                      <DetailRow label="Customer" value={tx.customer_id} mono />
                      <DetailRow label="Leak ID" value={tx.leak_id} mono />
                      <DetailRow label="Payment method" value={tx.payment_method.toUpperCase()} />
                      <DetailRow label="Failure reason" value={tx.failure_code} mono />
                      <DetailRow label="Event time" value={absoluteTime(tx.event_time)} />
                      <DetailRow label="Amount" value={formatINR(tx.amount)} />
                      <DetailRow label="Recovery probability" value={prob != null ? formatPct(prob) : 'Unscored'} />
                      <DetailRow label="Retry count" value={String(tx.retries_so_far)} />
                      <DetailRow label="Customer value" value={`${tx.ltv_bucket.toUpperCase()} LTV`} />
                      <DetailRow label="Merchant segment" value={tx.merchant_segment} />
                    </Disclosure>
                    <Disclosure label="View raw data">
                      <pre className="text-[10.5px] font-mono text-text-secondary leading-relaxed overflow-x-auto">
                        {JSON.stringify(tx, null, 2)}
                      </pre>
                    </Disclosure>
                  </motion.section>
                </motion.div>
              )}
            </div>

            {/* ── Action footer ── */}
            {tx && !loadError && (
              <div className="p-5 border-t border-border-subtle bg-surface shrink-0 space-y-2.5">
                {execError && (
                  <div className="flex items-start gap-2 text-[11.5px] text-risk-300">
                    <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>{execError}</span>
                  </div>
                )}

                {intervention ? (
                  <div className="rounded-md border border-border-strong bg-panel p-3.5">
                    <div className="flex items-center gap-2">
                      <CircleCheck
                        className={`w-4 h-4 shrink-0 ${intervention.recovered ? 'text-success-400' : 'text-text-muted'}`}
                      />
                      <span className="text-[12.5px] font-medium text-text-primary">
                        {OUTCOME_LABEL[intervention.status] ?? intervention.status.replace(/_/g, ' ')}
                      </span>
                      {intervention.recovered && intervention.recovered_amount > 0 && (
                        <span className="ml-auto text-[13px] font-semibold text-success-300 tabular-nums">
                          {formatINR(intervention.recovered_amount)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted mt-1.5">
                      {actionLabel(intervention.final_action)} · {formatTimeAgo(intervention.timestamp)}
                    </p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleExecute}
                      disabled={executing}
                      className={`w-full py-3 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                        decision && !decision.policy_allowed
                          ? // Blocked: a deliberate fallback path, kept subordinate to the
                            // paused explanation above rather than competing with it.
                            'bg-transparent border border-warning-500/50 text-warning-300 hover:bg-warning-muted/50'
                          : 'bg-primary-600 hover:bg-primary-500 text-white shadow-sm'
                      }`}
                    >
                      <Zap className={`w-4 h-4 ${executing ? 'animate-spin' : ''}`} />
                      <span>
                        {executing
                          ? 'Running recovery...'
                          : !decision
                          ? 'Execute recovery'
                          : decision.policy_allowed
                          ? `Execute recovery · ${actionLabel(decision.final_action)}`
                          : `${actionLabel(decision.final_action)} instead`}
                      </span>
                    </button>
                    {decision && !decision.policy_allowed && (
                      <p className="text-[11px] text-text-muted leading-relaxed text-center">
                        The originally proposed action is blocked. This runs the safe alternative REVORA selected.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted pb-2 mb-3 border-b border-border-divider">
    {children}
  </h4>
);

const DetailRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-baseline justify-between gap-4 py-1">
    <span className="text-[11.5px] text-text-muted shrink-0">{label}</span>
    <span className={`text-[11.5px] text-text-secondary text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);

const Disclosure: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-md border border-border-divider bg-surface p-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * Built only from timestamps the API actually returns. Stages without a
 * recorded time say so plainly rather than implying precision.
 */
const CaseTimeline: React.FC<{ tx: Transaction; decision: Decision | null; intervention: Intervention | null }> = ({
  tx,
  decision,
  intervention,
}) => {
  const stages: { title: string; detail: string; time: string | null; tone: 'risk' | 'neutral' | 'success' | 'warning' | 'pending' }[] = [
    {
      title: 'Revenue event',
      detail: `${LEAK_LABEL[tx.leak_type] || tx.leak_type.replace(/_/g, ' ')} · ${tx.failure_code}`,
      time: tx.event_time,
      tone: 'risk',
    },
    { title: 'Leak detected', detail: `Recorded as ${tx.leak_id}`, time: null, tone: 'neutral' },
  ];

  if (decision) {
    stages.push({
      title: 'Case analyzed',
      detail: `Proposed ${actionLabel(decision.ai_proposed_action).toLowerCase()}`,
      time: decision.created_at,
      tone: 'neutral',
    });
    stages.push({
      title: 'Recovery recommended',
      detail: decision.policy_allowed
        ? `Cleared for ${actionLabel(decision.final_action).toLowerCase()}`
        : `Paused — ${decision.policy_reason}`,
      time: decision.created_at,
      tone: decision.policy_allowed ? 'success' : 'warning',
    });
  } else {
    stages.push({ title: 'Case analyzed', detail: 'Pending intelligence pass', time: null, tone: 'pending' });
  }

  if (intervention) {
    stages.push({
      title: 'Action executed',
      detail: `${actionLabel(intervention.final_action)} · ${OUTCOME_LABEL[intervention.status] ?? intervention.status}`,
      time: intervention.timestamp,
      tone: intervention.recovered ? 'success' : 'neutral',
    });
  } else if (decision) {
    stages.push({
      title: 'Action',
      detail: decision.policy_allowed
        ? `${actionLabel(decision.final_action)} available to run`
        : 'Held until recovery controls allow it',
      time: null,
      tone: 'pending',
    });
  }

  const dot: Record<string, string> = {
    risk: 'bg-risk-900/40 border-risk-500/50',
    neutral: 'bg-panel-raised border-border-strong',
    success: 'bg-success-900/30 border-success-500/50',
    warning: 'bg-warning-muted border-warning-500/50',
    pending: 'bg-panel border-border-strong border-dashed',
  };

  return (
    <div>
      {stages.map((s, i) => (
        <div key={`${s.title}-${i}`} className="flex gap-3">
          <div className="flex flex-col items-center shrink-0">
            <span className={`w-2 h-2 rounded-full border ${dot[s.tone]} mt-1.5`} />
            {i < stages.length - 1 && <span className="w-px flex-1 bg-border-subtle my-1" />}
          </div>
          <div className={i < stages.length - 1 ? 'pb-4' : ''}>
            <div className="text-[12.5px] font-medium text-text-primary">{s.title}</div>
            <div className="text-[11.5px] text-text-secondary mt-0.5 leading-relaxed">{s.detail}</div>
            <div className="text-[10px] font-mono text-text-muted mt-1">
              {s.time ? `${absoluteTime(s.time)} · ${formatTimeAgo(s.time)}` : 'No timestamp recorded'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const CaseSkeleton: React.FC = () => (
  <div className="space-y-6 animate-pulse">
    {[0, 1, 2].map((s) => (
      <div key={s}>
        <div className="h-2 w-32 rounded bg-border-strong/60 mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-border-subtle" />
          <div className="h-3 w-4/5 rounded bg-border-subtle" />
          <div className="h-3 w-2/3 rounded bg-border-subtle" />
        </div>
      </div>
    ))}
  </div>
);

const CaseError: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="h-full flex flex-col items-center justify-center text-center px-4">
    <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mb-3" />
    <p className="text-[13px] font-medium text-text-primary">Unable to open this case</p>
    <p className="text-[12px] text-text-muted mt-1.5 max-w-xs leading-relaxed">
      REVORA couldn&apos;t load the investigation record for this transaction.
    </p>
    <button
      onClick={onRetry}
      className="mt-4 px-4 py-2 rounded-sm bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors"
    >
      Try again
    </button>
  </div>
);
