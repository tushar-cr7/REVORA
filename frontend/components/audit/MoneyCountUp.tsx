'use client';

import React from 'react';
import { useReducedMotion } from 'motion/react';
import CountUp from '@/components/reactbits/CountUp/CountUp';
import { Amount, type AmountSize } from '@/components/grammar';
import { splitINR } from '@/lib/grammar';
import './reactbits-adapt.css';

const SIZE_CLASS: Record<AmountSize, string> = {
  xs: 'rv-amount--xs',
  sm: 'rv-amount--sm',
  md: 'rv-amount--md',
  lg: 'rv-amount--lg',
  xl: 'rv-amount--xl',
};

/**
 * Headline money that counts to its value — the official React Bits CountUp, in REVORA's
 * financial formatting.
 *
 * CountUp animates a bare number; REVORA writes money as "₹2.39L". So the figure is split by the
 * product's own formatter (`splitINR` → `formatINR`) into currency · number · unit, the official
 * CountUp counts the number, and the ₹ and the unit stay put: ₹0.01L → ₹2.39L. Nothing about how
 * the number is written changes.
 *
 * Three things the wrapper — not the component — is responsible for:
 *   · Stable space. The finished figure is rendered, hidden, in normal flow, and the counting
 *     figure sits over it, so the column is already its final width and nothing shifts. It also
 *     carries the exact figure for assistive tech; the moving digits are hidden from it.
 *   · Exact decimals. CountUp infers its decimals from the numbers it is given, which would drop a
 *     trailing zero ("2.30" → "2.3"). `from` is set to the smallest value that carries the
 *     figure's decimals, so CountUp keeps them: ₹2.30L stays ₹2.30L.
 *   · Reduced motion. CountUp does not check it; the wrapper renders the finished figure instead.
 *
 * A figure CountUp can't write faithfully (Indian digit grouping, e.g. ₹12,34,567 — CountUp only
 * groups in threes) is shown as the plain `Amount`, never approximated.
 *
 * For a page's headline money only; remounted when the value changes so it counts to the new one.
 */
export function MoneyCountUp({ value, size = 'md', compact = false }: { value: number; size?: AmountSize; compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  const { currency, figure } = splitINR(value, compact);
  const parts = /^(\d+(?:\.\d+)?)(.*)$/.exec(figure);

  // No leading number, or Indian digit grouping (₹12,34,567 — CountUp only groups in threes): not
  // countable faithfully, so it is shown exactly as `Amount` writes it.
  if (reduceMotion || !parts || figure.includes(',')) return <Amount value={value} size={size} compact={compact} />;

  const [, numeric, unit] = parts;
  const decimals = numeric.includes('.') ? numeric.split('.')[1].length : 0;
  const to = parseFloat(numeric);
  // The smallest positive value with the same decimals: 0.01 for two, 0.1 for one, 0 for none.
  const from = decimals > 0 ? Number(`0.${'0'.repeat(decimals - 1)}1`) : 0;

  return (
    <span className="rv-countup">
      <Amount value={value} size={size} compact={compact} className="rv-countup-final" />
      <span aria-hidden className={`rv-countup-live rv-amount ${SIZE_CLASS[size]}`}>
        {currency && <span className="rv-cur">{currency}</span>}
        <CountUp key={value} from={from} to={to} duration={1} />
        {unit}
      </span>
      <span className="sr-only">
        {currency}
        {figure}
      </span>
    </span>
  );
}
