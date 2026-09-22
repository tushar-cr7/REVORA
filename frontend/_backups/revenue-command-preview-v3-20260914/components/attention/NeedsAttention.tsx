'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { Opportunity } from '@/lib/types';
import { motion } from 'framer-motion';

interface NeedsAttentionProps {
  opportunities: Opportunity[];
  policyBlockedCount: number;
  escalationsCount: number;
  onFollowOpportunity: (opp: Opportunity) => void;
}

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

/**
 * A priority queue, not a grid of equally-weighted boxes — the merchant
 * should know what's #1 without comparing anything. Ranked: things
 * blocking REVORA first, things needing a human decision next, the best
 * opportunity last (it's good news, not urgent).
 */
export const NeedsAttention: React.FC<NeedsAttentionProps> = ({
  opportunities,
  policyBlockedCount,
  escalationsCount,
  onFollowOpportunity,
}) => {
  const featured = useMemo(() => {
    if (opportunities.length === 0) return null;
    return [...opportunities].sort((a, b) => b.expected_recovery - a.expected_recovery)[0];
  }, [opportunities]);

  type AttentionItem = {
    key: string;
    title: string;
    subtitle: string;
    tone: 'warning' | 'risk' | 'ai';
    href?: string;
    onClick?: () => void;
  };

  const items = [
    policyBlockedCount > 0
      ? ({
          key: 'paused',
          title: `${policyBlockedCount} action${policyBlockedCount === 1 ? '' : 's'} paused`,
          subtitle: 'Waiting for review before REVORA can act',
          tone: 'warning',
          href: '/interventions',
        } as AttentionItem)
      : null,
    escalationsCount > 0
      ? ({
          key: 'escalations',
          title: `${escalationsCount} escalation${escalationsCount === 1 ? '' : 's'}`,
          subtitle: 'Require merchant attention',
          tone: 'risk',
          href: '/escalations',
        } as AttentionItem)
      : null,
    featured
      ? ({
          key: 'opportunity',
          title: 'High-value recovery opportunity',
          subtitle: `${formatINR(featured.amount)} · ${LEAK_LABEL[featured.leak_type] || featured.leak_type} · ${formatPct(featured.recovery_probability)} likely to recover`,
          tone: 'ai',
          onClick: () => onFollowOpportunity(featured),
        } as AttentionItem)
      : null,
  ].filter((x): x is AttentionItem => x !== null);

  return (
    <div className="bg-panel border border-border-strong rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-border-subtle">
        <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Needs Attention</h3>
        <p className="text-text-muted text-[12px] mt-0.5">What to look at right now, in order</p>
      </div>

      {items.length === 0 ? (
        <div className="py-10 flex flex-col items-center justify-center text-center">
          <CheckCircle2 className="w-8 h-8 text-success-500/50 mb-3" />
          <span className="text-[13px] text-text-secondary">Nothing needs attention right now.</span>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {items.map((item, i) => {
            const toneClass =
              item.tone === 'warning'
                ? 'text-warning-400'
                : item.tone === 'risk'
                ? 'text-risk-400'
                : 'text-ai-400';
            const content = (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.25 }}
                className="flex items-center gap-4 px-5 py-4 group cursor-pointer hover:bg-surface/60 transition-colors"
              >
                <span className={`font-display font-semibold text-2xl tabular-nums ${toneClass} opacity-70 w-10 shrink-0`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text-primary">{item.title}</div>
                  <div className="text-[12px] text-text-muted mt-0.5 truncate">{item.subtitle}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
              </motion.div>
            );

            return item.href ? (
              <Link key={item.key} href={item.href}>
                {content}
              </Link>
            ) : (
              <button key={item.key} onClick={item.onClick} className="w-full text-left">
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
