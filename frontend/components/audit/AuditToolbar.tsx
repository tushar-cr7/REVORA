'use client';

import React from 'react';
import { ChevronDown, RefreshCw, Search } from 'lucide-react';
import { EVENT_TYPE_OPTIONS } from './auditSignals';

export type AuditMode = 'timeline' | 'transactions' | 'decisions' | 'policy' | 'system';

export const MODES: { id: AuditMode; label: string; search: boolean; type: boolean }[] = [
  { id: 'timeline', label: 'Event Ledger', search: true, type: true },
  { id: 'transactions', label: 'Transaction View', search: true, type: true },
  { id: 'decisions', label: 'Decision Explorer', search: true, type: false },
  { id: 'policy', label: 'Policy Audit', search: false, type: false },
  { id: 'system', label: 'System Activity', search: false, type: false },
];

interface Props {
  mode: AuditMode;
  onMode: (m: AuditMode) => void;
  search: string;
  onSearch: (s: string) => void;
  eventType: string;
  onEventType: (t: string) => void;
  loading: boolean;
  onRefresh: () => void;
  updatedLabel: string | null;
}

/**
 * Views as underlined tabs (blue marks the active one only), with search, the
 * event-type filter and refresh beside them. Behaviour is unchanged: the same
 * server-side event-type filter and client-side search, same element ids.
 */
export const AuditToolbar: React.FC<Props> = ({ mode, onMode, search, onSearch, eventType, onEventType, loading, onRefresh, updatedLabel }) => {
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="flex flex-col gap-3 border-b border-border-subtle min-[1400px]:flex-row min-[1400px]:items-end min-[1400px]:justify-between">
      <div role="tablist" aria-label="Audit views" className="custom-scrollbar -mx-1 flex items-center gap-0.5 overflow-x-auto px-1">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={m.id === mode} onClick={() => onMode(m.id)} className="rv-tab shrink-0">
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-2.5">
        <div className={`relative min-w-[140px] flex-1 transition-opacity min-[1400px]:w-[260px] min-[1400px]:flex-none ${active.search ? '' : 'opacity-40'}`}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            id="input-audit-search"
            type="text"
            aria-label="Search audit events"
            placeholder="Search event, transaction or action…"
            value={search}
            disabled={!active.search}
            onChange={(e) => onSearch(e.target.value)}
            className="rv-input pl-9 font-mono text-[12.5px] disabled:cursor-not-allowed"
          />
        </div>

        <div className={`relative transition-opacity ${active.type ? '' : 'opacity-40'}`}>
          <select
            id="select-event-type"
            aria-label="Filter by event type"
            value={eventType}
            disabled={!active.type}
            onChange={(e) => onEventType(e.target.value)}
            className="rv-input appearance-none pr-8 disabled:cursor-not-allowed"
          >
            {EVENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        </div>

        <button id="btn-refresh-audit" onClick={onRefresh} disabled={loading} aria-label="Refresh audit trail" className="rv-btn rv-btn-secondary">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        {updatedLabel && <span className="rv-ts hidden 2xl:inline">{updatedLabel}</span>}
      </div>
    </div>
  );
};
