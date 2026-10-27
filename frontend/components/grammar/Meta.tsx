import React from 'react';
import { cn } from '@/lib/utils';
import { formatClockAuto, formatClockDate, formatClockTime, type Tone } from '@/lib/grammar';
import { formatTimeAgo } from '@/lib/format';

/**
 * Temporal + metadata primitives. Time is first-class: what happened, when, and
 * what came next. Mono is reserved for IDs, clocks and system values.
 *
 *   Timestamp       a precise clock (14:32:08), optionally with relative age
 *   TemporalToken   LABEL value — COOLDOWN 04:12:31 · ESCALATED AFTER 30 DAYS
 *   RetryCount      RETRY 1 / 2 with one pip per allowed attempt
 *   MetadataLine    hairline-separated LABEL value pairs
 */

export function Timestamp({
  iso,
  format = 'clock',
  relative = false,
  className,
}: {
  iso: string | null | undefined;
  /** `clock` = 14:32:08 · `date` = 04 Oct 14:32:08 · `auto` = clock if today, else date */
  format?: 'clock' | 'date' | 'auto';
  /** Append "· 3m ago". */
  relative?: boolean;
  className?: string;
}) {
  const text = format === 'date' ? formatClockDate(iso) : format === 'auto' ? formatClockAuto(iso) : formatClockTime(iso);
  return (
    // Local-time formatting differs between server and browser; the value is correct on the client.
    <time dateTime={iso ?? undefined} suppressHydrationWarning className={cn('rv-ts', className)}>
      {text}
      {relative && iso && <span className="rv-ts-rel"> · {formatTimeAgo(iso)}</span>}
    </time>
  );
}

export function TemporalToken({
  label,
  value,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span className={cn('rv-temporal', className)} data-tone={tone}>
      <span>{label}</span>
      <span className="rv-temporal-value">{value}</span>
    </span>
  );
}

export function RetryCount({
  used,
  max,
  className,
}: {
  used: number;
  max: number;
  className?: string;
}) {
  // The limit being reached is a binding control, so it reads as risk.
  const atLimit = used >= max;
  return (
    <span className={cn('rv-temporal', className)} data-tone={atLimit ? 'risk' : 'neutral'}>
      <span>Retry</span>
      <span className="rv-temporal-value">
        {used} / {max}
      </span>
      <span aria-hidden className="rv-pips">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className="rv-pip" data-on={i < used ? '' : undefined} />
        ))}
      </span>
    </span>
  );
}

export interface MetaItem {
  label?: string;
  value: React.ReactNode;
  /** IDs, clocks, policy identifiers, system values. */
  mono?: boolean;
}

export type MetaList = Array<MetaItem | null | false | undefined>;

export function MetadataLine({ items, className }: { items: MetaList; className?: string }) {
  const visible = items.filter(Boolean) as MetaItem[];
  if (visible.length === 0) return null;
  return (
    <div className={cn('rv-metaline', className)}>
      <div className="rv-metaline-row">
        {visible.map((item, i) => (
          <span key={i} className="rv-metaline-item">
            {item.label && <span className="rv-metaline-label">{item.label}</span>}
            <span className="rv-metaline-value" data-mono={item.mono ? '' : undefined}>
              {item.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
