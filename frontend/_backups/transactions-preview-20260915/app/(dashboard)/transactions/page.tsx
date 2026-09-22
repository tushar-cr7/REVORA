'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Rows3, Search, RefreshCw, ArrowUpRight, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { Transaction } from '@/lib/types';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import { TransactionDrawer } from '@/components/drawer/TransactionDrawer';

const LEAK_TYPES = ['', 'failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'];

const LEAK_META: Record<string, { label: string; color: string; bg: string }> = {
  failed_payment:      { label: 'Failed Payment',      color: 'text-risk-300',    bg: 'bg-risk-muted border-risk-500/30' },
  abandoned_checkout:  { label: 'Abandoned Checkout',  color: 'text-warning-300', bg: 'bg-warning-muted border-warning-500/30' },
  failed_subscription: { label: 'Subscription Fail',   color: 'text-ai-300',      bg: 'bg-ai-muted border-ai-500/30' },
  overdue_invoice:     { label: 'Overdue Invoice',     color: 'text-primary-300', bg: 'bg-primary-muted border-primary-500/30' },
};

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load transactions: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [leakTypeFilter]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const filtered = transactions.filter((tx) =>
    search === '' ||
    tx.transaction_id.toLowerCase().includes(search.toLowerCase()) ||
    tx.customer_id.toLowerCase().includes(search.toLowerCase()) ||
    tx.leak_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Rows3 strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Transactions</h2>
            <p className="text-xs text-text-muted mt-0.5">All detected revenue leaks with recovery probability</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-text-muted">{filtered.length} of {transactions.length} shown</span>
          <button
            id="btn-refresh-transactions"
            onClick={loadTransactions}
            disabled={loading}
            className="p-2 rounded-sm bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
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
        <div className="relative">
          <select
            id="select-leak-type"
            value={leakTypeFilter}
            onChange={(e) => setLeakTypeFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 bg-panel border border-border-strong rounded-sm text-xs text-text-secondary focus:outline-none focus:border-primary-500/60 font-mono"
          >
            <option value="">All Leak Types</option>
            {LEAK_TYPES.slice(1).map((t) => (
              <option key={t} value={t}>{LEAK_META[t]?.label || t}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-panel border border-border-subtle rounded-md shadow-panel overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border-divider text-[11px] font-mono text-text-muted uppercase">
              <th className="py-3 px-4">Transaction / Customer</th>
              <th className="py-3 px-4">Leak Type</th>
              <th className="py-3 px-4">Payment</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4 text-center">P(Recovery)</th>
              <th className="py-3 px-4">LTV / Retries</th>
              <th className="py-3 px-4">Event Time</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider font-mono">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-muted italic font-sans text-xs">
                  Loading transactions...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-muted italic font-sans text-xs">
                  {transactions.length === 0
                    ? 'No transactions found. Run a scan from Mission Control or Revenue Scanner.'
                    : 'No transactions match your search.'}
                </td>
              </tr>
            ) : (
              filtered.slice(0, 200).map((tx) => {
                const meta = LEAK_META[tx.leak_type];
                const prob = tx.model_recovery_prob;
                const probColor = prob != null
                  ? prob >= 0.7 ? 'bg-success-muted text-success-300 border-success-500/30'
                  : prob >= 0.4 ? 'bg-ai-muted text-ai-300 border-ai-500/30'
                  : 'bg-risk-muted text-risk-300 border-risk-500/30'
                  : 'bg-surface text-text-muted border-border-subtle';

                return (
                  <tr
                    key={tx.transaction_id}
                    onClick={() => setSelectedTxId(tx.transaction_id)}
                    className="hover:bg-panel-hover transition cursor-pointer group"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-1.5 text-text-primary font-medium">
                        <span>{tx.transaction_id}</span>
                        <ArrowUpRight className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition" />
                      </div>
                      <div className="text-[11px] text-text-muted">{tx.customer_id}</div>
                    </td>
                    <td className="py-3 px-4">
                      {meta ? (
                        <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${meta.bg} ${meta.color}`}>
                          {meta.label}
                        </span>
                      ) : (
                        <span className="text-text-secondary capitalize">{tx.leak_type}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-text-secondary uppercase">{tx.payment_method}</div>
                      <div className="text-[11px] text-risk-300">{tx.failure_code}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-text-primary">{formatINR(tx.amount)}</td>
                    <td className="py-3 px-4 text-center">
                      {prob != null ? (
                        <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-pill border ${probColor}`}>
                          {formatPct(prob)}
                        </span>
                      ) : (
                        <span className="text-text-muted text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-text-secondary uppercase">{tx.ltv_bucket}</div>
                      <div className="text-[11px] text-text-muted">{tx.retries_so_far} retries</div>
                    </td>
                    <td className="py-3 px-4 text-text-muted text-[11px]">{formatTimeAgo(tx.event_time)}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedTxId(tx.transaction_id); }}
                        className="px-2 py-1 rounded-sm border border-border-strong text-text-muted hover:text-text-primary hover:border-primary-500/50 text-[11px] transition"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <div className="px-4 py-2 border-t border-border-divider text-xs text-text-muted font-mono">
            Showing first 200 of {filtered.length} matches. Refine your search to see more.
          </div>
        )}
      </div>

      <TransactionDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onRefresh={loadTransactions}
      />
    </div>
  );
}
