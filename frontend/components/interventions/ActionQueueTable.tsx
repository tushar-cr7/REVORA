'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Inbox, Loader2, Search, SlidersHorizontal, Play, Eye, ShieldAlert, X } from 'lucide-react';
import { Intervention, Opportunity, Transaction } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { actionLabel, OUTCOME_LABEL } from '@/lib/actionMeta';
import { actionIcon } from './actionIcons';
import {
  ACTION_KEYS,
  ActionKey,
  Priority,
  QueueTab,
  Row,
  leakLabel,
  rowAction,
  rowAmount,
  rowPolicyAllowed,
} from './interventionSignals';

const ROW_CAP = 200;

/**
 * Reason and Time are the two columns the case panel already repeats in
 * full, so they're the first to go when the ledger runs short of width.
 * Measured: the full column set needs ~758px, which the ledger has from
 * 1280px up — including at 1440px, where the inline case panel takes 340px
 * out of the row — but not at 1024px.
 */
const SECONDARY_COL = 'hidden xl:table-cell';

/* ────────────────────────────── time ────────────────────────────── */

/**
 * Queued work has no timestamp of its own — the backend's opportunity
 * records carry no clock. What it does carry, on the underlying
 * transaction, is `hours_since_event`: how long the leak has existed. That
 * is the honest age for a case nothing has executed yet.
 */
function queuedAge(tx: Transaction | undefined): string {
  if (!tx || tx.hours_since_event == null) return '—';
  const h = tx.hours_since_event;
  if (h < 1) return '<1h ago';
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function executedAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ────────────────────────────── toolbar ────────────────────────────── */

export interface TabCounts {
  queue: number;
  in_progress: number;
  completed: number;
  attention: number;
}

interface ToolbarProps {
  tab: QueueTab;
  onTab: (t: QueueTab) => void;
  counts: TabCounts;
  search: string;
  onSearch: (v: string) => void;
  actionFilter: ActionKey | 'all';
  onActionFilter: (a: ActionKey | 'all') => void;
  actionCountsByKey: Record<string, number>;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'queue', label: 'Action Queue' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'attention', label: 'Needs Attention' },
];

export const QueueToolbar: React.FC<ToolbarProps> = ({
  tab,
  onTab,
  counts,
  search,
  onSearch,
  actionFilter,
  onActionFilter,
  actionCountsByKey,
  filtersOpen,
  onToggleFilters,
}) => {
  const available = ACTION_KEYS.filter((a) => (actionCountsByKey[a] ?? 0) > 0);

  return (
    <div className="border-b border-border-divider">
      {/* Wraps rather than shrinking: the tab strip must never clip a label like "Needs Attention". */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 pt-3 pb-3">
        <div className="flex items-center gap-0.5 overflow-x-auto custom-scrollbar max-w-full">
          {TABS.map((t) => {
            const active = tab === t.id;
            const count = counts[t.id];
            return (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                aria-pressed={active}
                className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active ? 'text-text-primary bg-panel-raised' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`text-[10.5px] font-mono tabular-nums px-1.5 py-px rounded ${
                    active
                      ? t.id === 'attention' && count > 0
                        ? 'bg-warning-500/20 text-warning-300'
                        : 'bg-border-strong text-text-secondary'
                      : t.id === 'attention' && count > 0
                      ? 'text-warning-300'
                      : 'text-text-muted'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-1 sm:flex-none min-w-[180px]">
          <div className="relative flex-1 sm:w-[190px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              id="input-intervention-search"
              type="text"
              placeholder="Search actions..."
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 bg-surface border border-border-strong rounded-md text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-500/60 transition-colors"
            />
            {search !== '' && (
              <button
                onClick={() => onSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={onToggleFilters}
            aria-expanded={filtersOpen}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[12px] font-medium transition-colors shrink-0 ${
              filtersOpen || actionFilter !== 'all'
                ? 'border-primary-500/50 bg-primary-muted/40 text-primary-200'
                : 'border-border-strong bg-surface text-text-secondary hover:text-text-primary'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filters</span>
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 pb-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted mr-1">Action type</span>
          <FilterChip label="All" active={actionFilter === 'all'} onClick={() => onActionFilter('all')} />
          {available.map((a) => (
            <FilterChip
              key={a}
              label={`${actionLabel(a)} (${actionCountsByKey[a]})`}
              active={actionFilter === a}
              onClick={() => onActionFilter(actionFilter === a ? 'all' : a)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FilterChip: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
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

/* ────────────────────────────── table ────────────────────────────── */

interface ActionQueueTableProps {
  rows: Row[];
  loading: boolean;
  totalLoaded: number;
  selectedId: string | null;
  onSelect: (row: Row) => void;
  onExecute: (opp: Opportunity) => void;
  executingId: string | null;
  priorityByTx: Map<string, Priority>;
  txById: Map<string, Transaction>;
  filtersActive: boolean;
  onClearFilters: () => void;
  tab: QueueTab;
}

export const ActionQueueTable: React.FC<ActionQueueTableProps> = ({
  rows,
  loading,
  totalLoaded,
  selectedId,
  onSelect,
  onExecute,
  executingId,
  priorityByTx,
  txById,
  filtersActive,
  onClearFilters,
  tab,
}) => {
  if (loading) return <TableSkeleton />;

  if (rows.length === 0) {
    return <EmptyState hadRows={totalLoaded > 0} filtersActive={filtersActive} onClearFilters={onClearFilters} tab={tab} />;
  }

  const visible = rows.slice(0, ROW_CAP);

  return (
    <>
      {/* Desktop ledger */}
      <div className="hidden lg:block overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[9.5px] font-mono uppercase tracking-[0.12em] text-text-muted border-b border-border-divider">
              <th className="w-[3px] p-0" aria-hidden />
              <th className="py-2 pl-2.5 pr-2 font-medium whitespace-nowrap">Priority</th>
              <th className="py-2 px-2 font-medium">Customer / Transaction</th>
              <th className="py-2 px-2 font-medium">Action</th>
              <th className="py-2 px-2 font-medium text-right">Amount</th>
              <th className="py-2 px-2 font-medium">Status</th>
              <th className={`py-2 px-2 font-medium ${SECONDARY_COL}`}>Reason</th>
              <th className={`py-2 px-2 font-medium whitespace-nowrap ${SECONDARY_COL}`}>Time</th>
              <th className="py-2 pl-2 pr-2.5 font-medium text-right w-[92px]" aria-label="Action" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider">
            {visible.map((row) => (
              <LedgerRow
                key={row.id}
                row={row}
                isSelected={row.id === selectedId}
                isExecuting={row.id === executingId}
                priority={row.kind === 'queued' ? priorityByTx.get(row.id) : undefined}
                tx={txById.get(row.id)}
                onSelect={() => onSelect(row)}
                onExecute={onExecute}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden divide-y divide-border-divider">
        {visible.map((row) => (
          <MobileRow
            key={row.id}
            row={row}
            isSelected={row.id === selectedId}
            isExecuting={row.id === executingId}
            priority={row.kind === 'queued' ? priorityByTx.get(row.id) : undefined}
            tx={txById.get(row.id)}
            onSelect={() => onSelect(row)}
          />
        ))}
      </div>

      {rows.length > ROW_CAP && (
        <div className="px-4 py-2 border-t border-border-divider text-[11px] text-text-muted font-mono">
          Showing first {ROW_CAP} of {rows.length} matches. Refine your search to see more.
        </div>
      )}
    </>
  );
};

const LedgerRow: React.FC<{
  row: Row;
  isSelected: boolean;
  isExecuting: boolean;
  priority?: Priority;
  tx?: Transaction;
  onSelect: () => void;
  onExecute: (opp: Opportunity) => void;
}> = ({ row, isSelected, isExecuting, priority, tx, onSelect, onExecute }) => {
  const action = rowAction(row);
  const Icon = actionIcon(action);
  const allowed = rowPolicyAllowed(row);
  const leakType = row.kind === 'queued' ? row.opp.leak_type : tx?.leak_type;

  const railCls = isExecuting
    ? 'bg-ai-400'
    : row.kind === 'completed' && row.itv.recovered
    ? 'bg-success-500'
    : !allowed
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
        <div
          className={`w-[3px] h-9 ${railCls} transition-opacity ${
            isSelected || isExecuting ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'
          }`}
        />
      </td>

      <td className="py-2 pl-2.5 pr-2">
        {row.kind === 'queued' && priority ? (
          <PriorityIndicator priority={priority} />
        ) : (
          <span className="text-[11px] text-text-disabled">—</span>
        )}
      </td>

      <td className="py-2 px-2 leading-tight max-w-[132px]">
        <div className={`font-mono text-[11.5px] truncate ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>
          {row.kind === 'queued' ? row.opp.customer_id : row.itv.customer_id}
        </div>
        <div className="font-mono text-[10px] text-text-muted truncate mt-0.5">{row.id}</div>
      </td>

      <td className="py-2 px-2">
        <div className="flex items-center gap-1.5">
          <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className="text-[12px] text-text-secondary group-hover:text-text-primary transition-colors whitespace-nowrap">
            {actionLabel(action)}
          </span>
        </div>
      </td>

      <td className="py-2 px-2 text-right whitespace-nowrap">
        {row.kind === 'completed' && row.itv.recovered ? (
          <span className="font-mono text-[12.5px] font-semibold text-success-300 tabular-nums">
            +{formatINR(row.itv.recovered_amount)}
          </span>
        ) : (
          <span className="font-mono text-[12.5px] font-semibold text-text-primary tabular-nums">
            {formatINR(rowAmount(row))}
          </span>
        )}
      </td>

      <td className="py-2 px-2">
        <StatusCell row={row} isExecuting={isExecuting} />
      </td>

      <td className={`py-2 px-2 max-w-[150px] ${SECONDARY_COL}`}>
        {row.kind === 'queued' && !allowed ? (
          <span className="block text-[11.5px] text-warning-300 truncate" title={row.opp.policy_reason}>
            {row.opp.policy_reason}
          </span>
        ) : (
          <span className="block text-[11.5px] text-text-secondary truncate">{leakLabel(leakType)}</span>
        )}
      </td>

      <td className={`py-2 px-2 text-[11px] text-text-muted whitespace-nowrap ${SECONDARY_COL}`}>
        {row.kind === 'completed' ? executedAge(row.itv.timestamp) : queuedAge(tx)}
      </td>

      <td className="py-2 pl-2 pr-2.5 text-right">
        <RowAction row={row} isExecuting={isExecuting} onExecute={onExecute} />
      </td>
    </tr>
  );
};

const RowAction: React.FC<{ row: Row; isExecuting: boolean; onExecute: (opp: Opportunity) => void }> = ({
  row,
  isExecuting,
  onExecute,
}) => {
  if (row.kind === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        <Eye className="w-3 h-3" />
        View
      </span>
    );
  }

  const allowed = row.opp.policy_allowed;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onExecute(row.opp);
      }}
      disabled={isExecuting}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-all whitespace-nowrap disabled:opacity-60 ${
        allowed
          ? 'border-transparent text-text-muted group-hover:border-primary-500/50 group-hover:text-primary-200 group-hover:bg-primary-muted/40'
          : 'border-transparent text-text-muted group-hover:border-warning-500/50 group-hover:text-warning-200'
      } focus:outline-none focus-visible:border-primary-500 focus-visible:text-text-primary`}
    >
      {isExecuting ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </>
      ) : allowed ? (
        <>
          <Play className="w-3 h-3" />
          Execute
        </>
      ) : (
        <>
          <ShieldAlert className="w-3 h-3" />
          Review
        </>
      )}
    </button>
  );
};

/** Ranking made visible: signal bars instead of a coloured pill, so REVORA's semantic colours stay reserved for state. */
const PriorityIndicator: React.FC<{ priority: Priority }> = ({ priority }) => {
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  const label = priority === 'high' ? 'High' : priority === 'medium' ? 'Medium' : 'Low';
  const tone = priority === 'high' ? 'text-primary-200' : priority === 'medium' ? 'text-text-secondary' : 'text-text-muted';
  const fill = priority === 'high' ? 'bg-primary-400' : priority === 'medium' ? 'bg-primary-500/70' : 'bg-text-disabled';

  return (
    <span className="inline-flex items-center gap-1.5" title={`Ranked by expected recovery: ${label}`}>
      <span className="flex items-end gap-[2px] h-3" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-sm ${i <= level ? fill : 'bg-border-strong'}`}
            style={{ height: `${4 + i * 3}px` }}
          />
        ))}
      </span>
      <span className={`text-[11px] font-medium ${tone}`}>{label}</span>
    </span>
  );
};

const StatusCell: React.FC<{ row: Row; isExecuting: boolean }> = ({ row, isExecuting }) => {
  if (isExecuting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ai-300 whitespace-nowrap">
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        Executing
      </span>
    );
  }

  if (row.kind === 'queued') {
    return row.opp.policy_allowed ? (
      <StatusDot tone="bg-primary-400" className="text-primary-200" label="Ready" />
    ) : (
      <StatusDot tone="bg-warning-400" className="text-warning-200" label="Action paused" />
    );
  }

  const itv = row.itv;
  if (itv.recovered) return <StatusDot tone="bg-success-400" className="text-success-200" label="Recovered" />;
  if (itv.status === 'escalated_to_merchant')
    return <StatusDot tone="bg-warning-400" className="text-warning-200" label="Escalated" />;
  if (itv.status === 'suppressed') return <StatusDot tone="bg-text-disabled" className="text-text-muted" label="Held" />;
  return <StatusDot tone="bg-text-disabled" className="text-text-muted" label="No recovery" />;
};

const StatusDot: React.FC<{ tone: string; className: string; label: string }> = ({ tone, className, label }) => (
  <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap ${className}`}>
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone}`} />
    {label}
  </span>
);

/* ────────────────────────────── mobile ────────────────────────────── */

const MobileRow: React.FC<{
  row: Row;
  isSelected: boolean;
  isExecuting: boolean;
  priority?: Priority;
  tx?: Transaction;
  onSelect: () => void;
}> = ({ row, isSelected, isExecuting, priority, tx, onSelect }) => {
  const action = rowAction(row);
  const Icon = actionIcon(action);
  const allowed = rowPolicyAllowed(row);
  const railCls = isExecuting
    ? 'bg-ai-400'
    : row.kind === 'completed' && row.itv.recovered
    ? 'bg-success-500'
    : !allowed
    ? 'bg-warning-500'
    : row.kind === 'completed'
    ? 'bg-border-strong'
    : 'bg-primary-500';

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 flex gap-3 transition-colors ${
        isSelected ? 'bg-panel-raised' : 'active:bg-panel-hover'
      }`}
    >
      <div className={`w-[3px] rounded-full shrink-0 ${railCls} opacity-70`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="text-[12.5px] font-medium text-text-primary truncate">{actionLabel(action)}</span>
          </span>
          <span className="font-mono text-[13px] font-semibold text-text-primary tabular-nums shrink-0">
            {row.kind === 'completed' && row.itv.recovered
              ? `+${formatINR(row.itv.recovered_amount)}`
              : formatINR(rowAmount(row))}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5">
          <StatusCell row={row} isExecuting={isExecuting} />
          <span className="text-[10px] text-text-muted shrink-0">
            {row.kind === 'completed' ? executedAge(row.itv.timestamp) : queuedAge(tx)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="font-mono text-[10px] text-text-muted truncate">{row.id}</span>
          {row.kind === 'queued' && priority && <PriorityIndicator priority={priority} />}
        </div>

        {row.kind === 'queued' && !allowed && (
          <p className="text-[11px] text-warning-300/90 mt-1.5 leading-snug line-clamp-2">{row.opp.policy_reason}</p>
        )}
      </div>
    </button>
  );
};

/* ────────────────────────────── states ────────────────────────────── */

const TableSkeleton: React.FC = () => (
  <div className="divide-y divide-border-divider">
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="px-4 py-3 flex items-center gap-4 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
        <div className="h-3 w-14 rounded bg-border-strong/60 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 w-32 rounded bg-border-strong/60" />
          <div className="h-2 w-24 rounded bg-border-subtle" />
        </div>
        <div className="h-2.5 w-20 rounded bg-border-subtle shrink-0" />
        <div className="h-2.5 w-16 rounded bg-border-subtle shrink-0" />
        <div className="h-2.5 w-20 rounded bg-border-subtle shrink-0 hidden lg:block" />
      </div>
    ))}
  </div>
);

const TAB_EMPTY: Record<QueueTab, { title: string; body: string }> = {
  queue: {
    title: 'Queue is clear',
    body: 'Every decided recovery action has been executed. New opportunities appear here as REVORA finds them.',
  },
  in_progress: {
    title: 'Nothing executing',
    body: 'Actions appear here while REVORA is running them. Execution is immediate, so this view is usually empty.',
  },
  completed: {
    title: 'No completed actions',
    body: 'Once a recovery action runs, its outcome is recorded here.',
  },
  attention: {
    title: 'Nothing needs you',
    body: 'No actions are paused by recovery controls and nothing has come back unresolved.',
  },
};

const EmptyState: React.FC<{
  hadRows: boolean;
  filtersActive: boolean;
  onClearFilters: () => void;
  tab: QueueTab;
}> = ({ hadRows, filtersActive, onClearFilters, tab }) => {
  if (filtersActive) {
    return (
      <div className="py-14 px-6 text-center">
        <Search strokeWidth={1.5} className="w-7 h-7 text-text-muted/40 mx-auto mb-3" />
        <p className="text-[13px] font-medium text-text-secondary">No actions match this view</p>
        <p className="text-[12px] text-text-muted mt-1">Adjust your search or filters to widen the queue.</p>
        <button
          onClick={onClearFilters}
          className="mt-4 px-3 py-1.5 rounded-md border border-border-strong text-[12px] text-text-secondary hover:text-text-primary hover:border-primary-500/50 transition-colors"
        >
          Clear filters
        </button>
      </div>
    );
  }

  const copy = hadRows
    ? TAB_EMPTY[tab]
    : {
        title: 'No recovery actions',
        body: 'REVORA has no queued or completed interventions right now. Run an intelligence pass from Recovery Brain to surface opportunities.',
      };

  return (
    <div className="py-14 px-6 text-center">
      <Inbox strokeWidth={1.5} className="w-8 h-8 text-text-muted/40 mx-auto mb-3" />
      <p className="text-[13px] font-medium text-text-primary">{copy.title}</p>
      <p className="text-[12px] text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">{copy.body}</p>
    </div>
  );
};
