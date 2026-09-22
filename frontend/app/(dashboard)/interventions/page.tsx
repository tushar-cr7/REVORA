'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Pause, Play, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Intervention, Opportunity, Transaction } from '@/lib/types';
import { InterventionKpiRail } from '@/components/interventions/InterventionKpiRail';
import { RecoveryJourney } from '@/components/interventions/RecoveryJourney';
import { ActionQueueTable, QueueToolbar, TabCounts } from '@/components/interventions/ActionQueueTable';
import { InterventionCasePanel, useCaseData } from '@/components/interventions/InterventionCasePanel';
import {
  ActionKey,
  QueueTab,
  Row,
  actionCounts,
  buildCaseJourney,
  buildPriorityMap,
  buildSystemJourney,
  deriveQueue,
  latestByTransaction,
  matchesAction,
  matchesSearch,
  matchesTab,
  needsAttentionItems,
  rowAction,
  rowCustomerId,
  rowLeakId,
  summarize,
} from '@/components/interventions/interventionSignals';

const OPPORTUNITY_LIMIT = 100;
const INTERVENTION_LIMIT = 200;
const TRANSACTION_LIMIT = 300;
const LIVE_INTERVAL_MS = 15000;

export default function InterventionsPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [live, setLive] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  const [tab, setTab] = useState<QueueTab>('queue');
  const [actionFilter, setActionFilter] = useState<ActionKey | 'all'>('all');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // One in-flight load at a time. This also absorbs React Strict Mode's
  // dev-only double-invoke of the mount effect, so the page issues exactly
  // one set of requests on load rather than two.
  const inFlight = useRef(false);

  const loadData = useCallback(async (quiet = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!quiet) setLoading(true);
    try {
      const [oppRes, intRes, txRes] = await Promise.all([
        api.getOpportunities(OPPORTUNITY_LIMIT),
        api.getInterventions(INTERVENTION_LIMIT),
        api.getTransactions(TRANSACTION_LIMIT),
      ]);
      setOpportunities(oppRes);
      setInterventions(latestByTransaction(intRes.interventions));
      setTransactions(txRes);
      setErrorMsg(null);
      setHasLoadedOnce(true);
      setLastUpdatedAt(new Date());
    } catch {
      if (!quiet) setErrorMsg('Unable to load recovery operations data.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => loadData(true), LIVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [live, loadData]);

  /* ── derived, all from loaded records ── */

  const queue = useMemo(() => deriveQueue(opportunities, interventions), [opportunities, interventions]);
  const summary = useMemo(
    () => summarize(opportunities, queue, interventions, executingId != null),
    [opportunities, queue, interventions, executingId]
  );
  const priorityByTx = useMemo(() => buildPriorityMap(opportunities), [opportunities]);
  const txById = useMemo(() => new Map(transactions.map((t) => [t.transaction_id, t])), [transactions]);

  const rows: Row[] = useMemo(() => {
    const queued: Row[] = queue.map((opp) => ({ kind: 'queued', id: opp.transaction_id, opp }));
    const completed: Row[] = [...interventions]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .map((itv) => ({ kind: 'completed', id: itv.transaction_id, itv }));
    return [...queued, ...completed];
  }, [queue, interventions]);

  const tabCounts: TabCounts = useMemo(
    () => ({
      queue: queue.length,
      in_progress: executingId ? 1 : 0,
      completed: interventions.length,
      attention: needsAttentionItems(queue, interventions).length,
    }),
    [queue, interventions, executingId]
  );

  const tabRows = useMemo(() => rows.filter((r) => matchesTab(r, tab, executingId)), [rows, tab, executingId]);

  const actionCountsByKey = useMemo(
    () => actionCounts(tabRows.map((r) => ({ action: rowAction(r) }))),
    [tabRows]
  );

  const filteredRows = useMemo(
    () =>
      tabRows.filter(
        (r) => matchesAction(rowAction(r), actionFilter) && matchesSearch(r.id, rowCustomerId(r), search)
      ),
    [tabRows, actionFilter, search]
  );

  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  // Fetched once here, then shared by both panel presentations below.
  const caseData = useCaseData(selectedRow?.id ?? null, selectedRow ? rowLeakId(selectedRow) : null);

  const journey = useMemo(() => {
    if (selectedRow) {
      // The open case's own fetched transaction comes first: `txById` only
      // holds the first TRANSACTION_LIMIT records, and `/opportunities`
      // ranks by expected recovery, so a high-value case can easily sit
      // outside that window — which used to leave the journey's first
      // stage showing "—" instead of the real leak type.
      const tx = caseData.tx ?? txById.get(selectedRow.id) ?? null;
      return buildCaseJourney(selectedRow, selectedRow.id === executingId, tx);
    }
    return buildSystemJourney(opportunities, queue, interventions, summary);
  }, [selectedRow, executingId, caseData.tx, txById, opportunities, queue, interventions, summary]);

  const filtersActive = actionFilter !== 'all' || search !== '';
  const clearFilters = useCallback(() => {
    setActionFilter('all');
    setSearch('');
  }, []);

  /* ── the real execution path, unchanged ── */

  const handleExecute = useCallback(async (opp: Opportunity) => {
    setExecError(null);
    setExecutingId(opp.transaction_id);
    setSelectedId(opp.transaction_id);
    try {
      const idempotencyKey = `itv_exec_${opp.transaction_id}_${Date.now()}`;
      // The result below is always the real API response — the floor only
      // holds the executing state on screen long enough to be perceptible
      // (the local backend can resolve in under 20ms).
      const [result] = await Promise.all([
        api.executeIntervention(opp.transaction_id, idempotencyKey),
        new Promise((resolve) => window.setTimeout(resolve, 550)),
      ]);
      setInterventions((prev) => latestByTransaction([result, ...prev]));
    } catch (err: unknown) {
      setExecError(err instanceof Error ? err.message : 'Recovery action could not be completed.');
    } finally {
      setExecutingId(null);
    }
  }, []);

  const handleTab = useCallback((next: QueueTab) => {
    setTab(next);
    setActionFilter('all');
  }, []);

  const scopeLabel = selectedRow ? selectedRow.id : `${summary.decided} cases · ${summary.queued} awaiting action`;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      {/* ── Hero header ── */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">Operations</div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold text-text-primary tracking-tight leading-tight mt-1">
            Interventions
          </h1>
          <p className="text-[12.5px] text-text-secondary mt-1.5 max-w-xl">
            From insight to recovery. Monitor, execute and track every revenue recovery action.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <LiveControl
            live={live}
            onToggle={() => setLive((v) => !v)}
            lastUpdatedAt={lastUpdatedAt}
            offline={errorMsg != null}
          />
          <button
            id="btn-refresh-interventions"
            onClick={() => loadData()}
            disabled={loading}
            aria-label="Refresh interventions"
            className="p-2 rounded-md bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {errorMsg && !hasLoadedOnce ? (
        <div className="bg-panel border border-border-subtle rounded-lg shadow-panel py-16 px-6 text-center">
          <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">Unable to load recovery operations</p>
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
          <InterventionKpiRail summary={summary} queue={queue} interventions={interventions} />

          <RecoveryJourney journey={journey} scopeLabel={scopeLabel} />

          {/* ── Workspace ──
              The two-column split and which panel presentation is visible are
              decided purely in CSS. Branching on a JS breakpoint here would
              render a different tree on the server than on the client and
              break hydration. 1440px is where the ledger still has room to
              breathe beside a 340px panel. */}
          <div className="grid gap-4 items-start grid-cols-1 min-[1440px]:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-lg border border-border-subtle bg-panel overflow-hidden min-w-0">
              <QueueToolbar
                tab={tab}
                onTab={handleTab}
                counts={tabCounts}
                search={search}
                onSearch={setSearch}
                actionFilter={actionFilter}
                onActionFilter={setActionFilter}
                actionCountsByKey={actionCountsByKey}
                filtersOpen={filtersOpen}
                onToggleFilters={() => setFiltersOpen((v) => !v)}
              />
              <ActionQueueTable
                rows={filteredRows}
                loading={loading && !hasLoadedOnce}
                totalLoaded={tabRows.length}
                selectedId={selectedId}
                onSelect={(row) => setSelectedId(row.id)}
                onExecute={handleExecute}
                executingId={executingId}
                priorityByTx={priorityByTx}
                txById={txById}
                filtersActive={filtersActive}
                onClearFilters={clearFilters}
                tab={tab}
              />
            </section>

            <div className="hidden min-[1440px]:block sticky top-6 min-w-0">
              <InterventionCasePanel
                row={selectedRow}
                caseData={caseData}
                variant="inline"
                onClose={() => setSelectedId(null)}
                onExecute={handleExecute}
                executingId={executingId}
                execError={execError}
                txById={txById}
              />
            </div>
          </div>

          <div className="min-[1440px]:hidden">
            <InterventionCasePanel
              row={selectedRow}
              caseData={caseData}
              variant="overlay"
              onClose={() => setSelectedId(null)}
              onExecute={handleExecute}
              executingId={executingId}
              execError={execError}
              txById={txById}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Replaces the reference's date-range control. The backend keeps no
 * historical window to filter by — interventions only exist from the moment
 * they're executed in this session, and queued work carries no timestamp of
 * its own — so a "last 7 days" selector would be filtering against data
 * that isn't there. What is real, and useful here, is whether the page is
 * currently following the backend.
 */
const LiveControl: React.FC<{
  live: boolean;
  onToggle: () => void;
  lastUpdatedAt: Date | null;
  offline: boolean;
}> = ({ live, onToggle, lastUpdatedAt, offline }) => {
  const [, forceTick] = useState(0);

  // Keeps the "updated Xs ago" readout honest between refreshes.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 10000);
    return () => window.clearInterval(id);
  }, []);

  const ago = (() => {
    if (!lastUpdatedAt) return null;
    const secs = Math.floor((Date.now() - lastUpdatedAt.getTime()) / 1000);
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  return (
    <button
      onClick={onToggle}
      aria-pressed={live}
      className="flex items-center gap-2 pl-2.5 pr-3 py-2 rounded-md bg-panel border border-border-strong hover:border-border-strong/80 transition-colors group"
    >
      {offline ? (
        <span className="w-1.5 h-1.5 rounded-full bg-risk-500 shrink-0" />
      ) : live ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-500" />
        </span>
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-text-disabled shrink-0" />
      )}

      <span className="text-left leading-tight">
        <span
          className={`block text-[10px] font-mono uppercase tracking-wider ${
            offline ? 'text-risk-300' : live ? 'text-success-300' : 'text-text-muted'
          }`}
        >
          {offline ? 'Offline' : live ? 'Live' : 'Paused'}
        </span>
        {ago && <span className="block text-[9.5px] text-text-muted">Updated {ago}</span>}
      </span>

      {live ? (
        <Pause className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors shrink-0" />
      ) : (
        <Play className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors shrink-0" />
      )}
    </button>
  );
};
