'use client';

import React, { useMemo } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { formatINR, formatPct } from '@/lib/format';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { AnalyzeResponse, RecoverResponse, ScanResponse } from '@/lib/types';

interface RevenueFlowSystemProps {
  scanData: ScanResponse | null;
  analyzeData: AnalyzeResponse | null;
  recoverData: RecoverResponse | null;
  onSelectCategory: (leakType: string) => void;
  highlightLeakType?: string | null;
}

const CATEGORY_META: Record<string, { label: string; stroke: string; dot: string }> = {
  failed_payment: { label: 'Failed Payments', stroke: '#F5484F', dot: '#FF8A8F' },
  abandoned_checkout: { label: 'Abandoned Checkouts', stroke: '#F5A623', dot: '#FFD37A' },
  failed_subscription: { label: 'Subscription Failures', stroke: '#8B5CF6', dot: '#B69AFF' },
  overdue_invoice: { label: 'Overdue Invoices', stroke: '#4F6EF7', dot: '#8FA3FF' },
};

const VB_W = 920;
const VB_H = 260;
const CENTER_X = VB_W / 2;
const NODE_Y = 190;
const TOP_Y = 34;

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * REVORA's signature: revenue in motion. Each risk category is a
 * proportionally-weighted stream flowing into a single point of
 * intelligence — the REVORA mark itself, not a generic node — and back out
 * toward recovery. Width tells the story before a single number is read.
 * Sits directly on the canvas; the visualization IS the surface.
 */
export const RevenueFlowSystem: React.FC<RevenueFlowSystemProps> = ({
  scanData,
  analyzeData,
  recoverData,
  onSelectCategory,
  highlightLeakType,
}) => {
  const reduceMotion = useReducedMotion();
  const breakdown = useMemo(
    () => [...(scanData?.breakdown || [])].sort((a, b) => b.amount_at_risk - a.amount_at_risk),
    [scanData]
  );
  const atRisk = scanData?.total_at_risk || 0;
  const recoverable = analyzeData?.realistically_recoverable || 0;
  const recovered = recoverData?.total_recovered || 0;
  const maxAmount = Math.max(1, ...breakdown.map((b) => b.amount_at_risk));

  const streams = useMemo(() => {
    const n = breakdown.length;
    if (n === 0) return [];
    return breakdown.map((item, i) => {
      const x = ((i + 1) / (n + 1)) * VB_W;
      const width = 1.5 + (item.amount_at_risk / maxAmount) * 13;
      const path = `M ${x} ${TOP_Y} C ${x} ${TOP_Y + 70}, ${CENTER_X} ${NODE_Y - 90}, ${CENTER_X} ${NODE_Y}`;
      const meta = CATEGORY_META[item.leak_type] || { label: item.leak_type, stroke: '#4F6EF7', dot: '#8FA3FF' };
      return { ...item, x, width, path, meta };
    });
  }, [breakdown, maxAmount]);

  return (
    <div>
      {/* Hero: revenue at risk */}
      <div className="flex flex-col items-center text-center">
        <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-muted">Revenue at Risk</span>
        <AnimatedNumber
          value={atRisk}
          format={(v) => formatINR(v, true)}
          className="mt-1 text-5xl sm:text-6xl font-display font-semibold text-text-primary tracking-tight tabular-nums"
        />
        <span className="mt-1.5 text-[12px] text-text-muted">
          {scanData?.total_transactions_scanned || 0} transactions across {streams.length} risk categories
        </span>
      </div>

      {/* The flow */}
      <div className="mt-4 relative">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="revora-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="revora-outflow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5FE3AD" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#5FE3AD" stopOpacity="0" />
            </linearGradient>
          </defs>

          {streams.length === 0 ? (
            <text x={CENTER_X} y={NODE_Y} textAnchor="middle" fontSize={13} className="fill-text-muted">
              No revenue leaks detected yet — run a scan to populate the flow.
            </text>
          ) : (
            streams.map((s) => {
              const dimmed = highlightLeakType && highlightLeakType !== s.leak_type;
              const focused = highlightLeakType === s.leak_type;
              return (
                <g
                  key={s.leak_type}
                  onClick={() => onSelectCategory(s.leak_type)}
                  className="cursor-pointer"
                  style={{ opacity: dimmed ? 0.28 : 1, transition: 'opacity 300ms ease' }}
                >
                  <path
                    d={s.path}
                    fill="none"
                    stroke={s.meta.stroke}
                    strokeOpacity={focused ? 0.85 : 0.38}
                    strokeWidth={focused ? s.width * 1.35 : s.width}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-width 300ms ease, stroke-opacity 300ms ease' }}
                  />
                  {!reduceMotion && (
                    <motion.circle
                      r={2.6}
                      fill={s.meta.dot}
                      initial={{
                        cx: cubicPoint(0, s.x, s.x, CENTER_X, CENTER_X),
                        cy: cubicPoint(0, TOP_Y, TOP_Y + 70, NODE_Y - 90, NODE_Y),
                      }}
                      animate={{
                        cx: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, s.x, s.x, CENTER_X, CENTER_X)),
                        cy: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, TOP_Y, TOP_Y + 70, NODE_Y - 90, NODE_Y)),
                      }}
                      transition={{ duration: 2.6, repeat: Infinity, ease: 'linear', delay: s.x / 900 }}
                    />
                  )}

                  {/* Label + amount, anchored above each stream. fontSize is a
                      presentation attribute (viewBox units), not inline style —
                      React auto-appends "px" to style.fontSize even on SVG
                      elements, which would stop the text scaling with the
                      diagram on resize. */}
                  <text x={s.x} y={TOP_Y - 16} textAnchor="middle" fontSize={12} fontWeight={500} className="fill-text-secondary">
                    {s.meta.label}
                  </text>
                  <text x={s.x} y={TOP_Y - 2} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-text-primary font-mono">
                    {formatINR(s.amount_at_risk)}
                  </text>
                  <circle cx={s.x} cy={TOP_Y} r={3.5} fill={s.meta.dot} />
                </g>
              );
            })
          )}

          {/* REVORA node */}
          <circle cx={CENTER_X} cy={NODE_Y} r={46} fill="url(#revora-core-glow)" />
          {!reduceMotion && (
            <motion.circle
              cx={CENTER_X}
              cy={NODE_Y}
              r={30}
              fill="none"
              stroke="#8B5CF6"
              strokeOpacity={0.3}
              animate={{ r: [26, 34, 26], strokeOpacity: [0.35, 0.1, 0.35] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <circle cx={CENTER_X} cy={NODE_Y} r={24} className="fill-panel" stroke="#8B5CF6" strokeOpacity={0.4} />

          {/* Outflow toward recovery */}
          <rect x={CENTER_X - 3} y={NODE_Y + 24} width={6} height={VB_H - NODE_Y - 24} fill="url(#revora-outflow)" />
        </svg>

        {/* REVORA mark sits exactly at the convergence point */}
        <div
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            left: `${(CENTER_X / VB_W) * 100}%`,
            top: `${(NODE_Y / VB_H) * 100}%`,
            width: `${(48 / VB_W) * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="relative w-full" style={{ aspectRatio: '1 / 1' }}>
            <Image src="/brand/revora-mark-transparent.png" alt="" fill className="object-contain" />
          </div>
        </div>
      </div>

      {/* Outputs: potential recovery + recovered so far */}
      <div className="flex items-center justify-center gap-10 sm:gap-16 -mt-2">
        <div className="flex flex-col items-center text-center">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-ai-400">Potential Recovery</span>
          <AnimatedNumber
            value={recoverable}
            format={(v) => formatINR(v, true)}
            className="mt-1 text-2xl sm:text-3xl font-display font-semibold text-ai-300 tracking-tight tabular-nums"
          />
          <span className="mt-1 text-[11px] text-text-muted">{formatPct(analyzeData?.avg_recovery_probability || 0)} avg. likelihood</span>
        </div>
        <div className="w-px h-10 bg-border-subtle" />
        <div className="flex flex-col items-center text-center">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-success-400">Recovered</span>
          <AnimatedNumber
            value={recovered}
            format={(v) => formatINR(v, true)}
            className="mt-1 text-2xl sm:text-3xl font-display font-semibold text-success-300 tracking-tight tabular-nums"
          />
          <span className="mt-1 text-[11px] text-text-muted">{formatPct(recoverData?.recovery_rate_pct || 0)} recovery rate</span>
        </div>
      </div>
    </div>
  );
};
