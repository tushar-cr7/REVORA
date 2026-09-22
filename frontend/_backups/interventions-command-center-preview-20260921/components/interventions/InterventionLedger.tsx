'use client';

import React from 'react';
import { ArrowUpRight, Inbox, Loader2, Search } from 'lucide-react';
import { Intervention, Opportunity } from '@/lib/types';
import { formatINR, formatTimeAgo } from '@/lib/format';
import { actionLabel, OUTCOME_LABEL } from '@/lib/actionMeta';
import { actionIcon } from './actionIcons';

export type Row =
  | { kind: 'queued'; id: string; opp: Opportunity }
  | { kind: 'completed'; id: string; itv: Intervention };

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

interface InterventionLedgerProps {
  rows: Row[];
  loading: boolean;
  totalLoaded: number;
  selectedId: string | null;
  onSelect: (row: Row) => void;
  onExecute: (opp: Opportunity) => void;
  executingId: string | null;
  onClearFilters: () => void;
  filtersActive: boolean;
}

const ROW_CAP = 200;

export const InterventionLedger: React.FC<InterventionLedgerProps> = ({
  rows,
  loading,
  totalLoaded,
  selectedId,
  onSelect,
  onExecute,
  executingId,
  onClearFilters,
  filtersActive,
}) => {
  const visible = rows.slice(0, ROW_CAP);

  if (loading) return <LedgerSkeleton />;

  if (visible.length === 0) {
    return (
      <div className="bg-panel border border-border-subtle rounded-md shadow-panel">
        <EmptyState hadRows={totalLoaded > 0} filtersActive={filtersActive} onClearFilters={onClearFilters} />
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
              <th className="py-2 pl-2 pr-4 font-medium">Action / Transaction</th>
              <th className="py-2 px-4 font-medium">Leak</th>
              <th className="py-2 px-4 font-medium text-right">Amount</th>
              <th className="py-2 px-4 font-medium">Status</th>
              <th className="py-2 px-4 font-medium">Result</th>
              <th className="py-2 px-4 font-medium">Updated</th>
              <th className="py-2 px-4 font-medium text-right">Next Step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider">
            {visible.map((row) => (
              <LedgerRow
                key={row.id}
                row={row}
                isSelected={row.id === selectedId}
                onSelect={() => onSelect(row)}
                onExecute={onExecute}
                isExecuting={row.id === executingId}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile compact list */}
      <div className="md:hidden divide-y divide-border-divider">
        {visible.map((row) => (
          <MobileRow
            key={row.id}
            row={row}
            isSelected={row.id === selectedId}
            isExecuting={row.id === executingId}
            onSelect={() => onSelect(row)}
          />
        ))}
      </div>

      {rows.length > ROW_CAP && (
        <div className="px-4 py-2 border-t border-border-divider text-[11px] text-text-muted font-mono">
          Showing first {ROW_CAP} of {rows.length} matches. Refine your search to see more.
        </div>
      )}
    </div>
  );
};

const LedgerRow: React.FC<{
  row: Row;
  isSelected: boolean;
  onSelect: () => void;
  onExecute: (opp: Opportunity) => void;
  isExecuting: boolean;
}> = ({ row, isSelected, onSelect, onExecute, isExecuting }) => {
  const action = row.kind === 'queued' ? row.opp.recommended_action : row.itv.final_action;
  const Icon = actionIcon(action);
  const amount = row.kind === 'queued' ? row.opp.amount : row.itv.amount;
  const leakType = row.kind === 'queued' ? row.opp.leak_type : undefined;
  const txId = row.kind === 'queued' ? row.opp.transaction_id : row.itv.transaction_id;
  const customerId = row.kind === 'queued' ? row.opp.customer_id : row.itv.customer_id;
  const policyAllowed = row.kind === 'queued' ? row.opp.policy_allowed : row.itv.policy_allowed;
  const railCls = isExecuting
    ? 'bg-ai-400'
    : row.kind === 'completed' && row.itv.recovered
    ? 'bg-success-500'
    : !policyAllowed
    ? 'bg-warning-500'
    : row.kind === 'completed'
    ? 'bg-border-strong'
    : 'bg-primary-500';

  return (
    <tr
      onClick={onSelect}
      className={`group cursor-pointer transition-colors ${isSelected ? 'bg-panel-raised' : 'hover:bg-panel-hover'}`}
    >
      <td className="p-0 align-middle">
        <div className={`w-[3px] h-7 rounded-full ml-1.5 transition-opacity ${railCls} ${isSelected || isExecuting ? 'opacity-100' : 'opacity-55 group-hover:opacity-90'}`} />
      </td>

      <td className="py-2 pl-2 pr-4 leading-tight">
        <div className="flex items-center gap-1.5">
          <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className={`text-[12px] font-medium ${isSelected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
            {actionLabel(action)}
          </span>
          <ArrowUpRight className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="font-mono text-[10.5px] text-text-muted mt-0.5">
          {txId} · {customerId}
        </div>
      </td>

      <td className="py-2 px-4 text-[11.5px] text-text-secondary">
        {leakType ? LEAK_LABEL[leakType] ?? leakType : <span className="text-text-muted">—</span>}
      </td>

      <td className="py-2 px-4 text-right">
        {row.kind === 'completed' && row.itv.recovered ? (
          <span className="font-mono text-[13px] font-semibold text-success-300 tabular-nums">
            +{formatINR(row.itv.recovered_amount)}
          </span>
        ) : (
          <span className="font-mono text-[13px] font-semibold text-text-primary tabular-nums">{formatINR(amount)}</span>
        )}
      </td>

      <td className="py-2 px-4">
        <StatusBadge row={row} isExecuting={isExecuting} />
      </td>

      <td className="py-2 px-4 text-[11px] text-text-secondary">
        {row.kind === 'completed' ? OUTCOME_LABEL[row.itv.status] ?? row.itv.status : <span className="text-text-muted">—</span>}
      </td>

      <td className="py-2 px-4 text-[11px] text-text-muted whitespace-nowrap">
        {row.kind === 'completed' ? formatTimeAgo(row.itv.timestamp) : 'Ready to execute'}
      </td>

      <td className="py-2 px-4 text-right">
        {row.kind === 'queued' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExecute(row.opp);
            }}
            disabled={isExecuting}
            className="px-2.5 py-1 rounded-sm border border-transparent text-[10.5px] font-medium text-text-muted group-hover:text-text-primary group-hover:border-border-strong transition-colors disabled:opacity-50 focus:outline-none focus-visible:border-primary-500 focus-visible:text-text-primary"
          >
            {isExecuting ? 'Executing...' : row.opp.policy_allowed ? 'Execute' : 'Review'}
          </button>
        ) : (
          <span className="px-2.5 py-1 rounded-sm border border-transparent text-[10.5px] font-medium text-text-muted group-hover:text-text-primary group-hover:border-border-strong transition-colors">
            View
          </span>
        )}
      </td>
    </tr>
  );
};

const StatusBadge: React.FC<{ row: Row; isExecuting?: boolean }> = ({ row, isExecuting }) => {
  if (isExecuting) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-ai-muted text-ai-300 border-ai-500/30">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        In progress
      </span>
    );
  }
  if (row.kind === 'queued') {
    return row.opp.policy_allowed ? (
      <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-primary-muted text-primary-300 border-primary-500/30">
        Ready
      </span>
    ) : (
      <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-warning-muted text-warning-300 border-warning-500/30">
        Action paused
      </span>
    );
  }
  const itv = row.itv;
  if (itv.recovered) {
    return (
      <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-success-muted text-success-300 border-success-500/30">
        Completed
      </span>
    );
  }
  if (itv.status === 'escalated_to_merchant') {
    return (
      <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-warning-muted text-warning-300 border-warning-500/30">
        Escalated
      </span>
    );
  }
  return (
    <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded border bg-surface text-text-muted border-border-subtle">
      Completed
    </span>
  );
};

const MobileRow: React.FC<{ row: Row; isSelected: boolean; isExecuting?: boolean; onSelect: () => void }> = ({
  row,
  isSelected,
  isExecuting,
  onSelect,
}) => {
  const action = row.kind === 'queued' ? row.opp.recommended_action : row.itv.final_action;
  const Icon = actionIcon(action);
  const amount = row.kind === 'queued' ? row.opp.amount : row.itv.amount;
  const txId = row.kind === 'queued' ? row.opp.transaction_id : row.itv.transaction_id;
  const policyAllowed = row.kind === 'queued' ? row.opp.policy_allowed : row.itv.policy_allowed;
  const railCls = isExecuting
    ? 'bg-ai-400'
    : row.kind === 'completed' && row.itv.recovered
    ? 'bg-success-500'
    : !policyAllowed
    ? 'bg-warning-500'
    : row.kind === 'completed'
    ? 'bg-border-strong'
    : 'bg-primary-500';

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 flex gap-3 transition-colors ${isSelected ? 'bg-panel-raised' : 'active:bg-panel-hover'}`}
    >
      <div className={`w-[3px] rounded-full shrink-0 ${railCls} opacity-70`} />
      <Icon strokeWidth={1.75} className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px] font-medium text-text-primary truncate">{actionLabel(action)}</span>
          <span className="font-mono text-[13.5px] font-semibold text-text-primary tabular-nums shrink-0">
            {row.kind === 'completed' && row.itv.recovered ? `+${formatINR(row.itv.recovered_amount)}` : formatINR(amount)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <StatusBadge row={row} isExecuting={isExecuting} />
          <span className="text-[10px] text-text-muted shrink-0">
            {row.kind === 'completed' ? formatTimeAgo(row.itv.timestamp) : 'Ready'}
          </span>
        </div>
        <div className="font-mono text-[10px] text-text-muted mt-1 truncate">{txId}</div>
      </div>
    </button>
  );
};

const LedgerSkeleton: React.FC = () => (
  <div className="bg-panel border border-border-subtle rounded-md shadow-panel overflow-hidden">
    <div className="border-b border-border-divider px-4 py-2.5 flex gap-4">
      {['Action / Transaction', 'Leak', 'Amount', 'Status', 'Result', 'Updated'].map((h) => (
        <div key={h} className="text-[10px] font-mono text-text-muted uppercase tracking-wider flex-1 truncate">
          {h}
        </div>
      ))}
    </div>
    <div className="divide-y divide-border-divider">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="w-[3px] h-7 rounded-full bg-border-strong shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-28 rounded bg-border-strong/60" />
            <div className="h-2 w-32 rounded bg-border-subtle" />
          </div>
          <div className="h-2.5 w-20 rounded bg-border-subtle" />
          <div className="h-4 w-16 rounded bg-border-subtle" />
          <div className="h-4 w-16 rounded-pill bg-border-subtle" />
          <div className="h-2.5 w-16 rounded bg-border-subtle" />
        </div>
      ))}
    </div>
  </div>
);

const EmptyState: React.FC<{ hadRows: boolean; filtersActive: boolean; onClearFilters: () => void }> = ({
  hadRows,
  filtersActive,
  onClearFilters,
}) => {
  if (hadRows) {
    return (
      <div className="py-16 px-6 text-center">
        <Search strokeWidth={1.5} className="w-8 h-8 text-text-muted/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-text-secondary">No actions match this view</p>
        <p className="text-xs text-text-muted mt-1">Adjust your search or filters to widen the queue.</p>
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
      <Inbox strokeWidth={1.5} className="w-9 h-9 text-text-muted/40 mx-auto mb-3" />
      <p className="text-sm font-medium text-text-primary">No recovery actions</p>
      <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
        REVORA has no queued or completed recovery interventions right now. Run an intelligence pass from Recovery
        Brain to surface recovery opportunities.
      </p>
    </div>
  );
};
