import React from 'react';
import { cn } from '@/lib/utils';
import {
  VERDICTS,
  type RecoveryStageData,
  type StageState,
  type Tone,
  type Verdict,
} from '@/lib/grammar';
import type { EventKind } from '@/components/ui/eventKinds';
import { MetadataLine, type MetaList } from './Meta';

/**
 * Relationship primitives. A line between two things means one led to the
 * other — never decoration.
 *
 *   TimelineConnector   the link: solid = reached · dashed = not yet ·
 *                       dashed + stop cap = the flow ended at the boundary
 *   Timeline            vertical chronology: time · node · event
 *   RecoveryStage       one stage of DETECT → DIAGNOSE → DECIDE → ACT → OUTCOME
 *   RecoveryFlow        the stages as a compact row or as a timeline
 */

export type LinkState = 'reached' | 'pending' | 'halted';

/** A link into a stage is solid only if the stage was actually reached. */
export function linkInto(state: StageState | undefined): LinkState {
  if (state === 'halted') return 'halted';
  if (state === 'pending') return 'pending';
  return 'reached';
}

export function TimelineConnector({
  orientation = 'vertical',
  state = 'reached',
  tone,
  className,
}: {
  orientation?: 'vertical' | 'horizontal';
  state?: LinkState;
  /** Colour of the stop cap when `halted` (defaults to risk). */
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('rv-link', className)}
      data-orient={orientation === 'vertical' ? 'v' : 'h'}
      data-state={state}
      data-tone={state === 'halted' ? tone : undefined}
    />
  );
}

/* ─────────────────────────────── timeline ─────────────────────────────── */

export interface TimelineEntry {
  id: string;
  kind: EventKind;
  state?: StageState;
  tone?: Tone;
  /** Usually a <Timestamp />. */
  time?: React.ReactNode;
  /** Optional when the body is a block of its own (a LayerBlock states its own title). */
  title?: React.ReactNode;
  detail?: React.ReactNode;
  meta?: MetaList;
  /** The body holds a surface (e.g. a LayerBlock): the node aligns with that surface's header, not a text line. */
  block?: boolean;
  /** Marks the row the viewer arrived from. */
  focus?: boolean;
  children?: React.ReactNode;
}

export function TimelineItem({
  kind,
  state = 'reached',
  tone,
  time,
  title,
  detail,
  meta,
  block,
  focus,
  children,
  linkState,
  linkTone,
}: Omit<TimelineEntry, 'id'> & {
  /** State of the link running down to the next item; omit on the last item. */
  linkState?: LinkState;
  linkTone?: Tone;
}) {
  return (
    <div
      className="rv-tl-item"
      role="listitem"
      data-state={state}
      data-block={block ? '' : undefined}
      data-focus={focus ? '' : undefined}
    >
      <div className="rv-tl-time">{time}</div>
      <div className="rv-tl-rail">
        <span aria-hidden className="rv-node" data-kind={state === 'halted' ? 'block' : kind} data-tone={tone} />
        {linkState && <TimelineConnector state={linkState} tone={linkTone} />}
      </div>
      <div className="rv-tl-body">
        {title && <div className="rv-tl-title">{title}</div>}
        {detail && <div className="rv-layer-detail">{detail}</div>}
        {meta && <MetadataLine items={meta} />}
        {children}
      </div>
    </div>
  );
}

export function Timeline({ items, className }: { items: TimelineEntry[]; className?: string }) {
  return (
    <div className={cn('rv-tl', className)} role="list">
      {items.map((item, i) => {
        const next = items[i + 1];
        const { id, ...rest } = item;
        return (
          <TimelineItem
            key={id}
            {...rest}
            linkState={next ? linkInto(next.state) : undefined}
            linkTone={next?.tone}
          />
        );
      })}
    </div>
  );
}

/* ───────────────────────────── recovery flow ───────────────────────────── */

export function RecoveryStage({
  label,
  kind,
  state = 'pending',
  value,
  tone,
  className,
}: Pick<RecoveryStageData, 'label' | 'kind' | 'value'> & {
  state?: StageState;
  tone?: Tone;
  className?: string;
}) {
  // A stage that never ran because policy stopped it wears the block silhouette.
  const shown: EventKind = state === 'halted' ? 'block' : kind;
  return (
    <div className={cn('rv-stage', className)} data-state={state} data-kind={shown} data-tone={tone}>
      <div className="rv-stage-mark">
        <span aria-hidden className="rv-node" data-kind={shown} data-tone={tone} />
      </div>
      <span className="rv-stage-label">{label}</span>
      {value ? <span className="rv-stage-value">{value}</span> : null}
    </div>
  );
}

/** The policy gate inside a horizontal flow: a bar across the path, not a stage on it. */
function FlowGate({ verdict }: { verdict: Verdict }) {
  const meta = VERDICTS[verdict];
  return (
    <div className="rv-stage" data-verdict={verdict}>
      <div className="rv-stage-mark">
        <span aria-hidden className="rv-gatemark" />
      </div>
      <span className="rv-stage-label">Policy</span>
      <span className="rv-stage-verdict">{meta.label}</span>
    </div>
  );
}

export function RecoveryFlow({
  stages,
  gate,
  orientation = 'horizontal',
  className,
}: {
  stages: RecoveryStageData[];
  /**
   * Draw the authorization boundary between DECIDE and ACT. The verdict comes from
   * `decisionVerdict(decision)`; the flow only displays it.
   */
  gate?: { verdict: Verdict };
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  if (orientation === 'vertical') {
    const entries: TimelineEntry[] = [];
    stages.forEach((stage, i) => {
      entries.push({
        id: stage.key,
        kind: stage.kind,
        state: stage.state,
        title: stage.label,
        detail: stage.value,
      });
      if (gate && stage.key === 'decide' && stages[i + 1]) {
        const meta = VERDICTS[gate.verdict];
        entries.push({
          id: 'gate',
          kind: 'policy',
          state: gate.verdict === 'pending' ? 'pending' : 'reached',
          tone: meta.tone,
          title: 'Authorization boundary',
          detail: meta.label,
        });
      }
    });
    return <Timeline items={entries} className={className} />;
  }

  const nodes: React.ReactNode[] = [];
  stages.forEach((stage, i) => {
    const prev = stages[i - 1];
    if (prev) {
      if (gate && prev.key === 'decide') {
        const meta = VERDICTS[gate.verdict];
        const intoGate: LinkState = prev.state === 'pending' || gate.verdict === 'pending' ? 'pending' : 'reached';
        const outOfGate = linkInto(stage.state);
        nodes.push(<TimelineConnector key={`in-${stage.key}`} orientation="horizontal" state={intoGate} />);
        nodes.push(<FlowGate key="gate" verdict={gate.verdict} />);
        nodes.push(
          <TimelineConnector
            key={`out-${stage.key}`}
            orientation="horizontal"
            state={outOfGate}
            tone={outOfGate === 'halted' ? meta.tone : undefined}
          />,
        );
      } else {
        nodes.push(<TimelineConnector key={`link-${stage.key}`} orientation="horizontal" state={linkInto(stage.state)} />);
      }
    }
    nodes.push(<RecoveryStage key={stage.key} label={stage.label} kind={stage.kind} state={stage.state} value={stage.value} />);
  });

  return (
    <div className={cn('rv-flow', className)} role="list" aria-label="Recovery flow">
      {nodes}
    </div>
  );
}
