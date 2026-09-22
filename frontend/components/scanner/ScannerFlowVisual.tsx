'use client';

import React from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';

interface ScannerFlowVisualProps {
  phase: 'idle' | 'scanning';
  targetCount: number;
}

const VB_W = 880;
const VB_H = 250;
const CENTER_X = VB_W / 2;
const CORE_Y = 180;
const TOP_Y = 36;
const CORE_R = 24;

// Four source lanes, all in the same blue "system" family (not yet the red/
// amber/violet/green risk palette — nothing has been classified as a leak
// until the scan actually returns). This is deliberately Scanner's own
// visual identity, distinct from Revenue Command's category-colored flow.
const LANES = [
  { key: 'payments', label: 'Payment Activity', color: '#8FA3FF' },
  { key: 'checkouts', label: 'Checkout Activity', color: '#4F6EF7' },
  { key: 'invoices', label: 'Invoice Activity', color: '#3B57DE' },
  { key: 'subscriptions', label: 'Subscription Activity', color: '#2C42B0' },
] as const;

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * The signature scanner visual: REVORA's revenue universe (payments,
 * checkouts, invoices, subscriptions) flowing into a single point of
 * intelligence. Present in both the idle state (a still preview of what
 * will happen) and the scanning state (the same geometry, now alive) so
 * clicking "Run Scan" feels like waking up the exact system just shown,
 * not switching to an unrelated loading screen.
 */
export const ScannerFlowVisual: React.FC<ScannerFlowVisualProps> = ({ phase, targetCount }) => {
  const reduceMotion = useReducedMotion();
  const scanning = phase === 'scanning';

  const lanes = LANES.map((lane, i) => {
    const n = LANES.length;
    const x = ((i + 1) / (n + 1)) * VB_W;
    const path = `M ${x} ${TOP_Y} C ${x} ${TOP_Y + 60}, ${CENTER_X} ${CORE_Y - 80}, ${CENTER_X} ${CORE_Y}`;
    return { ...lane, x, path };
  });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="scanner-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4F6EF7" stopOpacity={scanning ? 0.4 : 0.22} />
            <stop offset="100%" stopColor="#4F6EF7" stopOpacity="0" />
          </radialGradient>
        </defs>

        {lanes.map((lane, idx) => (
          <g key={lane.key}>
            <path
              d={lane.path}
              fill="none"
              stroke={lane.color}
              strokeOpacity={scanning ? 0.55 : 0.22}
              strokeWidth={scanning ? 4.5 : 3}
              strokeLinecap="round"
              style={{ transition: 'stroke-opacity 500ms ease, stroke-width 500ms ease' }}
            />
            {!reduceMotion && scanning && (
              <motion.circle
                r={2.4}
                fill={lane.color}
                initial={{
                  cx: cubicPoint(0, lane.x, lane.x, CENTER_X, CENTER_X),
                  cy: cubicPoint(0, TOP_Y, TOP_Y + 60, CORE_Y - 80, CORE_Y),
                }}
                animate={{
                  cx: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, lane.x, lane.x, CENTER_X, CENTER_X)),
                  cy: Array.from({ length: 11 }, (_, i) => cubicPoint(i / 10, TOP_Y, TOP_Y + 60, CORE_Y - 80, CORE_Y)),
                }}
                transition={{ duration: 1.7, repeat: Infinity, ease: 'linear', delay: idx * 0.22 }}
              />
            )}
            <text x={lane.x} y={TOP_Y - 12} textAnchor="middle" fontSize={11.5} fontWeight={500} className="fill-text-secondary">
              {lane.label}
            </text>
            <motion.circle
              cx={lane.x}
              cy={TOP_Y}
              r={3}
              fill={lane.color}
              animate={
                reduceMotion
                  ? undefined
                  : scanning
                  ? { opacity: [0.5, 1, 0.5] }
                  : { opacity: 0.5 }
              }
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.2 }}
            />
          </g>
        ))}

        {/* REVORA core */}
        {reduceMotion ? (
          <circle cx={CENTER_X} cy={CORE_Y} r={48} fill="url(#scanner-core-glow)" />
        ) : (
          <motion.circle
            cx={CENTER_X}
            cy={CORE_Y}
            fill="url(#scanner-core-glow)"
            initial={{ r: scanning ? 44 : 46 }}
            animate={{ r: scanning ? [44, 54, 44] : [46, 50, 46] }}
            transition={{ duration: scanning ? 2 : 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {!reduceMotion && scanning && (
          <motion.circle
            cx={CENTER_X}
            cy={CORE_Y}
            fill="none"
            stroke="#4F6EF7"
            initial={{ r: 30, strokeOpacity: 0.4 }}
            animate={{ r: [26, 36, 26], strokeOpacity: [0.5, 0.1, 0.5] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <circle cx={CENTER_X} cy={CORE_Y} r={CORE_R} className="fill-panel" stroke="#4F6EF7" strokeOpacity={0.45} />
      </svg>

      <div
        className="absolute flex items-center justify-center pointer-events-none"
        style={{
          left: `${(CENTER_X / VB_W) * 100}%`,
          top: `${(CORE_Y / VB_H) * 100}%`,
          width: `${(46 / VB_W) * 100}%`,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div className="relative w-full" style={{ aspectRatio: '1 / 1' }}>
          <Image src="/brand/revora-mark-transparent.png" alt="" fill className="object-contain" />
        </div>
      </div>
    </div>
  );
};
