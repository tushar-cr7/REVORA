'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Crosshair, RefreshCw, CircleAlert, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Intervention, Opportunity } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { actionLabel } from '@/lib/actionMeta';
import { ActionStream, ExecutingItem } from '@/components/interventions/ActionStream';
import { InterventionLedger, Row } from '@/components/interventions/InterventionLedger';
import { InterventionDetail } from '@/components/interventions/InterventionDetail';
import { actionIcon } from '@/components/interventions/actionIcons';
import {
  ACTION_KEYS,
  ActionKey,
  AttentionItem,
  StatusFilter,
  deriveQueue,
  latestByTransaction,
  matchesAction,
  matchesSearch,
  matchesStatus,
  needsAttentionItems,
  summarize,
} from '@/components/interventions/interventionSignals';

const OPPORTUNITY_LIMIT = 100;
const INTERVENTION_LIMIT = 200;

export default function InterventionsPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executingItem, setExecutingItem] = useState<ExecutingItem | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState<ActionKey | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [oppRes, intRes] = await Promise.all([
        api.getOpportunities(OPPORTUNITY_LIMIT),
        api.getInterventions(INTERVENTION_LIMIT),
      ]);
      setOpportunities(oppRes);
      setInterventions(latestByTransaction(intRes.interventions));
      setHasLoadedOnce(true);
    } catch {
      setErrorMsg('Unable to load recovery operations data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const queue = useMemo(() => deriveQueue(opportunities, interventions), [opportunities, interventions]);

  const rows: Row[] = useMemo(() => {
    const queuedRows: Row[] = queue.map((opp) => ({ kind: 'queued', id: opp.transaction_id, opp }));
    const completedRows: Row[] = [...interventions]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .map((itv) => ({ kind: 'completed', id: itv.transaction_id, itv }));
    return [...queuedRows, ...completedRows];
  }, [queue, interventions]);

  const availableActions = useMemo(() => {
    const present = new Set(rows.map((r) => (r.kind === 'queued' ? r.opp.recommended_action : r.itv.final_action)));
    return ACTION_KEYS.filter((a) => present.has(a));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        const action = r.kind === 'queued' ? r.opp.recommended_action : r.itv.final_action;
        const customerId = r.kind === 'queued' ? r.opp.customer_id : r.itv.customer_id;
        const policyAllowed = r.kind === 'queued' ? r.opp.policy_allowed : r.itv.policy_allowed;
        return (
          matchesAction(action, actionFilter) &&
          matchesStatus({ kind: r.kind, policyAllowed }, statusFilter) &&
          matchesSearch(r.id, customerId, search)
        );
      }),
    [rows, actionFilter, statusFilter, search]
  );

  const summary = useMemo(() => summarize(queue, interventions), [queue, interventions]);
  const attentionItems = useMemo(() => needsAttentionItems(queue, interventions), [queue, interventions]);
  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const filtersActive = actionFilter !== 'all' || statusFilter !== 'all' || search !== '';
  const clearFilters = useCallback(() => {
    setActionFilter('all');
    setStatusFilter('all');
    setSearch('');
  }, []);

  const handleExecute = useCallback(async (opp: Opportunity) => {
    setExecError(null);
    setExecutingItem({
      transactionId: opp.transaction_id,
      action: opp.recommended_action,
      amount: opp.amount,
      leakType: opp.leak_type,
    });
    try {
      const idempotencyKey = `itv_exec_${opp.transaction_id}_${Date.now()}`;
      // The result below is always the real API response — this floor only
      // holds the "Executing" state on screen long enough to be perceptible
      // (the local backend can resolve in under 20ms), so the operational
      // moment in section 16 is actually visible rather than flickering.
      const [result] = await Promise.all([
        api.executeIntervention(opp.transaction_id, idempotencyKey),
        new Promise((resolve) => window.setTimeout(resolve, 550)),
      ]);
      setInterventions((prev) => latestByTransaction([result, ...prev]));
      setJustCompletedId(result.transaction_id);
      window.setTimeout(() => setJustCompletedId(null), 1000);
    } catch (err: unknown) {
      setExecError(err instanceof Error ? err.message : 'Recovery action could not be completed.');
    } finally {
      setExecutingItem(null);
    }
  }, []);

  const handleSelectRow = useCallback((row: Row) => setSelectedId(row.id), []);
  const handleSelectAttention = useCallback((item: AttentionItem) => {
    setSelectedId(item.kind === 'queued' ? item.opp.transaction_id : item.itv.transaction_id);
  }, []);

  const showOperationalUI = hasLoadedOnce && (queue.length > 0 || interventions.length > 0);
  const connectivity: 'online' | 'syncing' | 'offline' = errorMsg ? 'offline' : !hasLoadedOnce ? 'syncing' : 'online';

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Crosshair strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-semibold text-text-primary tracking-tight">Interventions</h2>
              <ConnectivityBadge state={connectivity} />
            </div>
            <p className="text-xs text-text-muted mt-0.5">Control and monitor revenue recovery actions.</p>
          </div>
        </div>
        <button
          id="btn-refresh-interventions"
          onClick={loadData}
          disabled={loading}
          aria-label="Refresh interventions"
          className="p-2 rounded-sm bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {errorMsg ? (
        <div className="bg-panel border border-border-subtle rounded-md shadow-panel py-16 px-6 text-center">
          <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">Unable to load recovery operations</p>
          <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
            REVORA couldn&apos;t reach the recovery service. Check that the service is running, then try again.
          </p>
          <button
            onClick={loadData}
            disabled={loading}
            className="mt-4 px-4 py-2 rounded-sm bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Retrying...' : 'Try again'}
          </button>
        </div>
      ) : (
        <>
          {showOperationalUI && (
            <>
              {/* Operational summary rail */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-border-subtle border border-border-subtle rounded-md overflow-hidden">
                <SummaryCell label="Revenue Recovered" value={formatINR(summary.recoveredAmount, true)} tone="success" />
                <SummaryCell label="Completed Today" value={summary.completedToday.toLocaleString()} />
                <SummaryCell label="Queued" value={summary.queued.toLocaleString()} tone="primary" />
                <SummaryCell label="Blocked" value={summary.blocked.toLocaleString()} tone={summary.blocked > 0 ? 'warning' : undefined} />
                <SummaryCell
                  label="Needs Attention"
                  value={summary.needsAttention.toLocaleString()}
                  tone={summary.needsAttention > 0 ? 'warning' : undefined}
                />
              </div>

              {/* Signature visual: the recovery action stream */}
              <ActionStream ready={queue} completed={interventions} executing={executingItem} justCompletedId={justCompletedId} />

              {/* Needs attention */}
              {attentionItems.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-warning-300 mb-2">Needs attention</h3>
                  <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                    {attentionItems.map((it) => (
                      <AttentionCard
                        key={it.kind === 'queued' ? it.opp.transaction_id : it.itv.intervention_id}
                        item={it}
                        onClick={() => handleSelectAttention(it)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Filters */}
          {(showOperationalUI || filtersActive) && (
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <input
                    id="input-intervention-search"
                    type="text"
                    placeholder="Search by Transaction ID, Customer ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-panel border border-border-strong rounded-sm text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-500/60 font-mono"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
                  <Chip label="Queued" active={statusFilter === 'queued'} onClick={() => setStatusFilter((s) => (s === 'queued' ? 'all' : 'queued'))} />
                  <Chip label="Completed" active={statusFilter === 'completed'} onClick={() => setStatusFilter((s) => (s === 'completed' ? 'all' : 'completed'))} />
                  <Chip label="Blocked" active={statusFilter === 'blocked'} onClick={() => setStatusFilter((s) => (s === 'blocked' ? 'all' : 'blocked'))} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip label="All Actions" active={actionFilter === 'all'} onClick={() => setActionFilter('all')} />
                {availableActions.map((a) => (
                  <Chip key={a} label={actionLabel(a)} active={actionFilter === a} onClick={() => setActionFilter((f) => (f === a ? 'all' : a))} />
                ))}
              </div>
            </div>
          )}

          <InterventionLedger
            rows={filteredRows}
            loading={loading && !hasLoadedOnce}
            totalLoaded={rows.length}
            selectedId={selectedId}
            onSelect={handleSelectRow}
            onExecute={handleExecute}
            executingId={executingItem?.transactionId ?? null}
            onClearFilters={clearFilters}
            filtersActive={filtersActive}
          />
        </>
      )}

      {selectedRow && (
        <InterventionDetail
          row={selectedRow}
          onClose={() => setSelectedId(null)}
          onExecute={handleExecute}
          executingId={executingItem?.transactionId ?? null}
          execError={execError}
        />
      )}
    </div>
  );
}

const ConnectivityBadge: React.FC<{ state: 'online' | 'syncing' | 'offline' }> = ({ state }) => {
  if (state === 'offline') return null;
  if (state === 'syncing') {
    return <span className="text-[10px] font-mono text-text-muted tracking-wide">SYNCING</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-500" />
      </span>
      <span className="text-success-500 text-[10px] font-mono font-medium tracking-wide">RECOVERY CONTROLS ONLINE</span>
    </div>
  );
};

const SummaryCell: React.FC<{ label: string; value: string; tone?: 'primary' | 'success' | 'warning' }> = ({ label, value, tone }) => {
  const toneCls =
    tone === 'primary' ? 'text-primary-300' : tone === 'success' ? 'text-success-300' : tone === 'warning' ? 'text-warning-300' : 'text-text-primary';
  return (
    <div className="bg-panel px-4 py-2 leading-tight">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
};

const Chip: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
      active
        ? 'bg-panel-raised border-border-strong text-text-primary'
        : 'bg-transparent border-border-subtle text-text-muted hover:text-text-secondary hover:border-border-strong'
    }`}
  >
    {label}
  </button>
);

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

const AttentionCard: React.FC<{ item: AttentionItem; onClick: () => void }> = ({ item, onClick }) => {
  const action = item.kind === 'queued' ? item.opp.recommended_action : item.itv.final_action;
  const Icon = actionIcon(action);
  const amount = item.kind === 'queued' ? item.opp.amount : item.itv.amount;
  const leakType = item.kind === 'queued' ? item.opp.leak_type : undefined;
  const reason =
    item.kind === 'queued'
      ? item.opp.policy_reason
      : item.itv.status === 'escalated_to_merchant'
      ? 'Escalated to merchant'
      : 'No recovery on this attempt';

  return (
    <button
      onClick={onClick}
      className="shrink-0 w-[220px] text-left rounded-md border border-warning-500/25 bg-warning-muted/15 hover:bg-warning-muted/25 px-3 py-2.5 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-warning-300 shrink-0" />
        <span className="text-[11.5px] font-medium text-text-primary truncate">{actionLabel(action)}</span>
        <span className="ml-auto font-mono text-[11.5px] font-semibold text-text-primary tabular-nums shrink-0">
          {formatINR(amount)}
        </span>
      </div>
      {leakType && <div className="text-[10px] text-text-muted mt-1">{LEAK_LABEL[leakType] ?? leakType}</div>}
      <div className="text-[10.5px] text-warning-300/90 mt-1 leading-snug line-clamp-2">{reason}</div>
    </button>
  );
};
