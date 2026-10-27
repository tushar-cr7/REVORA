'use client';

import React from 'react';
import StatusMark from '@/components/reactbits/StatusMark/StatusMark';
import { cn } from '@/lib/utils';
import type { Tone } from '@/lib/grammar';
import './reactbits-adapt.css';

/** The five states the official StatusMark draws. */
export type MarkState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * The operational state of an action or a record — the official React Bits StatusMark, set in
 * REVORA's own state read-out (mono caps, semantic tone).
 *
 * The mark is the published component, untouched: a dashed ring while pending, a turning arc
 * while running, a check when done, a cross when failed or cancelled, morphing in place when the
 * state changes. REVORA supplies what the state *is* (from the audit record), its word, and its
 * colour — the tone colours the whole mark, so green is recovered, red is blocked, amber is a
 * person's attention and blue is the system, as everywhere else in the product.
 *
 * `strike` is off: StatusMark strikes through the label of a finished task, which is right for a
 * to-do list and wrong for a ledger — "Recovered" must not read as crossed out.
 */
export function OperationalMark({
  state,
  label,
  tone = 'neutral',
  chip = false,
  className,
}: {
  state: MarkState;
  label: string;
  tone?: Tone;
  /** A bordered chip rather than inline text. */
  chip?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('rv-state rv-opmark', chip && 'rv-badge', className)} data-tone={tone}>
      <StatusMark
        status={state}
        label={label}
        color="var(--tone)"
        doneColor="var(--tone)"
        errorColor="var(--tone)"
        size={13}
        strokeWidth={2.4}
        fontSize={10}
        strike={false}
      />
    </span>
  );
}
