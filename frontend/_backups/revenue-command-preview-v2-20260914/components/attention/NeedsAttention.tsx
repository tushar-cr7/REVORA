'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { Opportunity } from '@/lib/types';
import { motion } from 'framer-motion';

interface NeedsAttentionProps {
  opportunities: Opportunity[];
  policyBlockedCount: number;
  escalationsCount: number;
  onSelectTransaction: (txId: string) => void;
}

const ACTION_LABEL: Record<string, string> = {
  retry: 'Retry',
  payment_link: 'Send payment link',
  reminder: 'Send reminder',
  escalate: 'Escalate',
  suppress: 'Suppress',
};

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

/**
 * "What should I look at right now?" — a single, opinionated spotlight on
 * the best real recovery opportunity plus a short list of things that
 * genuinely need a merchant's attention today. Everything here is derived
 * from data already loaded elsewhere on the page; nothing is invented.
 */
export const NeedsAttention: React.FC<NeedsAttentionProps> = ({
  opportunities,
  policyBlockedCount,
  escalationsCount,
  onSelectTransaction,
}) => {
  const featured = useMemo(() => {
    if (opportunities.length === 0) return null;
    return [...opportunities].sort((a, b) => b.expected_recovery - a.expected_recovery)[0];
  }, [opportunities]);

  const otherCount = Math.max(0, opportunities.length - (featured ? 1 : 0));
  const nothingToShow = !featured && policyBlockedCount === 0 && escalationsCount === 0;

  return (
    <div className="bg-panel border border-border-strong rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border-subtle">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-warning-900/20 border border-warning-500/30 flex items-center justify-center text-warning-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Needs Attention</h3>
            <p className="text-text-muted text-[12px] mt-0.5">What to look at right now</p>
          </div>
        </div>
      </div>

      {nothingToShow ? (
        <div className="py-10 flex flex-col items-center justify-center text-center">
          <CheckCircle2 className="w-8 h-8 text-success-500/50 mb-3" />
          <span className="text-[13px] text-text-secondary">Nothing needs attention right now.</span>
          <span className="text-[11px] text-text-muted mt-1">Run an intelligence pass to check for opportunities.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr]">
          {/* Spotlight */}
          <div className="p-5 border-b lg:border-b-0 lg:border-r border-border-subtle">
            {featured ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="rounded-xl bg-ai-900/10 border border-ai-500/25 p-4 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-ai-500/10 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none" />
                <div className="relative z-10">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ai-400 font-mono font-semibold">
                    <Sparkles className="w-3 h-3" />
                    Recovery opportunity
                  </div>
                  <div className="mt-2 text-2xl font-display font-semibold text-text-primary">
                    {formatINR(featured.amount)}
                  </div>
                  <div className="mt-1 text-[13px] text-text-secondary">
                    {LEAK_LABEL[featured.leak_type] || featured.leak_type} &middot;{' '}
                    <span className="text-ai-300 font-medium">{formatPct(featured.recovery_probability)}</span> likely to recover
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-[12px]">
                    <span className="text-text-muted">REVORA recommends:</span>
                    <span className="font-semibold text-text-primary">
                      {ACTION_LABEL[featured.recommended_action] || featured.recommended_action}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    {featured.policy_allowed ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Safety check passed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-risk-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Held by policy
                      </span>
                    )}
                    <button
                      onClick={() => onSelectTransaction(featured.transaction_id)}
                      className="px-4 py-1.5 rounded-md bg-ai-600 hover:bg-ai-500 text-white text-[12px] font-medium transition-colors flex items-center gap-1.5"
                    >
                      Review
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="text-[13px] text-text-muted py-6 text-center">No open opportunities right now.</div>
            )}
            {otherCount > 0 && (
              <a href="#opportunities" className="mt-3 block text-[12px] text-text-muted hover:text-primary-400 transition-colors text-center">
                +{otherCount} more opportunit{otherCount === 1 ? 'y' : 'ies'} below
              </a>
            )}
          </div>

          {/* Attention list */}
          <div className="p-5 space-y-2.5">
            {policyBlockedCount > 0 && (
              <AttentionRow
                href="/interventions"
                tone="warning"
                title={`${policyBlockedCount} action${policyBlockedCount === 1 ? '' : 's'} paused by policy`}
                subtitle="Held for review before REVORA can act"
              />
            )}
            {escalationsCount > 0 && (
              <AttentionRow
                href="/escalations"
                tone="risk"
                title={`${escalationsCount} escalation${escalationsCount === 1 ? '' : 's'} awaiting review`}
                subtitle="Couldn't be safely automated"
              />
            )}
            {policyBlockedCount === 0 && escalationsCount === 0 && (
              <div className="text-[12px] text-text-muted flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-success-500/70" />
                No paused actions or escalations.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function AttentionRow({
  href,
  tone,
  title,
  subtitle,
}: {
  href: string;
  tone: 'warning' | 'risk';
  title: string;
  subtitle: string;
}) {
  const toneClass = tone === 'warning' ? 'text-warning-400 border-warning-500/30 bg-warning-900/10' : 'text-risk-400 border-risk-500/30 bg-risk-900/10';
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 transition-colors hover:bg-surface group ${toneClass}`}
    >
      <div>
        <div className="text-[13px] font-medium text-text-primary">{title}</div>
        <div className="text-[11px] text-text-muted mt-0.5">{subtitle}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-text-primary group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}
