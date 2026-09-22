'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { mulberry32 } from './seededRandom';

export type FieldPhase = 'idle' | 'scanning' | 'complete' | 'error';

interface BreakdownItem {
  leak_type: string;
  amount_at_risk: number;
  count: number;
}

interface TransactionFieldProps {
  phase: FieldPhase;
  breakdown?: BreakdownItem[];
}

const VB_W = 760;
const VB_H = 220;
const COLS = 20;
const ROWS = 7;
const SWEEP_DURATION = 2.4; // seconds per pass, while scanning
const HIGHLIGHT_COUNT = 24; // dots recolored at completion — a minority of the field
const REVEAL_DURATION = 1.8; // seconds — the single final pass that discovers the real leak nodes

const CATEGORY_COLOR: Record<string, string> = {
  failed_payment: '#F5484F',
  overdue_invoice: '#4F6EF7',
  abandoned_checkout: '#F5A623',
  failed_subscription: '#8B5CF6',
};

function buildField() {
  const rng = mulberry32(1337);
  const cellW = VB_W / COLS;
  const cellH = VB_H / ROWS;
  const nodes: { x: number; y: number }[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const jitterX = (rng() - 0.5) * cellW * 0.72;
      const jitterY = (rng() - 0.5) * cellH * 0.72;
      nodes.push({
        x: i * cellW + cellW / 2 + jitterX,
        y: j * cellH + cellH / 2 + jitterY,
      });
    }
  }
  return nodes;
}

const FIELD = buildField();

/**
 * Revenue Scanner's signature visual — deliberately NOT Revenue Command's
 * streams-into-a-core. Here REVORA looks INSIDE a field of transactions: a
 * scan line sweeps through, quiet nodes stay quiet, and once the real scan
 * response resolves, a proportion of nodes matching the actual detected
 * category mix resolve into color. Most of the field always stays dark —
 * risk is meant to emerge from noise, not dominate it.
 */
export const TransactionField: React.FC<TransactionFieldProps> = ({ phase, breakdown }) => {
  const reduceMotion = useReducedMotion();

  // A single final scan-line pass plays exactly once, right when real leak
  // data first becomes available (scanning -> complete). It's a plain
  // mount-triggered timer, not a claim about ongoing backend activity —
  // the data it's revealing is already the real response.
  const [revealing, setRevealing] = useState(false);
  const prevPhase = useRef<FieldPhase>(phase);
  useEffect(() => {
    const cameFromScanning = prevPhase.current === 'scanning';
    prevPhase.current = phase;
    if (phase === 'complete' && cameFromScanning && !reduceMotion) {
      setRevealing(true);
      const t = window.setTimeout(() => setRevealing(false), REVEAL_DURATION * 1000);
      return () => window.clearTimeout(t);
    }
    if (phase !== 'complete') setRevealing(false);
  }, [phase, reduceMotion]);

  const highlighted = useMemo(() => {
    if (phase !== 'complete' || !breakdown || breakdown.length === 0) return new Map<number, string>();
    const total = breakdown.reduce((s, b) => s + b.amount_at_risk, 0) || 1;
    const ranked = [...breakdown].sort((a, b) => b.amount_at_risk - a.amount_at_risk);
    const assignment = new Map<number, string>();
    let cursor = 0;
    ranked.forEach((item) => {
      const share = Math.round((item.amount_at_risk / total) * HIGHLIGHT_COUNT);
      for (let k = 0; k < share && cursor < FIELD.length; k++, cursor++) {
        assignment.set(cursor, CATEGORY_COLOR[item.leak_type] || '#4F6EF7');
      }
    });
    return assignment;
  }, [phase, breakdown]);

  const scanning = phase === 'scanning';
  const dormant = phase === 'idle' || phase === 'error';

  return (
    <div className="relative rounded-lg border border-border-subtle bg-surface/40 p-3">
      {/* Corner brackets — a diagnostic viewport, not an open canvas */}
      {(
        [
          { key: 'tl', cls: 'top-1.5 left-1.5 border-t border-l' },
          { key: 'tr', cls: 'top-1.5 right-1.5 border-t border-r' },
          { key: 'bl', cls: 'bottom-1.5 left-1.5 border-b border-l' },
          { key: 'br', cls: 'bottom-1.5 right-1.5 border-b border-r' },
        ] as const
      ).map((corner) => (
        <span
          key={corner.key}
          aria-hidden
          className={`absolute w-3 h-3 border-primary-500/40 pointer-events-none ${corner.cls}`}
        />
      ))}

      {/* Instrument badge */}
      <div className="absolute top-3 left-4 flex items-center gap-1.5 z-10">
        <div className="relative w-3.5 h-3.5">
          <Image src="/brand/revora-mark-transparent.png" alt="" fill className="object-contain" />
        </div>
        <span className="text-[9.5px] font-mono uppercase tracking-[0.15em] text-text-muted">Revenue Scan</span>
      </div>

      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto mt-4" preserveAspectRatio="xMidYMid meet">
        {FIELD.map((node, i) => {
          const color = highlighted.get(i);
          if (color) {
            // Keyed distinctly from the scanning/dormant variants at this
            // same field index so React mounts a fresh element here rather
            // than updating props on an already-mounted circle — Framer
            // Motion only applies `initial` at true mount, so reusing the
            // same key would silently drop it on this phase transition and
            // leave `r` momentarily unresolved.
            //
            // The reveal is staggered by each node's own Y position, timed
            // to match the single scan-line pass below — the line finding
            // each real leak node as it reaches it, not all of them
            // appearing at once.
            return (
              <motion.circle
                key={`hl-${i}`}
                cx={node.x}
                cy={node.y}
                fill={color}
                initial={{ r: 0.6, opacity: 0.5 }}
                animate={reduceMotion ? { r: 2.6, opacity: 0.95 } : { r: [0.6, 3.2, 2.6], opacity: [0.5, 1, 0.95] }}
                transition={{
                  duration: 0.5,
                  ease: 'easeOut',
                  delay: reduceMotion ? 0 : (node.y / VB_H) * REVEAL_DURATION,
                }}
              />
            );
          }
          if (dormant || reduceMotion) {
            return <circle key={`d-${i}`} cx={node.x} cy={node.y} r={1.1} fill="#3A4557" opacity={0.5} />;
          }
          return (
            <motion.circle
              key={`s-${i}`}
              cx={node.x}
              cy={node.y}
              r={1.2}
              fill="#8FA3FF"
              initial={{ opacity: 0.28 }}
              animate={{ opacity: [0.28, 0.9, 0.28] }}
              transition={{
                duration: SWEEP_DURATION,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: (node.y / VB_H) * SWEEP_DURATION,
              }}
            />
          );
        })}

        {/* The scan line — animated as native SVG rect geometry (y is a real
            attribute in viewBox units), not a motion.g wrapper. A CSS
            transform-based translate would move in raw pixels, which
            wouldn't track the SVG's own viewBox scale once it's rendered
            responsively at a different pixel size than VB_W x VB_H. */}
        {scanning && !reduceMotion && (
          <>
            <motion.rect
              x={0}
              width={VB_W}
              height={14}
              fill="url(#scan-trail)"
              initial={{ y: -14 }}
              animate={{ y: VB_H - 14 }}
              transition={{ duration: SWEEP_DURATION, repeat: Infinity, ease: 'linear' }}
            />
            <motion.rect
              x={0}
              width={VB_W}
              height={2}
              fill="#8FA3FF"
              initial={{ y: -1 }}
              animate={{ y: VB_H - 1 }}
              transition={{ duration: SWEEP_DURATION, repeat: Infinity, ease: 'linear' }}
            />
          </>
        )}

        {/* The single reveal pass — same line, same styling, no repeat.
            Plays once right as real leak data arrives, then is gone. */}
        {revealing && (
          <>
            <motion.rect
              x={0}
              width={VB_W}
              height={14}
              fill="url(#scan-trail)"
              initial={{ y: -14 }}
              animate={{ y: VB_H - 14 }}
              transition={{ duration: REVEAL_DURATION, ease: 'linear' }}
            />
            <motion.rect
              x={0}
              width={VB_W}
              height={2}
              fill="#8FA3FF"
              initial={{ y: -1 }}
              animate={{ y: VB_H - 1 }}
              transition={{ duration: REVEAL_DURATION, ease: 'linear' }}
            />
          </>
        )}
        <defs>
          <linearGradient id="scan-trail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F6EF7" stopOpacity="0" />
            <stop offset="100%" stopColor="#4F6EF7" stopOpacity="0.25" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};
