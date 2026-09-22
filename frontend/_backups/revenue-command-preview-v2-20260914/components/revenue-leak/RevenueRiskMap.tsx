'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, ArrowDownRight, ArrowRight } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { AnalyzeResponse, ScanResponse } from '@/lib/types';
import { motion } from 'framer-motion';

interface RevenueRiskMapProps {
  scanData: ScanResponse | null;
  analyzeData: AnalyzeResponse | null;
}

const CATEGORY_MAP: Record<string, { label: string; color: string; bar: string }> = {
  failed_payment: { label: 'Failed Payments', color: 'text-risk-300', bar: 'bg-risk-500' },
  abandoned_checkout: { label: 'Abandoned Checkouts', color: 'text-warning-300', bar: 'bg-warning-500' },
  failed_subscription: { label: 'Subscription Failures', color: 'text-ai-300', bar: 'bg-ai-500' },
  overdue_invoice: { label: 'Overdue Invoices', color: 'text-primary-300', bar: 'bg-primary-500' },
};

/**
 * Where the money is, and where it's headed. Replaces the old "Revenue Leak
 * Breakdown" list with a compact risk map that reads as a single flow —
 * each category is proportional and clickable straight into the filtered
 * transaction list, and the bottom row ties the whole risk universe to the
 * recovery total instead of leaving it as an unconnected number.
 */
export const RevenueRiskMap: React.FC<RevenueRiskMapProps> = ({ scanData, analyzeData }) => {
  const router = useRouter();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const breakdown = scanData?.breakdown || [];
  const totalAtRisk = scanData?.total_at_risk || 1;
  const recoverable = analyzeData?.realistically_recoverable || 0;

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Revenue Risk Map</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Where revenue is leaking, ordered by size</p>
          </div>
          <div className="p-2 rounded-lg bg-surface border border-border-subtle text-text-muted">
            <PieChart className="w-4 h-4" />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {breakdown.length === 0 ? (
            <div className="text-text-muted text-[13px] py-8 text-center flex flex-col items-center border border-dashed border-border-subtle rounded-lg">
              <PieChart className="w-8 h-8 text-text-muted/50 mb-2" />
              <span>No revenue leaks detected.</span>
              <span className="text-[11px] mt-1">Click "Scan Revenue" to initialize.</span>
            </div>
          ) : (
            [...breakdown]
              .sort((a, b) => b.amount_at_risk - a.amount_at_risk)
              .map((item) => {
                const meta = CATEGORY_MAP[item.leak_type] || { label: item.leak_type, color: 'text-primary-300', bar: 'bg-primary-500' };
                const pct = (item.amount_at_risk / totalAtRisk) * 100;
                const isHovered = hoveredItem === item.leak_type;
                const isOtherHovered = hoveredItem !== null && hoveredItem !== item.leak_type;

                return (
                  <motion.button
                    key={item.leak_type}
                    onClick={() => router.push(`/transactions?leak_type=${item.leak_type}`)}
                    onMouseEnter={() => setHoveredItem(item.leak_type)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={`w-full text-left group transition-opacity duration-200 ${isOtherHovered ? 'opacity-40' : 'opacity-100'}`}
                  >
                    <div className="flex items-center justify-between text-[13px] mb-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`font-medium transition-colors ${isHovered ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {meta.label}
                        </span>
                        <span className="text-text-muted font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle">
                          {item.count}
                        </span>
                        <ArrowRight className={`w-3 h-3 text-text-muted transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`} />
                      </div>
                      <div className="flex items-center gap-3 font-mono">
                        <span className={`font-semibold transition-colors ${isHovered ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {formatINR(item.amount_at_risk)}
                        </span>
                        <span className="text-text-muted text-[12px] w-11 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface border border-border-subtle/50 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(2, pct)}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className={`h-full rounded-full ${meta.bar} ${isHovered ? 'opacity-100' : 'opacity-75'} transition-opacity`}
                      />
                    </div>
                  </motion.button>
                );
              })
          )}
        </div>
      </div>

      {/* Flow to recovery */}
      <div className="mt-6 pt-4 border-t border-border-subtle flex items-center justify-between text-[13px]">
        <div className="flex items-center gap-2 text-text-muted">
          <span className="font-medium">Total Risk Universe</span>
          <span className="font-display text-text-primary font-semibold text-base">{formatINR(totalAtRisk)}</span>
        </div>
        {recoverable > 0 && (
          <div className="flex items-center gap-1.5 text-ai-300">
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span className="font-display font-semibold text-base">{formatINR(recoverable)}</span>
            <span className="text-text-muted text-[11px]">recoverable</span>
          </div>
        )}
      </div>
    </div>
  );
};
