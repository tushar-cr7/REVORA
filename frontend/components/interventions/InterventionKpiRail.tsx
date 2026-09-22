'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IndianRupee, Send, CircleCheck, TriangleAlert, LucideIcon } from 'lucide-react';
import { Intervention, Opportunity } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { OperationalSummary, activityByHour, leakLabel, riskComposition } from './interventionSignals';

/**
 * Four operational figures, each counted from loaded records.
 *
 * Deliberately no trend percentages: the backend keeps no historical series
 * to compare against, so "+18% vs last week" could only ever be invented.
 * Each card instead carries a micro-visual that is itself a real derivation
 * of the same data — a composition, a histogram, a ratio — so the card is
 * visually rich without asserting anything the data can't support.
 */

const LEAK_COLOR: Record<string, string> = {
  failed_payment: '#F5484F',
  abandoned_checkout: '#F5A623',
  failed_subscription: '#8B5CF6',
  overdue_invoice: '#4F6EF7',
};

type Tone = 'primary' | 'neutral' | 'success' | 'warning';

const TONE: Record<Tone, { icon: string; ring: string; value: string; glow: string }> = {
  primary: { icon: 'text-primary-300', ring: 'border-primary-500/30 bg-primary-muted/40', value: 'text-text-primary', glow: 'bg-primary-500/10' },
  neutral: { icon: 'text-text-secondary', ring: 'border-border-strong bg-panel-raised', value: 'text-text-primary', glow: 'bg-transparent' },
  success: { icon: 'text-success-300', ring: 'border-success-500/30 bg-success-muted/50', value: 'text-success-200', glow: 'bg-success-500/10' },
  warning: { icon: 'text-warning-300', ring: 'border-warning-500/30 bg-warning-muted/50', value: 'text-warning-200', glow: 'bg-warning-500/10' },
};

interface KpiRailProps {
  summary: OperationalSummary;
  queue: Opportunity[];
  interventions: Intervention[];
}

export const InterventionKpiRail: React.FC<KpiRailProps> = ({ summary, queue, interventions }) => {
  const composition = React.useMemo(() => riskComposition(queue), [queue]);
  const hourly = React.useMemo(() => activityByHour(interventions), [interventions]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <KpiCard
        index={0}
        icon={IndianRupee}
        tone="primary"
        label="Revenue at risk"
        value={formatINR(summary.revenueAtRisk, true)}
        caption={`Across ${summary.queued} queued action${summary.queued === 1 ? '' : 's'}`}
        visual={<CompositionBar segments={composition} total={summary.revenueAtRisk} />}
      />
      <KpiCard
        index={1}
        icon={Send}
        tone="neutral"
        label="Actions today"
        value={summary.completedToday.toLocaleString()}
        caption={`${summary.completed} executed in total`}
        visual={<HourHistogram buckets={hourly} />}
      />
      <KpiCard
        index={2}
        icon={CircleCheck}
        tone="success"
        label="Recovered revenue"
        value={formatINR(summary.recoveredAmount, true)}
        caption={
          summary.recoveredCount > 0
            ? `From ${summary.recoveredCount} successful action${summary.recoveredCount === 1 ? '' : 's'}`
            : 'No recoveries yet'
        }
        visual={<RatioBar filled={summary.recoveredCount} total={summary.completed} />}
      />
      <KpiCard
        index={3}
        icon={TriangleAlert}
        tone="warning"
        label="Needs attention"
        value={summary.needsAttention.toLocaleString()}
        caption={summary.needsAttention > 0 ? 'Require human review' : 'Nothing waiting on you'}
        visual={<AttentionSplit blocked={summary.blocked} unresolved={Math.max(0, summary.needsAttention - summary.blocked)} />}
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

/** Queued revenue split by the leak type it came from, using Revenue Command's own encoding. */
const CompositionBar: React.FC<{ segments: { leakType: string; amount: number }[]; total: number }> = ({
  segments,
  total,
}) => {
  if (total <= 0 || segments.length === 0) return <EmptyTrack label="Nothing queued" />;

  return (
    <div>
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.leakType}
            className="h-full rounded-full"
            style={{ width: `${Math.max(2, (s.amount / total) * 100)}%`, backgroundColor: LEAK_COLOR[s.leakType] ?? '#4F6EF7' }}
            title={`${leakLabel(s.leakType)} · ${formatINR(s.amount)}`}
          />
        ))}
      </div>
      <div className="mt-1.5 text-[10px] text-text-muted truncate">
        {leakLabel(segments[0].leakType)} leads at {formatINR(segments[0].amount, true)}
      </div>
    </div>
  );
};

/** Executed interventions per hour, last 12 hours. Empty hours stay empty. */
const HourHistogram: React.FC<{ buckets: number[] }> = ({ buckets }) => {
  const max = Math.max(...buckets, 1);
  const any = buckets.some((b) => b > 0);

  return (
    <div>
      <div className="flex h-6 items-end gap-[3px]">
        {buckets.map((count, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm ${count > 0 ? 'bg-primary-500/70' : 'bg-border-subtle'}`}
            style={{ height: count > 0 ? `${Math.max(14, (count / max) * 100)}%` : '3px' }}
            title={count > 0 ? `${count} executed` : 'None'}
          />
        ))}
      </div>
      <div className="mt-1 text-[10px] text-text-muted">{any ? 'Last 12 hours' : 'No activity in the last 12 hours'}</div>
    </div>
  );
};

/** How many executed actions actually recovered revenue. */
const RatioBar: React.FC<{ filled: number; total: number }> = ({ filled, total }) => {
  if (total <= 0) return <EmptyTrack label="No actions executed yet" />;
  const pct = (filled / total) * 100;

  return (
    <div>
      <div className="h-1.5 w-full rounded-full bg-border-subtle overflow-hidden">
        <div className="h-full rounded-full bg-success-500" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="mt-1.5 text-[10px] text-text-muted">
        {filled} of {total} actions recovered
      </div>
    </div>
  );
};

/** What the attention count is actually made of. */
const AttentionSplit: React.FC<{ blocked: number; unresolved: number }> = ({ blocked, unresolved }) => {
  const total = blocked + unresolved;
  if (total <= 0) return <EmptyTrack label="Queue is clear" />;

  return (
    <div>
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
        {blocked > 0 && (
          <div className="h-full rounded-full bg-warning-500" style={{ width: `${(blocked / total) * 100}%` }} />
        )}
        {unresolved > 0 && (
          <div className="h-full rounded-full bg-risk-500/70" style={{ width: `${(unresolved / total) * 100}%` }} />
        )}
      </div>
      <div className="mt-1.5 text-[10px] text-text-muted truncate">
        {blocked} paused by controls · {unresolved} unresolved
      </div>
    </div>
  );
};

const EmptyTrack: React.FC<{ label: string }> = ({ label }) => (
  <div>
    <div className="h-1.5 w-full rounded-full bg-border-subtle" />
    <div className="mt-1.5 text-[10px] text-text-muted">{label}</div>
  </div>
);
