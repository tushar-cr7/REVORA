'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Rows3, Search, RefreshCw, CircleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { Transaction } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { TransactionDrawer } from '@/components/drawer/TransactionDrawer';
import { TransactionLedger } from '@/components/transactions/TransactionLedger';
import {
  LEAK_META,
  LEAK_TYPES,
  SIGNAL_FILTERS,
  SignalFilter,
  SortDir,
  SortKey,
  highValueCutoff,
  matchesSearch,
  matchesSignal,
  sortTransactions,
  summarize,
} from '@/components/transactions/transactionSignals';

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsPageInner />
    </Suspense>
  );
}

function TransactionsPageInner() {
  const searchParams = useSearchParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [leakTypeFilter, setLeakTypeFilter] = useState('');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('natural');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  // Reacts to the ?leak_type= param even when Next.js reuses a cached
  // instance of this page across a client-side navigation (e.g. from the
  // Revenue Risk Map), where a mount-only initializer would miss the value.
  useEffect(() => {
    setLeakTypeFilter(searchParams.get('leak_type') || '');
  }, [searchParams]);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getTransactions(500, leakTypeFilter || undefined);
      setTransactions(data);
    } catch {
      setErrorMsg('Unable to load transaction data.');
    } finally {
      setLoading(false);
    }
  }, [leakTypeFilter]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const cutoff = useMemo(() => highValueCutoff(transactions), [transactions]);

  const filtered = useMemo(
    () => transactions.filter((tx) => matchesSearch(tx, search) && matchesSignal(tx, signalFilter, cutoff)),
    [transactions, search, signalFilter, cutoff]
  );

  const visible = useMemo(() => sortTransactions(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  // Every figure reflects the rows currently in view and is derived from
  // the already-loaded records — nothing here is fetched or invented.
  const summary = useMemo(() => summarize(filtered), [filtered]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey]
  );

  const filtersActive = search !== '' || signalFilter !== 'all' || leakTypeFilter !== '';

  const clearFilters = useCallback(() => {
    setSearch('');
    setSignalFilter('all');
    setLeakTypeFilter('');
  }, []);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Rows3 strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Transactions</h2>
            <p className="text-xs text-text-muted mt-0.5">Investigate revenue leaks and recovery opportunities.</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <span className="hidden sm:inline text-[11px] font-mono text-text-muted tabular-nums">
            {filtered.length} of {transactions.length} shown
          </span>
          <button
            id="btn-refresh-transactions"
            onClick={loadTransactions}
            disabled={loading}
            aria-label="Refresh transactions"
            className="p-2 rounded-sm bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Intelligence strip — compact investigation toolbar, not dashboard cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border-subtle border border-border-subtle rounded-md overflow-hidden">
        <SummaryCell label="Revenue at Risk" value={formatINR(summary.exposure, true)} tone="primary" />
        <SummaryCell label="Transactions" value={summary.count.toLocaleString()} />
        <SummaryCell
          label="High Recovery"
          value={summary.highRecovery === null ? '—' : summary.highRecovery.toLocaleString()}
          hint={summary.highRecovery === null ? 'Run an intelligence pass to score recovery' : undefined}
          tone={summary.highRecovery ? 'success' : undefined}
        />
        <SummaryCell
          label="Repeated Failures"
          value={summary.repeatedFailures.toLocaleString()}
          tone={summary.repeatedFailures > 0 ? 'warning' : undefined}
        />
      </div>

      {/* Investigation control bar */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              id="input-tx-search"
              type="text"
              placeholder="Search by Transaction ID, Customer ID, Leak ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-panel border border-border-strong rounded-sm text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-500/60 font-mono"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {SIGNAL_FILTERS.map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                active={signalFilter === f.key}
                onClick={() => setSignalFilter((s) => (s === f.key ? 'all' : f.key))}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label="All Leaks" active={leakTypeFilter === ''} onClick={() => setLeakTypeFilter('')} />
          {LEAK_TYPES.map((t) => (
            <Chip
              key={t}
              label={LEAK_META[t]?.label ?? t}
              active={leakTypeFilter === t}
              onClick={() => setLeakTypeFilter((prev) => (prev === t ? '' : t))}
            />
          ))}
        </div>
      </div>

      {errorMsg ? (
        <div className="bg-panel border border-border-subtle rounded-md shadow-panel py-16 px-6 text-center">
          <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-400/70 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">Unable to load transaction data</p>
          <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
            REVORA couldn&apos;t reach the transaction service. Check that the service is running, then try again.
          </p>
          <button
            onClick={loadTransactions}
            disabled={loading}
            className="mt-4 px-4 py-2 rounded-sm bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Retrying...' : 'Try again'}
          </button>
        </div>
      ) : (
        <TransactionLedger
          transactions={visible}
          loading={loading}
          totalLoaded={transactions.length}
          selectedId={selectedTxId}
          onSelect={setSelectedTxId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onClearFilters={clearFilters}
          filtersActive={filtersActive}
        />
      )}

      <TransactionDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onRefresh={loadTransactions}
      />
    </div>
  );
}

const SummaryCell: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'primary' | 'success' | 'warning';
}> = ({ label, value, hint, tone }) => {
  const toneCls =
    tone === 'primary'
      ? 'text-text-primary'
      : tone === 'success'
      ? 'text-success-300'
      : tone === 'warning'
      ? 'text-warning-300'
      : 'text-text-primary';
  return (
    <div className="bg-panel px-4 py-2 leading-tight">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums mt-1 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
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
