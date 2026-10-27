'use client';

import React from 'react';
import Link from 'next/link';
import { FinancialTick, LayerTag, StateIndicator, TimelineConnector } from '@/components/grammar';
import { MoneyCountUp } from './MoneyCountUp';
import { FINANCIAL_STATES, LAYERS, type Layer } from '@/lib/grammar';
import { AuditKpis, formatCount } from './auditSignals';
import { SplitBar } from './SplitBar';

interface Props {
  kpis: AuditKpis | null;
  /** Pipeline-wide money from `GET /api/analytics`; null until (or unless) it loads. */
  money: { atRisk: number; recovered: number } | null;
  loading: boolean;
}

/**
 * Page identity, and the system's one loop told as a single chain:
 *
 *   REVENUE AT RISK → RECOMMENDATIONS → POLICY DECISIONS → ACTIONS RUN → RECOVERED REVENUE
 *   ₹2.39L            700                539 | 161          2             ₹6.9k
 *
 * Every stage is labelled by *what it counts*, never by who produced it: the
 * actor (INTELLIGENCE recommends · POLICY authorizes · SYSTEM executes) is
 * attribution beneath the figure, and the two ends are money — what is at
 * risk, and what came back. So an actor, a metric and an outcome can't be
 * mistaken for one another.
 *
 * The middle of the chain is not a funnel of arbitrary KPIs. Each recommendation
 * receives exactly one policy decision (the audit log writes DECISION_CREATED or
 * ACTION_BLOCKED for it), so the policy stage *divides* the recommendations —
 * 539 + 161 = 700 — and says so with a partition bar. Execution is separate: an
 * authorized action is cleared to run, and runs only when it is executed from
 * Interventions, so "actions run" is deliberately not derived from "authorized".
 *
 * Figures are real: audit-event counts from `counts_by_type` (taken before any
 * limit, so they cover the whole log) and pipeline money from the analytics
 * endpoint. There are no trend percentages — the backend keeps no history. A
 * figure that isn't loaded reads "—".
 */
export const AuditHero: React.FC<Props> = ({ kpis, money, loading }) => {
  const pending = loading && !kpis;
  const n = (v: number | undefined) => (kpis && v != null ? formatCount(v) : '—');

  return (
    <section className="rv-surface">
      <div className="flex flex-col gap-5 px-5 pb-5 pt-5 lg:flex-row lg:items-end lg:justify-between lg:px-6">
        <div className="max-w-[660px]">
          <div className="rv-label">Audit trail</div>
          <h1 className="mt-2 text-[26px] font-semibold leading-[1.12] tracking-tight text-text-primary sm:text-[30px]">
            Every recovery decision, accounted for.
          </h1>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-text-secondary">
            What happened, what REVORA recommended, what the rules allowed, what ran, and what came back — recorded as it happened.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
            <LayerTag layer="intelligence" verb />
            <span aria-hidden className="hidden h-px w-4 bg-border-strong sm:block" />
            <LayerTag layer="policy" verb />
          </div>
          <div className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-text-muted lg:text-right">
            AI for intelligence. Rules for control.
          </div>
        </div>
      </div>

      <div className="mx-5 border-t border-border-divider py-5 lg:mx-6">
        <div className="rv-story">
          <ol className="rv-story-flow" aria-label="Recovery flow, from revenue at risk to recovered revenue">
            <Stage
              marker={<FinancialTick state="at_risk" />}
              label={FINANCIAL_STATES.at_risk.label}
              pending={pending}
              figure={money ? <MoneyCountUp value={money.atRisk} compact size="lg" /> : <Dash />}
              note="Detected across scanned revenue"
            />
            <StoryLink />
            <Stage
              layer="intelligence"
              label="Recommendations"
              pending={pending}
              figure={<Count>{n(kpis?.decisions)}</Count>}
              note="Best-value action proposed for each case"
            />
            <StoryLink />
            <Stage
              layer="policy"
              label="Policy decisions"
              pending={pending}
              figure={
                <>
                  <div className="rv-story-split">
                    <div className="rv-story-count">
                      <Count>{n(kpis?.authorized)}</Count>
                      <StateIndicator label="authorized" kind="policy" tone="success" />
                    </div>
                    <div className="rv-story-count">
                      <Count>{n(kpis?.blocked)}</Count>
                      <StateIndicator label="stopped" kind="block" tone="risk" />
                    </div>
                  </div>
                  {kpis && (
                    <SplitBar
                      parts={[
                        { key: 'authorized', value: kpis.authorized, tone: 'success', label: `${formatCount(kpis.authorized)} authorized` },
                        { key: 'stopped', value: kpis.blocked, tone: 'risk', label: `${formatCount(kpis.blocked)} stopped` },
                      ]}
                    />
                  )}
                </>
              }
              note="Every recommendation checked against Recovery Controls"
            />
            <StoryLink />
            <Stage
              layer="system"
              label="Actions run"
              pending={pending}
              figure={<Count>{n(kpis?.actions)}</Count>}
              note="Executed so far · simulated provider"
            />
            <StoryLink />
            <Stage
              marker={<FinancialTick state="recovered" />}
              label={FINANCIAL_STATES.recovered.label}
              pending={pending}
              figure={money ? <MoneyCountUp value={money.recovered} compact size="lg" /> : <Dash />}
              note={outcomeNote(kpis)}
            />
          </ol>
        </div>

        {kpis && kpis.authorized > kpis.actions && (
          <p className="rv-meta mt-4 max-w-[62ch] leading-relaxed">
            Authorized means cleared to run — it doesn&apos;t mean it has run. Actions are executed from{' '}
            <Link href="/interventions" className="font-medium text-primary-300 transition-colors hover:text-primary-100">
              Interventions
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
};

/** What the measured actions came to — the outcomes divide "actions run", the way decisions divide recommendations. */
function outcomeNote(kpis: AuditKpis | null): string {
  if (!kpis) return 'Measured outcomes';
  const parts: [number, string][] = [
    [kpis.recovered, 'recovered'],
    [kpis.notRecovered, 'not recovered'],
    [kpis.escalated, 'escalated'],
    [kpis.suppressed, 'suppressed'],
  ];
  const shown = parts.filter(([count]) => count > 0).map(([count, label]) => `${formatCount(count)} ${label}`);
  return shown.length > 0 ? shown.join(' · ') : 'No outcomes measured yet';
}

/** The link between two stages: a hairline when the chain runs across, a rail when it runs down. */
const StoryLink: React.FC = () => (
  <li aria-hidden className="rv-story-link">
    <TimelineConnector orientation="horizontal" className="rv-story-h" />
    <TimelineConnector orientation="vertical" className="rv-story-v" />
  </li>
);

const Dash: React.FC = () => <span className="rv-amount rv-amount--lg text-text-muted">—</span>;

const Count: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="rv-amount rv-amount--lg">{children}</span>;

/**
 * One stage: LABEL (what is counted) → FIGURE → what it means. A counted stage
 * names the `layer` that produced it in its note, and wears that layer's
 * silhouette as its marker; a money stage passes its own tick.
 */
const Stage: React.FC<{
  label: string;
  figure: React.ReactNode;
  note: React.ReactNode;
  pending: boolean;
  marker?: React.ReactNode;
  layer?: Layer;
}> = ({ label, figure, note, pending, marker, layer }) => (
  <li className="rv-story-stage" data-layer={layer}>
    <div className="rv-story-head">
      {layer ? <span aria-hidden className="rv-node" data-kind={LAYERS[layer].kind} /> : marker}
      <span className="rv-label truncate">{label}</span>
    </div>
    <div className="rv-story-figure">{pending ? <div className="h-[26px] w-24 animate-pulse rounded bg-border-subtle" /> : figure}</div>
    <div className="rv-story-note">
      {layer && (
        <span className="rv-story-who">
          <span className="rv-story-actor">{LAYERS[layer].label}</span> {LAYERS[layer].verb}
        </span>
      )}
      {note}
    </div>
  </li>
);
