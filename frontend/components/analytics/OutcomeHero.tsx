'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PiggyBank, Gauge, ShieldAlert, TriangleAlert, LucideIcon } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { OutcomeTotals } from './analyticsSignals';

/**
 * Four executive figures, each traceable to real backend/derived data.
 * Deliberately no "+12% vs last week" badges — the backend keeps no
 * historical series to compare against (same reasoning as Interventions'
 * KPI rail), so a trend arrow here could only ever be invented.
 */

type Tone = 'success' | 'primary' | 'risk' | 'warning';

const TONE: Record<Tone, { icon: string; ring: string; value: string; glow: string }> = {
  success: { icon: 'text-success-300', ring: 'border-success-500/30 bg-success-muted/50', value: 'text-success-200', glow: 'bg-success-500/10' },
  primary: { icon: 'text-primary-300', ring: 'border-primary-500/30 bg-primary-muted/40', value: 'text-text-primary', glow: 'bg-primary-500/10' },
  risk: { icon: 'text-risk-300', ring: 'border-risk-500/30 bg-risk-muted/60', value: 'text-risk-200', glow: 'bg-risk-500/10' },
  warning: { icon: 'text-warning-300', ring: 'border-warning-500/30 bg-warning-muted/50', value: 'text-warning-200', glow: 'bg-warning-500/10' },
};

interface OutcomeHeroProps {
  totals: OutcomeTotals;
}

export const OutcomeHero: React.FC<OutcomeHeroProps> = ({ totals }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <Tile
        index={0}
        icon={PiggyBank}
        tone="success"
        label="Revenue recovered"
        value={totals.recoveredAmount}
        format={(v) => formatINR(v, true)}
        caption={
          totals.recoveredCount > 0
            ? `From ${totals.recoveredCount} successful recover${totals.recoveredCount === 1 ? 'y' : 'ies'}`
            : 'No recoveries yet'
        }
      />
      <Tile
        index={1}
        icon={Gauge}
        tone="primary"
        label="Recovery rate"
        value={totals.recoveryRatePct}
        format={(v) => `${v.toFixed(1)}%`}
        caption="Recovered against total revenue at risk"
      />
      <Tile
        index={2}
        icon={ShieldAlert}
        tone="risk"
        label="Revenue still at risk"
        value={totals.stillAtRiskAmount}
        format={(v) => formatINR(v, true)}
        caption="Queued, blocked, or not yet recovered"
      />
      <Tile
        index={3}
        icon={TriangleAlert}
        tone="warning"
        label="Needs attention"
        value={totals.needsAttentionCount}
        format={(v) => Math.round(v).toLocaleString('en-IN')}
        caption={totals.needsAttentionCount > 0 ? 'Blocked or unresolved cases' : 'Nothing waiting on you'}
      />
    </div>
  );
};

const Tile: React.FC<{
  index: number;
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: number;
  format: (v: number) => string;
  caption: string;
}> = ({ index, icon: Icon, tone, label, value, format, caption }) => {
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
          <AnimatedNumber
            value={value}
            format={format}
            className={`block text-[22px] font-mono font-semibold leading-none mt-1.5 ${t.value}`}
          />
        </div>
      </div>

      <p className="relative text-[11px] text-text-muted mt-3 leading-snug">{caption}</p>
    </motion.div>
  );
};
