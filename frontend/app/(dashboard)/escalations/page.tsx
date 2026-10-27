'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';
import { latestByTransaction } from '@/components/interventions/interventionSignals';
import { EscalationsHero } from '@/components/escalations/EscalationsHero';
import { AttentionKpiRail } from '@/components/escalations/AttentionKpiRail';
import { EscalationToolbar, EscalationTable, StatusCounts } from '@/components/escalations/EscalationQueue';
import { EscalationCasePanel } from '@/components/escalations/EscalationCasePanel';
import {
  EscalationCase,
  ReasonKey,
  StatusFilter,
  buildEscalationCases,
  buildPriorityMap,
  latestDecisionsByTransaction,
  matchesReason,
  matchesSearch,
  matchesStatus,
  reasonKey,
  summarize,
} from '@/components/escalations/escalationSignals';

const ESCALATION_LIMIT = 1000;
const TRANSACTION_LIMIT = 1000;
const INTERVENTION_LIMIT = 1000;

export default function EscalationsPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);

  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [reasonFilter, setReasonFilter] = useState<ReasonKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const inFlight = useRef(false);
  const queueRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const [escRes, txRes, intRes, polRes] = await Promise.all([
        api.getEscalations(ESCALATION_LIMIT),
        api.getTransactions(TRANSACTION_LIMIT),
        api.getInterventions(INTERVENTION_LIMIT),
        api.getPolicies(),
      ]);

      const dedupedDecisions = latestDecisionsByTransaction(escRes.escalations);

      // `/api/transactions` is capped at 1000 records and returned in scan
      // order, not by relevance — a large dataset can leave some escalated
      // transactions outside that window. Anything missing from the bulk
      // fetch gets its own direct lookup so no case ever renders with a
      // blank amount or leak type.
      const bulkTxById = new Map(txRes.map((t) => [t.transaction_id, t]));
      const missingIds = dedupedDecisions
        .map((d) => d.transaction_id)
        .filter((id) => !bulkTxById.has(id));

      if (missingIds.length > 0) {
        const fetched = await Promise.allSettled(missingIds.map((id) => api.getTransactionById(id)));
        fetched.forEach((r) => {
          if (r.status === 'fulfilled') bulkTxById.set(r.value.transaction_id, r.value);
        });
      }

      setDecisions(dedupedDecisions);
      setTransactions(Array.from(bulkTxById.values()));
      setInterventions(latestByTransaction(intRes.interventions));
      setPolicy(polRes.active_policy);
      setErrorMsg(null);
      setHasLoadedOnce(true);
      setLastUpdatedAt(new Date());
    } catch {
      setErrorMsg('Unable to load escalations data.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ── derived, all from loaded records ── */

  const txById = useMemo(() => new Map(transactions.map((t) => [t.transaction_id, t])), [transactions]);
  const interventionByTx = useMemo(() => new Map(interventions.map((i) => [i.transaction_id, i])), [interventions]);

  const cases: EscalationCase[] = useMemo(
    () => buildEscalationCases(decisions, txById, interventionByTx),
    [decisions, txById, interventionByTx]
  );

  // Opens the queue with a real case already in view, matching the
  // approved reference's populated drawer, rather than the empty
  // "Select a case" state. Desktop only: below the 1440px breakpoint the
  // case panel renders as a full-screen overlay (see the CSS-driven
  // inline/overlay split below), so auto-selecting there would pop a
  // modal open over the whole page the instant it loads, before the
  // visitor has seen anything else.
  useEffect(() => {
    if (selectedId == null && cases.length > 0 && window.innerWidth >= 1440) {
      setSelectedId(cases[0].decision.decision_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases]);

  const handleReviewCases = useCallback(() => {
    queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const summary = useMemo(() => summarize(cases, policy), [cases, policy]);
  const priorityByDecision = useMemo(() => buildPriorityMap(cases), [cases]);

  const statusCounts: StatusCounts = useMemo(
    () => ({
      all: cases.length,
      pending: summary.pendingCases,
      routed: summary.routedCases,
    }),
    [cases.length, summary.pendingCases, summary.routedCases]
  );

  const statusFiltered = useMemo(() => cases.filter((c) => matchesStatus(c, status)), [cases, status]);

  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of statusFiltered) {
      const k = reasonKey(c.decision);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [statusFiltered]);

  const filteredCases = useMemo(
    () => statusFiltered.filter((c) => matchesReason(c, reasonFilter) && matchesSearch(c, search)),
    [statusFiltered, reasonFilter, search]
  );

  const selectedCase = useMemo(
    () => cases.find((c) => c.decision.decision_id === selectedId) ?? null,
    [cases, selectedId]
  );
  const selectedPriority = selectedCase ? priorityByDecision.get(selectedCase.decision.decision_id) ?? null : null;

  const filtersActive = reasonFilter !== 'all' || search !== '';
  const clearFilters = useCallback(() => {
    setReasonFilter('all');
    setSearch('');
  }, []);

  const handleStatus = useCallback((next: StatusFilter) => {
    setStatus(next);
    setReasonFilter('all');
  }, []);

  /* ── the real hand-off path: POST /interventions/{id}/execute ── */

  const handleRoute = useCallback(async (c: EscalationCase) => {
    setRouteError(null);
    setRoutingId(c.decision.decision_id);
    try {
      const idempotencyKey = `esc_route_${c.decision.transaction_id}_${Date.now()}`;
      const [result] = await Promise.all([
        api.executeIntervention(c.decision.transaction_id, idempotencyKey),
        new Promise((resolve) => window.setTimeout(resolve, 500)),
      ]);
      setInterventions((prev) => latestByTransaction([result, ...prev]));
    } catch (err: unknown) {
      setRouteError(err instanceof Error ? err.message : 'Could not route this case to the merchant queue.');
    } finally {
      setRoutingId(null);
    }
  }, []);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      <div className="relative">
        <EscalationsHero summary={summary} onReviewCases={handleReviewCases} />
        <div className="absolute right-3 top-3 flex items-center gap-2 z-10">
          {lastUpdatedAt && !loading && (
            <span className="text-[10.5px] font-mono text-text-muted hidden sm:inline">Updated {timeAgo(lastUpdatedAt)}</span>
          )}
          <button
            id="btn-refresh-escalations"
            onClick={() => loadData()}
            disabled={loading}
            aria-label="Refresh escalations"
            className="p-2 rounded-md bg-panel/80 backdrop-blur border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {errorMsg && !hasLoadedOnce ? (
        <div className="bg-panel border border-border-subtle rounded-lg shadow-panel py-16 px-6 text-center">
          <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">Unable to load escalations</p>
          <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
            REVORA couldn&apos;t reach the recovery service. Check that the service is running, then try again.
          </p>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="mt-4 px-4 py-2 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Retrying...' : 'Try again'}
          </button>
        </div>
      ) : (
        <>
          <AttentionKpiRail summary={summary} policy={policy} loading={loading && !hasLoadedOnce} />

          {/* Two-column workspace, same technique as Interventions: which
              panel presentation is visible is decided purely in CSS so
              server and client render the same tree. */}
          <div ref={queueRef} className="grid gap-4 items-start grid-cols-1 min-[1440px]:grid-cols-[minmax(0,1fr)_340px] scroll-mt-6">
            <section className="rounded-lg border border-border-subtle bg-panel overflow-hidden min-w-0">
              <EscalationToolbar
                status={status}
                onStatus={handleStatus}
                counts={statusCounts}
                search={search}
                onSearch={setSearch}
                reasonFilter={reasonFilter}
                onReasonFilter={setReasonFilter}
                reasonCounts={reasonCounts}
                filtersOpen={filtersOpen}
                onToggleFilters={() => setFiltersOpen((v) => !v)}
              />
              <EscalationTable
                cases={filteredCases}
                loading={loading && !hasLoadedOnce}
                totalLoaded={statusFiltered.length}
                selectedId={selectedId}
                onSelect={(c) => setSelectedId(c.decision.decision_id)}
                priorityByDecision={priorityByDecision}
                filtersActive={filtersActive}
                onClearFilters={clearFilters}
                status={status}
              />
            </section>

            <div className="hidden min-[1440px]:block sticky top-6 min-w-0">
              <EscalationCasePanel
                escCase={selectedCase}
                policy={policy}
                priority={selectedPriority}
                variant="inline"
                onClose={() => setSelectedId(null)}
                onRoute={handleRoute}
                routingId={routingId}
                routeError={routeError}
              />
            </div>
          </div>

          <div className="min-[1440px]:hidden">
            <EscalationCasePanel
              escCase={selectedCase}
              policy={policy}
              priority={selectedPriority}
              variant="overlay"
              onClose={() => setSelectedId(null)}
              onRoute={handleRoute}
              routingId={routingId}
              routeError={routeError}
            />
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
