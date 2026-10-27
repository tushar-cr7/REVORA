import React from 'react';
import {
  Amount,
  DecisionState,
  EventRow,
  FinancialMetric,
  FinancialStateTag,
  LayerBlock,
  LayerTag,
  MetadataLine,
  MonetaryDelta,
  OutcomeIndicator,
  PolicyBoundary,
  RecoveryFlow,
  RetryCount,
  StateIndicator,
  TemporalToken,
  Timeline,
  Timestamp,
  type TimelineEntry,
} from '@/components/grammar';
import {
  FINANCIAL_STATES,
  LAYERS,
  OUTCOMES,
  RECOVERY_STAGES,
  VERDICTS,
  decisionVerdict,
  recoveryStageStates,
  type FinancialState,
  type Layer,
  type OutcomeKey,
  type RecoveryStageData,
  type Verdict,
} from '@/lib/grammar';

/**
 * Visual grammar reference. Not linked from the navigation.
 *
 * Every value on this page is a SPECIMEN — it exists to show how the primitives
 * look in each state, and is not live REVORA data. Verdicts and flow states are
 * derived by the same helpers the product uses (`decisionVerdict`,
 * `recoveryStageStates`), fed with made-up records.
 */

function Section({
  title,
  question,
  children,
}: {
  title: string;
  /** The question this part of the grammar answers. */
  question: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <div className="rv-label-rule">
          <span className="rv-label">{title}</span>
        </div>
        <p className="rv-subtitle">{question}</p>
      </div>
      {children}
    </section>
  );
}

const MONEY_STATES: FinancialState[] = [
  'at_risk', 'potential', 'recovered', 'blocked', 'failed', 'pending', 'suppressed', 'escalated',
];

const SECONDARY_METRICS: Array<{ state: FinancialState; amount: number; context: string }> = [
  { state: 'potential', amount: 148000, context: '62 opportunities' },
  { state: 'recovered', amount: 31400, context: 'Confirmed' },
  { state: 'blocked', amount: 18200, context: '3 cases' },
  { state: 'escalated', amount: 46000, context: '1 invoice' },
];

const LAYER_ORDER: Layer[] = ['intelligence', 'policy', 'system', 'human'];
const OUTCOME_ORDER: OutcomeKey[] = ['recovered', 'not_recovered', 'suppressed', 'escalated', 'pending'];
const VERDICT_ORDER: Verdict[] = ['authorized', 'rerouted', 'downgraded', 'blocked', 'pending'];

/* Specimen records, shaped like the real ones, fed to the real derivation helpers. */
const AUTHORIZED = { policy_allowed: true, final_action: 'retry' };
const BLOCKED = { policy_allowed: false, final_action: 'suppress' };
const REROUTED = { policy_allowed: false, final_action: 'escalate' };

function flow(
  decision: { policy_allowed: boolean; final_action: string } | null,
  intervention: { status: 'recovered' | 'attempted_no_recovery' | 'suppressed' | 'escalated_to_merchant' } | null,
  values: Partial<Record<(typeof RECOVERY_STAGES)[number]['key'], React.ReactNode>>,
): RecoveryStageData[] {
  const states = recoveryStageStates({ decision, intervention });
  return RECOVERY_STAGES.map((def) => ({ ...def, state: states[def.key], value: values[def.key] }));
}

const CHRONOLOGY: TimelineEntry[] = [
  {
    id: 'e1', kind: 'event', time: <Timestamp iso="2026-10-04T14:32:08" />,
    title: 'PAYMENT_FAILED',
    detail: 'Card declined by the issuer',
    meta: [{ value: 'TXN_8F29A1', mono: true }, { label: 'Value', value: '₹12,400', mono: true }],
  },
  {
    id: 'e2', kind: 'signal', time: <Timestamp iso="2026-10-04T14:32:08" />,
    title: 'Diagnosed as a failed payment',
    detail: 'Returning customer, 6 prior successful payments',
  },
  {
    id: 'e3', kind: 'decision', time: <Timestamp iso="2026-10-04T14:32:09" />,
    title: 'REVORA recommends a retry',
    meta: [{ label: 'Layer', value: 'Intelligence' }],
  },
  {
    id: 'e4', kind: 'policy', tone: 'success', time: <Timestamp iso="2026-10-04T14:32:09" />,
    title: 'Retry authorized',
    detail: 'Within retry limit and value ceiling',
    meta: [{ label: 'Policy', value: 'P-02', mono: true }, { value: <RetryCount used={0} max={2} /> }],
  },
  {
    id: 'e5', kind: 'action', time: <Timestamp iso="2026-10-04T14:34:41" />,
    title: 'RETRY_ATTEMPTED',
    meta: [{ label: 'Attempt', value: '1 / 2', mono: true }],
  },
  {
    id: 'e6', kind: 'outcome', tone: 'success', time: <Timestamp iso="2026-10-04T14:34:44" />,
    title: <OutcomeIndicator outcome="recovered" amount={12400} />,
  },
];

export default function GrammarPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-12 p-4 lg:p-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Visual grammar</h2>
        <p className="text-xs text-text-muted">
          How REVORA marks money, events, states, authority and time. Specimen values — not live data.
        </p>
      </div>

      {/* ─────────────── MONEY ─────────────── */}
      <Section title="Money" question="Is this money? A ledger tick marks a sum; the fill says how real it is. Scale follows importance.">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
          <div className="rv-surface-raised p-5">
            <FinancialMetric
              state="at_risk"
              amount={239000}
              compact
              size="xl"
              context="100 transactions"
              secondary="4 risk categories"
            />
          </div>
          <div className="rv-surface grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4">
            {SECONDARY_METRICS.map((m) => (
              <FinancialMetric key={m.state} state={m.state} amount={m.amount} compact size="md" context={m.context} />
            ))}
          </div>
        </div>

        <div className="rv-surface grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4">
          {MONEY_STATES.map((s) => (
            <div key={s} className="space-y-2">
              <FinancialStateTag state={s} />
              <p className="text-[11px] leading-snug text-text-muted">{FINANCIAL_STATES[s].meaning}</p>
            </div>
          ))}
        </div>

        <div className="rv-surface flex flex-wrap items-baseline gap-x-8 gap-y-3 p-5">
          <Amount value={239000} compact size="xl" />
          <Amount value={239000} compact size="lg" />
          <Amount value={12400} size="md" />
          <Amount value={12400} size="sm" />
          <Amount value={12400} size="xs" />
          <span className="h-4 w-px self-center bg-border-strong" />
          <MonetaryDelta value={31400} />
          <MonetaryDelta value={-12400} />
          <MonetaryDelta value={0} />
        </div>
      </Section>

      {/* ─────────────── EVENTS ─────────────── */}
      <Section title="Events" question="What happened, when, to what, and where does it stand? Type · subject · time · amount · state.">
        <div className="rv-surface overflow-hidden p-0">
          <EventRow type="PAYMENT_FAILED" entity="TXN_8F29A1" timestamp="2026-10-04T14:32:08" amount={12400}
            reason="Card declined by the issuer" status={{ label: 'Diagnosed', tone: 'system' }} />
          <EventRow type="CHECKOUT_ABANDONED" entity="TXN_2C71D4" timestamp="2026-10-04T14:36:51" amount={4800}
            status={{ label: 'Detected', tone: 'neutral' }} />
          <EventRow type="DECISION_CREATED" entity="TXN_8F29A1" timestamp="2026-10-04T14:32:09" actor="intelligence"
            reason="A retry looks viable for this customer" status={{ label: 'Recommended', kind: 'decision' }} />
          <EventRow type="ACTION_AUTHORIZED" entity="TXN_8F29A1" timestamp="2026-10-04T14:32:09" actor="policy"
            reason="Within retry limit and value ceiling" status={{ label: 'Authorized', kind: 'policy', tone: 'success' }} />
          <EventRow type="RETRY_ATTEMPTED" entity="TXN_8F29A1" timestamp="2026-10-04T14:34:41" actor="system"
            amount={12400} status={{ label: 'Executed', kind: 'action' }} />
          <EventRow type="RECOVERY_CONFIRMED" entity="TXN_8F29A1" timestamp="2026-10-04T14:34:44" amount={12400}
            status={{ label: 'Recovered', kind: 'outcome', tone: 'success' }} />
          <EventRow type="ACTION_BLOCKED" entity="TXN_51B0E7" timestamp="2026-10-04T14:41:02" actor="policy" amount={9300}
            reason="Retry limit reached (2 of 2)" status={{ label: 'Blocked', kind: 'block' }} />
          <EventRow type="ESCALATION_CREATED" entity="INV_90E3C2" timestamp="2026-10-04T14:41:03" actor="human" amount={46000}
            reason="Invoice is past the escalation age" status={{ label: 'Needs review', kind: 'escalation' }} />
          <EventRow type="ACTION_SUPPRESSED" entity="TXN_7D14A9" timestamp="2026-10-04T14:43:15" amount={1200}
            status={{ label: 'Suppressed', tone: 'neutral' }} />
          <EventRow type="SUBSCRIPTION_FAILED" entity="SUB_0A44F1" timestamp="2026-10-04T14:44:30" amount={2900} selected
            status={{ label: 'Detected', tone: 'neutral' }} />
        </div>
      </Section>

      {/* ─────────────── AUTHORITY ─────────────── */}
      <Section title="Intelligence · Policy · System · Human" question="Who is acting? AI recommends; rules authorize. Recessed means advisory, raised means binding.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LAYER_ORDER.map((layer) => (
            <div key={layer} className="rv-surface space-y-2.5 p-4">
              <LayerTag layer={layer} verb />
              <p className="text-[12px] leading-snug text-text-secondary">{LAYERS[layer].meaning}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <LayerBlock layer="intelligence" title="Retry payment" detail="A retry looks viable for this customer." />
          <LayerBlock layer="policy" verdict="authorized" title="Retry permitted" detail="Within retry limit and value ceiling."
            status={<StateIndicator label="Authorized" kind="policy" tone="success" />} />
        </div>

        <div className="space-y-2.5">
          {VERDICT_ORDER.map((v) => (
            <PolicyBoundary key={v} verdict={v} />
          ))}
        </div>
      </Section>

      {/* ─────────────── DECISION RECORDS ─────────────── */}
      <Section title="Decision records" question="Recommendation is not authorization. The boundary shows what rules did with what intelligence proposed.">
        <div className="grid gap-6 lg:grid-cols-3">
          <DecisionState
            verdict={decisionVerdict(AUTHORIZED)}
            recommendation={{
              title: 'Retry payment',
              detail: 'A retry looks viable for this customer.',
              meta: [{ label: 'Value', value: '₹12,400', mono: true }],
            }}
            policy={{
              reason: 'Within retry limit and value ceiling.',
              meta: [{ label: 'Policy', value: 'P-02', mono: true }],
            }}
            action={{
              title: 'Retry attempted',
              meta: [{ value: <Timestamp iso="2026-10-04T14:34:41" />, mono: true }],
              status: <OutcomeIndicator outcome="recovered" amount={12400} />,
            }}
          />
          <DecisionState
            verdict={decisionVerdict(BLOCKED)}
            recommendation={{
              title: 'Retry payment',
              detail: 'A retry looks viable, but it has already been tried twice.',
              meta: [{ label: 'Value', value: '₹9,300', mono: true }],
            }}
            policy={{
              reason: 'Retry limit reached.',
              meta: [{ label: 'Policy', value: 'P-01', mono: true }, { value: <RetryCount used={2} max={2} /> }],
            }}
          />
          <DecisionState
            verdict={decisionVerdict(REROUTED)}
            recommendation={{
              title: 'Send a reminder',
              detail: 'A reminder would normally be sent.',
              meta: [{ label: 'Value', value: '₹46,000', mono: true }],
            }}
            policy={{
              reason: 'The invoice is past the escalation age, so a person takes over.',
              meta: [{ label: 'Policy', value: 'P-06', mono: true }, { value: <TemporalToken label="Escalated after" value="30 days" tone="warning" /> }],
            }}
          />
        </div>
      </Section>

      {/* ─────────────── RECOVERY FLOW ─────────────── */}
      <Section title="Recovery flow" question="Detect → Diagnose → Decide → Act → Outcome. A solid line was reached; a dashed one was not; a cap means the flow stopped at the boundary.">
        <div className="rv-surface divide-y divide-border-divider">
          {[
            {
              name: 'Recovered',
              stages: flow(AUTHORIZED, { status: 'recovered' }, {
                detect: '14:32:08', decide: 'Retry', act: '14:34:41', outcome: <MonetaryDelta value={12400} />,
              }),
              verdict: decisionVerdict(AUTHORIZED),
            },
            {
              name: 'Stopped by policy',
              stages: flow(BLOCKED, null, { detect: '14:41:02', decide: 'Retry' }),
              verdict: decisionVerdict(BLOCKED),
            },
            {
              name: 'Waiting for a person',
              stages: flow(REROUTED, null, { detect: '14:41:03', decide: 'Reminder' }),
              verdict: decisionVerdict(REROUTED),
            },
            {
              name: 'Just detected',
              stages: flow(null, null, { detect: '14:44:30' }),
              verdict: 'pending' as Verdict,
            },
          ].map((row) => (
            <div key={row.name} className="grid gap-3 p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
              <span className="rv-label pt-0.5">{row.name}</span>
              <RecoveryFlow stages={row.stages} gate={{ verdict: row.verdict }} />
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rv-surface p-5">
            <div className="rv-label mb-4">Chronology</div>
            <Timeline items={CHRONOLOGY} />
          </div>
          <div className="rv-surface p-5">
            <div className="rv-label mb-4">Vertical flow</div>
            <RecoveryFlow
              orientation="vertical"
              gate={{ verdict: 'blocked' }}
              stages={flow(BLOCKED, null, { detect: '₹9,300 at risk', decide: 'Retry payment' })}
            />
          </div>
        </div>
      </Section>

      {/* ─────────────── STATE + OUTCOME ─────────────── */}
      <Section title="State and outcome" question="What is it in right now? Colour carries the state and nothing else.">
        <div className="rv-surface space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <StateIndicator label="Neutral" tone="neutral" />
            <StateIndicator label="System active" tone="system" />
            <StateIndicator label="Intelligence" tone="ai" />
            <StateIndicator label="Recovered" tone="success" />
            <StateIndicator label="Blocked" tone="risk" />
            <StateIndicator label="Needs attention" tone="warning" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StateIndicator chip label="Diagnosed" tone="system" />
            <StateIndicator chip label="Recommended" kind="decision" />
            <StateIndicator chip label="Authorized" kind="policy" tone="success" />
            <StateIndicator chip label="Blocked" kind="block" />
            <StateIndicator chip label="Escalated" kind="escalation" />
          </div>
          <div className="space-y-2.5 border-t border-border-divider pt-4">
            {OUTCOME_ORDER.map((o) => (
              <div key={o} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <OutcomeIndicator outcome={o} amount={o === 'recovered' ? 31400 : undefined} />
                <span className="text-[11px] text-text-muted">{OUTCOMES[o].label}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ─────────────── TIME ─────────────── */}
      <Section title="Time" question="What happened, when, and what came next. Mono for clocks, IDs and system values only.">
        <div className="rv-surface space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Timestamp iso="2026-10-04T14:32:08" />
            <Timestamp iso="2026-10-04T14:32:08" format="date" />
            <Timestamp iso={new Date(Date.now() - 4 * 60 * 1000).toISOString()} relative />
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <RetryCount used={0} max={2} />
            <RetryCount used={1} max={2} />
            <RetryCount used={2} max={2} />
            <TemporalToken label="Cooldown" value="04:12:31" tone="warning" />
            <TemporalToken label="Escalated after" value="30 days" />
            <TemporalToken label="Elapsed" value="02:41:09" />
          </div>
          <MetadataLine
            items={[
              { value: 'TXN_8F29A1', mono: true },
              { label: 'Policy', value: 'P-02', mono: true },
              { label: 'Event', value: <Timestamp iso="2026-10-04T14:32:08" />, mono: true },
              { label: 'Provider', value: 'Simulation' },
            ]}
          />
        </div>
      </Section>

      <p className="rv-meta pb-6">
        Verdict vocabulary: {VERDICT_ORDER.map((v) => VERDICTS[v].label).join(' · ')}.
      </p>
    </div>
  );
}
