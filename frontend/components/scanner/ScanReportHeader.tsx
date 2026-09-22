'use client';

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ScanResponse, AnalyzeResponse } from '@/lib/types';

interface ScanReportHeaderProps {
  scanData: ScanResponse;
  analyzeData: AnalyzeResponse | null;
  scanCompletedAt: Date | null;
}

/**
 * The scan's headline numbers, presented as one instrument rather than
 * three separate cards — a single panel with a shared status row so the
 * three figures read as outputs of the same event.
 */
export const ScanReportHeader: React.FC<ScanReportHeaderProps> = ({ scanData, analyzeData, scanCompletedAt }) => {
  return (
    <div className="bg-panel border border-border-strong rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-success-400" />
          <span className="text-success-300 font-semibold uppercase tracking-wider">Scan Complete</span>
        </div>
        {scanCompletedAt && (
          <span className="text-[11px] text-text-muted font-mono">Scanned {formatTimeAgo(scanCompletedAt.toISOString())}</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border-subtle">
        <div className="p-5">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Transactions Scanned</span>
          <AnimatedNumber
            value={scanData.total_transactions_scanned}
            format={(v) => Math.round(v).toLocaleString()}
            className="block mt-2 text-3xl font-display font-semibold text-text-primary tracking-tight tabular-nums"
          />
          <p className="mt-2 text-[12px] text-text-muted">Across {scanData.breakdown.length} leak categories</p>
        </div>
        <div className="p-5">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Total Revenue at Risk</span>
          <AnimatedNumber
            value={scanData.total_at_risk}
            format={(v) => formatINR(v, true)}
            className="block mt-2 text-3xl font-display font-semibold text-risk-300 tracking-tight tabular-nums"
          />
          <p className="mt-2 text-[12px] text-text-muted">Gross detected universe</p>
        </div>
        <div className="p-5">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Realistically Recoverable</span>
          {analyzeData ? (
            <>
              <AnimatedNumber
                value={analyzeData.realistically_recoverable}
                format={(v) => formatINR(v, true)}
                className="block mt-2 text-3xl font-display font-semibold text-ai-300 tracking-tight tabular-nums"
              />
              <p className="mt-2 text-[12px] text-text-muted flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-ai-400" />
                Avg. {formatPct(analyzeData.avg_recovery_probability)} recovery probability
              </p>
            </>
          ) : (
            <>
              <span className="block mt-2 text-3xl font-display font-semibold text-text-muted tracking-tight">—</span>
              <p className="mt-2 text-[12px] text-text-muted">Run an intelligence pass to compute</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
