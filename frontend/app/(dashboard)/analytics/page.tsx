'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, RefreshCw, CircleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { AnalyticsResponse, Intervention, Opportunity, Transaction } from '@/lib/types';
import { OutcomeHero } from '@/components/analytics/OutcomeHero';
import { RecoveryComposition } from '@/components/analytics/RecoveryComposition';
import { RecoveryByAction, RecoveryByLeakType } from '@/components/analytics/RecoveryByDimension';
import { OutcomeInsights } from '@/components/analytics/OutcomeInsights';
import {
  buildActionOutcomes,
  buildLeakOutcomes,
  buildRecoveryComposition,
  buildWhatsWorking,
  buildWhereAttentionRemains,
  computeOutcomeTotals,
  deriveQueue,
  latestByTransaction,
} from '@/components/analytics/analyticsSignals';

const INTERVENTION_LIMIT = 500;
const OPPORTUNITY_LIMIT = 100;
const TRANSACTION_LIMIT = 1000;

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Absorbs React Strict Mode's dev-only double-invoke of the mount effect
  // (same pattern already used by the Interventions page) so exactly one
  // set of requests fires on load.
  const inFlight = useRef(false);

  const loadData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [analyticsRes, oppRes, intRes, txRes] = await Promise.all([
        api.getAnalytics(),
        api.getOpportunities(OPPORTUNITY_LIMIT),
        api.getInterventions(INTERVENTION_LIMIT),
        api.getTransactions(TRANSACTION_LIMIT),
      ]);
      setAnalytics(analyticsRes);
      setOpportunities(oppRes);
      setInterventions(latestByTransaction(intRes.interventions));
      setTransactions(txRes);
      setHasLoadedOnce(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load recovery outcomes: ${msg}`);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ── derived, all from loaded records ── */

  const queue = useMemo(() => deriveQueue(opportunities, interventions), [opportunities, interventions]);
  const txById = useMemo(() => new Map(transactions.map((t) => [t.transaction_id, t])), [transactions]);

  const totals = useMemo(
    () => (analytics ? computeOutcomeTotals(analytics, queue, interventions) : null),
    [analytics, queue, interventions]
  );

  const composition = useMemo(() => (totals ? buildRecoveryComposition(totals) : []), [totals]);
  const actionRows = useMemo(() => buildActionOutcomes(interventions), [interventions]);
  const leakOutcome = useMemo(() => buildLeakOutcomes(interventions, queue, txById), [interventions, queue, txById]);

  const working = useMemo(() => buildWhatsWorking(actionRows, leakOutcome.rows), [actionRows, leakOutcome.rows]);
  const attention = useMemo(() => (totals ? buildWhereAttentionRemains(totals) : []), [totals]);

  const hasData = totals != null && totals.totalAtRisk > 0;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      {/* ── Hero header ── */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          <TrendingUp strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0 mt-1.5" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">
              Revenue Outcome Intelligence
            </div>
            <h1 className="text-[26px] sm:text-[30px] font-semibold text-text-primary tracking-tight leading-tight mt-1">
              Recovery Performance
            </h1>
            <p className="text-[12.5px] text-text-secondary mt-1.5 max-w-xl">
              How much REVORA has actually recovered, what&apos;s working, and where revenue is still at risk.
            </p>
          </div>
        </div>

        <button
          id="btn-refresh-analytics"
          onClick={loadData}
          disabled={loading}
          aria-label="Refresh analytics"
          className="p-2 rounded-md bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {errorMsg && !hasLoadedOnce ? (
        <div className="bg-panel border border-border-subtle rounded-lg shadow-panel py-16 px-6 text-center">
          <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">Unable to load recovery outcomes</p>
          <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
            REVORA couldn&apos;t reach the recovery service. Check that the service is running, then try again.
          </p>
          <button
            onClick={loadData}
            disabled={loading}
            className="mt-4 px-4 py-2 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Retrying...' : 'Try again'}
          </button>
        </div>
      ) : !hasData && hasLoadedOnce ? (
        <div className="bg-panel border border-border-subtle rounded-lg shadow-panel py-16 px-6 text-center">
          <TrendingUp strokeWidth={1.5} className="w-10 h-10 text-text-muted/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">No revenue has been scanned yet</p>
          <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
            Run a scan from Revenue Command or the header&apos;s Scan control, then return here to see real recovery
            outcomes.
          </p>
        </div>
      ) : !hasLoadedOnce ? (
        <div className="bg-panel border border-border-subtle rounded-lg shadow-panel py-16 px-6 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-primary-500/50 mx-auto mb-3" />
          <p className="text-xs text-text-muted">Loading recovery outcomes...</p>
        </div>
      ) : (
        totals && (
          <>
            <OutcomeHero totals={totals} />

            <RecoveryComposition segments={composition} totalAtRisk={totals.totalAtRisk} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RecoveryByAction rows={actionRows} />
              <RecoveryByLeakType rows={leakOutcome.rows} unclassifiedRecoveredAmount={leakOutcome.unclassifiedRecoveredAmount} />
            </div>

            <OutcomeInsights working={working} attention={attention} />
          </>
        )
      )}
    </div>
  );
}
