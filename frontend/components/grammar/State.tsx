import React from 'react';
import { cn } from '@/lib/utils';
import { LAYERS, OUTCOMES, type Layer, type OutcomeKey, type Tone } from '@/lib/grammar';
import type { EventKind } from '@/components/ui/eventKinds';
import { MonetaryDelta } from './Money';

/**
 * State primitives — "what is this in right now?"
 *
 *   StateIndicator   node + MONO CAPS word, in the state's colour
 *   LayerTag         INTELLIGENCE · POLICY · SYSTEM · HUMAN — who is acting
 *   OutcomeIndicator the measured result of an intervention, with money where it moved
 *
 * Colour carries the state and nothing else: violet = intelligence, silver =
 * policy, blue = system, green = recovered, red = risk / blocked, amber =
 * human attention, neutral = inactive or historical.
 */

export type NodeShape =
  | 'disc'
  | 'ring'
  | 'diamond'
  | 'square'
  | 'capsule'
  | 'halo'
  | 'triangle'
  | 'dashed'
  | 'slashed';

export function StateIndicator({
  label,
  tone,
  kind,
  shape,
  chip = false,
  title,
  className,
}: {
  label: React.ReactNode;
  /** Semantic colour. Defaults to the kind's own colour, else neutral. */
  tone?: Tone;
  /** Borrow an event kind's silhouette and colour. */
  kind?: EventKind;
  /** A silhouette without a kind's colour. */
  shape?: NodeShape;
  /** Render as a bordered chip rather than inline text. */
  chip?: boolean;
  title?: string;
  className?: string;
}) {
  // Always resolve a tone so an ancestor's --tone can never leak into this state.
  const resolvedTone = tone ?? (kind ? undefined : 'neutral');
  return (
    <span
      className={cn('rv-state', chip && 'rv-badge', className)}
      data-kind={kind}
      data-tone={resolvedTone}
      title={title}
    >
      <span aria-hidden className="rv-node" data-shape={kind ? undefined : shape} />
      {label}
    </span>
  );
}

export function LayerTag({
  layer,
  verb = false,
  className,
}: {
  layer: Layer;
  /** Append the layer's verb: "recommends", "authorizes", "executes", "decides". */
  verb?: boolean;
  className?: string;
}) {
  const meta = LAYERS[layer];
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span className="rv-kind" data-layer={layer} data-kind={meta.kind} title={meta.meaning}>
        <span aria-hidden className="rv-node" />
        {meta.label}
      </span>
      {verb && <span className="rv-layer-verb">{meta.verb}</span>}
    </span>
  );
}

export function OutcomeIndicator({
  outcome,
  amount,
  compact = false,
  className,
}: {
  outcome: OutcomeKey;
  /** Money that moved. Omitted or 0 renders no figure. */
  amount?: number | null;
  compact?: boolean;
  className?: string;
}) {
  const meta = OUTCOMES[outcome];
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="rv-state" data-kind={meta.kind} data-tone={meta.tone}>
        <span aria-hidden className="rv-node" />
        {meta.label}
      </span>
      {amount ? <MonetaryDelta value={amount} compact={compact} tone={meta.tone} /> : null}
    </span>
  );
}
