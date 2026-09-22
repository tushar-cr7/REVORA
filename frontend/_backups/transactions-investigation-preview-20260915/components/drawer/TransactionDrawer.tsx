'use client';

import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, ShieldAlert, Network, Zap, Rows3, Clock, User, Database, Search } from 'lucide-react';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import { Decision, Transaction } from '@/lib/types';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface TransactionDrawerProps {
  transactionId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

type TabId = 'investigation' | 'timeline' | 'customer' | 'raw';

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

/** Rendered only after a row is clicked, so this never runs during SSR. */
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
  const [tx, setTx] = useState<Transaction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [executing, setExecuting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabId>('investigation');

  useEffect(() => {
    if (!transactionId) return;

    const loadDetails = async () => {
      setLoading(true);
      try {
        const txData = await api.getTransactionById(transactionId);
        setTx(txData);
        try {
          const decData = await api.getDecisionById(txData.leak_id);
          setDecision(decData);
        } catch {
          setDecision(null);
        }
      } catch (err: any) {
        console.error('Drawer Load Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
    setActiveTab('investigation');
  }, [transactionId]);

  // Close on Escape, matching the overlay click affordance.
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
    try {
      const idempotencyKey = `drawer_exec_${tx.transaction_id}_${Date.now()}`;
      await api.executeIntervention(tx.transaction_id, idempotencyKey);
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(`Execution Error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const prob = tx?.model_recovery_prob;
  const tier = tierOf(prob);
  const allowed = decision ? decision.policy_allowed : true;
  const rerouted = decision ? decision.ai_proposed_action !== decision.final_action : false;

  return (
    <AnimatePresence>
      {transactionId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-hidden bg-canvas/80 backdrop-blur-sm flex justify-end"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Transaction investigation"
            className="w-full max-w-[560px] bg-panel border-l border-border-strong shadow-drawer h-full flex flex-col overflow-hidden"
          >
            {/* Forensic header */}
            <div className="border-b border-border-subtle bg-surface shrink-0">
              <div className="p-5 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-text-muted">
                      <Rows3 className="w-3 h-3" />
                      Transaction
                    </div>
                    <div className="font-mono text-[13px] text-text-secondary mt-1 truncate">
                      {tx?.transaction_id || transactionId}
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    aria-label="Close investigation"
                    className="p-2 rounded-md hover:bg-panel-hover text-text-muted hover:text-text-primary transition-colors border border-transparent hover:border-border-subtle shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {tx && (
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-3xl font-display font-semibold text-text-primary tabular-nums leading-none">
                        {formatINR(tx.amount)}
                      </div>
                      <div className="text-[11px] text-text-muted mt-1.5">
                        At risk · {LEAK_LABEL[tx.leak_type] || tx.leak_type.replace('_', ' ')}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Recovery</div>
                      <div className={`text-xl font-semibold tabular-nums ${tier.text}`}>
                        {prob != null ? formatPct(prob) : '—'}
                      </div>
                      <div className="text-[10px] text-text-muted">{tier.label}</div>
                    </div>
                  </div>
                )}
              </div>

              {tx && (
                <div className="flex items-center px-2 overflow-x-auto custom-scrollbar">
                  <TabButton label="Investigation" icon={Search} active={activeTab === 'investigation'} onClick={() => setActiveTab('investigation')} />
                  <TabButton label="Timeline" icon={Clock} active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} />
                  <TabButton label="Customer" icon={User} active={activeTab === 'customer'} onClick={() => setActiveTab('customer')} />
                  <TabButton label="Raw Data" icon={Database} active={activeTab === 'raw'} onClick={() => setActiveTab('raw')} />
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
              {loading || !tx ? (
                <div className="h-full flex flex-col items-center justify-center space-y-4 text-text-muted">
                  <div className="w-8 h-8 rounded-full border-2 border-primary-500/30 border-t-primary-500 animate-spin" />
                  <p className="text-[13px] font-medium">Loading investigation...</p>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-6"
                  >
                    {activeTab === 'investigation' && (
                      <>
                        <Section title="Revenue event">
                          <Row label="What happened" value={LEAK_LABEL[tx.leak_type] || tx.leak_type.replace('_', ' ')} />
                          <Row label="Payment method" value={tx.payment_method.toUpperCase()} mono />
                          <Row label="Reason" value={tx.failure_code} mono tone="risk" />
                          <Row label="Occurred" value={`${formatTimeAgo(tx.event_time)} · ${absoluteTime(tx.event_time)}`} />
                        </Section>

                        <Section title="Recovery signal">
                          {prob != null ? (
                            <div className="pb-1">
                              <div className="flex items-baseline justify-between">
                                <span className="text-[12px] text-text-secondary">Recovery likelihood</span>
                                <span className={`text-[15px] font-semibold tabular-nums ${tier.text}`}>{formatPct(prob)}</span>
                              </div>
                              <div className="mt-2 h-1.5 w-full rounded-full bg-surface overflow-hidden">
                                <div className={`h-full rounded-full ${tier.bar}`} style={{ width: `${Math.max(2, prob * 100)}%` }} />
                              </div>
                            </div>
                          ) : (
                            <p className="text-[12px] text-text-muted">
                              This transaction hasn&apos;t been scored yet. Run an intelligence pass to estimate recovery likelihood.
                            </p>
                          )}

                          <div className="pt-1 space-y-0">
                            <Row label="Previous successful payments" value={String(tx.prior_successful_payments)} />
                            <Row
                              label="Recovery attempts so far"
                              value={String(tx.retries_so_far)}
                              tone={tx.retries_so_far >= 2 ? 'warning' : undefined}
                            />
                            <Row label="Transaction age" value={`${tx.age_days}d · ${tx.hours_since_event}h since event`} />
                            <Row label="Customer value" value={`${tx.ltv_bucket.toUpperCase()} LTV`} />
                            {tx.consecutive_failures != null && tx.consecutive_failures > 0 && (
                              <Row label="Consecutive failures" value={String(tx.consecutive_failures)} tone="warning" />
                            )}
                            {tx.visit_count != null && tx.leak_type === 'abandoned_checkout' && (
                              <Row label="Checkout visits" value={String(tx.visit_count)} />
                            )}
                          </div>
                        </Section>

                        <Section title="REVORA recommendation">
                          {decision ? (
                            <>
                              <div className="flex items-center justify-between pb-3">
                                <span className="text-[12px] text-text-secondary">Recommended action</span>
                                <span className="text-[15px] font-semibold uppercase tracking-tight text-ai-300">
                                  {decision.final_action.replace('_', ' ')}
                                </span>
                              </div>

                              <div
                                className={`rounded-md border p-3 flex items-start gap-2.5 ${
                                  allowed ? 'bg-success-muted/40 border-success-500/30' : 'bg-warning-muted/40 border-warning-500/30'
                                }`}
                              >
                                {allowed ? (
                                  <ShieldCheck className="w-4 h-4 text-success-400 shrink-0 mt-0.5" />
                                ) : (
                                  <ShieldAlert className="w-4 h-4 text-warning-400 shrink-0 mt-0.5" />
                                )}
                                <div>
                                  <span
                                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                                      allowed ? 'text-success-300' : 'text-warning-300'
                                    }`}
                                  >
                                    {allowed ? 'Safety check passed' : 'Action paused — review required'}
                                  </span>
                                  <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                                    {decision.policy_reason}
                                    {rerouted && ` Rerouted to ${decision.final_action.replace('_', ' ')}.`}
                                  </p>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start gap-2.5">
                              <Network className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                              <p className="text-[12px] text-text-muted leading-relaxed">
                                REVORA hasn&apos;t evaluated this transaction yet. Run an intelligence pass from Recovery Brain to
                                generate a recommendation.
                              </p>
                            </div>
                          )}
                        </Section>
                      </>
                    )}

                    {activeTab === 'timeline' && <Timeline tx={tx} decision={decision} />}

                    {activeTab === 'customer' && (
                      <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-surface border border-border-strong flex items-center gap-4">
                          <div className="w-11 h-11 rounded-full bg-panel border border-border-strong flex items-center justify-center text-text-secondary shrink-0">
                            <User className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[14px] font-medium text-text-primary font-mono truncate">{tx.customer_id}</h3>
                            <p className="text-[11px] text-text-muted mt-0.5 capitalize">
                              {tx.ltv_bucket} lifetime-value segment
                            </p>
                          </div>
                        </div>
                        <Section title="Customer context">
                          <Row label="Lifetime value" value={`${tx.ltv_bucket.toUpperCase()} LTV`} />
                          <Row label="Previous successful payments" value={String(tx.prior_successful_payments)} />
                          <Row label="Preferred payment method" value={tx.payment_method.toUpperCase()} mono />
                          <Row label="Merchant segment" value={tx.merchant_segment} />
                          {tx.contacts_today != null && <Row label="Contacts today" value={String(tx.contacts_today)} />}
                        </Section>
                      </div>
                    )}

                    {activeTab === 'raw' && (
                      <div className="rounded-lg overflow-hidden border border-border-strong bg-canvas">
                        <div className="p-3 border-b border-border-subtle bg-surface">
                          <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest">JSON payload</span>
                        </div>
                        <div className="p-4 overflow-x-auto">
                          <pre className="text-[11px] font-mono text-text-secondary leading-relaxed">
                            {JSON.stringify(tx, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {/* Action footer */}
            <div className="p-5 border-t border-border-subtle bg-surface shrink-0 space-y-2">
              {decision && !allowed && (
                <p className="text-[11px] text-warning-300 leading-relaxed">
                  REVORA can&apos;t run the originally proposed action on this transaction. Proceeding runs the safe
                  alternative below.
                </p>
              )}
              <button
                onClick={handleExecute}
                disabled={executing || !tx}
                className="w-full py-3 px-4 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
              >
                <Zap className={`w-4 h-4 ${executing ? 'animate-spin' : ''}`} />
                <span>
                  {executing
                    ? 'Executing action...'
                    : decision
                    ? `${allowed ? 'Execute' : 'Review & execute'} ${decision.final_action.replace('_', ' ').toUpperCase()}`
                    : 'Execute action'}
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="text-[10px] font-mono uppercase tracking-widest text-text-muted pb-2 mb-2 border-b border-border-divider">
      {title}
    </h4>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: string; mono?: boolean; tone?: 'risk' | 'warning' }> = ({
  label,
  value,
  mono,
  tone,
}) => {
  const toneCls = tone === 'risk' ? 'text-risk-300' : tone === 'warning' ? 'text-warning-300' : 'text-text-primary';
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[12px] text-text-muted shrink-0">{label}</span>
      <span className={`text-[12px] text-right ${mono ? 'font-mono' : ''} ${toneCls}`}>{value}</span>
    </div>
  );
};

/**
 * Built only from timestamps the API actually returns (the revenue event and,
 * when present, the decision record). Retry attempts are shown as a count
 * because per-attempt timestamps aren't recorded — none are invented.
 */
const Timeline: React.FC<{ tx: Transaction; decision: Decision | null }> = ({ tx, decision }) => {
  const events: { title: string; detail: string; time: string | null; tone: 'neutral' | 'risk' | 'success' | 'warning' | 'pending' }[] = [
    {
      title: 'Revenue event',
      detail: `${LEAK_LABEL[tx.leak_type] || tx.leak_type.replace('_', ' ')} · ${tx.failure_code}`,
      time: tx.event_time,
      tone: 'risk',
    },
  ];

  if (tx.retries_so_far > 0) {
    events.push({
      title: 'Recovery attempts',
      detail: `${tx.retries_so_far} attempt${tx.retries_so_far === 1 ? '' : 's'} recorded — individual attempt times aren't captured`,
      time: null,
      tone: 'warning',
    });
  }

  if (decision) {
    events.push({
      title: 'REVORA analyzed',
      detail: `Proposed ${decision.ai_proposed_action.replace('_', ' ')}`,
      time: decision.created_at,
      tone: 'neutral',
    });
    events.push({
      title: 'Safety check',
      detail: decision.policy_allowed
        ? `Cleared for ${decision.final_action.replace('_', ' ')}`
        : `Paused — ${decision.policy_reason}`,
      time: decision.created_at,
      tone: decision.policy_allowed ? 'success' : 'warning',
    });
    events.push({
      title: 'Next step',
      detail: `${decision.final_action.replace('_', ' ')} available to run`,
      time: null,
      tone: 'pending',
    });
  }

  const dotCls: Record<string, string> = {
    neutral: 'bg-panel-raised border-border-strong',
    risk: 'bg-risk-900/40 border-risk-500/50',
    success: 'bg-success-900/30 border-success-500/50',
    warning: 'bg-warning-muted border-warning-500/50',
    pending: 'bg-panel border-border-strong border-dashed',
  };

  return (
    <div>
      {events.map((e, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-2.5 h-2.5 rounded-full border ${dotCls[e.tone]} mt-1.5`} />
            {i < events.length - 1 && <div className="w-px flex-1 bg-border-subtle my-1" />}
          </div>
          <div className={i < events.length - 1 ? 'pb-5' : ''}>
            <div className="text-[13px] font-medium text-text-primary">{e.title}</div>
            <div className="text-[11.5px] text-text-secondary mt-0.5 leading-relaxed">{e.detail}</div>
            <div className="text-[10.5px] font-mono text-text-muted mt-1">
              {e.time ? `${absoluteTime(e.time)} · ${formatTimeAgo(e.time)}` : 'No timestamp recorded'}
            </div>
          </div>
        </div>
      ))}

      {!decision && (
        <p className="text-[11.5px] text-text-muted mt-4 leading-relaxed">
          REVORA hasn&apos;t evaluated this transaction yet, so no decision or safety events exist for it.
        </p>
      )}
    </div>
  );
};

const TabButton: React.FC<{
  label: string;
  icon: React.FC<any>;
  active: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium transition-colors border-b-2 whitespace-nowrap ${
      active
        ? 'text-primary-400 border-primary-500'
        : 'text-text-muted border-transparent hover:text-text-primary'
    }`}
  >
    <Icon className="w-3.5 h-3.5" />
    <span>{label}</span>
  </button>
);
