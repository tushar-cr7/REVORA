'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, FileText, ShieldAlert, UserCheck, Zap, LucideIcon } from 'lucide-react';
import { JourneyStage, JourneyStageState, JourneyState } from './interventionSignals';

/**
 * REVORA's signature surface: the path a unit of at-risk revenue travels —
 * opportunity, decision, action, outcome, recovery — drawn as one
 * continuous stream rather than five separate cards.
 *
 * The stream is a single wave running left to right behind the stage
 * nodes, so revenue visibly moves *through* the system. Nothing in it is
 * decorative: which segments carry light, how far that light travels, and
 * where it stops are all driven by `reachedIndex` — how far the real work
 * has actually progressed. A case stopped by recovery controls halts at
 * that boundary instead of flowing through it.
 */

const STAGE_ICON: LucideIcon[] = [FileText, Brain, Zap, UserCheck];

/** One hue per stage, chosen by what the stage means — never for variety. */
const STAGE_TONE = [
  { ring: 'border-risk-500/50', icon: 'text-risk-300', glow: 'bg-risk-500/20', stroke: '#F5484F' },
  { ring: 'border-ai-500/50', icon: 'text-ai-300', glow: 'bg-ai-500/20', stroke: '#8B5CF6' },
  { ring: 'border-primary-500/50', icon: 'text-primary-300', glow: 'bg-primary-500/20', stroke: '#4F6EF7' },
  { ring: 'border-success-500/50', icon: 'text-success-300', glow: 'bg-success-500/20', stroke: '#10B981' },
];

const DIM = { ring: 'border-border-strong', icon: 'text-text-disabled', glow: 'bg-transparent', stroke: '#2A3646' };
const BLOCKED = { ring: 'border-warning-500/70', icon: 'text-warning-300', glow: 'bg-warning-500/20', stroke: '#F5A623' };
const AMBER = '#F5A623';

function toneFor(index: number, state: JourneyStageState) {
  if (state === 'blocked') return BLOCKED;
  if (state === 'pending') return DIM;
  return STAGE_TONE[index] ?? DIM;
}

const OUTCOME_TONE = {
  success: { label: 'text-success-300', value: 'text-success-100' },
  warning: { label: 'text-warning-300', value: 'text-text-primary' },
  neutral: { label: 'text-text-muted', value: 'text-text-primary' },
} as const;

/**
 * The stream geometry. Node centres sit at x = 100/300/500/700/900 in a
 * 1000-unit viewBox, all on the centreline (y=70), with each 200-unit span
 * bulging alternately up and down. Because every segment starts and ends
 * exactly on the centreline, the four segments join into one unbroken wave
 * and the nodes always land on it — at any width, since the viewBox
 * stretches horizontally.
 */
const NODE_X = [10, 30, 50, 70, 90];
const SEGMENTS = [
  'M100,70 c50,0 55,-26 100,-26 s55,26 100,26',
  'M300,70 c50,0 55,26 100,26 s55,-26 100,-26',
  'M500,70 c50,0 55,-26 100,-26 s55,26 100,26',
  'M700,70 c50,0 55,26 100,26 s55,-26 100,-26',
];

/** Three offset ribbons per segment give the stream depth without extra noise. */
const RIBBONS = [
  { dy: 0, width: 1.6, opacity: 1, dotSpeed: 3.2, dots: '2 26' },
  { dy: 7, width: 1, opacity: 0.5, dotSpeed: 4.1, dots: '1.5 34' },
  { dy: -7, width: 1, opacity: 0.45, dotSpeed: 3.6, dots: '1.5 30' },
];

interface RecoveryJourneyProps {
  journey: JourneyState;
  /** Transaction id when a case is selected — shown so the scope is unambiguous. */
  scopeLabel: string;
}

export const RecoveryJourney: React.FC<RecoveryJourneyProps> = ({ journey, scopeLabel }) => {
  const reduceMotion = !!useReducedMotion();
  const { stages, reachedIndex, boundary } = journey;
  const recovered = journey.outcomeTone === 'success' && reachedIndex >= 4;

  // A case view runs its stream slightly brighter than the resting system
  // view, so selecting a case reads as that case becoming active.
  const intensity = journey.scope === 'case' ? 1 : 0.72;

  // Changing this remounts the destination pulse so it plays exactly once
  // when a recovered case is opened, instead of looping forever.
  const pulseKey = `${journey.scope}:${scopeLabel}:${recovered}`;

  return (
    <section className="relative overflow-hidden rounded-lg border border-border-subtle bg-gradient-to-b from-panel/70 via-surface/50 to-canvas/40">
      <Atmosphere recovered={recovered} />

      <div className="relative p-5 sm:p-6">
        {/* ── Header ── */}
        {/* Stacks on narrow screens so the headline never gets squeezed into a column by the scope chip */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="h-[3px] w-7 rounded-full bg-gradient-to-r from-risk-500 via-ai-500 to-success-500"
              />
              <h2 className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-text-muted">
                The recovery journey
              </h2>
            </div>
            <p className="text-[15px] sm:text-[16.5px] font-medium text-text-primary mt-2 leading-snug">
              From revenue opportunity to recovered money.
            </p>
          </div>

          <div className="shrink-0 self-start sm:self-auto sm:text-right rounded-md border border-border-subtle bg-surface/70 px-2.5 py-1.5">
            <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-text-muted">
              {journey.scope === 'case' ? 'Selected case' : 'All activity'}
            </div>
            <div className="font-mono text-[11px] text-text-secondary mt-0.5 truncate max-w-[190px]">{scopeLabel}</div>
          </div>
        </div>

        {/* ── Desktop: the stream ── */}
        <div className="hidden lg:block mt-5">
          <div className="relative h-[168px]">
            <StreamLayer
              stages={stages}
              reachedIndex={reachedIndex}
              boundaryIndex={boundary?.atIndex ?? null}
              intensity={intensity}
              reduceMotion={reduceMotion}
            />

            {stages.slice(0, 4).map((stage, i) => (
              <div
                key={stage.id}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                style={{ left: `${NODE_X[i]}%` }}
              >
                <StageNode stage={stage} index={i} reduceMotion={reduceMotion} />
              </div>
            ))}

            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${NODE_X[4]}%` }}
            >
              <DestinationNode
                recovered={recovered}
                blocked={boundary != null}
                reached={reachedIndex >= 4}
                pulseKey={pulseKey}
                reduceMotion={reduceMotion}
              />
            </div>
          </div>

          {/* Labels share the same 5-column geometry as the nodes above */}
          <div className="grid grid-cols-5 gap-3 mt-2">
            {stages.slice(0, 4).map((stage, i) => (
              <div key={stage.id} className="text-center px-1">
                {/* Fixed box so one- and two-line labels keep their details on the same baseline */}
                <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted min-h-[28px]">
                  {i + 1}. {stage.label}
                </div>
                <p
                  className={`text-[11.5px] mt-1 leading-snug ${
                    stage.state === 'pending' ? 'text-text-disabled' : 'text-text-secondary'
                  }`}
                >
                  {stage.detail}
                </p>
              </div>
            ))}

            <div className="text-center px-1">
              <div
                className={`text-[9.5px] font-mono uppercase tracking-[0.14em] min-h-[28px] ${
                  OUTCOME_TONE[journey.outcomeTone].label
                }`}
              >
                {journey.outcomeLabel}
              </div>
              <div
                className={`text-[21px] font-semibold tabular-nums leading-none mt-0.5 ${
                  OUTCOME_TONE[journey.outcomeTone].value
                }`}
              >
                {journey.outcomeValue}
              </div>
              <p className="text-[11px] text-text-muted mt-1.5 leading-snug">{journey.outcomeCaption}</p>
            </div>
          </div>
        </div>

        {/* ── Tablet / mobile: the same progression, read vertically ── */}
        <div className="lg:hidden mt-5">
          {stages.slice(0, 4).map((stage, i) => (
            <div key={stage.id} className="flex gap-3.5">
              <div className="flex flex-col items-center shrink-0 w-11">
                <StageNode stage={stage} index={i} reduceMotion={reduceMotion} compact />
                <VerticalStream
                  flowing={reachedIndex > i}
                  blocked={boundary?.atIndex === i + 1}
                  stroke={toneFor(i, stage.state).stroke}
                  reduceMotion={reduceMotion}
                />
              </div>
              <div className="pb-5 min-w-0 pt-1">
                <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted">
                  {i + 1}. {stage.label}
                </div>
                <p
                  className={`text-[12.5px] mt-1 leading-snug ${
                    stage.state === 'pending' ? 'text-text-disabled' : 'text-text-secondary'
                  }`}
                >
                  {stage.detail}
                </p>
                {boundary?.atIndex === i && (
                  <p className="text-[11.5px] text-warning-300 mt-1.5 leading-snug">{boundary.reason}</p>
                )}
              </div>
            </div>
          ))}

          <div className="flex gap-3.5">
            <div className="w-11 flex justify-center shrink-0">
              <DestinationNode
                recovered={recovered}
                blocked={boundary != null}
                reached={reachedIndex >= 4}
                pulseKey={pulseKey}
                reduceMotion={reduceMotion}
                compact
              />
            </div>
            <div className="min-w-0 pt-1">
              <div
                className={`text-[9.5px] font-mono uppercase tracking-[0.14em] ${
                  OUTCOME_TONE[journey.outcomeTone].label
                }`}
              >
                {journey.outcomeLabel}
              </div>
              <div
                className={`text-[20px] font-semibold tabular-nums leading-none mt-1 ${
                  OUTCOME_TONE[journey.outcomeTone].value
                }`}
              >
                {journey.outcomeValue}
              </div>
              <p className="text-[11.5px] text-text-muted mt-1.5 leading-snug">{journey.outcomeCaption}</p>
            </div>
          </div>
        </div>

        {/* The control boundary gets its own line — it's the product's central claim, not a footnote */}
        {boundary && (
          <div className="hidden lg:flex items-start gap-2 mt-4 rounded-md border border-warning-500/25 bg-warning-muted/20 px-3 py-2">
            <ShieldAlert className="w-3.5 h-3.5 text-warning-400 shrink-0 mt-px" />
            <p className="text-[11.5px] text-warning-200 leading-snug">
              <span className="font-medium">Recovery stopped at the control boundary.</span>{' '}
              <span className="text-warning-300/90">{boundary.reason}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
};

/* ──────────────────────────── atmosphere ──────────────────────────── */

/** Depth only: a technical grid, one cool light above the stream, and a warm one at the destination once revenue lands. */
const Atmosphere: React.FC<{ recovered: boolean }> = ({ recovered }) => (
  <>
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-60"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(42,54,70,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(42,54,70,0.2) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        maskImage: 'radial-gradient(ellipse 80% 78% at 50% 52%, #000 25%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 78% at 50% 52%, #000 25%, transparent 100%)',
      }}
    />
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/4 top-1/3 h-56 w-[34rem] -translate-x-1/2 rounded-full bg-primary-500/[0.06] blur-3xl"
    />
    {recovered && (
      <div
        aria-hidden
        className="pointer-events-none absolute right-[6%] top-1/2 h-56 w-56 -translate-y-1/2 translate-x-1/3 rounded-full bg-success-500/[0.1] blur-3xl"
      />
    )}
  </>
);

/* ──────────────────────────── the stream ──────────────────────────── */

const StreamLayer: React.FC<{
  stages: JourneyStage[];
  reachedIndex: number;
  boundaryIndex: number | null;
  intensity: number;
  reduceMotion: boolean;
}> = ({ stages, reachedIndex, boundaryIndex, intensity, reduceMotion }) => {
  const uid = React.useId().replace(/:/g, '');

  return (
    <svg
      viewBox="0 0 1000 140"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
      aria-hidden
    >
      <defs>
        {SEGMENTS.map((_, i) => {
          const blocked = boundaryIndex === i + 1;
          const flowing = reachedIndex > i;
          const from = toneFor(i, stages[i].state).stroke;
          const to = blocked ? AMBER : toneFor(i + 1, stages[i + 1].state).stroke;
          return (
            <linearGradient key={i} id={`${uid}-g${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={from} stopOpacity={(flowing ? 0.5 : 0.18) * intensity} />
              <stop offset="100%" stopColor={to} stopOpacity={(flowing ? 0.5 : 0.18) * intensity} />
            </linearGradient>
          );
        })}
      </defs>

      {SEGMENTS.map((d, i) => {
        const blocked = boundaryIndex === i + 1;
        const flowing = reachedIndex > i && !blocked;
        const to = blocked ? AMBER : toneFor(i + 1, stages[i + 1].state).stroke;

        return (
          <g key={i}>
            {RIBBONS.map((ribbon, r) => (
              <g key={r} transform={`translate(0 ${ribbon.dy})`}>
                {/* The channel: always drawn, so an unreached path still reads as a path */}
                <path
                  d={d}
                  fill="none"
                  stroke={`url(#${uid}-g${i})`}
                  strokeWidth={ribbon.width}
                  strokeLinecap="round"
                  strokeOpacity={ribbon.opacity}
                  strokeDasharray={blocked ? '4 5' : undefined}
                  vectorEffect="non-scaling-stroke"
                />

                {/* Particles: a train of dots marching left to right, only where work has travelled.
                    `initial` never depends on reduced-motion, so the server and the client always
                    render the same markup; only the post-mount `animate` differs. */}
                {flowing && (
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={to}
                    strokeWidth={ribbon.width + 0.6}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={ribbon.dots}
                    initial={{ strokeDashoffset: 240, opacity: 0 }}
                    animate={
                      reduceMotion
                        ? { strokeDashoffset: 240, opacity: 0 }
                        : { strokeDashoffset: 0, opacity: 0.85 * ribbon.opacity * intensity }
                    }
                    transition={{
                      strokeDashoffset: { duration: ribbon.dotSpeed, repeat: Infinity, ease: 'linear', delay: i * 0.18 },
                      opacity: { duration: 0.4 },
                    }}
                  />
                )}
              </g>
            ))}

            {/* One brighter pulse per segment, travelling the same direction, well spaced out */}
            {flowing && (
              <motion.path
                d={d}
                fill="none"
                stroke={to}
                strokeWidth={2.4}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="16 460"
                initial={{ strokeDashoffset: 476, opacity: 0 }}
                animate={
                  reduceMotion ? { strokeDashoffset: 476, opacity: 0 } : { strokeDashoffset: 0, opacity: 0.9 * intensity }
                }
                transition={{
                  strokeDashoffset: { duration: 5.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.7 },
                  opacity: { duration: 0.4 },
                }}
              />
            )}

            {/* Where recovery controls stop the case: a clean break in the stream */}
            {blocked && <BoundaryMark segmentIndex={i} />}
          </g>
        );
      })}
    </svg>
  );
};

/**
 * Drawn in viewBox units at the midpoint of the blocked segment. Kept as
 * two short strokes rather than a glyph so it stays crisp under the
 * non-uniform horizontal stretch of the stream.
 */
const BoundaryMark: React.FC<{ segmentIndex: number }> = ({ segmentIndex }) => {
  const x = 200 + segmentIndex * 200;
  const bulgeUp = segmentIndex % 2 === 0;
  const y = bulgeUp ? 44 : 96;
  return (
    <g>
      <circle cx={x} cy={y} r={13} fill={AMBER} fillOpacity={0.09} />
      <line
        x1={x}
        y1={y - 19}
        x2={x}
        y2={y + 19}
        stroke={AMBER}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeOpacity={0.9}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x} cy={y} r={4} fill={AMBER} fillOpacity={0.95} />
    </g>
  );
};

/* ──────────────────────────── nodes ──────────────────────────── */

const StageNode: React.FC<{
  stage: JourneyStage;
  index: number;
  reduceMotion: boolean;
  compact?: boolean;
}> = ({ stage, index, reduceMotion, compact }) => {
  const Icon = STAGE_ICON[index];
  const tone = toneFor(index, stage.state);
  const lit = stage.state !== 'pending';
  const core = compact ? 'w-11 h-11' : 'w-16 h-16';
  const iconSize = compact ? 'w-[17px] h-[17px]' : 'w-[21px] h-[21px]';

  return (
    <div className="relative shrink-0">
      {/* Soft light behind a reached node */}
      {lit && <div aria-hidden className={`absolute -inset-2 rounded-full blur-xl ${tone.glow}`} />}

      {/* Subtle outer ring, so a node reads as a station on the stream */}
      {!compact && (
        <span
          aria-hidden
          className={`absolute -inset-[7px] rounded-full border ${lit ? tone.ring : 'border-border-subtle'} opacity-30`}
        />
      )}

      {/* The stage the work is sitting on right now keeps a slow outward ring */}
      {stage.state === 'active' && (
        <motion.span
          aria-hidden
          className={`absolute inset-0 rounded-full border ${tone.ring}`}
          initial={{ opacity: 0, scale: 1 }}
          animate={reduceMotion ? { opacity: 0, scale: 1 } : { opacity: [0.5, 0], scale: [1, 1.7] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      <div className={`relative ${core} rounded-full border flex items-center justify-center bg-surface ${tone.ring} transition-colors`}>
        <Icon strokeWidth={1.6} className={`${iconSize} ${tone.icon} transition-colors`} />
      </div>
    </div>
  );
};

/**
 * The destination. Deliberately the largest thing in the journey: it is the
 * payoff the other four stages exist to reach. It only turns green once the
 * backend actually reports recovered money.
 */
const DestinationNode: React.FC<{
  recovered: boolean;
  blocked: boolean;
  reached: boolean;
  pulseKey: string;
  reduceMotion: boolean;
  compact?: boolean;
}> = ({ recovered, blocked, reached, pulseKey, reduceMotion, compact }) => {
  const core = compact ? 'w-11 h-11' : 'w-[88px] h-[88px]';
  const dot = compact ? 'w-2.5 h-2.5' : 'w-5 h-5';

  const shell = recovered
    ? 'border-success-500/70 bg-success-muted/60'
    : blocked
    ? 'border-warning-500/50 bg-warning-muted/30'
    : 'border-border-strong bg-surface';

  const center = recovered ? 'bg-success-400' : blocked ? 'bg-warning-400/70' : reached ? 'bg-text-muted' : 'bg-border-strong';

  return (
    <div className="relative shrink-0">
      <div
        aria-hidden
        className={`absolute -inset-3 rounded-full blur-2xl ${
          recovered ? 'bg-success-500/30' : blocked ? 'bg-warning-500/10' : 'bg-primary-500/[0.07]'
        }`}
      />

      {/* Concentric rings — the target the whole stream aims at. The compact
          rail keeps one ring so the destination still reads as the payoff. */}
      <span
        aria-hidden
        className={`absolute ${compact ? '-inset-[5px]' : '-inset-[9px]'} rounded-full border ${
          recovered ? 'border-success-500/35' : 'border-border-subtle'
        }`}
      />
      {!compact && (
        <span
          aria-hidden
          className={`absolute -inset-[20px] rounded-full border ${
            recovered ? 'border-success-500/20' : 'border-border-subtle/50'
          }`}
        />
      )}

      {/* One pulse when a recovered case lands — remounted by key, never looped */}
      {recovered && (
        <motion.span
          key={pulseKey}
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-success-400/60"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={reduceMotion ? { opacity: 0, scale: 0.92 } : { opacity: [0.75, 0], scale: [0.92, 2.1] }}
          transition={{ duration: 1.7, ease: 'easeOut' }}
        />
      )}

      <div className={`relative ${core} rounded-full border-2 flex items-center justify-center ${shell} transition-colors`}>
        {!compact && (
          <span
            aria-hidden
            className={`absolute inset-[9px] rounded-full border ${
              recovered ? 'border-success-500/40' : 'border-border-strong/60'
            }`}
          />
        )}
        {/* The core only lights up once real recovered revenue exists */}
        <span
          className={`rounded-full ${dot} ${center} transition-all ${
            recovered ? 'shadow-[0_0_20px_rgba(16,185,129,0.9)]' : ''
          }`}
        />
      </div>
    </div>
  );
};

/* ──────────────────────────── mobile stream ──────────────────────────── */

const VerticalStream: React.FC<{
  flowing: boolean;
  blocked: boolean;
  stroke: string;
  reduceMotion: boolean;
}> = ({ flowing, blocked, stroke, reduceMotion }) => (
  <div className="relative w-[3px] flex-1 min-h-[34px] my-1.5 overflow-hidden rounded-full">
    <div
      className="absolute inset-0 rounded-full"
      style={{ backgroundColor: blocked ? AMBER : stroke, opacity: flowing ? 0.45 : 0.16 }}
    />
    {blocked && (
      <div className="absolute left-1/2 top-1/2 h-[3px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ backgroundColor: AMBER }} />
    )}
    {flowing && !blocked && (
      <motion.div
        className="absolute left-0 w-full h-4 rounded-full"
        style={{ backgroundColor: stroke }}
        initial={{ top: '-25%', opacity: 0 }}
        animate={reduceMotion ? { top: '-25%', opacity: 0 } : { top: '115%', opacity: 0.9 }}
        transition={{ top: { duration: 2.4, repeat: Infinity, ease: 'linear' }, opacity: { duration: 0.3 } }}
      />
    )}
  </div>
);
