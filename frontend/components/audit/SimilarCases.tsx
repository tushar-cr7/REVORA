'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { formatTimeAgo } from '@/lib/format';
import { actionLabel } from '@/lib/actionMeta';
import { Amount, StateIndicator } from '@/components/grammar';
import { leakLabel } from '@/components/interventions/interventionSignals';
import { SimilarCase, SimilarCases as SimilarResult } from './auditSignals';

interface Props {
  result: SimilarResult | null;
  loading: boolean;
  leakType: string | null;
  action: string | null;
  onSelect: (transactionId: string) => void;
}

const STATUS: Record<SimilarCase['status'], { text: string; kind: 'outcome' | 'escalation'; tone: 'success' | 'neutral' | 'warning' }> = {
  recovered: { text: 'Recovered', kind: 'outcome', tone: 'success' },
  attempted_no_recovery: { text: 'Not recovered', kind: 'outcome', tone: 'neutral' },
  escalated_to_merchant: { text: 'Escalated', kind: 'escalation', tone: 'warning' },
  suppressed: { text: 'Suppressed', kind: 'outcome', tone: 'neutral' },
};

/**
 * Other transactions of the same leak type that REVORA handled with the same
 * action and that have a recorded outcome. Everything shown is read from the
 * loaded intervention records — when none exist the section says so rather
 * than inventing comparable cases.
 */
export const SimilarCases: React.FC<Props> = ({ result, loading, leakType, action, onSelect }) => (
  <section>
    <div className="flex items-center justify-between gap-3">
      <div className="rv-label">Comparable cases</div>
      {result && result.total > 0 && (
        <span className="rv-ts">
          {result.recoveredCount} of {result.total} recovered
        </span>
      )}
    </div>

    {loading ? (
      <div className="mt-3 space-y-2.5 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 rounded bg-border-subtle" />
        ))}
      </div>
    ) : !result || result.total === 0 ? (
      <p className="mt-2.5 text-[12px] leading-relaxed text-text-muted">
        {leakType && action
          ? `No other ${leakLabel(leakType).toLowerCase()} cases handled with ${actionLabel(action).toLowerCase()} have a recorded outcome yet. They appear here once they do.`
          : 'Comparable cases appear once this record has an action.'}
      </p>
    ) : (
      <>
        <ul className="mt-2.5">
          {result.cases.map((c) => {
            const s = STATUS[c.status];
            return (
              <li key={c.transactionId} className="border-t border-border-divider first:border-t-0">
                <button
                  onClick={() => onSelect(c.transactionId)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-panel-hover/55 focus:outline-none focus-visible:bg-panel-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="rv-id block truncate">{c.transactionId}</span>
                    <span className="rv-meta mt-0.5 block">{formatTimeAgo(c.timestamp)}</span>
                  </span>
                  <Amount value={c.amount} size="xs" />
                  <StateIndicator label={s.text} kind={s.kind} tone={s.tone} />
                  <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="rv-meta mt-2 leading-relaxed">
          Same leak type, same action, outcome on record — {result.total} {result.total === 1 ? 'case' : 'cases'} in loaded history.
        </p>
      </>
    )}
  </section>
);
