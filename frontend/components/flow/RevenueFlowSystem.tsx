'use client';

import React, { useMemo, useState } from 'react';
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
const VB_H = 320;
const CENTER_X = VB_W / 2;
const NODE_Y = 190;
const TOP_Y = 34;
const CORE_R = 24;
const SPLIT_OFFSET = 92;

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function widthFor(amount: number, maxAmount: number) {
  return Math.min(16, 1.5 + (amount / maxAmount) * 13);
}

/**
 * REVORA's signature: revenue in motion. Risk categories flow into a
 * single point of intelligence — the REVORA mark itself — which then
 * splits the same visual language back out into what's realistically
 * recoverable and what's actually been recovered, so the filtering
 * relationship reads as one continuous system rather than three
 * disconnected numbers. Sits directly on the canvas.
 */
export const RevenueFlowSystem: React.FC<RevenueFlowSystemProps> = ({
  scanData,
  analyzeData,
  recoverData,
  onSelectCategory,
  highlightLeakType,
}) => {
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);
  const activeLeakType = highlightLeakType || hovered;

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
      const width = widthFor(item.amount_at_risk, maxAmount);
      const path = `M ${x} ${TOP_Y} C ${x} ${TOP_Y + 70}, ${CENTER_X} ${NODE_Y - 90}, ${CENTER_X} ${NODE_Y}`;
      const meta = CATEGORY_META[item.leak_type] || { label: item.leak_type, stroke: '#4F6EF7', dot: '#8FA3FF' };
      return { ...item, x, width, path, meta, isLargest: item.amount_at_risk === maxAmount };
    });
  }, [breakdown, maxAmount]);

  const recoverableWidth = widthFor(recoverable, maxAmount);
  const recoveredWidth = widthFor(recovered, maxAmount);
  const recoverablePath = `M ${CENTER_X} ${NODE_Y + CORE_R} C ${CENTER_X} ${NODE_Y + 60}, ${CENTER_X - SPLIT_OFFSET} ${VB_H - 70}, ${CENTER_X - SPLIT_OFFSET} ${VB_H}`;
  const recoveredPath = `M ${CENTER_X} ${NODE_Y + CORE_R} C ${CENTER_X} ${NODE_Y + 60}, ${CENTER_X + SPLIT_OFFSET} ${VB_H - 70}, ${CENTER_X + SPLIT_OFFSET} ${VB_H}`;

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
            <linearGradient id="revora-recoverable" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B69AFF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#B69AFF" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="revora-recovered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5FE3AD" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#5FE3AD" stopOpacity="0.35" />
            </linearGradient>
          </defs>

          {streams.length === 0 ? (
            <text x={CENTER_X} y={NODE_Y} textAnchor="middle" fontSize={13} className="fill-text-muted">
              No revenue leaks detected yet — run a scan to populate the flow.
            </text>
          ) : (
            streams.map((s, idx) => {
              const dimmed = activeLeakType && activeLeakType !== s.leak_type;
              const focused = activeLeakType === s.leak_type;
              return (
                <g
                  key={s.leak_type}
                  onClick={() => onSelectCategory(s.leak_type)}
                  onMouseEnter={() => setHovered(s.leak_type)}
                  onMouseLeave={() => setHovered(null)}
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
                    <>
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
                      {/* The largest leak carries more visual energy — a second, offset-phase particle */}
                      {s.isLargest && (
                        <motion.circle
                          r={2.2}
                          fill={s.meta.dot}
                          initial={{
                            cx: cubicPoint(0, s.x, s.x, CENTER_X, CENTER_X),
                            cy: cubicPoint(0, TOP_Y, TOP_Y + 70, NODE_Y - 90, NODE_Y),
                          }}
                          animate={{
                            cx: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, s.x, s.x, CENTER_X, CENTER_X)),
                            cy: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, TOP_Y, TOP_Y + 70, NODE_Y - 90, NODE_Y)),
                          }}
                          transition={{ duration: 2.6, repeat: Infinity, ease: 'linear', delay: s.x / 900 + 1.3 }}
                        />
                      )}
                    </>
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
                    {focused ? ` · ${s.count} txns` : ''}
                  </text>
                  <motion.circle
                    cx={s.x}
                    cy={TOP_Y}
                    r={3.5}
                    fill={s.meta.dot}
                    animate={reduceMotion ? undefined : { opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.3 }}
                  />
                </g>
              );
            })
          )}

          {/* Recovery conversion — the same core splits its output into what's
              realistically recoverable and what's actually been recovered,
              scaled on the same visual axis as the risk streams above so
              the proportion is honest: recovery is a fraction of risk. */}
          <path
            d={recoverablePath}
            fill="none"
            stroke="url(#revora-recoverable)"
            strokeWidth={recoverableWidth}
            strokeLinecap="round"
          />
          <path
            d={recoveredPath}
            fill="none"
            stroke="url(#revora-recovered)"
            strokeWidth={recoveredWidth}
            strokeLinecap="round"
          />
          {!reduceMotion && recoverable > 0 && (
            <motion.circle
              r={2.4}
              fill="#B69AFF"
              initial={{
                cx: cubicPoint(0, CENTER_X, CENTER_X, CENTER_X - SPLIT_OFFSET, CENTER_X - SPLIT_OFFSET),
                cy: cubicPoint(0, NODE_Y + CORE_R, NODE_Y + 60, VB_H - 70, VB_H),
              }}
              animate={{
                cx: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, CENTER_X, CENTER_X, CENTER_X - SPLIT_OFFSET, CENTER_X - SPLIT_OFFSET)),
                cy: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, NODE_Y + CORE_R, NODE_Y + 60, VB_H - 70, VB_H)),
              }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
            />
          )}
          {!reduceMotion && recovered > 0 && (
            <motion.circle
              r={2.4}
              fill="#5FE3AD"
              initial={{
                cx: cubicPoint(0, CENTER_X, CENTER_X, CENTER_X + SPLIT_OFFSET, CENTER_X + SPLIT_OFFSET),
                cy: cubicPoint(0, NODE_Y + CORE_R, NODE_Y + 60, VB_H - 70, VB_H),
              }}
              animate={{
                cx: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, CENTER_X, CENTER_X, CENTER_X + SPLIT_OFFSET, CENTER_X + SPLIT_OFFSET)),
                cy: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, NODE_Y + CORE_R, NODE_Y + 60, VB_H - 70, VB_H)),
              }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'linear', delay: 1.1 }}
            />
          )}

          {/* Terminal markers — the same visual language as each stream's
              source dot at the top, now at the delivery point, so the two
              output ribbons read as landing precisely on the numbers below
              rather than fading out into empty space. */}
          <circle cx={CENTER_X - SPLIT_OFFSET} cy={VB_H - 4} r={3.5} fill="#B69AFF" />
          <circle cx={CENTER_X + SPLIT_OFFSET} cy={VB_H - 4} r={3.5} fill="#5FE3AD" />

          {/* REVORA core — the engine. A slow breathing glow behind concentric
              rings and orbiting indicators reads as "actively processing,"
              not a static badge. */}
          {reduceMotion ? (
            <circle cx={CENTER_X} cy={NODE_Y} r={54} fill="url(#revora-core-glow)" />
          ) : (
            <motion.circle
              cx={CENTER_X}
              cy={NODE_Y}
              fill="url(#revora-core-glow)"
              animate={{ r: [50, 58, 50] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          {!reduceMotion && (
            <>
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
              <motion.circle
                cx={CENTER_X}
                cy={NODE_Y}
                r={40}
                fill="none"
                stroke="#8B5CF6"
                strokeOpacity={0.12}
                animate={{ r: [38, 46, 38] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
              />
              <motion.g
                style={{ transformOrigin: `${CENTER_X}px ${NODE_Y}px` }}
                animate={{ rotate: 360 }}
                transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
              >
                <circle cx={CENTER_X + 37} cy={NODE_Y} r={1.6} fill="#B69AFF" opacity={0.7} />
              </motion.g>
              <motion.g
                style={{ transformOrigin: `${CENTER_X}px ${NODE_Y}px` }}
                animate={{ rotate: -360 }}
                transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
              >
                <circle cx={CENTER_X - 43} cy={NODE_Y} r={1.3} fill="#8FA3FF" opacity={0.55} />
              </motion.g>
            </>
          )}
          <circle cx={CENTER_X} cy={NODE_Y} r={CORE_R} className="fill-panel" stroke="#8B5CF6" strokeOpacity={0.4} />
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

      {/* Outputs: potential recovery + recovered so far — positioned under
          the two paths the core just split into */}
      <div className="flex items-start justify-center gap-16 sm:gap-24 -mt-3">
        <div className="flex flex-col items-center text-center">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-ai-400">Potential Recovery</span>
          <AnimatedNumber
            value={recoverable}
            format={(v) => formatINR(v, true)}
            className="mt-1 text-2xl sm:text-3xl font-display font-semibold text-ai-300 tracking-tight tabular-nums"
          />
          <span className="mt-1 text-[11px] text-text-muted">{formatPct(analyzeData?.avg_recovery_probability || 0)} avg. likelihood</span>
        </div>
        <div className="flex flex-col items-center text-center opacity-90">
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-success-400">Recovered</span>
          <AnimatedNumber
            value={recovered}
            format={(v) => formatINR(v, true)}
            className="mt-1 text-xl sm:text-2xl font-display font-semibold text-success-300 tracking-tight tabular-nums"
          />
          <span className="mt-1 text-[11px] text-text-muted">{formatPct(recoverData?.recovery_rate_pct || 0)} recovery rate</span>
        </div>
      </div>
    </div>
  );
};
