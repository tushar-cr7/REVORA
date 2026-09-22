'use client';

import React from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, Search, ShieldCheck, RotateCcw } from 'lucide-react';
import { Transaction } from '@/lib/types';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import {
  LEAK_META,
  TIER_META,
  recoveryTier,
  REPEATED_FAILURE_THRESHOLD,
  SortDir,
  SortKey,
} from './transactionSignals';

interface TransactionLedgerProps {
  transactions: Transaction[];
  loading: boolean;
  totalLoaded: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onClearFilters: () => void;
  filtersActive: boolean;
}

const ROW_CAP = 200;

export const TransactionLedger: React.FC<TransactionLedgerProps> = ({
  transactions,
  loading,
  totalLoaded,
  selectedId,
  onSelect,
  sortKey,
  sortDir,
  onSort,
  onClearFilters,
  filtersActive,
}) => {
  const visible = transactions.slice(0, ROW_CAP);

  if (loading) return <LedgerSkeleton />;

  if (visible.length === 0) {
    return (
      <div className="bg-panel border border-border-subtle rounded-md shadow-panel">
        <EmptyState hadTransactions={totalLoaded > 0} filtersActive={filtersActive} onClearFilters={onClearFilters} />
      </div>
    );
  }

  return (
    <div className="bg-panel border border-border-subtle rounded-md shadow-panel">
      {/* Desktop ledger */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border-divider text-[10px] font-mono text-text-muted uppercase tracking-wider">
              <th className="w-[10px] p-0" aria-hidden />
              <th className="py-2 pl-2 pr-4 font-medium">Transaction / Customer</th>
              <th className="py-2 px-4 font-medium">Leak</th>
              <th className="py-2 px-4 font-medium">Payment / Reason</th>
              <SortableHeader label="Amount at Risk" sortKey="amount" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
              <SortableHeader label="Recovery" sortKey="recovery" active={sortKey} dir={sortDir} onSort={onSort} align="center" />
              <th className="py-2.5 px-4 font-medium">Customer Signal</th>
              <SortableHeader label="Age" sortKey="age" active={sortKey} dir={sortDir} onSort={onSort} align="left" />
              <th className="py-2.5 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider">
            {visible.map((tx) => {
              const meta = LEAK_META[tx.leak_type];
              const prob = tx.model_recovery_prob;
              const tier = recoveryTier(prob);
              const tierMeta = TIER_META[tier];
              const isSelected = tx.transaction_id === selectedId;
              const repeated = tx.retries_so_far >= REPEATED_FAILURE_THRESHOLD;

              return (
                <tr
                  key={tx.transaction_id}
                  onClick={() => onSelect(tx.transaction_id)}
                  className={`group cursor-pointer transition-colors ${
                    isSelected ? 'bg-panel-raised shadow-[inset_2px_0_0_0_theme(colors.primary.500)]' : 'hover:bg-panel-hover'
                  }`}
                >
                  {/* Risk signal rail — scan the whole ledger by recovery tier */}
                  <td className="p-0 align-middle">
                    <div
                      className={`w-[3px] h-7 rounded-full ml-1.5 transition-opacity ${tierMeta.rail} ${
                        isSelected ? 'opacity-100' : 'opacity-55 group-hover:opacity-90'
                      }`}
                    />
                  </td>

                  <td className="py-2 pl-2 pr-4 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono text-[12px] font-medium transition-colors ${
                          isSelected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                        }`}
                      >
                        {tx.transaction_id}
                      </span>
                      <ArrowUpRight className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="font-mono text-[10.5px] text-text-muted mt-0.5">{tx.customer_id}</div>
                  </td>

                  <td className="py-2 px-4">
                    {meta ? (
                      <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${meta.bg} ${meta.color}`}>
                        {meta.label}
                      </span>
                    ) : (
                      <span className="text-text-secondary capitalize">{tx.leak_type.replace('_', ' ')}</span>
                    )}
                  </td>

                  <td className="py-2 px-4 leading-tight">
                    <div className="text-[11.5px] text-text-secondary uppercase font-medium">{tx.payment_method}</div>
                    <div className="font-mono text-[10.5px] text-text-muted mt-0.5">{tx.failure_code}</div>
                  </td>

                  <td className="py-2 px-4 text-right">
                    <span className="font-mono text-[14px] font-semibold text-text-primary tabular-nums">
                      {formatINR(tx.amount)}
                    </span>
                  </td>

                  <td className="py-2 px-4">
                    {prob != null ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-pill border tabular-nums ${tierMeta.pill}`}>
                          {formatPct(prob)}
                        </span>
                        <div className="w-14 h-[3px] rounded-full bg-surface overflow-hidden">
                          <div className={`h-full rounded-full ${tierMeta.rail}`} style={{ width: `${Math.max(3, prob * 100)}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-[10.5px] text-text-muted">Unscored</div>
                    )}
                  </td>

                  <td className="py-2 px-4 leading-tight">
                    <div className="text-[11.5px] text-text-secondary uppercase font-medium">{tx.ltv_bucket} LTV</div>
                    <div className={`text-[10.5px] mt-0.5 flex items-center gap-1 ${repeated ? 'text-warning-300' : 'text-text-muted'}`}>
                      {repeated && <RotateCcw className="w-2.5 h-2.5 shrink-0" />}
                      {tx.retries_so_far} {tx.retries_so_far === 1 ? 'retry' : 'retries'}
                    </div>
                  </td>

                  <td className="py-2 px-4 text-[11px] text-text-muted whitespace-nowrap">{formatTimeAgo(tx.event_time)}</td>

                  <td className="py-2 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(tx.transaction_id);
                      }}
                      className={`px-2.5 py-1 rounded-sm border text-[10.5px] font-medium transition-colors focus:outline-none focus-visible:border-primary-500 focus-visible:text-text-primary ${
                        isSelected
                          ? 'border-primary-500/50 text-text-primary'
                          : 'border-transparent text-text-muted group-hover:text-text-primary group-hover:border-border-strong'
                      }`}
                    >
                      Investigate
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile investigation list */}
      <div className="md:hidden divide-y divide-border-divider">
        {visible.map((tx) => {
          const meta = LEAK_META[tx.leak_type];
          const prob = tx.model_recovery_prob;
          const tierMeta = TIER_META[recoveryTier(prob)];
          const isSelected = tx.transaction_id === selectedId;

          return (
            <button
              key={tx.transaction_id}
              onClick={() => onSelect(tx.transaction_id)}
              className={`w-full text-left px-3 py-3 flex gap-3 transition-colors ${isSelected ? 'bg-panel-raised' : 'active:bg-panel-hover'}`}
            >
              <div className={`w-[3px] rounded-full shrink-0 ${tierMeta.rail} opacity-70`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11.5px] text-text-secondary truncate">{tx.transaction_id}</span>
                  <span className="font-mono text-[14px] font-semibold text-text-primary tabular-nums shrink-0">
                    {formatINR(tx.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  {meta ? (
                    <span className={`text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded border ${meta.bg} ${meta.color}`}>
                      {meta.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-secondary capitalize">{tx.leak_type.replace('_', ' ')}</span>
                  )}
                  {prob != null ? (
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-pill border tabular-nums ${tierMeta.pill}`}>
                      {formatPct(prob)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-muted">Unscored</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5 text-[10px] text-text-muted">
                  <span className="font-mono truncate">{tx.customer_id}</span>
                  <span className="shrink-0">{formatTimeAgo(tx.event_time)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {transactions.length > ROW_CAP && (
        <div className="px-4 py-2 border-t border-border-divider text-[11px] text-text-muted font-mono">
          Showing first {ROW_CAP} of {transactions.length} matches. Refine your search to see more.
        </div>
      )}
    </div>
  );
};

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align: 'left' | 'right' | 'center';
}> = ({ label, sortKey, active, dir, onSort, align }) => {
  const isActive = active === sortKey;
  const alignCls = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={`py-2.5 px-4 font-medium ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}>
      <button
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 w-full ${alignCls} uppercase tracking-wider transition-colors ${
          isActive ? 'text-text-secondary' : 'hover:text-text-secondary'
        }`}
      >
        {label}
        {isActive && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </button>
    </th>
  );
};

const LedgerSkeleton: React.FC = () => (
  <div className="bg-panel border border-border-subtle rounded-md shadow-panel overflow-hidden">
    <div className="border-b border-border-divider px-4 py-2.5 flex gap-4">
      {['Transaction / Customer', 'Leak', 'Payment / Reason', 'Amount at Risk', 'Recovery', 'Customer Signal', 'Age'].map((h) => (
        <div key={h} className="text-[10px] font-mono text-text-muted uppercase tracking-wider flex-1 truncate">
          {h}
        </div>
      ))}
    </div>
    <div className="divide-y divide-border-divider">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="w-[3px] h-8 rounded-full bg-border-strong shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-28 rounded bg-border-strong/60" />
            <div className="h-2 w-20 rounded bg-border-subtle" />
          </div>
          <div className="h-4 w-24 rounded bg-border-subtle" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-16 rounded bg-border-subtle" />
            <div className="h-2 w-24 rounded bg-border-subtle" />
          </div>
          <div className="h-3.5 w-20 rounded bg-border-strong/60" />
          <div className="h-4 w-14 rounded-pill bg-border-subtle" />
          <div className="flex-1 h-2.5 rounded bg-border-subtle max-w-[80px]" />
          <div className="h-2.5 w-12 rounded bg-border-subtle" />
        </div>
      ))}
    </div>
  </div>
);

const EmptyState: React.FC<{ hadTransactions: boolean; filtersActive: boolean; onClearFilters: () => void }> = ({
  hadTransactions,
  filtersActive,
  onClearFilters,
}) => {
  if (hadTransactions) {
    return (
      <div className="py-16 px-6 text-center">
        <Search strokeWidth={1.5} className="w-8 h-8 text-text-muted/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-text-secondary">No transactions match this view</p>
        <p className="text-xs text-text-muted mt-1">Adjust your search or filters to widen the investigation.</p>
        {filtersActive && (
          <button
            onClick={onClearFilters}
            className="mt-4 px-3 py-1.5 rounded-sm border border-border-strong text-xs text-text-secondary hover:text-text-primary hover:border-primary-500/50 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="py-16 px-6 text-center">
      <ShieldCheck strokeWidth={1.5} className="w-9 h-9 text-success-500/50 mx-auto mb-3" />
      <p className="text-sm font-medium text-text-primary">No revenue leaks found</p>
      <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
        REVORA hasn&apos;t detected any transactions requiring investigation. Run a scan from Revenue Scanner to surface
        new revenue leaks.
      </p>
    </div>
  );
};
