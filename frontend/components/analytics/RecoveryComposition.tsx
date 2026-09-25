'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { formatINR } from '@/lib/format';
import { CompositionSegment, CompositionTone } from './analyticsSignals';

/**
 * Analytics' signature visual: the entire scanned revenue universe as one
 * continuous, segmented bar — a restrained financial "composition" read,
 * deliberately distinct from every other page's hero (no nodes, no flowing
 * streams, no dot field). Each segment is a real amount; the bar tells you
 * at a glance where every rupee REVORA has ever seen currently stands.
 */

const TONE_FILL: Record<CompositionTone, string> = {
  success: 'bg-success-500',
  risk: 'bg-risk-500',
  primary: 'bg-primary-500',
  warning: 'bg-warning-500',
  neutral: 'bg-border-strong',
};

const TONE_DOT: Record<CompositionTone, string> = {
  success: 'bg-success-400',
  risk: 'bg-risk-400',
  primary: 'bg-primary-400',
  warning: 'bg-warning-400',
  neutral: 'bg-text-muted',
};

const TONE_TEXT: Record<CompositionTone, string> = {
  success: 'text-success-300',
  risk: 'text-risk-300',
  primary: 'text-primary-300',
  warning: 'text-warning-300',
  neutral: 'text-text-muted',
};

interface RecoveryCompositionProps {
  segments: CompositionSegment[];
  totalAtRisk: number;
}

export const RecoveryComposition: React.FC<RecoveryCompositionProps> = ({ segments, totalAtRisk }) => {
  const reduceMotion = useReducedMotion();
  const visible = segments.filter((s) => s.amount > 0);
  const empty = totalAtRisk <= 0 || visible.length === 0;

  return (
    <section className="rounded-lg border border-border-subtle bg-panel p-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-5">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">Revenue composition</div>
          <h2 className="text-[19px] font-semibold text-text-primary tracking-tight mt-1">Where every rupee stands</h2>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Total revenue at risk</div>
          <div className="text-[18px] font-mono font-semibold text-text-primary">{formatINR(totalAtRisk, true)}</div>
        </div>
      </div>

      {empty ? (
        <div className="h-6 w-full rounded-md bg-surface border border-border-divider flex items-center justify-center">
          <span className="text-[11px] text-text-muted">No revenue has been scanned yet.</span>
        </div>
      ) : (
        <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label="Revenue composition breakdown">
          {visible.map((s, i) => {
            const pct = Math.max(1.2, (s.amount / totalAtRisk) * 100);
            return (
              <motion.div
                key={s.key}
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                className={`h-full first:rounded-l-md last:rounded-r-md ${TONE_FILL[s.tone]}`}
                title={`${s.label} · ${formatINR(s.amount)}`}
              />
            );
          })}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {segments.map((s) => (
          <div key={s.key} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[s.tone]}`} />
              <span className="text-[11px] font-medium text-text-secondary truncate">{s.label}</span>
            </div>
            <div className={`text-[15px] font-mono font-semibold mt-1 ${TONE_TEXT[s.tone]}`}>
              {formatINR(s.amount, true)}
              {s.count != null && <span className="text-[10px] font-sans font-normal text-text-muted ml-1.5">· {s.count}</span>}
            </div>
            <p className="text-[10.5px] text-text-muted mt-0.5 leading-snug">{s.caption}</p>
          </div>
        ))}
      </div>
    </section>
  );
};
