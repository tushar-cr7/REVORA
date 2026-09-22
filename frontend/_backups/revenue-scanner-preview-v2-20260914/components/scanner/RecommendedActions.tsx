'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Zap, ArrowRight } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { ScanResponse } from '@/lib/types';

interface RecommendedActionsProps {
  scanData: ScanResponse;
}

const ACTION_META: Record<string, { verb: string; icon: string }> = {
  failed_payment: { verb: 'Retry failed payments', icon: '↻' },
  overdue_invoice: { verb: 'Send payment reminders', icon: '✉' },
  abandoned_checkout: { verb: 'Recover abandoned checkouts', icon: '↗' },
  failed_subscription: { verb: 'Fix subscription issues', icon: '⚙' },
};

/**
 * Recommendations only — these are entry points into the existing,
 * policy-governed workflows, never a way to execute anything directly.
 * REVORA's deterministic policy engine still gates every real action;
 * this panel just points at where to go next.
 */
export const RecommendedActions: React.FC<RecommendedActionsProps> = ({ scanData }) => {
  const ranked = useMemo(
    () => [...scanData.breakdown].sort((a, b) => b.amount_at_risk - a.amount_at_risk),
    [scanData.breakdown]
  );

  if (ranked.length === 0) return null;

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3 pb-4 border-b border-border-subtle">
        <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-warning-400">
          <Zap className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Recommended Actions</h3>
          <p className="text-text-muted text-[12px] mt-0.5">Based on scan results — governed by REVORA&apos;s policy engine</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ranked.map((item) => {
          const meta = ACTION_META[item.leak_type] || { verb: `Review ${item.leak_type}`, icon: '→' };
          return (
            <Link
              key={item.leak_type}
              href={`/transactions?leak_type=${item.leak_type}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3.5 hover:border-primary-500/40 hover:bg-panel-hover transition-colors"
            >
              <div>
                <div className="text-[13.5px] font-medium text-text-primary">{meta.verb}</div>
                <div className="text-[12px] text-text-muted font-mono mt-0.5">{formatINR(item.amount_at_risk)} potential exposure</div>
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-primary-400 group-hover:translate-x-0.5 transition-all shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
};
