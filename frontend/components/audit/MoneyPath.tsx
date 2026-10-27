import React from 'react';
import { Amount, FinancialTick, StateIndicator, TimelineConnector, type LinkState } from '@/components/grammar';
import { FINANCIAL_STATES, VERDICTS, type FinancialState } from '@/lib/grammar';
import type { OutcomeKind, Verdict } from './auditSignals';

/**
 * One case's money, followed through the recovery process:
 *
 *   ▌ REVENUE AT RISK   ──  POLICY DECISION   ──  ▌ RECOVERED REVENUE
 *     ₹12,400               ■ AUTHORIZED            ₹12,400
 *     Payment failed        Retry payment           Recovery confirmed
 *
 * Not a KPI: it is a single path. The left figure is the transaction's amount,
 * the right figure is where that money ended up according to the audit record,
 * the middle is what the rules decided, and the line after it stops (a cap)
 * where the rules stopped the flow. Nothing here is estimated — an unknown
 * amount renders "—".
 */

interface Props {
  /** The transaction's amount — what was at risk. */
  amount: number | null;
  /** The business event: "Payment failed". */
  eventLabel: string;
  verdict: Verdict;
  /** What the policy verdict did to the action: "Retry payment", "Retry payment stopped"… */
  actionNote: string | null;
  outcome: OutcomeKind;
  executed: boolean;
  /** `outcome.recovered_amount` from the execution event. */
  recoveredAmount: number | null;
}

interface Destination {
  state: FinancialState;
  label: string;
  context: string;
  amount: number | null;
}

function destination(p: Props): Destination {
  switch (p.outcome) {
    case 'recovered':
      return { state: 'recovered', label: 'Recovered', context: 'Recovery confirmed', amount: p.recoveredAmount ?? p.amount };
    case 'not_recovered':
      return { state: 'at_risk', label: 'Still at risk', context: 'The attempt did not recover it', amount: p.amount };
    case 'escalated':
      return { state: 'escalated', label: 'Escalated', context: 'With the merchant team', amount: p.amount };
    case 'suppressed':
      return { state: 'suppressed', label: 'Suppressed', context: 'No automated action', amount: p.amount };
    default:
      if (p.verdict === 'blocked') return { state: 'blocked', label: 'Blocked', context: 'Held by Recovery Controls', amount: p.amount };
      if (p.verdict === 'rerouted') return { state: 'escalated', label: 'Escalated', context: 'Waiting for a person', amount: p.amount };
      if (p.verdict === 'pending') return { state: 'pending', label: 'Pending', context: 'Awaiting a decision', amount: p.amount };
      return { state: 'pending', label: 'Pending', context: 'Authorized, not yet run', amount: p.amount };
  }
}

function Cell({ state, label, amount, context }: { state: FinancialState; label: string; amount: number | null; context: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-start gap-2">
        <FinancialTick state={state} className="mt-px" />
        <span className="rv-label rv-path-label">{label}</span>
      </div>
      {amount != null ? (
        <Amount value={amount} size="lg" compact={amount >= 100000} className="rv-path-amount" />
      ) : (
        <span className="rv-amount rv-amount--lg rv-path-amount text-text-muted">—</span>
      )}
      <div className="text-[11px] leading-snug text-text-muted">{context}</div>
    </div>
  );
}

export function MoneyPath(props: Props) {
  const { amount, eventLabel, verdict, actionNote, executed } = props;
  const dest = destination(props);
  const vmeta = VERDICTS[verdict];

  // The flow reaches the destination only if something actually ran; if the rules stopped it, the line ends in a cap.
  const outLink: LinkState = executed ? 'reached' : verdict === 'blocked' || verdict === 'rerouted' ? 'halted' : 'pending';
  const inLink: LinkState = verdict === 'pending' ? 'pending' : 'reached';

  return (
    <div className="rv-path pt-4">
      <div className="rv-path-grid">
        <Cell state="at_risk" label={FINANCIAL_STATES.at_risk.label} amount={amount} context={eventLabel} />
        <TimelineConnector orientation="horizontal" state={inLink} />
        <div className="flex min-w-0 flex-col items-center gap-2 px-1 text-center">
          <span className="rv-label rv-path-label">Policy decision</span>
          <StateIndicator label={vmeta.label} kind={vmeta.kind} tone={vmeta.tone} />
          {actionNote && <span className="max-w-[9rem] text-[11px] leading-snug text-text-secondary">{actionNote}</span>}
        </div>
        <TimelineConnector orientation="horizontal" state={outLink} tone={outLink === 'halted' ? vmeta.tone : undefined} />
        <Cell state={dest.state} label={dest.label} amount={dest.amount} context={dest.context} />
      </div>
    </div>
  );
}
