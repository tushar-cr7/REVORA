import React from 'react';
import { cn } from '@/lib/utils';
import { eventTypeMeta, type Layer, type Tone } from '@/lib/grammar';
import type { EventKind } from '@/components/ui/eventKinds';
import { Amount, MonetaryDelta, type AmountSize } from './Money';
import { LayerTag, StateIndicator, type NodeShape } from './State';
import { Timestamp } from './Meta';

/**
 * One event, set the way infrastructure sets an event: TYPE · SUBJECT · TIME ·
 * AMOUNT · STATE. Nothing here is a card. Rows share a hairline and a column
 * grid, so a stack of them reads as a ledger of what happened, in order.
 *
 *   PAYMENT_FAILED   TXN_8F29A1            14:32:08      ₹12,400   ● DIAGNOSED
 *
 * Give the row a business `title` and it reads event → context → metadata: the
 * title and its one-line `reason` lead, and the case reference and event
 * constant step back into the subject column as technical metadata:
 *
 *   ○ Payment failed      TXN_8F29A1            14:32:08      ₹12,400   ● DIAGNOSED
 *     Card declined       PAYMENT_FAILED
 *
 * The row measures its own width (container query), so the same component is
 * correct in a page, a drawer or a bottom sheet.
 */
export interface EventRowProps {
  /** The event constant (PAYMENT_FAILED, RETRY_ATTEMPTED…). Its kind and tone come from EVENT_TYPES. */
  type: string;
  /**
   * The business-language name of the event ("Payment failed"). When set it is the
   * primary label, `reason` becomes its context line beneath, and `type` moves to
   * technical metadata beside the entity reference.
   */
  title?: React.ReactNode;
  /** Entity / transaction reference. */
  entity?: React.ReactNode;
  /** ISO timestamp. */
  timestamp?: string | null;
  /** `clock` (default) · `date` · `auto` (clock if today, else date — use where events may be old). */
  timeFormat?: 'clock' | 'date' | 'auto';
  /** Relevant monetary value. */
  amount?: number;
  /** A signed change instead of a plain figure: +₹31,400 recovered. Wins over `amount`. */
  delta?: number;
  amountSize?: AmountSize;
  /** Where the event stands: "DIAGNOSED", "AUTHORIZED"… */
  status?: { label: React.ReactNode; tone?: Tone; kind?: EventKind; shape?: NodeShape };
  /** What happens next, as a consequence of this event — shown under the state. */
  next?: React.ReactNode;
  /** Who produced it. Omit for a plain fact (a payment failing has no actor). */
  actor?: Layer;
  /** Why — one line, plain language. */
  reason?: React.ReactNode;
  /** Override the registry's kind / tone for this row. */
  kind?: EventKind;
  tone?: Tone;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function EventRow({
  type,
  title,
  entity,
  timestamp,
  timeFormat = 'clock',
  amount,
  delta,
  amountSize = 'sm',
  status,
  next,
  actor,
  reason,
  kind,
  tone,
  selected,
  onClick,
  className,
}: EventRowProps) {
  const meta = eventTypeMeta(type);
  const resolvedKind = kind ?? meta.kind;
  const resolvedTone = tone ?? meta.tone;
  const interactive = !!onClick;
  const titled = title != null;

  return (
    <div
      className={cn('rv-event', className)}
      data-interactive={interactive ? '' : undefined}
      data-selected={selected ? '' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="rv-event-body" data-titled={titled ? '' : undefined}>
        <div className="rv-event-type" data-titled={titled ? '' : undefined}>
          <span aria-hidden className="rv-node" data-kind={resolvedKind} data-tone={resolvedTone} />
          {titled ? (
            <span className="rv-event-heading">
              <span className="rv-event-title">{title}</span>
              {reason && <span className="rv-event-context">{reason}</span>}
            </span>
          ) : (
            <span className="rv-event-name" title={type}>
              {type}
            </span>
          )}
        </div>

        <div className="rv-event-subject">
          {(entity || actor) && (
            <span className="rv-event-entity">
              {entity && <span className="rv-id">{entity}</span>}
              {actor && <LayerTag layer={actor} />}
            </span>
          )}
          {titled ? (
            <span className="rv-event-code" title={type}>
              {type}
            </span>
          ) : (
            reason && <span className="rv-event-reason">{reason}</span>
          )}
        </div>

        <span className="rv-event-time">
          <Timestamp iso={timestamp} format={timeFormat} />
        </span>

        <span className="rv-event-amount">
          {delta !== undefined ? (
            <MonetaryDelta value={delta} />
          ) : amount !== undefined ? (
            <Amount value={amount} size={amountSize} />
          ) : null}
        </span>

        <span className="rv-event-state">
          {status && <StateIndicator {...status} />}
          {next ? <span className="rv-event-next">{next}</span> : null}
        </span>
      </div>
    </div>
  );
}
