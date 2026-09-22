'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanEye } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatINR } from '@/lib/format';
import { ScanResponse } from '@/lib/types';
import { mulberry32 } from './seededRandom';

interface RiskDensityMapProps {
  scanData: ScanResponse;
}

const CATEGORY_META: Record<string, { label: string; color: string; text: string }> = {
  failed_payment: { label: 'Failed Payments', color: '#F5484F', text: 'text-risk-300' },
  overdue_invoice: { label: 'Overdue Invoices', color: '#4F6EF7', text: 'text-primary-300' },
  abandoned_checkout: { label: 'Abandoned Checkouts', color: '#F5A623', text: 'text-warning-300' },
  failed_subscription: { label: 'Subscription Failures', color: '#8B5CF6', text: 'text-ai-300' },
};

const VB_W = 900;
const VB_H = 64;
const DOT_BUDGET = 70; // total texture dots across the whole strip

/**
 * Where the risk concentrates — rendered as a density field (width = share
 * of revenue at risk, dot texture = share of transaction count), the same
 * visual language as the scan field above, not four flat bars. Hovering a
 * category card lights up its segment; clicking deep-links into the
 * existing filtered Transactions view.
 */
export const RiskDensityMap: React.FC<RiskDensityMapProps> = ({ scanData }) => {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const total = scanData.total_at_risk || 1;
  const totalCount = scanData.breakdown.reduce((s, b) => s + b.count, 0) || 1;

  const segments = useMemo(() => {
    const ranked = [...scanData.breakdown].sort((a, b) => b.amount_at_risk - a.amount_at_risk);
    let cursorX = 0;
    return ranked.map((item, idx) => {
      const widthPct = item.amount_at_risk / total;
      const w = widthPct * VB_W;
      const x = cursorX;
      cursorX += w;
      const meta = CATEGORY_META[item.leak_type] || { label: item.leak_type, color: '#4F6EF7', text: 'text-primary-300' };
      const dotCount = Math.max(1, Math.round((item.count / totalCount) * DOT_BUDGET));
      const rng = mulberry32(500 + idx * 37);
      const dots = Array.from({ length: dotCount }, () => ({
        x: x + rng() * w,
        y: rng() * VB_H,
      }));
      return { ...item, meta, x, w, dots, pct: widthPct * 100 };
    });
  }, [scanData, total, totalCount]);

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-primary-400">
            <ScanEye className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Revenue Leak Map</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Density by transaction count, width by revenue at risk</p>
          </div>
        </div>
      </div>

      {/* Risk density strip */}
      <div className="mt-5 rounded-md border border-border-subtle bg-surface/60 overflow-hidden">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto block" preserveAspectRatio="none">
          {segments.map((seg) => {
            const dimmed = active && active !== seg.leak_type;
            return (
              <g key={seg.leak_type} style={{ opacity: dimmed ? 0.32 : 1, transition: 'opacity 250ms ease' }}>
                <rect x={seg.x} y={0} width={seg.w} height={VB_H} fill={seg.meta.color} opacity={0.08} />
                {seg.dots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r={1.5} fill={seg.meta.color} opacity={active === seg.leak_type ? 0.95 : 0.65} />
                ))}
                {seg.w > 6 && <rect x={seg.x} y={0} width={1} height={VB_H} fill="#080B12" opacity={0.6} />}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Diagnostic cards */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {segments.map((seg, i) => (
          <motion.button
            key={seg.leak_type}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.25 }}
            onMouseEnter={() => setActive(seg.leak_type)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(seg.leak_type)}
            onBlur={() => setActive(null)}
            onClick={() => router.push(`/transactions?leak_type=${seg.leak_type}`)}
            className="text-left rounded-lg border border-border-subtle bg-surface px-4 py-3.5 hover:border-primary-500/40 hover:bg-panel-hover transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.meta.color }} />
                <span className="text-[13.5px] font-medium text-text-primary">{seg.meta.label}</span>
              </div>
              <span className={`text-[11px] font-mono font-bold ${seg.meta.text}`}>{seg.pct.toFixed(1)}%</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-[12px] text-text-muted font-mono">{seg.count.toLocaleString()} transactions</span>
              <span className="font-mono font-semibold text-text-primary text-[14px]">{formatINR(seg.amount_at_risk)}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};
