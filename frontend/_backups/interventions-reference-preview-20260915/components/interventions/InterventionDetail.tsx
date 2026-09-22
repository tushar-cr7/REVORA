'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion, Variants } from 'framer-motion';
import { X, ShieldCheck, ShieldAlert, Check, ChevronRight, CircleAlert, Zap, CircleCheck } from 'lucide-react';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import { Decision, Intervention, Opportunity, PolicyLimits, Transaction } from '@/lib/types';
import { api } from '@/lib/api';
import { actionLabel, ACTION_PREVIEW, buildRationale, buildSafetyChecks, OUTCOME_LABEL } from '@/lib/actionMeta';
import { actionIcon } from './actionIcons';
import { Row } from './InterventionLedger';

interface InterventionDetailProps {
  row: Row | null;
  onClose: () => void;
  onExecute: (opp: Opportunity) => void;
  executingId: string | null;
  execError: string | null;
}

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

function absoluteTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const InterventionDetail: React.FC<InterventionDetailProps> = ({ row, onClose, onExecute, executingId, execError }) => {
  const reduceMotion = useReducedMotion();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Computed synchronously (not via effect) so it's correct on the very
  // first render — Framer Motion only reads `initial` at mount, so if this
  // defaulted to false and flipped true a tick later, the panel would
  // capture the desktop x-axis slide-in as its mount animation and then
  // get stuck: mobile-sized (via the always-current className) but still
  // positioned by a stale x-transform, off-screen to the right.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );

  const transactionId = row?.id ?? null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setIsMobile(mq.matches);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const load = useCallback(async (id: string, leakId: string) => {
    setLoading(true);
    setLoadError(false);
    setTx(null);
    setDecision(null);
    try {
      const [txRes, decRes, polRes] = await Promise.allSettled([
        api.getTransactionById(id),
        api.getDecisionById(leakId),
        api.getPolicies(),
      ]);
      if (txRes.status === 'fulfilled') setTx(txRes.value);
      else throw new Error('transaction unavailable');
      setDecision(decRes.status === 'fulfilled' ? decRes.value : null);
      setPolicy(polRes.status === 'fulfilled' ? polRes.value.active_policy : null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!row) return;
    setConfirming(false);
    const leakId = row.kind === 'queued' ? row.opp.leak_id : row.itv.leak_id;
    load(row.id, leakId);
  }, [row, load]);

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  // Once execution resolves, the row this panel is showing is re-derived by
  // the parent from real data, so it naturally flips from queued to
  // completed on its own — this just clears the local confirm step.
  useEffect(() => {
    if (row?.kind === 'completed') setConfirming(false);
  }, [row?.kind]);

  if (!row) return null;

  const isExecuting = transactionId === executingId;
  const action = row.kind === 'queued' ? row.opp.recommended_action : row.itv.final_action;
  const Icon = actionIcon(action);
  const amount = row.kind === 'queued' ? row.opp.amount : row.itv.amount;
  const leakType = row.kind === 'queued' ? row.opp.leak_type : tx?.leak_type;
  const policyAllowed = row.kind === 'queued' ? row.opp.policy_allowed : row.itv.policy_allowed;
  const rationale = tx ? buildRationale(tx, decision) : null;
  const safetyChecks = tx ? buildSafetyChecks(tx, policy) : [];
  const preview = ACTION_PREVIEW[action];

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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 z-50 overflow-hidden bg-canvas/80 backdrop-blur-sm flex ${isMobile ? 'items-end' : 'justify-end'}`}
        onClick={onClose}
      >
        <motion.div
          {...panelMotion}
          transition={{ type: 'spring', damping: 28, stiffness: 240 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Action control center"
          className={`bg-panel border-border-strong shadow-drawer flex flex-col overflow-hidden ${
            isMobile ? 'w-full max-h-[92vh] rounded-t-lg border-t' : 'w-full max-w-[560px] h-full border-l'
          }`}
        >
          {/* ── Action header ── */}
          <div className="border-b border-border-subtle bg-surface shrink-0 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">Action control</div>
                <div className="font-mono text-[12.5px] text-text-secondary mt-1 truncate">{transactionId}</div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-2 -m-1 rounded-md hover:bg-panel-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mt-4 flex items-end justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Icon strokeWidth={1.5} className="w-6 h-6 text-text-secondary shrink-0" />
                  <div>
                    <div className="text-[22px] leading-none font-display font-semibold text-text-primary">
                      {actionLabel(action)}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[19px] font-semibold tabular-nums leading-none text-text-primary">
                    {row.kind === 'completed' && row.itv.recovered ? `+${formatINR(row.itv.recovered_amount)}` : formatINR(amount)}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mt-1.5">
                    {row.kind === 'completed' && row.itv.recovered ? 'Recovered' : 'At risk'}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <ActionStatusBadge row={row} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-secondary">
                {leakType && <span>{LEAK_LABEL[leakType] ?? leakType}</span>}
                {leakType && <span className="text-border-strong">·</span>}
                <span className="text-text-muted">
                  {row.kind === 'completed' ? formatTimeAgo(row.itv.timestamp) : 'Awaiting execution'}
                </span>
              </div>
            </motion.div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
            {loadError ? (
              <PanelError onRetry={() => row && load(row.id, row.kind === 'queued' ? row.opp.leak_id : row.itv.leak_id)} />
            ) : loading || !tx ? (
              <PanelSkeleton />
            ) : (
              <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
                <motion.section variants={item}>
                  <SectionTitle>Why this action</SectionTitle>
                  {decision ? (
                    rationale ? (
                      <p className="text-[12.5px] text-text-secondary leading-relaxed">{rationale}</p>
                    ) : (
                      <p className="text-[12.5px] text-text-muted leading-relaxed">
                        REVORA recommends {actionLabel(decision.final_action).toLowerCase()} for this transaction.
                      </p>
                    )
                  ) : (
                    <p className="text-[12.5px] text-text-muted leading-relaxed">
                      REVORA hasn&apos;t analyzed this case yet — a recommendation isn&apos;t available.
                    </p>
                  )}
                </motion.section>

                <motion.section variants={item}>
                  <SectionTitle>Safety check</SectionTitle>
                  {decision ? (
                    <>
                      <div
                        className={`flex items-start gap-2.5 rounded-md border p-3 ${
                          decision.policy_allowed ? 'bg-success-muted/30 border-success-500/25' : 'bg-warning-muted/30 border-warning-500/30'
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
                            {decision.policy_allowed ? 'Recovery controls satisfied' : 'REVORA prevented this action'}
                          </div>
                          <p
                            className={`leading-relaxed mt-1 ${
                              decision.policy_allowed ? 'text-[12px] text-text-secondary' : 'text-[13px] text-text-primary'
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
                    </>
                  ) : (
                    <p className="text-[12.5px] text-text-muted leading-relaxed">
                      Safety verdicts become available once REVORA has analyzed this case.
                    </p>
                  )}
                </motion.section>

                {preview && (
                  <motion.section variants={item}>
                    <SectionTitle>What happens next</SectionTitle>
                    <p className="text-[12.5px] text-text-secondary leading-relaxed">{preview}</p>
                  </motion.section>
                )}

                <motion.section variants={item}>
                  <SectionTitle>Timeline</SectionTitle>
                  <ActionTimeline tx={tx} decision={decision} itv={row.kind === 'completed' ? row.itv : null} />
                </motion.section>

                <motion.section variants={item}>
                  <Disclosure label="View technical details">
                    {decision && <DetailRow label="decision_id" value={decision.decision_id} mono />}
                    {row.kind === 'completed' && <DetailRow label="intervention_id" value={row.itv.intervention_id} mono />}
                    {row.kind === 'completed' && <DetailRow label="provider" value={row.itv.provider} mono />}
                    {row.kind === 'completed' && row.itv.idempotency_key && (
                      <DetailRow label="idempotency_key" value={row.itv.idempotency_key} mono />
                    )}
                    {decision && <DetailRow label="ai_proposed_action" value={decision.ai_proposed_action} mono />}
                    {decision && <DetailRow label="policy_allowed" value={String(decision.policy_allowed)} mono />}
                    {row.kind === 'completed' && row.itv.execution_probability_used != null && (
                      <DetailRow label="execution_probability_used" value={row.itv.execution_probability_used.toFixed(6)} mono />
                    )}
                  </Disclosure>
                </motion.section>
              </motion.div>
            )}
          </div>

          {/* ── Action footer ── */}
          {!loadError && (
            <div className="p-5 border-t border-border-subtle bg-surface shrink-0 space-y-2.5">
              {execError && !isExecuting && row.kind === 'queued' && (
                <div className="flex items-start gap-2 text-[11.5px] text-risk-300">
                  <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{execError}</span>
                </div>
              )}

              {row.kind === 'completed' ? (
                <div className="rounded-md border border-border-strong bg-panel p-3.5">
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
                  className="w-full py-3 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 bg-ai-700 text-text-primary opacity-90"
                >
                  <Zap className="w-4 h-4 animate-spin" />
                  <span>Executing...</span>
                </button>
              ) : confirming ? (
                <div className="rounded-md border border-primary-500/40 bg-primary-muted/30 p-3.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-primary-300">Ready to execute</div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className="text-[14px] font-semibold text-text-primary">{actionLabel(action)}</span>
                    <span className="text-[13px] font-mono font-semibold text-text-primary tabular-nums">{formatINR(amount)} at risk</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setConfirming(false)}
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
                    onClick={() => setConfirming(true)}
                    className={`w-full py-3 px-4 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 transition-colors ${
                      policyAllowed
                        ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-sm'
                        : 'bg-transparent border border-warning-500/50 text-warning-300 hover:bg-warning-muted/50'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    <span>{policyAllowed ? 'Execute recovery' : `${actionLabel(action)} instead`}</span>
                  </button>
                  {!policyAllowed && (
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
    </AnimatePresence>
  );
};

const ActionStatusBadge: React.FC<{ row: Row }> = ({ row }) => {
  if (row.kind === 'queued') {
    return row.opp.policy_allowed ? (
      <span className="inline-block text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-primary-muted text-primary-300 border-primary-500/30">
        Ready
      </span>
    ) : (
      <span className="inline-block text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-warning-muted text-warning-300 border-warning-500/30">
        Action paused
      </span>
    );
  }
  return row.itv.recovered ? (
    <span className="inline-block text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-success-muted text-success-300 border-success-500/30">
      Completed
    </span>
  ) : (
    <span className="inline-block text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-surface text-text-muted border-border-subtle">
      Completed
    </span>
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
    <div>
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

const ActionTimeline: React.FC<{ tx: Transaction; decision: Decision | null; itv: Intervention | null }> = ({ tx, decision, itv }) => {
  const stages: { title: string; detail: string; time: string | null; tone: 'risk' | 'neutral' | 'success' | 'warning' | 'pending' }[] = [
    {
      title: 'Detected',
      detail: `${LEAK_LABEL[tx.leak_type] || tx.leak_type.replace(/_/g, ' ')} · ${tx.failure_code}`,
      time: tx.event_time,
      tone: 'risk',
    },
  ];

  if (decision) {
    stages.push({
      title: 'Decision made',
      detail: `${actionLabel(decision.final_action)}${decision.policy_allowed ? '' : ' (rerouted by recovery controls)'}`,
      time: decision.created_at,
      tone: decision.policy_allowed ? 'neutral' : 'warning',
    });
  } else {
    stages.push({ title: 'Decision made', detail: 'Pending intelligence pass', time: null, tone: 'pending' });
  }

  if (itv) {
    stages.push({
      title: 'Action executed',
      detail: `${actionLabel(itv.final_action)} · ${OUTCOME_LABEL[itv.status] ?? itv.status}`,
      time: itv.timestamp,
      tone: itv.recovered ? 'success' : 'neutral',
    });
  } else {
    stages.push({
      title: 'Action',
      detail: decision ? (decision.policy_allowed ? 'Available to run' : 'Held until recovery controls allow it') : 'Awaiting decision',
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

const PanelSkeleton: React.FC = () => (
  <div className="space-y-6 animate-pulse">
    {[0, 1, 2].map((s) => (
      <div key={s}>
        <div className="h-2 w-32 rounded bg-border-strong/60 mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-border-subtle" />
          <div className="h-3 w-4/5 rounded bg-border-subtle" />
        </div>
      </div>
    ))}
  </div>
);

const PanelError: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="h-full flex flex-col items-center justify-center text-center px-4">
    <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mb-3" />
    <p className="text-[13px] font-medium text-text-primary">Unable to open this action</p>
    <p className="text-[12px] text-text-muted mt-1.5 max-w-xs leading-relaxed">
      REVORA couldn&apos;t load the record for this intervention.
    </p>
    <button
      onClick={onRetry}
      className="mt-4 px-4 py-2 rounded-sm bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors"
    >
      Try again
    </button>
  </div>
);
