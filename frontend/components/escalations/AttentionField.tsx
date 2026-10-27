'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ShieldAlert, Users, CircleCheck } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { AttentionSummary, REASON_LABEL, ReasonKey } from './escalationSignals';
import { reasonIcon } from './reasonIcons';

interface Props {
  summary: AttentionSummary;
  loading: boolean;
}

/**
 * Signature visual for Escalations: "Attention Field."
 *
 * Reads left to right as the real handoff REVORA performs: cases REVORA
 * has decided on flow toward a control boundary; the ones a deterministic
 * rule stops (or that REVORA's own scoring decides need a person) collect
 * in the human-attention box, grouped by the real reason each one is
 * there; from there, resolution happens outside REVORA's system — the
 * product's honest boundary of authority, not a claimed outcome.
 *
 * Every count and amount below comes from `AttentionSummary`, itself
 * built only from loaded `/api/escalations` + `/api/transactions` +
 * `/api/interventions` records (see escalationSignals.ts) — nothing here
 * is a decorative or invented figure.
 */
export const AttentionField: React.FC<Props> = ({ summary, loading }) => {
  const reduceMotion = useReducedMotion();
  const lanes = (Object.keys(REASON_LABEL) as ReasonKey[])
    .map((key) => ({ key, ...summary.byReason[key] }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.amount - a.amount);

  const maxLaneAmount = Math.max(...lanes.map((l) => l.amount), 1);

  if (loading) return <FieldSkeleton />;

  return (
    <div className="rounded-lg border border-border-subtle bg-panel p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <div>
          <div className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-warning-300">Attention Field</div>
          <p className="text-[12.5px] text-text-secondary mt-1 max-w-md">
            Where revenue lands when REVORA reaches the edge of what it&apos;s allowed to do on its own.
          </p>
        </div>
      </div>

      {summary.totalCases === 0 ? (
        <EmptyField />
      ) : (
        <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-0">
          {/* Source: autonomous recovery */}
          <FieldNode
            icon={<span className="w-2 h-2 rounded-full bg-primary-400" />}
            label="Autonomous Recovery"
            value={`${summary.totalCases}`}
            caption="cases REVORA could not resolve on its own"
            tone="neutral"
          />

          <Connector reduceMotion={!!reduceMotion} icon={<ShieldAlert className="w-3.5 h-3.5 text-warning-300" />} label="Control boundary" />

          {/* Destination: human attention, grouped by real reason */}
          <div className="flex-1 min-w-0 rounded-md border border-warning-500/25 bg-warning-muted/10 p-4">
            <div className="flex items-center gap-2 mb-3.5">
              <Users className="w-3.5 h-3.5 text-warning-300 shrink-0" strokeWidth={1.75} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-warning-200">Human Attention</span>
              <span className="ml-auto text-[11px] font-mono text-text-muted tabular-nums">
                {summary.totalCases} case{summary.totalCases === 1 ? '' : 's'} · {formatINR(summary.revenueRequiringAttention, true)}
              </span>
            </div>

            <div className="space-y-2.5">
              {lanes.map((lane, i) => {
                const Icon = reasonIcon(lane.key);
                return (
                  <motion.div
                    key={lane.key}
                    initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className="flex items-center gap-2 text-[12px]">
                      <Icon className="w-3.5 h-3.5 text-warning-300/90 shrink-0" strokeWidth={1.75} />
                      <span className="text-text-secondary truncate">{REASON_LABEL[lane.key]}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-text-muted tabular-nums">
                        {lane.count} · {formatINR(lane.amount, true)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-border-subtle overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-warning-500/70"
                        initial={reduceMotion ? false : { width: 0 }}
                        animate={{ width: `${Math.max(3, (lane.amount / maxLaneAmount) * 100)}%` }}
                        transition={{ duration: 0.4, delay: i * 0.06 + 0.1, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <Connector reduceMotion={!!reduceMotion} icon={<ArrowRight className="w-3.5 h-3.5 text-text-muted" />} label="Handoff" />

          {/* Resolution happens outside REVORA — shown as a boundary, not a claimed outcome. */}
          <FieldNode
            icon={<CircleCheck className="w-3 h-3 text-success-400" />}
            label="Resolution"
            value={`${summary.routedCases}`}
            caption={
              summary.routedCases > 0
                ? `routed to your merchant queue · resolved outside REVORA`
                : 'happens outside REVORA, once you act'
            }
            tone="outside"
          />
        </div>
      )}
    </div>
  );
};

const FieldNode: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
  tone: 'neutral' | 'outside';
}> = ({ icon, label, value, caption, tone }) => (
  <div className="lg:w-[168px] shrink-0 flex flex-col justify-center rounded-md border border-border-subtle bg-surface p-3.5">
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
    </div>
    <div className={`text-[20px] font-semibold tabular-nums mt-1.5 ${tone === 'outside' ? 'text-text-secondary' : 'text-text-primary'}`}>
      {value}
    </div>
    <p className="text-[10.5px] text-text-muted mt-1 leading-snug">{caption}</p>
  </div>
);

const Connector: React.FC<{ reduceMotion: boolean; icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex lg:flex-col items-center justify-center gap-2 lg:gap-1.5 shrink-0 py-1 lg:py-0 lg:px-3">
    <div className="hidden lg:block h-full w-px border-l border-dashed border-border-strong" aria-hidden />
    <div className="w-7 h-7 rounded-full border border-border-strong bg-panel-raised flex items-center justify-center shrink-0">
      {icon}
    </div>
    <span className="lg:hidden text-[9.5px] font-mono uppercase tracking-wider text-text-muted whitespace-nowrap">{label}</span>
    <div className="hidden lg:block h-full w-px border-l border-dashed border-border-strong" aria-hidden />
  </div>
);

const EmptyField: React.FC = () => (
  <div className="py-10 text-center">
    <CircleCheck strokeWidth={1.5} className="w-8 h-8 text-success-400/70 mx-auto mb-3" />
    <p className="text-[13px] font-medium text-text-primary">Nothing needs human attention right now</p>
    <p className="text-[12px] text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
      Every decision REVORA has made so far stayed within its recovery controls. Escalations appear here the moment a
      case hits a control boundary or REVORA decides a person should look at it.
    </p>
  </div>
);

const FieldSkeleton: React.FC = () => (
  <div className="rounded-lg border border-border-subtle bg-panel p-5 sm:p-6 animate-pulse">
    <div className="h-2 w-24 rounded bg-border-strong/60 mb-2" />
    <div className="h-2.5 w-64 rounded bg-border-subtle mb-6" />
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="lg:w-[168px] h-20 rounded-md bg-surface border border-border-subtle shrink-0" />
      <div className="flex-1 h-32 rounded-md bg-surface border border-border-subtle" />
      <div className="lg:w-[168px] h-20 rounded-md bg-surface border border-border-subtle shrink-0" />
    </div>
  </div>
);
