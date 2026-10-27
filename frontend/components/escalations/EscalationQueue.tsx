'use client';

import React from 'react';
import { Inbox, Search, SlidersHorizontal, ChevronRight, CircleCheck, X } from 'lucide-react';
import { formatINR } from '@/lib/format';
import {
  EscalationCase,
  Priority,
  PRIORITY_LABEL,
  REASON_LABEL,
  ReasonKey,
  StatusFilter,
  caseAmount,
  caseCustomerId,
  caseLeakType,
  formatAge,
  isRoutedToMerchant,
  leakLabel,
  reasonKey,
  reasonLabel,
  caseAgeHours,
} from './escalationSignals';
import { reasonIcon } from './reasonIcons';

const ROW_CAP = 200;

/* ────────────────────────────── toolbar ────────────────────────────── */

export interface StatusCounts {
  all: number;
  pending: number;
  routed: number;
}

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All Cases' },
  { id: 'pending', label: 'Awaiting Review' },
  { id: 'routed', label: 'Routed to Merchant' },
];

interface ToolbarProps {
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  counts: StatusCounts;
  search: string;
  onSearch: (v: string) => void;
  reasonFilter: ReasonKey | 'all';
  onReasonFilter: (r: ReasonKey | 'all') => void;
  reasonCounts: Record<string, number>;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export const EscalationToolbar: React.FC<ToolbarProps> = ({
  status,
  onStatus,
  counts,
  search,
  onSearch,
  reasonFilter,
  onReasonFilter,
  reasonCounts,
  filtersOpen,
  onToggleFilters,
}) => {
  const availableReasons = (Object.keys(REASON_LABEL) as ReasonKey[]).filter((r) => (reasonCounts[r] ?? 0) > 0);

  return (
    <div className="border-b border-border-divider">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 pt-3 pb-3">
        <div className="flex items-center gap-0.5 overflow-x-auto custom-scrollbar max-w-full">
          {STATUS_TABS.map((t) => {
            const active = status === t.id;
            const count = counts[t.id];
            return (
              <button
                key={t.id}
                onClick={() => onStatus(t.id)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active ? 'text-text-primary bg-panel-raised' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`text-[10.5px] font-mono tabular-nums px-1.5 py-px rounded ${
                    active
                      ? t.id === 'pending' && count > 0
                        ? 'bg-warning-500/20 text-warning-300'
                        : 'bg-border-strong text-text-secondary'
                      : t.id === 'pending' && count > 0
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
              id="input-escalation-search"
              type="text"
              placeholder="Search cases..."
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 bg-surface border border-border-strong rounded-md text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-warning-500/60 transition-colors"
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
              filtersOpen || reasonFilter !== 'all'
                ? 'border-warning-500/50 bg-warning-muted/40 text-warning-200'
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
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted mr-1">Reason</span>
          <FilterChip label="All" active={reasonFilter === 'all'} onClick={() => onReasonFilter('all')} />
          {availableReasons.map((r) => (
            <FilterChip
              key={r}
              label={`${REASON_LABEL[r]} (${reasonCounts[r]})`}
              active={reasonFilter === r}
              onClick={() => onReasonFilter(reasonFilter === r ? 'all' : r)}
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

/* ────────────────────────────── priority chip ────────────────────────────── */

const PriorityChip: React.FC<{ priority: Priority }> = ({ priority }) => {
  const style =
    priority === 'critical'
      ? 'text-risk-300 bg-risk-muted/60 border-risk-500/30'
      : priority === 'high'
      ? 'text-warning-300 bg-warning-muted/50 border-warning-500/30'
      : 'text-text-muted bg-panel-raised border-border-strong';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${style}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
};

/* ────────────────────────────── table ────────────────────────────── */

interface TableProps {
  cases: EscalationCase[];
  loading: boolean;
  totalLoaded: number;
  selectedId: string | null;
  onSelect: (c: EscalationCase) => void;
  priorityByDecision: Map<string, Priority>;
  filtersActive: boolean;
  onClearFilters: () => void;
  status: StatusFilter;
}

export const EscalationTable: React.FC<TableProps> = ({
  cases,
  loading,
  totalLoaded,
  selectedId,
  onSelect,
  priorityByDecision,
  filtersActive,
  onClearFilters,
  status,
}) => {
  if (loading) return <TableSkeleton />;

  if (cases.length === 0) {
    return <EmptyState hadRows={totalLoaded > 0} filtersActive={filtersActive} onClearFilters={onClearFilters} status={status} />;
  }

  const visible = cases.slice(0, ROW_CAP);

  return (
    <>
      <div className="hidden lg:block overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[9.5px] font-mono uppercase tracking-[0.12em] text-text-muted border-b border-border-divider">
              <th className="w-[3px] p-0" aria-hidden />
              <th className="py-2 pl-2.5 pr-2 font-medium whitespace-nowrap">Priority</th>
              <th className="py-2 px-2 font-medium">Customer / Transaction</th>
              <th className="py-2 px-2 font-medium">Reason</th>
              <th className="py-2 px-2 font-medium text-right">Amount</th>
              <th className="py-2 px-2 font-medium">Status</th>
              <th className="py-2 px-2 font-medium whitespace-nowrap hidden xl:table-cell">Age</th>
              <th className="py-2 pl-2 pr-2.5 font-medium text-right w-[80px]" aria-label="Open" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider">
            {visible.map((c) => (
              <CaseRow
                key={c.decision.decision_id}
                c={c}
                isSelected={c.decision.decision_id === selectedId}
                priority={priorityByDecision.get(c.decision.decision_id) ?? 'standard'}
                onSelect={() => onSelect(c)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="lg:hidden divide-y divide-border-divider">
        {visible.map((c) => (
          <MobileCaseRow
            key={c.decision.decision_id}
            c={c}
            isSelected={c.decision.decision_id === selectedId}
            priority={priorityByDecision.get(c.decision.decision_id) ?? 'standard'}
            onSelect={() => onSelect(c)}
          />
        ))}
      </div>

      {cases.length > ROW_CAP && (
        <div className="px-4 py-2 border-t border-border-divider text-[11px] text-text-muted font-mono">
          Showing first {ROW_CAP} of {cases.length} matches. Refine your search to see more.
        </div>
      )}
    </>
  );
};

const CaseRow: React.FC<{ c: EscalationCase; isSelected: boolean; priority: Priority; onSelect: () => void }> = ({
  c,
  isSelected,
  priority,
  onSelect,
}) => {
  const routed = isRoutedToMerchant(c);
  const rKey = reasonKey(c.decision);
  const Icon = reasonIcon(rKey);
  const railCls = routed ? 'bg-success-500/70' : priority === 'critical' ? 'bg-risk-500' : priority === 'high' ? 'bg-warning-500' : 'bg-border-strong';

  return (
    <tr onClick={onSelect} className={`group cursor-pointer transition-colors ${isSelected ? 'bg-panel-raised' : 'hover:bg-panel-hover'}`}>
      <td className="p-0 align-middle">
        <div className={`w-[3px] h-9 ${railCls} transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'}`} />
      </td>
      <td className="py-2 pl-2.5 pr-2">
        <PriorityChip priority={priority} />
      </td>
      <td className="py-2 px-2 leading-tight max-w-[150px]">
        <div className={`font-mono text-[11.5px] truncate ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>{caseCustomerId(c)}</div>
        <div className="font-mono text-[10px] text-text-muted truncate mt-0.5">{c.decision.transaction_id}</div>
      </td>
      <td className="py-2 px-2 max-w-[200px]">
        <div className="flex items-center gap-1.5">
          <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className="text-[12px] text-text-secondary group-hover:text-text-primary transition-colors truncate">{reasonLabel(c.decision)}</span>
        </div>
        <div className="text-[10.5px] text-text-muted mt-0.5 truncate">{leakLabel(caseLeakType(c))}</div>
      </td>
      <td className="py-2 px-2 text-right whitespace-nowrap">
        <span className="font-mono text-[12.5px] font-semibold text-text-primary tabular-nums">{formatINR(caseAmount(c))}</span>
      </td>
      <td className="py-2 px-2">
        {routed ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success-200 whitespace-nowrap">
            <CircleCheck className="w-3 h-3 shrink-0" />
            Routed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-warning-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-warning-400 shrink-0" />
            Awaiting review
          </span>
        )}
      </td>
      <td className="py-2 px-2 text-[11px] text-text-muted whitespace-nowrap hidden xl:table-cell">{formatAge(caseAgeHours(c))}</td>
      <td className="py-2 pl-2 pr-2.5 text-right">
        <span className="inline-flex items-center gap-1 text-[11px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          Open
          <ChevronRight className="w-3 h-3" />
        </span>
      </td>
    </tr>
  );
};

const MobileCaseRow: React.FC<{ c: EscalationCase; isSelected: boolean; priority: Priority; onSelect: () => void }> = ({
  c,
  isSelected,
  priority,
  onSelect,
}) => {
  const routed = isRoutedToMerchant(c);
  const rKey = reasonKey(c.decision);
  const Icon = reasonIcon(rKey);
  const railCls = routed ? 'bg-success-500/70' : priority === 'critical' ? 'bg-risk-500' : priority === 'high' ? 'bg-warning-500' : 'bg-border-strong';

  return (
    <button onClick={onSelect} className={`w-full text-left px-3 py-3 flex gap-3 transition-colors ${isSelected ? 'bg-panel-raised' : 'active:bg-panel-hover'}`}>
      <div className={`w-[3px] rounded-full shrink-0 ${railCls} opacity-80`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="text-[12.5px] font-medium text-text-primary truncate">{reasonLabel(c.decision)}</span>
          </span>
          <span className="font-mono text-[13px] font-semibold text-text-primary tabular-nums shrink-0">{formatINR(caseAmount(c))}</span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5">
          {routed ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success-200">
              <CircleCheck className="w-3 h-3" />
              Routed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-warning-200">
              <span className="w-1.5 h-1.5 rounded-full bg-warning-400" />
              Awaiting review
            </span>
          )}
          <span className="text-[10px] text-text-muted shrink-0">{formatAge(caseAgeHours(c))} old</span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="font-mono text-[10px] text-text-muted truncate">{c.decision.transaction_id}</span>
          <PriorityChip priority={priority} />
        </div>
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
      </div>
    ))}
  </div>
);

const STATUS_EMPTY: Record<StatusFilter, { title: string; body: string }> = {
  all: {
    title: 'No escalations',
    body: 'REVORA has not handed any case back for human review. Cases appear here the moment a control boundary is hit.',
  },
  pending: {
    title: 'Nothing awaiting review',
    body: 'Every open escalation has already been routed to your merchant queue.',
  },
  routed: {
    title: 'Nothing routed yet',
    body: 'Open a case and confirm the hand-off to move it into your merchant queue.',
  },
};

const EmptyState: React.FC<{ hadRows: boolean; filtersActive: boolean; onClearFilters: () => void; status: StatusFilter }> = ({
  hadRows,
  filtersActive,
  onClearFilters,
  status,
}) => {
  if (filtersActive) {
    return (
      <div className="py-14 px-6 text-center">
        <Search strokeWidth={1.5} className="w-7 h-7 text-text-muted/40 mx-auto mb-3" />
        <p className="text-[13px] font-medium text-text-secondary">No cases match this view</p>
        <p className="text-[12px] text-text-muted mt-1">Adjust your search or filters to widen the queue.</p>
        <button
          onClick={onClearFilters}
          className="mt-4 px-3 py-1.5 rounded-md border border-border-strong text-[12px] text-text-secondary hover:text-text-primary hover:border-warning-500/50 transition-colors"
        >
          Clear filters
        </button>
      </div>
    );
  }

  const copy = hadRows
    ? STATUS_EMPTY[status]
    : { title: 'No escalations', body: 'REVORA has no cases requiring human attention right now.' };

  return (
    <div className="py-14 px-6 text-center">
      <Inbox strokeWidth={1.5} className="w-8 h-8 text-text-muted/40 mx-auto mb-3" />
      <p className="text-[13px] font-medium text-text-primary">{copy.title}</p>
      <p className="text-[12px] text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">{copy.body}</p>
    </div>
  );
};
