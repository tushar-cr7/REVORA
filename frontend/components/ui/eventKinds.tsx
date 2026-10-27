import React from 'react';
import {
  CircleDot,
  Activity,
  GitBranch,
  SlidersHorizontal,
  Crosshair,
  CircleCheck,
  CircleAlert,
  UserCog,
  Ban,
  type LucideIcon,
} from 'lucide-react';

/**
 * REVORA event language — the nine concepts every transaction's story is made of.
 * Colour, node silhouette and mono-caps type are defined once in globals.css
 * (`data-kind`, `.rv-node`, `.rv-kind`); this file adds the label + icon so a page
 * never has to re-decide them.
 *
 * Icons reuse the symbol already assigned to the same concept elsewhere in the
 * product: action = Interventions, policy = Recovery Controls,
 * escalation = Escalations.
 */
export type EventKind =
  | 'event'
  | 'signal'
  | 'decision'
  | 'policy'
  | 'action'
  | 'outcome'
  | 'escalation'
  | 'override'
  | 'block';

export interface EventKindMeta {
  label: string;
  /** One line, business language. */
  meaning: string;
  icon: LucideIcon;
}

export const EVENT_KINDS: Record<EventKind, EventKindMeta> = {
  event:      { label: 'Event',      meaning: 'Something happened to revenue',          icon: CircleDot },
  signal:     { label: 'Signal',     meaning: 'Evidence extracted from the event',      icon: Activity },
  decision:   { label: 'Decision',   meaning: 'REVORA chose an action',                 icon: GitBranch },
  policy:     { label: 'Policy',     meaning: 'Recovery Controls checked the action',   icon: SlidersHorizontal },
  action:     { label: 'Action',     meaning: 'An intervention was carried out',        icon: Crosshair },
  outcome:    { label: 'Outcome',    meaning: 'The measured result',                    icon: CircleCheck },
  escalation: { label: 'Escalation', meaning: 'Rerouted to a person',                   icon: CircleAlert },
  override:   { label: 'Override',   meaning: 'A person changed the outcome',           icon: UserCog },
  block:      { label: 'Block',      meaning: 'The action was prevented',               icon: Ban },
};

/** The silhouette alone — for timelines, chains and legends. */
export function KindNode({ kind, className = '' }: { kind: EventKind; className?: string }) {
  return <span aria-hidden className={`rv-node ${className}`} data-kind={kind} />;
}

/** Node + label chip in the kind's colour. */
export function KindChip({
  kind,
  label,
  className = '',
}: {
  kind: EventKind;
  label?: string;
  className?: string;
}) {
  return (
    <span className={`rv-kind ${className}`} data-kind={kind}>
      <span aria-hidden className="rv-node" />
      {label ?? EVENT_KINDS[kind].label}
    </span>
  );
}
