'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Users, IndianRupee, RefreshCw, LucideIcon } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ControlsKpis } from './controlsSignals';

/**
 * Four live KPI tiles plus a fifth controls-status tile, styled to match
 * the supplied reference. The reference's per-tile trend sparklines and
 * "Last 30 days" / "This month" framings are not reproduced literally —
 * REVORA's backend keeps no historical series (in-memory only, resets on
 * restart), so a time-windowed trend could only ever be invented. Each
 * tile instead carries a real ratio bar of current state, and honest
 * captions ("Across decided cases," "From executed recovery actions").
 */

type Tone = 'primary' | 'warning' | 'success';

const TONE: Record<Tone, { icon: string; ring: string; value: string; glow: string; bar: string }> = {
  primary: { icon: 'text-primary-300', ring: 'border-primary-500/30 bg-primary-muted/40', value: 'text-text-primary', glow: 'bg-primary-500/10', bar: 'bg-primary-500' },
  warning: { icon: 'text-warning-300', ring: 'border-warning-500/30 bg-warning-muted/50', value: 'text-warning-200', glow: 'bg-warning-500/10', bar: 'bg-warning-500' },
  success: { icon: 'text-success-300', ring: 'border-success-500/30 bg-success-muted/50', value: 'text-success-200', glow: 'bg-success-500/10', bar: 'bg-success-500' },
};

interface ControlsKpiRowProps {
  kpis: ControlsKpis | null;
  policyVersion: string;
  controlsActive: boolean;
  loading: boolean;
  onRefresh: () => void;
}

export const ControlsKpiRow: React.FC<ControlsKpiRowProps> = ({ kpis, policyVersion, controlsActive, loading, onRefresh }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
      <Tile
        index={0}
        icon={ShieldCheck}
        tone="primary"
        label="Actions within limits"
        value={kpis ? kpis.withinLimitsPct : 0}
        format={(v) => `${v.toFixed(1)}%`}
        caption="Across decided cases"
        barPct={kpis ? kpis.withinLimitsPct : 0}
      />
      <Tile
        index={1}
        icon={ShieldAlert}
        tone="warning"
        label="Manually escalated"
        value={kpis ? kpis.escalatedPct : 0}
        format={(v) => `${v.toFixed(1)}%`}
        caption="Across decided cases"
        barPct={kpis ? kpis.escalatedPct : 0}
      />
      <Tile
        index={2}
        icon={Users}
        tone="primary"
        label="Customers contacted"
        value={kpis ? kpis.customersContacted : 0}
        format={(v) => Math.round(v).toLocaleString('en-IN')}
        caption="From executed recovery actions"
      />
      <Tile
        index={3}
        icon={IndianRupee}
        tone="success"
        label="Autonomous recovery ceiling"
        value={25000}
        format={(v) => formatINR(v)}
        caption="Per action"
      />

      <ControlsStatusTile policyVersion={policyVersion} controlsActive={controlsActive} loading={loading} onRefresh={onRefresh} />
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
  barPct?: number;
}> = ({ index, icon: Icon, tone, label, value, format, caption, barPct }) => {
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
          <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted leading-snug">{label}</div>
          <AnimatedNumber
            value={value}
            format={format}
            className={`block text-[22px] font-mono font-semibold leading-none mt-1.5 ${t.value}`}
          />
        </div>
      </div>

      {barPct != null && (
        <div className="relative mt-3 h-1.5 w-full rounded-full bg-border-subtle overflow-hidden">
          <motion.div
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${Math.max(2, Math.min(100, barPct))}%` }}
            transition={{ duration: 0.6, delay: 0.15 + index * 0.05, ease: [0.16, 1, 0.3, 1] }}
            className={`h-full rounded-full ${t.bar}`}
          />
        </div>
      )}

      <p className="relative text-[11px] text-text-muted mt-2 leading-snug">{caption}</p>
    </motion.div>
  );
};

const ControlsStatusTile: React.FC<{
  policyVersion: string;
  controlsActive: boolean;
  loading: boolean;
  onRefresh: () => void;
}> = ({ policyVersion, controlsActive, loading, onRefresh }) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-lg border border-border-subtle bg-panel p-4 flex flex-col justify-between"
    >
      <div className="flex items-center justify-between">
        <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted">Controls status</div>
        <span
          className={`inline-flex items-center gap-1.5 text-[9.5px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
            controlsActive ? 'text-success-300 border-success-500/30 bg-success-muted/40' : 'text-risk-300 border-risk-500/30 bg-risk-muted/40'
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {controlsActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />}
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${controlsActive ? 'bg-success-500' : 'bg-risk-500'}`} />
          </span>
          {controlsActive ? 'Active' : 'Unavailable'}
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-muted">Policy version</span>
          <span className="font-mono text-text-primary">{policyVersion || '—'}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-muted">Last updated</span>
          <span className="font-mono text-text-secondary">—</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-text-muted">Read-only (API)</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh policy"
          className="p-1.5 rounded-md bg-surface border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </motion.div>
  );
};
