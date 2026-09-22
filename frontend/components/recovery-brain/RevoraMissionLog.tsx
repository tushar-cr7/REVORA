'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Search, ShieldCheck, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Opportunity, AuditEvent } from '@/lib/types';
import { formatINR, formatTimeAgo } from '@/lib/format';

interface RevoraMissionLogProps {
  opportunities: Opportunity[];
  auditLog: AuditEvent[];
}

const ACTION_LABEL: Record<string, string> = {
  retry: 'RETRY',
  payment_link: 'PAYMENT LINK',
  reminder: 'REMINDER',
  escalate: 'ESCALATE',
  suppress: 'SUPPRESS',
};

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

const RECORDED_ACTION_LABEL: Record<string, string> = {
  retry: 'Retry',
  payment_link: 'Payment Link',
  reminder: 'Reminder',
  escalate: 'Escalate',
  suppress: 'Suppress',
};

/**
 * REVORA's operational feed — a dense two-column log, not a narrow
 * timeline stranded in a wide row. Left: the single best real opportunity
 * narrated end-to-end, carrying the most visual weight since it's the
 * current story. Right: real audit entries with real timestamps, quieter
 * as they recede. Nothing here is fabricated — narrative steps (derived
 * from a static opportunity, not a timestamped event) carry no invented
 * clock time, only sequence and an icon.
 */
export const RevoraMissionLog: React.FC<RevoraMissionLogProps> = ({ opportunities, auditLog }) => {
  const featured = useMemo(
    () => (opportunities.length ? [...opportunities].sort((a, b) => b.expected_recovery - a.expected_recovery)[0] : null),
    [opportunities]
  );

  const narrative = featured
    ? [
        {
          icon: Sparkles,
          color: 'text-ai-400 border-ai-500/30 bg-ai-900/20',
          title: 'Opportunity detected',
          detail: LEAK_LABEL[featured.leak_type] || featured.leak_type,
          value: formatINR(featured.amount),
        },
        {
          icon: Search,
          color: 'text-primary-400 border-primary-500/30 bg-primary-900/20',
          title: 'Cause identified',
          detail: `Recovery likelihood ${(featured.recovery_probability * 100).toFixed(0)}%`,
          value: null,
        },
        {
          icon: featured.policy_allowed ? ShieldCheck : AlertTriangle,
          color: featured.policy_allowed
            ? 'text-success-400 border-success-500/30 bg-success-900/20'
            : 'text-risk-400 border-risk-500/30 bg-risk-900/20',
          title: featured.policy_allowed ? 'Safety check passed' : 'Held by policy',
          detail: featured.policy_allowed ? 'Within deterministic limits' : featured.policy_reason,
          value: null,
        },
        {
          icon: Zap,
          color: 'text-warning-400 border-warning-500/30 bg-warning-900/20',
          title: 'REVORA recommends',
          detail: null,
          value: ACTION_LABEL[featured.recommended_action] || featured.recommended_action.toUpperCase(),
        },
      ]
    : [];

  const recent = auditLog.slice(0, 6);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-text-primary text-[14px] font-medium tracking-wide">REVORA Activity</h3>
          <p className="text-text-muted text-[12px] mt-0.5">What REVORA is doing about your revenue</p>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-ai-500/10 rounded-full border border-ai-500/20">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ai-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-ai-500" />
          </span>
          <span className="text-[10px] uppercase font-mono font-medium text-ai-400">Live</span>
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-ai-500/30 via-border-strong to-transparent mb-5" />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-6">
        {/* Live narrative — dominant, the current story */}
        <div className="lg:col-span-5">
          {narrative.length === 0 ? (
            <div className="text-[13px] text-text-muted">Waiting for the next pass over your revenue at risk.</div>
          ) : (
            <div className="space-y-3.5">
              {narrative.map((step, i) => {
                const Icon = step.icon;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.3 }}
                    className="flex items-start gap-3"
                  >
                    <div className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${step.color}`}>
                      <Icon className="w-2.5 h-2.5" />
                    </div>
                    <div className="flex-1 min-w-0 flex items-baseline justify-between gap-3">
                      <div>
                        <div className="text-[13.5px] font-medium text-text-primary leading-tight">{step.title}</div>
                        {step.detail && <div className="text-[11.5px] text-text-muted mt-0.5">{step.detail}</div>}
                      </div>
                      {step.value && (
                        <span className="text-[13px] font-mono font-semibold text-text-primary shrink-0">{step.value}</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recorded activity — quieter, real, dense */}
        <div className="lg:col-span-7 lg:border-l lg:border-border-subtle lg:pl-8">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-3">Recorded Activity</div>

          {recent.length === 0 ? (
            <div className="text-[13px] text-text-muted">No recovery actions recorded yet.</div>
          ) : (
            <div className="space-y-0.5">
              <AnimatePresence initial={false}>
                {recent.map((evt, i) => {
                  const isSuccess = evt.outcome?.recovered || evt.event_type === 'EXECUTION_SUCCEEDED';
                  const isBlocked = evt.event_type === 'ACTION_BLOCKED';
                  const Icon = isSuccess ? CheckCircle2 : isBlocked ? AlertTriangle : ShieldCheck;
                  const color = isSuccess ? 'text-success-400' : isBlocked ? 'text-risk-400' : 'text-primary-400';
                  return (
                    <motion.div
                      key={evt.event_id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1 - i * 0.09, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-[16px_1fr_auto] items-center gap-3 py-1.5 rounded-md"
                    >
                      <Icon className={`w-3 h-3 ${color}`} />
                      <div className="min-w-0 flex items-baseline gap-2">
                        <span className="text-[12px] text-text-secondary font-medium shrink-0">
                          {RECORDED_ACTION_LABEL[evt.action] || evt.action.replace('_', ' ')}
                        </span>
                        <span className="text-[11px] text-text-muted font-mono truncate">{evt.transaction_id}</span>
                      </div>
                      <span className="text-[10px] text-text-muted font-mono shrink-0">{formatTimeAgo(evt.timestamp)}</span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
