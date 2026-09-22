'use client';

import React, { useState } from 'react';
import { PieChart, TrendingDown } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { ScanResponse } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';

interface LeakBreakdownChartProps {
  scanData: ScanResponse | null;
}

const CATEGORY_MAP: Record<string, { label: string; color: string; bg: string }> = {
  failed_payment: { label: 'Failed Payments', color: 'bg-risk-500', bg: 'bg-risk-500/10' },
  abandoned_checkout: { label: 'Abandoned Checkouts', color: 'bg-warning-500', bg: 'bg-warning-500/10' },
  failed_subscription: { label: 'Subscription Failures', color: 'bg-ai-500', bg: 'bg-ai-500/10' },
  overdue_invoice: { label: 'Overdue Invoices', color: 'bg-primary-500', bg: 'bg-primary-500/10' },
};

export const LeakBreakdownChart: React.FC<LeakBreakdownChartProps> = ({ scanData }) => {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const breakdown = scanData?.breakdown || [];
  const totalAtRisk = scanData?.total_at_risk || 1;

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Revenue Leak Breakdown</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Categorized risk universe from detection engine</p>
          </div>
          <div className="p-2 rounded-lg bg-surface border border-border-subtle text-text-muted">
            <TrendingDown className="w-4 h-4" />
          </div>
        </div>

        {/* Breakdown Items */}
        <div className="mt-5 space-y-4">
          {breakdown.length === 0 ? (
            <div className="text-text-muted text-[13px] py-8 text-center flex flex-col items-center border border-dashed border-border-subtle rounded-lg">
              <PieChart className="w-8 h-8 text-text-muted/50 mb-2" />
              <span>No revenue leaks detected.</span>
              <span className="text-[11px] mt-1">Click "Scan Revenue" to initialize.</span>
            </div>
          ) : (
            breakdown.map((item) => {
              const meta = CATEGORY_MAP[item.leak_type] || {
                label: item.leak_type,
                color: 'bg-primary-500',
                bg: 'bg-primary-500/10',
              };
              const pct = (item.amount_at_risk / totalAtRisk) * 100;
              const isHovered = hoveredItem === item.leak_type;
              const isOtherHovered = hoveredItem !== null && hoveredItem !== item.leak_type;

              return (
                <motion.div 
                  key={item.leak_type} 
                  className={`space-y-2 cursor-pointer transition-opacity duration-200 ${isOtherHovered ? 'opacity-40' : 'opacity-100'}`}
                  onMouseEnter={() => setHoveredItem(item.leak_type)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <div className="flex items-center justify-between text-[13px]">
                    <div className="flex items-center space-x-2.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${meta.color} shadow-sm`} />
                      <span className={`font-medium transition-colors ${isHovered ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {meta.label}
                      </span>
                      <span className="text-text-muted font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle">
                        {item.count}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 font-mono">
                      <span className={`font-semibold transition-colors ${isHovered ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {formatINR(item.amount_at_risk)}
                      </span>
                      <span className="text-text-muted text-[12px] w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-surface border border-border-subtle/50 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, pct)}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className={`h-full rounded-full ${meta.color} ${isHovered ? 'opacity-100 shadow-[0_0_8px_rgba(255,255,255,0.2)]' : 'opacity-80'} transition-all`}
                    />
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* Summary Footer */}
      <div className="mt-6 pt-4 border-t border-border-subtle flex items-center justify-between text-[13px]">
        <span className="text-text-muted font-medium">Total Risk Universe</span>
        <span className="font-display text-text-primary font-semibold text-lg">{formatINR(totalAtRisk)}</span>
      </div>
    </div>
  );
};
