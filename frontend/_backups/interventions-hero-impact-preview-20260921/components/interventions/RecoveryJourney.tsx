'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, FileText, ShieldAlert, UserCheck, Zap, LucideIcon } from 'lucide-react';
import { JourneyStage, JourneyStageState, JourneyState } from './interventionSignals';

/**
 * REVORA's signature surface for Interventions: the path a single unit of
 * at-risk revenue travels — opportunity, decision, action, outcome,
 * recovery — rendered as one continuous system rather than five cards.
 *
 * Nothing here is decorative-only. Which segments carry light, how far the
 * light travels, and where it stops are all driven by how far the real work
 * has actually progressed (`reachedIndex`), and a case stopped by recovery
 * controls visibly halts at that boundary instead of flowing through.
 */

const STAGE_ICON: LucideIcon[] = [FileText, Brain, Zap, UserCheck];

/** One hue per stage, by what the stage means — not for variety's sake. */
const STAGE_TONE = [
  { ring: 'border-risk-500/45', icon: 'text-risk-300', glow: 'bg-risk-500/15', stroke: '#F5484F' },
  { ring: 'border-ai-500/45', icon: 'text-ai-300', glow: 'bg-ai-500/15', stroke: '#8B5CF6' },
  { ring: 'border-primary-500/45', icon: 'text-primary-300', glow: 'bg-primary-500/15', stroke: '#4F6EF7' },
  { ring: 'border-success-500/45', icon: 'text-success-300', glow: 'bg-success-500/15', stroke: '#10B981' },
];

const DIM = {
  ring: 'border-border-strong',
  icon: 'text-text-disabled',
  glow: 'bg-transparent',
  stroke: '#2A3646',
};

const BLOCKED = {
  ring: 'border-warning-500/60',
  icon: 'text-warning-300',
  glow: 'bg-warning-500/15',
  stroke: '#F5A623',
};

function toneFor(index: number, state: JourneyStageState) {
  if (state === 'blocked') return BLOCKED;
  if (state === 'pending') return DIM;
  return STAGE_TONE[index] ?? DIM;
}

interface RecoveryJourneyProps {
  journey: JourneyState;
  /** Transaction id when a case is selected — shown so the scope is unambiguous. */
  scopeLabel: string;
}

export const RecoveryJourney: React.FC<RecoveryJourneyProps> = ({ journey, scopeLabel }) => {
  const reduceMotion = !!useReducedMotion();
  const { stages, reachedIndex, boundary } = journey;

  return (
    <section className="relative overflow-hidden rounded-lg border border-border-subtle bg-surface/50">
      {/* Fine technical grid + a single soft light source, both kept very low contrast */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(42,54,70,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(42,54,70,0.22) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, #000 35%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, #000 35%, transparent 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[42rem] -translate-x-1/2 rounded-full bg-primary-500/[0.07] blur-3xl"
      />

      <div className="relative p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">The recovery journey</h2>
            <p className="text-[12.5px] text-text-secondary mt-1">How an intervention creates impact</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9.5px] font-mono uppercase tracking-[0.16em] text-text-muted">
              {journey.scope === 'case' ? 'Selected case' : 'All activity'}
            </div>
            <div className="font-mono text-[11px] text-text-secondary mt-1 truncate max-w-[180px]">{scopeLabel}</div>
          </div>
        </div>

        {/* ── Desktop: one continuous horizontal path ── */}
        <div className="hidden lg:flex items-start mt-6">
          {stages.slice(0, 4).map((stage, i) => (
            <React.Fragment key={stage.id}>
              <JourneyNode stage={stage} index={i} reduceMotion={reduceMotion} />
              <Connector
                flowing={reachedIndex > i}
                blocked={boundary?.atIndex === i + 1}
                fromStroke={toneFor(i, stage.state).stroke}
                toStroke={toneFor(i + 1, stages[i + 1].state).stroke}
                delay={i * 0.35}
                reduceMotion={reduceMotion}
              />
            </React.Fragment>
          ))}
          <TerminalReadout journey={journey} reduceMotion={reduceMotion} />
        </div>

        {/* ── Tablet / mobile: the same progression, read vertically ── */}
        <div className="lg:hidden mt-5">
          {stages.slice(0, 4).map((stage, i) => (
            <div key={stage.id} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0 w-9">
                <JourneyDot stage={stage} index={i} reduceMotion={reduceMotion} />
                <VerticalConnector
                  flowing={reachedIndex > i}
                  blocked={boundary?.atIndex === i + 1}
                  stroke={toneFor(i, stage.state).stroke}
                  reduceMotion={reduceMotion}
                />
              </div>
              <div className="pb-4 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{i + 1}</span>
                  <span className="text-[12px] font-medium text-text-primary">{stage.label}</span>
                </div>
                <p className="text-[11.5px] text-text-secondary mt-0.5 leading-snug">{stage.detail}</p>
                {boundary?.atIndex === i && (
                  <p className="text-[11px] text-warning-300 mt-1 leading-snug">{boundary.reason}</p>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-3">
            <div className="w-9 flex justify-center shrink-0">
              <TerminalOrb journey={journey} reduceMotion={reduceMotion} compact />
            </div>
            <div className="min-w-0">
              <div className={`text-[10px] font-mono uppercase tracking-wider ${OUTCOME_TONE[journey.outcomeTone].label}`}>
                {journey.outcomeLabel}
              </div>
              <div className="text-[17px] font-semibold tabular-nums text-text-primary leading-tight mt-0.5">
                {journey.outcomeValue}
              </div>
              <p className="text-[11.5px] text-text-muted mt-0.5 leading-snug">{journey.outcomeCaption}</p>
            </div>
          </div>
        </div>

        {/* The control boundary gets its own line — it's the product's central claim, not a footnote */}
        {boundary && (
          <div className="hidden lg:flex items-start gap-2 mt-5 rounded-md border border-warning-500/25 bg-warning-muted/20 px-3 py-2">
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

/* ───────────────────────────── desktop pieces ───────────────────────────── */

const JourneyNode: React.FC<{ stage: JourneyStage; index: number; reduceMotion: boolean }> = ({
  stage,
  index,
  reduceMotion,
}) => {
  const Icon = STAGE_ICON[index];
  const tone = toneFor(index, stage.state);
  const lit = stage.state !== 'pending';

  return (
    <div className="flex flex-col items-center text-center w-[104px] xl:w-[118px] shrink-0">
      <div className="relative">
        {lit && <div className={`absolute inset-0 rounded-full blur-xl ${tone.glow}`} aria-hidden />}
        {stage.state === 'active' && !reduceMotion && (
          <motion.span
            aria-hidden
            className={`absolute inset-0 rounded-full border ${tone.ring}`}
            initial={{ opacity: 0.55, scale: 1 }}
            animate={{ opacity: 0, scale: 1.55 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <div
          className={`relative w-12 h-12 rounded-full border flex items-center justify-center bg-surface ${tone.ring} transition-colors`}
        >
          <Icon strokeWidth={1.6} className={`w-[18px] h-[18px] ${tone.icon} transition-colors`} />
        </div>
      </div>
      {/* Fixed height so a label that wraps to two lines ("4. Customer outcome")
          doesn't push its detail text out of line with the other stages. */}
      <div className="mt-3 min-h-[24px] text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted">
        {index + 1}. {stage.label}
      </div>
      <p className={`text-[11.5px] mt-1 leading-snug ${lit ? 'text-text-secondary' : 'text-text-disabled'}`}>
        {stage.detail}
      </p>
    </div>
  );
};

const PATH_D = 'M0,20 C16,20 20,6 36,6 S58,34 74,34 S96,20 112,20';

const Connector: React.FC<{
  flowing: boolean;
  blocked: boolean;
  fromStroke: string;
  toStroke: string;
  delay: number;
  reduceMotion: boolean;
}> = ({ flowing, blocked, fromStroke, toStroke, delay, reduceMotion }) => {
  const gradientId = React.useId();

  // pt aligns the path's centre line (viewBox y=20 of a 40px-tall svg) with the 48px node's centre
  return (
    <div className="flex-1 min-w-[36px] pt-[4px] relative">
      <svg viewBox="0 0 112 40" preserveAspectRatio="none" className="w-full h-10 overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={fromStroke} stopOpacity={flowing ? 0.55 : 0.22} />
            <stop offset="100%" stopColor={blocked ? '#F5A623' : toStroke} stopOpacity={flowing ? 0.55 : 0.22} />
          </linearGradient>
        </defs>

        {/* The channel itself — always present, so an unreached path still reads as a path */}
        <path
          d={PATH_D}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeDasharray={blocked ? '3 4' : undefined}
          vectorEffect="non-scaling-stroke"
        />

        {/* Light only travels where the work has actually travelled */}
        {flowing && !blocked && !reduceMotion && (
          <motion.path
            d={PATH_D}
            fill="none"
            stroke={toStroke}
            strokeWidth={1.75}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="5 150"
            initial={{ strokeDashoffset: 155, opacity: 0.9 }}
            animate={{ strokeDashoffset: 0, opacity: 0.9 }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'linear', delay }}
          />
        )}
      </svg>

      {blocked && (
        <span
          aria-hidden
          className="absolute left-1/2 top-[24px] -translate-x-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full bg-warning-500/70"
        />
      )}
    </div>
  );
};

const OUTCOME_TONE = {
  success: { label: 'text-success-300', bar: 'bg-success-400/80' },
  warning: { label: 'text-warning-300', bar: 'bg-warning-400/80' },
  neutral: { label: 'text-text-muted', bar: 'bg-primary-400/70' },
} as const;

const TerminalReadout: React.FC<{ journey: JourneyState; reduceMotion: boolean }> = ({ journey, reduceMotion }) => {
  const tone = OUTCOME_TONE[journey.outcomeTone];
  return (
    <div className="flex items-center gap-3 shrink-0 pl-1">
      <TerminalOrb journey={journey} reduceMotion={reduceMotion} />
      <div className="min-w-0 w-[132px] xl:w-[146px]">
        <div className={`text-[9.5px] font-mono uppercase tracking-[0.14em] ${tone.label}`}>{journey.outcomeLabel}</div>
        <div className="text-[19px] font-semibold tabular-nums text-text-primary leading-tight mt-1">
          {journey.outcomeValue}
        </div>
        <ProgressBars reached={journey.reachedIndex} fill={tone.bar} />
        <p className="text-[11px] text-text-muted mt-1.5 leading-snug">{journey.outcomeCaption}</p>
      </div>
    </div>
  );
};

const TerminalOrb: React.FC<{ journey: JourneyState; reduceMotion: boolean; compact?: boolean }> = ({
  journey,
  reduceMotion,
  compact,
}) => {
  const complete = journey.reachedIndex >= 4;
  const size = compact ? 'w-7 h-7' : 'w-11 h-11';

  return (
    <div className="relative shrink-0">
      <div
        aria-hidden
        className={`absolute inset-0 rounded-full blur-lg ${complete ? 'bg-success-500/30' : 'bg-success-500/10'}`}
      />
      {complete && !reduceMotion && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-success-500/50"
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: 0, scale: 1.7 }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <div
        className={`relative ${size} rounded-full border flex items-center justify-center ${
          complete ? 'border-success-500/60 bg-success-muted/50' : 'border-border-strong bg-surface'
        }`}
      >
        <span
          className={`rounded-full ${compact ? 'w-2 h-2' : 'w-3 h-3'} ${
            complete ? 'bg-success-400' : 'bg-border-strong'
          }`}
        />
      </div>
    </div>
  );
};

/** Five ticks, one per stage — filled as far as the work has genuinely reached. */
const ProgressBars: React.FC<{ reached: number; fill: string }> = ({ reached, fill }) => (
  <div className="flex items-center gap-[3px] mt-2" aria-hidden>
    {[0, 1, 2, 3, 4].map((i) => (
      <span key={i} className={`h-[9px] w-[3px] rounded-full ${i <= reached ? fill : 'bg-border-strong'}`} />
    ))}
  </div>
);

/* ───────────────────────────── mobile pieces ───────────────────────────── */

const JourneyDot: React.FC<{ stage: JourneyStage; index: number; reduceMotion: boolean }> = ({ stage, index }) => {
  const Icon = STAGE_ICON[index];
  const tone = toneFor(index, stage.state);
  return (
    <div className={`w-9 h-9 rounded-full border flex items-center justify-center bg-surface ${tone.ring} shrink-0`}>
      <Icon strokeWidth={1.6} className={`w-4 h-4 ${tone.icon}`} />
    </div>
  );
};

const VerticalConnector: React.FC<{
  flowing: boolean;
  blocked: boolean;
  stroke: string;
  reduceMotion: boolean;
}> = ({ flowing, blocked, stroke, reduceMotion }) => (
  <div className="relative w-[2px] flex-1 min-h-[26px] my-1 overflow-hidden rounded-full">
    <div
      className="absolute inset-0 rounded-full"
      style={{ backgroundColor: blocked ? '#F5A623' : stroke, opacity: flowing ? 0.4 : 0.16 }}
    />
    {flowing && !blocked && !reduceMotion && (
      <motion.div
        className="absolute left-0 w-full h-3 rounded-full"
        style={{ backgroundColor: stroke }}
        initial={{ top: '-20%', opacity: 0.85 }}
        animate={{ top: '110%', opacity: 0.85 }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
      />
    )}
  </div>
);
