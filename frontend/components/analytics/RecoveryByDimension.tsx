'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { actionIcon } from '@/components/interventions/actionIcons';
import { ActionOutcomeRow, LeakOutcomeRow } from './analyticsSignals';

/**
 * Two paired-bar breakdown panels ("Recovery by Action" / "Recovery by Leak
 * Type") built on one shared row primitive. Both compare two real amounts
 * side by side, scaled to a shared max across the whole panel — never
 * stacked as if they summed to one whole, since recovered revenue (the
 * past) and still-at-risk revenue (the present queue) are two different
 * populations.
 */

function Panel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-panel p-5 h-full">
      <div className="mb-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">{eyebrow}</div>
        <h3 className="text-[15px] font-semibold text-text-primary tracking-tight mt-1">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function BarRow({
  index,
  icon: Icon,
  label,
  primaryAmount,
  primaryLabel,
  secondaryAmount,
  secondaryLabel,
  secondaryTone,
  max,
  meta,
}: {
  index: number;
  icon?: LucideIcon;
  label: string;
  primaryAmount: number;
  primaryLabel: string;
  secondaryAmount: number;
  secondaryLabel: string;
  secondaryTone: 'risk' | 'primary';
  max: number;
  meta?: string;
}) {
  const reduceMotion = useReducedMotion();
  const secondaryFill = secondaryTone === 'risk' ? 'bg-risk-500/70' : 'bg-primary-500/70';
  const secondaryText = secondaryTone === 'risk' ? 'text-risk-300' : 'text-primary-300';

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {Icon && <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />}
          <span className="text-[12px] font-medium text-text-secondary truncate">{label}</span>
        </div>
        {meta && <span className="text-[10.5px] font-mono text-text-muted shrink-0 ml-2">{meta}</span>}
      </div>

      <div className="space-y-1">
        <Track index={index} amount={primaryAmount} max={max} fill="bg-success-500" reduceMotion={!!reduceMotion} />
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-text-muted">{primaryLabel}</span>
          <span className="font-mono text-success-300">{formatINR(primaryAmount, true)}</span>
        </div>

        <Track index={index} amount={secondaryAmount} max={max} fill={secondaryFill} reduceMotion={!!reduceMotion} />
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-text-muted">{secondaryLabel}</span>
          <span className={`font-mono ${secondaryText}`}>{formatINR(secondaryAmount, true)}</span>
        </div>
      </div>
    </div>
  );
}

function Track({
  index,
  amount,
  max,
  fill,
  reduceMotion,
}: {
  index: number;
  amount: number;
  max: number;
  fill: string;
  reduceMotion: boolean;
}) {
  const pct = max > 0 ? Math.max(amount > 0 ? 1.5 : 0, (amount / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-border-subtle overflow-hidden">
      <motion.div
        initial={reduceMotion ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, delay: 0.05 * index, ease: [0.16, 1, 0.3, 1] }}
        className={`h-full rounded-full ${fill}`}
      />
    </div>
  );
}

/* ────────────────────────────── recovery by action ────────────────────────────── */

export const RecoveryByAction: React.FC<{ rows: ActionOutcomeRow[] }> = ({ rows }) => {
  const attemptRows = rows.filter((r) => r.isAttemptType);
  const otherRows = rows.filter((r) => !r.isAttemptType);
  const max = Math.max(1, ...attemptRows.flatMap((r) => [r.recoveredAmount, r.notRecoveredAmount]));

  return (
    <Panel eyebrow="By recovery method" title="Recovery by Action">
      {attemptRows.length === 0 && otherRows.length === 0 ? (
        <EmptyState message="No recovery actions have executed yet." />
      ) : (
        <>
          {attemptRows.map((r, i) => (
            <BarRow
              key={r.action}
              index={i}
              icon={actionIcon(r.action)}
              label={r.label}
              primaryAmount={r.recoveredAmount}
              primaryLabel="Recovered"
              secondaryAmount={r.notRecoveredAmount}
              secondaryLabel="Not recovered"
              secondaryTone="risk"
              max={max}
              meta={r.successRatePct != null ? `${r.successRatePct.toFixed(0)}% success` : undefined}
            />
          ))}
          {otherRows.map((r) => (
            <div key={r.action} className="flex items-center justify-between py-1.5 border-t border-border-divider first:border-t-0 first:pt-0">
              <div className="flex items-center gap-1.5">
                {React.createElement(actionIcon(r.action), { strokeWidth: 1.75, className: 'w-3.5 h-3.5 text-text-muted shrink-0' })}
                <span className="text-[12px] font-medium text-text-secondary">{r.label}</span>
              </div>
              <span className="text-[11px] font-mono text-text-muted">
                {r.attemptedCount} case{r.attemptedCount === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
};

/* ────────────────────────────── recovery by leak type ────────────────────────────── */

export const RecoveryByLeakType: React.FC<{
  rows: LeakOutcomeRow[];
  unclassifiedRecoveredAmount: number;
}> = ({ rows, unclassifiedRecoveredAmount }) => {
  const max = Math.max(1, ...rows.flatMap((r) => [r.recoveredAmount, r.stillAtRiskAmount]));

  return (
    <Panel eyebrow="By leak type" title="Recovery by Leak Type">
      {rows.length === 0 ? (
        <EmptyState message="No leak types have been scanned yet." />
      ) : (
        rows.map((r, i) => (
          <BarRow
            key={r.leakType}
            index={i}
            label={r.label}
            primaryAmount={r.recoveredAmount}
            primaryLabel="Recovered"
            secondaryAmount={r.stillAtRiskAmount}
            secondaryLabel="Still at risk"
            secondaryTone="primary"
            max={max}
            meta={r.recoveredCount > 0 ? `${r.recoveredCount} recovered` : undefined}
          />
        ))
      )}
      {unclassifiedRecoveredAmount > 0 && (
        <p className="text-[10px] text-text-muted leading-snug pt-1 border-t border-border-divider">
          {formatINR(unclassifiedRecoveredAmount, true)} recovered from transactions outside the current sample window
          isn&apos;t shown above by leak type, but is included in the totals.
        </p>
      )}
    </Panel>
  );
};

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <p className="text-[12px] text-text-muted py-2">{message}</p>
);
