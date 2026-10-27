import React from 'react';
import type { Tone } from '@/lib/grammar';

export interface SplitPart {
  key: string;
  value: number;
  tone: Tone;
  /** Spoken / hover description: "539 authorized". */
  label: string;
}

/**
 * A partition: one bar divided in proportion to the counts it splits — the
 * 700 recommendations into 539 authorized and 161 stopped. It carries no
 * figure of its own; it only shows how one real total divides, so it renders
 * nothing when there is nothing to divide.
 */
export function SplitBar({ parts, wide = false }: { parts: SplitPart[]; wide?: boolean }) {
  const shown = parts.filter((p) => p.value > 0);
  if (shown.length === 0) return null;
  return (
    <div className="rv-split" data-wide={wide ? '' : undefined} role="img" aria-label={shown.map((p) => p.label).join(', ')}>
      {shown.map((p) => (
        <span key={p.key} className="rv-split-seg" data-tone={p.tone} style={{ flexGrow: p.value }} title={p.label} />
      ))}
    </div>
  );
}
