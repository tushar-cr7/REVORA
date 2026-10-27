'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Opportunity, CandidateEvaluation } from '@/lib/types';
import { formatINR } from '@/lib/format';
import {
  LANES,
  ACTION_COLOR,
  VB_W,
  VB_H,
  TOP_MARGIN,
  SIDE_MARGIN,
  LANE_H,
  layoutField,
  laneY,
  confidenceTier,
  buildDormantField,
} from './decisionField.utils';

export type DecisionFieldPhase = 'idle' | 'scanning' | 'results';

interface DecisionFieldProps {
  phase: DecisionFieldPhase;
  opportunities: Opportunity[];
  selectedId: string | null;
  onSelect: (opp: Opportunity) => void;
  candidates: CandidateEvaluation[] | null;
  finalAction: string | null;
  isMatch: (opp: Opportunity) => boolean;
  filterActive: boolean;
}

const DORMANT_NODES = buildDormantField(90);
const SWEEP_DURATION = 2.6;

/** Shared lane bands (labels + dividers) so idle/scanning/results all read as the same instrument. */
const LaneBands: React.FC<{ labelFontSize: number; compact: boolean }> = ({ labelFontSize, compact }) => (
  <>
    {LANES.map((lane, i) => {
      const y = laneY(i);
      return (
        <g key={lane.key}>
          {i > 0 && <line x1={0} y1={y} x2={VB_W} y2={y} stroke="#1A2028" strokeWidth={1} />}
          <text x={SIDE_MARGIN - 20} y={y + LANE_H / 2 + 3} fontSize={labelFontSize} fontFamily="var(--font-mono, monospace)" letterSpacing={1} fill="#5A6577" textAnchor="start">
            {compact ? lane.label.slice(0, 3).toUpperCase() : lane.label.toUpperCase()}
          </text>
        </g>
      );
    })}
  </>
);

export const DecisionField: React.FC<DecisionFieldProps> = ({
  phase,
  opportunities,
  selectedId,
  onSelect,
  candidates,
  finalAction,
  isMatch,
  filterActive,
}) => {
  const reduceMotion = useReducedMotion();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Track rendered width so the field can simplify on narrow screens instead
  // of just squeezing the same dense desktop layout down to illegible size.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(VB_W);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = containerWidth > 0 && containerWidth < 520;
  const labelFontSize = Math.min(20, Math.max(9, 11 * (VB_W / Math.max(containerWidth, 1))));

  const visibleOpportunities = useMemo(() => {
    if (!compact) return opportunities;
    return [...opportunities]
      .sort((a, b) => b.recovery_probability * b.expected_recovery - a.recovery_probability * a.expected_recovery)
      .slice(0, 40);
  }, [opportunities, compact]);

  const nodes = useMemo(() => layoutField(visibleOpportunities, compact), [visibleOpportunities, compact]);
  const selectedNode = useMemo(
    () => nodes.find((n) => n.opp.transaction_id === selectedId) || null,
    [nodes, selectedId]
  );

  const candidateGhosts = useMemo(() => {
    if (!candidates || !selectedNode) return [];
    return candidates.map((c) => {
      const laneIndex = Math.max(0, LANES.findIndex((l) => l.key === c.action));
      const x = SIDE_MARGIN + Math.min(1, Math.max(0, c.probability)) * (VB_W - SIDE_MARGIN * 2);
      const y = laneY(laneIndex) + LANE_H / 2;
      const isChosen = c.action === finalAction;
      return { ...c, x, y, isChosen };
    });
  }, [candidates, selectedNode, finalAction]);

  // Idle / scanning: a decorative, non-data-bound "decision universe" —
  // same dormant node set in both, only the animation differs, so the
  // field reads as one continuous instrument from BEFORE through DURING.
  if (phase !== 'results') {
    return (
      <div ref={wrapRef} className="relative rounded-lg border border-border-subtle bg-surface/40 p-3 overflow-hidden min-h-[300px] sm:min-h-[380px] lg:min-h-[500px]">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label={phase === 'scanning' ? 'REVORA scanning the decision universe' : 'Dormant decision universe, ready to be analyzed'}>
          <LaneBands labelFontSize={labelFontSize} compact={compact} />

          {DORMANT_NODES.map((n, i) => (
            <motion.circle
              key={`${phase}-${i}`}
              cx={n.x}
              cy={n.y}
              fill="#5A6577"
              initial={{ opacity: 0.16, r: n.r }}
              animate={
                reduceMotion
                  ? { opacity: 0.22, r: n.r }
                  : phase === 'scanning'
                  ? { opacity: [0.16, 0.95, 0.34], r: [n.r, n.r * 2.1, n.r * 1.15] }
                  : { opacity: [0.14, 0.32, 0.14], r: n.r }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : phase === 'scanning'
                  ? { duration: SWEEP_DURATION, repeat: Infinity, ease: 'easeInOut', delay: (n.x / VB_W) * SWEEP_DURATION, times: [0, 0.45, 1] }
                  : { duration: 3.2 + n.phaseOffset, repeat: Infinity, ease: 'easeInOut', delay: n.phaseOffset }
              }
            />
          ))}

          {phase === 'scanning' && !reduceMotion && (
            <>
              <motion.rect
                y={0}
                width={16}
                height={VB_H}
                fill="url(#brain-scan-trail)"
                initial={{ x: -16 }}
                animate={{ x: VB_W }}
                transition={{ duration: SWEEP_DURATION, repeat: Infinity, ease: 'linear' }}
              />
              <motion.rect
                y={0}
                width={2}
                height={VB_H}
                fill="#B69AFF"
                initial={{ x: -1 }}
                animate={{ x: VB_W }}
                transition={{ duration: SWEEP_DURATION, repeat: Infinity, ease: 'linear' }}
              />
            </>
          )}
          <defs>
            <linearGradient id="brain-scan-trail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.28" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div ref={wrapRef} className="relative rounded-lg border border-border-subtle bg-surface/40 flex items-center justify-center" style={{ minHeight: 260 }}>
        <p className="text-text-muted text-sm">No recovery decisions available yet.</p>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative rounded-lg border border-border-subtle bg-surface/40 p-3">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Decision field showing ${nodes.length} recovery opportunities across five action lanes`}>
        <LaneBands labelFontSize={labelFontSize} compact={compact} />

        {/* Nodes */}
        {nodes.map((node, i) => {
          const isSelected = node.opp.transaction_id === selectedId;
          const isHovered = node.opp.transaction_id === hoveredId;
          const sameLane = selectedNode ? node.laneIndex === selectedNode.laneIndex : false;
          const matched = isMatch(node.opp);

          let targetOpacity: number;
          if (selectedId) {
            targetOpacity = isSelected ? 1 : sameLane ? 0.28 : 0.07;
          } else if (filterActive) {
            targetOpacity = matched ? 0.2 + node.prominence * 0.6 : 0.05;
          } else {
            targetOpacity = 0.16 + node.prominence * 0.58;
          }

          const baseColor = ACTION_COLOR[node.opp.recommended_action] || '#8FA3FF';
          const r = isSelected ? node.r * 1.8 : isHovered ? node.r * 1.3 : node.r;
          const needsReview = !node.opp.policy_allowed;

          return (
            <g key={node.opp.transaction_id}>
              <motion.circle
                cx={node.x}
                cy={node.y}
                fill={baseColor}
                initial={reduceMotion ? { opacity: targetOpacity, r } : { opacity: 0, r: 0.4 }}
                animate={{ opacity: targetOpacity, r }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : isSelected || selectedId
                    ? { duration: 0.35, ease: 'easeOut' }
                    : { duration: 0.6, ease: 'easeOut', delay: (i % 12) * 0.02 }
                }
                onClick={() => onSelect(node.opp)}
                onMouseEnter={() => setHoveredId(node.opp.transaction_id)}
                onMouseLeave={() => setHoveredId((h) => (h === node.opp.transaction_id ? null : h))}
                style={{ cursor: 'pointer' }}
              >
                <title>
                  {formatINR(node.opp.amount)} · {node.opp.leak_type.replace('_', ' ')} · {node.opp.recommended_action.replace('_', ' ')} ·{' '}
                  {confidenceTier(node.opp.recovery_probability)} confidence
                  {needsReview ? ' · needs review' : ''}
                </title>
              </motion.circle>
              {needsReview && (isSelected || isHovered || (!selectedId && !filterActive)) && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r + 1.6}
                  fill="none"
                  stroke="#F5A623"
                  strokeWidth={0.7}
                  strokeOpacity={isSelected ? 0.85 : 0.35}
                  pointerEvents="none"
                />
              )}
              {isSelected && (
                <circle cx={node.x} cy={node.y} r={r + 3} fill="none" stroke="#B69AFF" strokeWidth={0.8} strokeOpacity={0.55} pointerEvents="none" />
              )}
            </g>
          );
        })}

        {/* Candidate ghosts — the real competing actions REVORA scored for the selected decision */}
        {selectedNode &&
          candidateGhosts.map((g) => (
            <g key={g.action}>
              <motion.line
                x1={selectedNode.x}
                y1={selectedNode.y}
                x2={g.x}
                y2={g.y}
                stroke={g.isChosen ? '#B69AFF' : '#343D4A'}
                strokeWidth={g.isChosen ? 1 : 0.6}
                strokeDasharray={g.isChosen ? undefined : '2 2'}
                initial={{ opacity: 0 }}
                animate={{ opacity: g.isChosen ? 0.8 : 0.4 }}
                transition={{ duration: 0.4, delay: 0.15 }}
              />
              <motion.circle
                cx={g.x}
                cy={g.y}
                fill="none"
                stroke={g.isChosen ? '#B69AFF' : '#6C7789'}
                strokeWidth={g.isChosen ? 1.2 : 0.8}
                initial={{ opacity: 0, r: 1 }}
                animate={{ opacity: 1, r: g.isChosen ? 5 : 3.4 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <title>
                  {g.action.replace('_', ' ')}: {(g.probability * 100).toFixed(1)}% · {formatINR(g.expected_value)} EV
                  {g.isChosen ? ' (chosen)' : ''}
                </title>
              </motion.circle>
            </g>
          ))}
      </svg>
    </div>
  );
};
