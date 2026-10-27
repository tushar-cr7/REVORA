import React from 'react';
import { cn } from '@/lib/utils';
import { FINANCIAL_STATES, splitINR, type FinancialState, type Tone } from '@/lib/grammar';

/**
 * Money primitives. A sum of money is DATA, so it is set in mono with a dimmed ₹
 * and marked with a vertical tick (the ledger column) — never an event node.
 *
 *   FinancialTick      the state marker alone
 *   FinancialStateTag  tick + short state word, as a chip
 *   Amount             an inline figure (use the smallest size that works)
 *   MonetaryDelta      a signed change: +₹31,400 / −₹12,400
 *   FinancialMetric    LABEL → ₹ AMOUNT → CONTEXT, with an optional status
 */

export type AmountSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// Full class names on purpose: Tailwind only keeps `rv-*` rules whose class appears literally.
const AMOUNT_SIZE: Record<AmountSize, string> = {
  xs: 'rv-amount--xs',
  sm: 'rv-amount--sm',
  md: 'rv-amount--md',
  lg: 'rv-amount--lg',
  xl: 'rv-amount--xl',
};

export function Amount({
  value,
  size = 'md',
  compact = false,
  className,
}: {
  value: number;
  size?: AmountSize;
  /** ₹2.39L / ₹12.4k rather than ₹2,39,000. */
  compact?: boolean;
  className?: string;
}) {
  const { currency, figure } = splitINR(value, compact);
  return (
    <span className={cn('rv-amount', AMOUNT_SIZE[size], className)}>
      {currency && <span className="rv-cur">{currency}</span>}
      {figure}
    </span>
  );
}

export function FinancialTick({ state, className }: { state: FinancialState; className?: string }) {
  const meta = FINANCIAL_STATES[state];
  return <span aria-hidden className={cn('rv-tick', className)} data-fill={meta.fill} data-tone={meta.tone} />;
}

export function FinancialStateTag({ state, className }: { state: FinancialState; className?: string }) {
  const meta = FINANCIAL_STATES[state];
  return (
    <span
      className={cn('rv-badge font-mono text-[10px] uppercase tracking-[0.08em]', className)}
      data-tone={meta.tone}
      title={meta.meaning}
    >
      <FinancialTick state={state} className="h-[9px] w-[5px]" />
      {meta.short}
    </span>
  );
}

export function MonetaryDelta({
  value,
  compact = false,
  tone,
  className,
}: {
  /** Positive = money gained (recovered), negative = money lost or prevented. */
  value: number;
  compact?: boolean;
  tone?: Tone;
  className?: string;
}) {
  const direction = value > 0 ? 'gain' : value < 0 ? 'loss' : 'flat';
  const resolved: Tone = tone ?? (value > 0 ? 'success' : value < 0 ? 'risk' : 'neutral');
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const { currency, figure } = splitINR(Math.abs(value), compact);
  return (
    <span className={cn('rv-delta', className)} data-tone={resolved} data-dir={direction}>
      {sign}
      {currency && <span className="rv-cur">{currency}</span>}
      {figure}
    </span>
  );
}

export function FinancialMetric({
  state,
  amount,
  size = 'md',
  compact = false,
  label,
  context,
  secondary,
  status,
  className,
}: {
  state: FinancialState;
  amount: number;
  /** Scale follows importance: xl only for a page's one defining number. */
  size?: AmountSize;
  compact?: boolean;
  /** Overrides the state's own label. */
  label?: string;
  /** First context line, e.g. "100 transactions". */
  context?: React.ReactNode;
  /** Second context line, e.g. "4 risk categories". */
  secondary?: React.ReactNode;
  /** A StateIndicator or similar, right-aligned on the label row. */
  status?: React.ReactNode;
  className?: string;
}) {
  const meta = FINANCIAL_STATES[state];
  return (
    <div className={cn('rv-fin', className)} data-state={state}>
      <div className="rv-fin-head">
        <span className="rv-fin-label">
          <FinancialTick state={state} />
          <span className="rv-label truncate">{label ?? meta.label}</span>
        </span>
        {status}
      </div>
      <Amount value={amount} size={size} compact={compact} />
      {(context || secondary) && (
        <div className="rv-fin-context">
          {context && <span>{context}</span>}
          {secondary && <span>{secondary}</span>}
        </div>
      )}
    </div>
  );
}
