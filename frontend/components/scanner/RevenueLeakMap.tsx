'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Map } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatINR } from '@/lib/format';
import { ScanResponse } from '@/lib/types';

interface RevenueLeakMapProps {
  scanData: ScanResponse;
}

const CATEGORY_META: Record<string, { label: string; bar: string; text: string; border: string }> = {
  failed_payment: { label: 'Failed Payments', bar: 'bg-risk-500', text: 'text-risk-300', border: 'border-risk-500/30' },
  overdue_invoice: { label: 'Overdue Invoices', bar: 'bg-primary-500', text: 'text-primary-300', border: 'border-primary-500/30' },
  abandoned_checkout: { label: 'Abandoned Checkouts', bar: 'bg-warning-500', text: 'text-warning-300', border: 'border-warning-500/30' },
  failed_subscription: { label: 'Subscription Failures', bar: 'bg-ai-500', text: 'text-ai-300', border: 'border-ai-500/30' },
};

/**
 * The shape of the risk universe at a glance (one proportional bar), then
 * the detail underneath — dual-encoded on both transaction count and
 * revenue amount so the relationship between "how often" and "how much"
 * is never left to guesswork. Each row deep-links into the existing
 * filtered Transactions view.
 */
export const RevenueLeakMap: React.FC<RevenueLeakMapProps> = ({ scanData }) => {
  const router = useRouter();
  const total = scanData.total_at_risk || 1;
  const ranked = useMemo(
    () => [...scanData.breakdown].sort((a, b) => b.amount_at_risk - a.amount_at_risk),
    [scanData.breakdown]
  );

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-primary-400">
            <Map className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Revenue Leak Map</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Where risk concentrates, by count and by value</p>
          </div>
        </div>
      </div>

      {/* Proportional overview — one bar, the whole risk universe */}
      <div className="mt-5 h-3 w-full rounded-full overflow-hidden flex bg-surface border border-border-subtle/50">
        {ranked.map((item) => {
          const meta = CATEGORY_META[item.leak_type] || { label: item.leak_type, bar: 'bg-primary-500', text: 'text-primary-300', border: 'border-primary-500/30' };
          const pct = (item.amount_at_risk / total) * 100;
          return (
            <motion.div
              key={item.leak_type}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className={`h-full ${meta.bar} first:rounded-l-full last:rounded-r-full`}
            />
          );
        })}
      </div>

      {/* Ranked detail */}
      <div className="mt-5 divide-y divide-border-subtle">
        {ranked.map((item, i) => {
          const meta = CATEGORY_META[item.leak_type] || { label: item.leak_type, bar: 'bg-primary-500', text: 'text-primary-300', border: 'border-primary-500/30' };
          const pct = (item.amount_at_risk / total) * 100;
          return (
            <button
              key={item.leak_type}
              onClick={() => router.push(`/transactions?leak_type=${item.leak_type}`)}
              className="w-full text-left py-3.5 group hover:bg-surface/50 transition-colors -mx-5 px-5"
            >
              <div className="flex items-center gap-4">
                <span className="font-display font-semibold text-lg text-text-muted opacity-60 w-7 shrink-0 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.bar}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text-primary">{meta.label}</div>
                  <div className="text-[12px] text-text-muted font-mono mt-0.5">{item.count.toLocaleString()} transactions</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-semibold text-text-primary text-[14px]">{formatINR(item.amount_at_risk)}</div>
                  <div className={`text-[11px] font-mono font-bold mt-0.5 ${meta.text}`}>{pct.toFixed(1)}% of risk</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
