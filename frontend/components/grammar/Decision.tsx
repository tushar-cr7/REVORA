import React from 'react';
import { cn } from '@/lib/utils';
import { LAYERS, VERDICTS, type Layer, type Verdict } from '@/lib/grammar';
import { MetadataLine, type MetaList } from './Meta';
import { LayerTag, StateIndicator } from './State';
import { TimelineConnector } from './Flow';

/**
 * Decision primitives — INTELLIGENCE is not AUTHORITY.
 *
 *   LayerBlock       one layer's statement, with the layer's verb and surface
 *   PolicyBoundary   the control boundary between recommendation and authorization
 *   DecisionState    intelligence → boundary → policy → action, as one record
 *
 * AI recommends; rules authorize. The distinction is carried by hierarchy and
 * structure — an advisory layer is recessed and violet, a binding layer is
 * raised and silver — not by effects. Verdicts are only ever *displayed* here;
 * pass them in from `decisionVerdict(decision)`.
 */

export type LayerBlockState = 'live' | 'pending' | 'void';

export function LayerBlock({
  layer,
  title,
  detail,
  meta,
  status,
  verdict,
  state = 'live',
  className,
  children,
}: {
  layer: Layer;
  /** The statement: "Retry payment", "Retry permitted". */
  title: React.ReactNode;
  detail?: React.ReactNode;
  meta?: MetaList;
  /** Right-aligned on the header row — a StateIndicator or OutcomeIndicator. */
  status?: React.ReactNode;
  /** Policy layer only: colours the rail with the verdict. */
  verdict?: Verdict;
  /** pending = not reached yet · void = deliberately nothing happened. */
  state?: LayerBlockState;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn('rv-layer', className)}
      data-layer={layer}
      data-verdict={layer === 'policy' ? verdict : undefined}
      data-state={state === 'live' ? undefined : state}
    >
      <div className="rv-layer-head">
        <LayerTag layer={layer} verb />
        {status}
      </div>
      <div className="rv-layer-statement">{title}</div>
      {detail && <div className="rv-layer-detail">{detail}</div>}
      {children}
      {meta && <MetadataLine items={meta} />}
    </section>
  );
}

export function PolicyBoundary({ verdict, className }: { verdict: Verdict; className?: string }) {
  const meta = VERDICTS[verdict];
  return (
    <div
      className={cn('rv-gate', className)}
      data-verdict={verdict}
      role="separator"
      aria-label={`Authorization boundary: ${meta.label.toLowerCase()}`}
    >
      <div className="rv-gate-row">
        <span className="rv-gate-side">AI recommends</span>
        <span aria-hidden className="rv-gate-line" />
        <span className="rv-gate-plate">
          <span aria-hidden className="rv-node" data-kind={meta.kind} />
          <span className="rv-gate-plate-label">Authorization boundary</span>
          {meta.label}
        </span>
        <span aria-hidden className="rv-gate-line" />
        <span className="rv-gate-side">Rules authorize</span>
      </div>
    </div>
  );
}

const POLICY_TITLE: Record<Verdict, string> = {
  authorized: 'Action authorized',
  rerouted: 'Rerouted to a person',
  blocked: 'Action blocked',
  downgraded: 'Action downgraded',
  pending: 'Awaiting policy check',
};

export interface DecisionActionInput {
  /** `system` for an executed action, `human` when a person acts. */
  layer?: Extract<Layer, 'system' | 'human'>;
  title: React.ReactNode;
  detail?: React.ReactNode;
  meta?: MetaList;
  /** Typically an <OutcomeIndicator />. */
  status?: React.ReactNode;
}

/** What the action slot shows when nothing has been executed — derived from the verdict only. */
function placeholderAction(verdict: Verdict): { layer: 'system' | 'human'; state: LayerBlockState; title: string; detail: string } {
  switch (verdict) {
    case 'blocked':
      return { layer: 'system', state: 'void', title: 'No action taken', detail: 'Recovery Controls withheld this action.' };
    case 'rerouted':
      return { layer: 'human', state: 'pending', title: 'Awaiting review', detail: 'This case is waiting for a person.' };
    case 'pending':
      return { layer: 'system', state: 'pending', title: 'Not executed', detail: 'Waiting on the policy check.' };
    default:
      return { layer: 'system', state: 'pending', title: 'Not executed yet', detail: 'Authorized and waiting to run.' };
  }
}

export function DecisionState({
  recommendation,
  verdict,
  policy,
  action,
  className,
}: {
  /** What intelligence proposed. */
  recommendation: { title: React.ReactNode; detail?: React.ReactNode; meta?: MetaList };
  /** What the policy layer did with it. */
  verdict: Verdict;
  policy?: { title?: React.ReactNode; reason?: React.ReactNode; meta?: MetaList };
  /** What actually ran. Omit if nothing has — the slot explains itself from the verdict. */
  action?: DecisionActionInput | null;
  className?: string;
}) {
  const vmeta = VERDICTS[verdict];
  const executed = !!action;
  const fallback = executed ? null : placeholderAction(verdict);
  const stopped = !executed && (verdict === 'blocked' || verdict === 'rerouted');

  return (
    <div className={cn('flex flex-col', className)}>
      <LayerBlock
        layer="intelligence"
        title={recommendation.title}
        detail={recommendation.detail}
        meta={recommendation.meta}
      />
      <TimelineConnector className="ml-4" />
      <PolicyBoundary verdict={verdict} />
      <TimelineConnector className="ml-4" state={verdict === 'pending' ? 'pending' : 'reached'} />
      <LayerBlock
        layer="policy"
        verdict={verdict}
        state={verdict === 'pending' ? 'pending' : 'live'}
        title={policy?.title ?? POLICY_TITLE[verdict]}
        detail={policy?.reason}
        meta={policy?.meta}
        status={<StateIndicator label={vmeta.label} kind={vmeta.kind} tone={vmeta.tone} />}
      />
      <TimelineConnector
        className="ml-4"
        state={executed ? 'reached' : stopped ? 'halted' : 'pending'}
        tone={stopped ? vmeta.tone : undefined}
      />
      {action ? (
        <LayerBlock
          layer={action.layer ?? 'system'}
          title={action.title}
          detail={action.detail}
          meta={action.meta}
          status={action.status}
        />
      ) : (
        <LayerBlock layer={fallback!.layer} state={fallback!.state} title={fallback!.title} detail={fallback!.detail} />
      )}
    </div>
  );
}
