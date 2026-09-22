'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { ScanResponse } from '@/lib/types';

interface ScanInsightsProps {
  scanData: ScanResponse;
}

const LABEL: Record<string, string> = {
  failed_payment: 'Failed Payments',
  overdue_invoice: 'Overdue Invoices',
  abandoned_checkout: 'Abandoned Checkouts',
  failed_subscription: 'Subscription Failures',
};

/**
 * "What REVORA discovered" — generated entirely from the real ranked
 * breakdown, worded by rank position (largest / mid-tier / smallest)
 * rather than hardcoded to any specific category, so it stays honest
 * regardless of which leak type actually dominates a given scan.
 */
export const ScanInsights: React.FC<ScanInsightsProps> = ({ scanData }) => {
  const insights = useMemo(() => {
    const total = scanData.total_at_risk || 1;
    const ranked = [...scanData.breakdown].sort((a, b) => b.amount_at_risk - a.amount_at_risk);
    return ranked.map((item, i) => {
      const pct = (item.amount_at_risk / total) * 100;
      const label = LABEL[item.leak_type] || item.leak_type;
      const isLast = i === ranked.length - 1 && ranked.length > 1;
      const headline =
        i === 0
          ? `${label} is your largest leak`
          : isLast
          ? `${label} is minimal`
          : `${label} needs attention`;
      const detail =
        i === 0 || isLast
          ? `${pct.toFixed(1)}% of total revenue at risk`
          : `${formatINR(item.amount_at_risk)} across ${item.count.toLocaleString()} transactions`;
      return { leakType: item.leak_type, headline, detail };
    });
  }, [scanData]);

  if (insights.length === 0) return null;

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3 pb-4 border-b border-border-subtle">
        <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-ai-400">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Scan Insights</h3>
          <p className="text-text-muted text-[12px] mt-0.5">What REVORA discovered</p>
        </div>
      </div>

      <div className="mt-3 divide-y divide-border-subtle">
        {insights.map((insight) => (
          <Link
            key={insight.leakType}
            href={`/transactions?leak_type=${insight.leakType}`}
            className="flex items-center justify-between py-3 group hover:bg-surface/50 transition-colors -mx-5 px-5"
          >
            <div>
              <div className="text-[13.5px] font-medium text-text-primary">{insight.headline}</div>
              <div className="text-[12px] text-text-muted mt-0.5">{insight.detail}</div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
};
