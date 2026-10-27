'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { AuditEvent } from '@/lib/types';
import { EventRow } from '@/components/grammar';
import { describeEvent } from './auditSignals';

const PAGE = 40;

interface Props {
  events: AuditEvent[];
  matched: number | null;
  /** Events loaded from the server before any search is applied. */
  windowCount: number;
  searching: boolean;
  selectedTxId: string | null;
  onSelect: (evt: AuditEvent) => void;
  loading: boolean;
  /** True when the log itself is empty (as opposed to a filter matching nothing). */
  logEmpty: boolean;
  filtersActive: boolean;
  remoteQuery: string | null;
  autoRefresh: boolean;
  /** Transaction amounts known so far, by transaction id. Rows without one simply show no figure. */
  amounts: Record<string, number>;
  /** Asks the page to look up amounts for the transactions on screen. */
  onNeedAmounts: (transactionIds: string[]) => void;
}

/**
 * The financial event ledger: every audit event, newest first, set as hairline
 * rows under one column header — not a stack of cards. Each row reads business
 * event ("Recovery blocked") → context ("Retry payment stopped by policy · …") →
 * technical metadata (the case reference and the ACTION_BLOCKED constant).
 * Rows belonging to the case open in the record panel are marked, so the
 * lineage of one recovery is visible down the ledger.
 */
export const EventStream: React.FC<Props> = ({
  events,
  matched,
  windowCount,
  searching,
  selectedTxId,
  onSelect,
  loading,
  logEmpty,
  filtersActive,
  remoteQuery,
  autoRefresh,
  amounts,
  onNeedAmounts,
}) => {
  const [visible, setVisible] = useState(PAGE);
  const shown = useMemo(() => events.slice(0, visible), [events, visible]);

  // Amounts live on the transactions, not the audit events — look up only the ones on screen.
  useEffect(() => {
    onNeedAmounts(Array.from(new Set(shown.map((e) => e.transaction_id))));
  }, [shown, onNeedAmounts]);

  return (
    <section className="rv-surface flex min-w-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h3 className="rv-section-title">Event ledger</h3>
          <p className="rv-meta mt-0.5 truncate">
            {remoteQuery
              ? `Matches for ${remoteQuery} from the full log`
              : searching
              ? `${events.length.toLocaleString('en-IN')} ${events.length === 1 ? 'match' : 'matches'} in the latest ${windowCount.toLocaleString('en-IN')} events`
              : matched != null && matched > windowCount
              ? `Latest ${windowCount.toLocaleString('en-IN')} of ${matched.toLocaleString('en-IN')} events · newest first`
              : `${windowCount.toLocaleString('en-IN')} ${windowCount === 1 ? 'event' : 'events'} · newest first`}
          </p>
        </div>
        {autoRefresh && (
          <span className="rv-state shrink-0" data-tone="success" title="Refreshes automatically every 20 seconds">
            <span aria-hidden className="rv-dot" data-live />
            Live
          </span>
        )}
      </header>

      <div className="rv-ledger">
        {loading && events.length === 0 ? (
          <LedgerSkeleton />
        ) : events.length === 0 ? (
          <EmptyLedger logEmpty={logEmpty} filtersActive={filtersActive} />
        ) : (
          <>
            <div className="rv-event-head" aria-hidden>
              <div className="rv-event-body" data-titled="">
                <span className="rv-event-type rv-label">Event</span>
                <span className="rv-event-subject rv-label">Case</span>
                <span className="rv-event-time rv-label">Time</span>
                <span className="rv-event-amount rv-label">Amount</span>
                <span className="rv-event-state rv-label">State</span>
              </div>
            </div>
            <div role="list">
              {shown.map((evt) => {
                const v = describeEvent(evt);
                const recovered = evt.event_type === 'EXECUTION_SUCCEEDED' ? evt.outcome?.recovered_amount ?? 0 : 0;
                const reason = [v.title, v.reason].filter(Boolean).join(' · ');
                return (
                  <EventRow
                    key={evt.event_id}
                    type={evt.event_type}
                    title={v.headline}
                    entity={evt.transaction_id}
                    timestamp={evt.timestamp}
                    timeFormat="auto"
                    actor={v.actor ?? undefined}
                    reason={<span title={reason}>{reason}</span>}
                    delta={recovered > 0 ? recovered : undefined}
                    amount={recovered > 0 ? undefined : amounts[evt.transaction_id]}
                    status={v.chip ? { label: v.chip.text, tone: v.chip.tone } : undefined}
                    next={v.next ? `→ ${v.next}` : undefined}
                    selected={evt.transaction_id === selectedTxId}
                    onClick={() => onSelect(evt)}
                  />
                );
              })}
            </div>
          </>
        )}
        {events.length > visible && (
          <button
            onClick={() => setVisible((n) => n + PAGE)}
            className="w-full border-t border-border-divider py-2.5 text-[11.5px] text-text-muted transition-colors hover:bg-panel-hover/55 hover:text-text-primary"
          >
            Show {Math.min(PAGE, events.length - visible)} more of {events.length - visible}
          </button>
        )}
      </div>
    </section>
  );
};

const LedgerSkeleton: React.FC = () => (
  <div className="animate-pulse">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-4 border-b border-border-divider px-4 py-3.5">
        <div className="h-2 w-2 shrink-0 rounded-full bg-border-strong/60" />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-44 rounded bg-border-strong/60" />
          <div className="h-2 w-28 rounded bg-border-subtle" />
        </div>
        <div className="h-3 w-16 rounded bg-border-subtle" />
      </div>
    ))}
  </div>
);

const EmptyLedger: React.FC<{ logEmpty: boolean; filtersActive: boolean }> = ({ logEmpty, filtersActive }) => (
  <div className="px-6 py-12 text-center">
    <History strokeWidth={1.5} className="mx-auto mb-3 h-9 w-9 text-text-muted/40" />
    {logEmpty && !filtersActive ? (
      <>
        <p className="text-[13px] font-medium text-text-primary">No audit events recorded yet</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-text-muted">
          Every decision and action is written here the moment it happens. Scan your revenue and run an intelligence pass to start the trail.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link href="/revenue-scanner" className="rv-btn rv-btn-secondary rv-btn-sm">
            Open Revenue Scanner
          </Link>
          <Link href="/recovery-brain" className="rv-btn rv-btn-secondary rv-btn-sm">
            Open Recovery Brain
          </Link>
        </div>
      </>
    ) : (
      <>
        <p className="text-[13px] font-medium text-text-primary">No events match</p>
        <p className="mt-1.5 text-[12px] text-text-muted">Try a different search or event type.</p>
      </>
    )}
  </div>
);
