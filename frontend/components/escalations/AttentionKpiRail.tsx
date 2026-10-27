'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IndianRupee, ListChecks, TriangleAlert, Clock3, LucideIcon } from 'lucide-react';
import { PolicyLimits } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { AGING_THRESHOLD_HOURS, AttentionSummary } from './escalationSignals';

/**
 * Four business questions a Revenue Operations lead actually has when
 * opening this page, each answered from `AttentionSummary` — itself built
 * only from loaded `/api/escalations` + `/api/transactions` +
 * `/api/interventions` records. No trend percentages: the backend keeps
 * no historical series for escalations to compare against, so every card
 * carries a real split of the same underlying figure instead.
 */

type Tone = 'primary' | 'warning' | 'risk' | 'neutral';

const TONE: Record<Tone, { icon: string; ring: string; value: string; glow: string; fill: string }> = {
  primary: { icon: 'text-primary-300', ring: 'border-primary-500/30 bg-primary-muted/40', value: 'text-text-primary', glow: 'bg-primary-500/10', fill: 'bg-primary-500' },
  warning: { icon: 'text-warning-300', ring: 'border-warning-500/30 bg-warning-muted/50', value: 'text-warning-200', glow: 'bg-warning-500/10', fill: 'bg-warning-500' },
  risk: { icon: 'text-risk-300', ring: 'border-risk-500/30 bg-risk-muted/60', value: 'text-risk-200', glow: 'bg-risk-500/10', fill: 'bg-risk-500' },
  neutral: { icon: 'text-text-secondary', ring: 'border-border-strong bg-panel-raised', value: 'text-text-primary', glow: 'bg-transparent', fill: 'bg-text-disabled' },
};

interface Props {
  summary: AttentionSummary;
  policy: PolicyLimits | null;
  loading: boolean;
}

export const AttentionKpiRail: React.FC<Props> = ({ summary, policy, loading }) => {
  if (loading) return <RailSkeleton />;

  const routedShare = summary.totalCases > 0 ? summary.routedCases / summary.totalCases : 0;
  const highValueShare = summary.totalCases > 0 ? summary.highValueCases / summary.totalCases : 0;
  const agingShare = summary.totalCases > 0 ? summary.agingCases / summary.totalCases : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <KpiCard
        index={0}
        icon={IndianRupee}
        tone="primary"
        label="Revenue requiring attention"
        value={formatINR(summary.revenueRequiringAttention, true)}
        caption={`Across ${summary.totalCases} case${summary.totalCases === 1 ? '' : 's'}`}
        visual={<SplitBar filled={routedShare} tone="primary" />}
      />
      <KpiCard
        index={1}
        icon={ListChecks}
        tone="warning"
        label="Cases needing review"
        value={summary.pendingCases.toLocaleString()}
        caption={
          summary.routedCases > 0
            ? `${summary.routedCases} of ${summary.totalCases} already routed`
            : 'None routed to your queue yet'
        }
        visual={<SplitBar filled={routedShare} tone="warning" />}
      />
      <KpiCard
        index={2}
        icon={TriangleAlert}
        tone="risk"
        label="High-value escalations"
        value={summary.highValueCases.toLocaleString()}
        caption={
          policy
            ? `Above the ₹${policy.max_auto_recovery_value.toLocaleString('en-IN')} auto-recovery ceiling`
            : 'Above the auto-recovery ceiling'
        }
        visual={<SplitBar filled={highValueShare} tone="risk" />}
      />
      <KpiCard
        index={3}
        icon={Clock3}
        tone="neutral"
        label="Aging escalations"
        value={summary.agingCases.toLocaleString()}
        caption={`Open more than ${AGING_THRESHOLD_HOURS / 24} days without a hand-off`}
        visual={<SplitBar filled={agingShare} tone="neutral" />}
      />
    </div>
  );
};

const KpiCard: React.FC<{
  index: number;
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string;
  caption: string;
  visual: React.ReactNode;
}> = ({ index, icon: Icon, tone, label, value, caption, visual }) => {
  const reduceMotion = useReducedMotion();
  const t = TONE[tone];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-lg border border-border-subtle bg-panel p-4"
    >
      <div aria-hidden className={`pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full blur-2xl ${t.glow}`} />

      <div className="relative flex items-start gap-3">
        <div className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${t.ring}`}>
          <Icon strokeWidth={1.6} className={`w-4 h-4 ${t.icon}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted">{label}</div>
          <div className={`text-[22px] font-semibold tabular-nums leading-none mt-1.5 ${t.value}`}>{value}</div>
        </div>
      </div>

      <div className="relative mt-3">{visual}</div>
      <p className="relative text-[11px] text-text-muted mt-2 leading-snug">{caption}</p>
    </motion.div>
  );
};

/** A single real fraction of the card's figure, rendered as a filled track. */
const SplitBar: React.FC<{ filled: number; tone: Tone }> = ({ filled, tone }) => {
  const t = TONE[tone];
  const pct = Math.max(0, Math.min(1, filled)) * 100;
  return <div className="h-1.5 w-full rounded-full bg-border-subtle overflow-hidden">
    <div className={`h-full rounded-full ${t.fill}`} style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct)}%` }} />
  </div>;
};

const RailSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="rounded-lg border border-border-subtle bg-panel p-4 animate-pulse">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-border-strong/50 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-2 w-24 rounded bg-border-strong/60" />
            <div className="h-4 w-16 rounded bg-border-subtle" />
          </div>
        </div>
        <div className="h-1.5 w-full rounded-full bg-border-subtle mt-3" />
        <div className="h-2 w-32 rounded bg-border-subtle mt-2" />
      </div>
    ))}
  </div>
);
