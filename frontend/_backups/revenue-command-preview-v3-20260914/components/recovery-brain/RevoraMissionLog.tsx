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
  retry: 'retry',
  payment_link: 'send a payment link',
  reminder: 'send a reminder',
  escalate: 'escalate',
  suppress: 'suppress',
};

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'a failed payment',
  abandoned_checkout: 'an abandoned checkout',
  failed_subscription: 'a subscription failure',
  overdue_invoice: 'an overdue invoice',
};

/**
 * REVORA's operational feed — a mission log for money, not a card. The
 * first entries narrate the single best real opportunity end-to-end
 * (detected -> understood -> cleared -> recommended); the rest are real
 * audit entries with their real timestamps. Nothing here is fabricated —
 * the narrative entries carry no invented clock times, only sequence.
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
          title: `${formatINR(featured.amount)} opportunity detected`,
          detail: LEAK_LABEL[featured.leak_type] || featured.leak_type,
        },
        {
          icon: Search,
          color: 'text-primary-400 border-primary-500/30 bg-primary-900/20',
          title: 'Cause identified',
          detail: `Recovery likelihood ${(featured.recovery_probability * 100).toFixed(0)}%`,
        },
        {
          icon: featured.policy_allowed ? ShieldCheck : AlertTriangle,
          color: featured.policy_allowed
            ? 'text-success-400 border-success-500/30 bg-success-900/20'
            : 'text-risk-400 border-risk-500/30 bg-risk-900/20',
          title: featured.policy_allowed ? 'Safety check passed' : 'Held by policy',
          detail: featured.policy_allowed ? 'Within deterministic limits' : featured.policy_reason,
        },
        {
          icon: Zap,
          color: 'text-warning-400 border-warning-500/30 bg-warning-900/20',
          title: `REVORA recommends: ${ACTION_LABEL[featured.recommended_action] || featured.recommended_action}`,
          detail: null,
        },
      ]
    : [];

  const recent = auditLog.slice(0, 5);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
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

      <div className="relative pl-5">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-ai-500/40 via-border-strong to-transparent" />

        <div className="space-y-4">
          {narrative.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.3 }}
                className="relative flex items-start gap-3"
              >
                <div className={`absolute -left-5 w-3.5 h-3.5 rounded-full border flex items-center justify-center ${step.color} shrink-0`}>
                  <Icon className="w-2 h-2" />
                </div>
                <div className="pl-4">
                  <div className="text-[13px] font-medium text-text-primary">{step.title}</div>
                  {step.detail && <div className="text-[11px] text-text-muted mt-0.5">{step.detail}</div>}
                </div>
              </motion.div>
            );
          })}

          {narrative.length === 0 && (
            <div className="text-[13px] text-text-muted pl-4">Waiting for the next pass over your revenue at risk.</div>
          )}

          {recent.length > 0 && (
            <div className="pt-1 pb-1 pl-4">
              <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Recorded activity</span>
            </div>
          )}

          <AnimatePresence initial={false}>
            {recent.map((evt) => {
              const isSuccess = evt.outcome?.recovered || evt.event_type === 'EXECUTION_SUCCEEDED';
              const isBlocked = evt.event_type === 'ACTION_BLOCKED';
              const Icon = isSuccess ? CheckCircle2 : isBlocked ? AlertTriangle : ShieldCheck;
              const color = isSuccess
                ? 'text-success-400 border-success-500/30 bg-success-900/20'
                : isBlocked
                ? 'text-risk-400 border-risk-500/30 bg-risk-900/20'
                : 'text-primary-400 border-primary-500/30 bg-primary-900/20';
              return (
                <motion.div
                  key={evt.event_id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="relative flex items-start gap-3"
                >
                  <div className={`absolute -left-5 w-3.5 h-3.5 rounded-full border flex items-center justify-center ${color} shrink-0`}>
                    <Icon className="w-2 h-2" />
                  </div>
                  <div className="pl-4 flex items-center justify-between w-full gap-2">
                    <div>
                      <span className="text-[12px] text-text-secondary capitalize">{evt.action.replace('_', ' ')}</span>
                      <span className="text-[11px] text-text-muted"> &middot; {evt.transaction_id}</span>
                    </div>
                    <span className="text-[10px] text-text-muted font-mono shrink-0">{formatTimeAgo(evt.timestamp)}</span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
