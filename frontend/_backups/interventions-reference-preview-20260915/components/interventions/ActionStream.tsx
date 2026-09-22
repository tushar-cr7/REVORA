'use client';

import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { Intervention, Opportunity } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { actionLabel, OUTCOME_LABEL } from '@/lib/actionMeta';
import { actionIcon } from './actionIcons';

const LEAK_LABEL: Record<string, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Subscription failure',
  overdue_invoice: 'Overdue invoice',
};

export interface ExecutingItem {
  transactionId: string;
  action: string;
  amount: number;
  leakType: string;
}

interface ActionStreamProps {
  ready: Opportunity[];
  completed: Intervention[];
  executing: ExecutingItem | null;
  /** transaction_id of the item that just landed in Completed, for a brief settle highlight. */
  justCompletedId: string | null;
}

const LANE_CAP = 5;

/**
 * REVORA's signature visual for Interventions: a compact three-lane rail —
 * Ready / Executing / Completed — showing real queued and recently-completed
 * items. When the user executes one, that exact chip carries a shared
 * layoutId so Framer Motion animates it traveling from Ready through
 * Executing into Completed once the real API response resolves.
 */
export const ActionStream: React.FC<ActionStreamProps> = ({ ready, completed, executing, justCompletedId }) => {
  const reduceMotion = useReducedMotion();
  const readyVisible = ready.filter((o) => o.transaction_id !== executing?.transactionId).slice(0, LANE_CAP);
  const completedVisible = completed.slice(0, LANE_CAP);

  return (
    <div className="rounded-lg border border-border-subtle bg-surface/40 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-3">
        <Lane title="Ready" count={ready.length}>
          <AnimatePresence initial={false}>
            {readyVisible.length === 0 ? (
              <EmptyLane label="Nothing queued" />
            ) : (
              readyVisible.map((o) => (
                <ReadyChip key={o.transaction_id} opp={o} reduceMotion={!!reduceMotion} />
              ))
            )}
          </AnimatePresence>
        </Lane>

        <Lane title="Executing" count={executing ? 1 : 0}>
          <AnimatePresence initial={false}>
            {executing ? (
              <ExecutingChip key={executing.transactionId} item={executing} reduceMotion={!!reduceMotion} />
            ) : (
              <EmptyLane label="Idle" />
            )}
          </AnimatePresence>
        </Lane>

        <Lane title="Completed" count={completed.length}>
          <AnimatePresence initial={false}>
            {completedVisible.length === 0 ? (
              <EmptyLane label="No actions yet" />
            ) : (
              completedVisible.map((itv) => (
                <CompletedChip
                  key={itv.intervention_id}
                  itv={itv}
                  justLanded={itv.transaction_id === justCompletedId}
                  reduceMotion={!!reduceMotion}
                />
              ))
            )}
          </AnimatePresence>
        </Lane>
      </div>
    </div>
  );
};

const Lane: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => (
  <div>
    <div className="flex items-center justify-between pb-2 mb-2 border-b border-border-divider">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">{title}</span>
      <span className="text-[10px] font-mono text-text-muted tabular-nums">{count}</span>
    </div>
    <div className="space-y-1.5 min-h-[64px]">{children}</div>
  </div>
);

const EmptyLane: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-[11px] text-text-muted/70 italic py-3 text-center">{label}</div>
);

const chipBase =
  'flex items-center gap-2 rounded-md border px-2.5 py-2 bg-panel';

const ReadyChip: React.FC<{ opp: Opportunity; reduceMotion: boolean }> = ({ opp, reduceMotion }) => {
  const Icon = actionIcon(opp.recommended_action);
  const blocked = !opp.policy_allowed;
  return (
    <motion.div
      layoutId={`stream-${opp.transaction_id}`}
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`${chipBase} ${blocked ? 'border-warning-500/30' : 'border-border-strong'}`}
    >
      <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-text-primary truncate">{actionLabel(opp.recommended_action)}</span>
          <span className="text-[11.5px] font-mono font-semibold text-text-primary tabular-nums shrink-0">
            {formatINR(opp.amount)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-[10px] text-text-muted truncate">{LEAK_LABEL[opp.leak_type] ?? opp.leak_type}</span>
          <span className={`text-[9px] font-mono uppercase tracking-wide shrink-0 ${blocked ? 'text-warning-300' : 'text-success-300'}`}>
            {blocked ? 'Blocked' : 'Ready'}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

const ExecutingChip: React.FC<{ item: ExecutingItem; reduceMotion: boolean }> = ({ item, reduceMotion }) => {
  const Icon = actionIcon(item.action);
  return (
    <motion.div
      layoutId={`stream-${item.transactionId}`}
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className={`${chipBase} border-ai-500/50 bg-ai-muted/25`}
    >
      <Loader2 strokeWidth={1.75} className="w-3.5 h-3.5 text-ai-300 shrink-0 animate-spin" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-ai-200 truncate">{actionLabel(item.action)}</span>
          <span className="text-[11.5px] font-mono font-semibold text-text-primary tabular-nums shrink-0">
            {formatINR(item.amount)}
          </span>
        </div>
        <div className="text-[9px] font-mono uppercase tracking-wide text-ai-300 mt-0.5">Executing</div>
      </div>
      <Icon strokeWidth={1.5} className="w-3 h-3 text-ai-400/50 shrink-0" />
    </motion.div>
  );
};

const CompletedChip: React.FC<{ itv: Intervention; justLanded: boolean; reduceMotion: boolean }> = ({
  itv,
  justLanded,
  reduceMotion,
}) => {
  const Icon = actionIcon(itv.final_action);
  const tone = itv.recovered ? 'success' : itv.status === 'escalated_to_merchant' ? 'warning' : 'muted';
  const toneCls =
    tone === 'success' ? 'text-success-300' : tone === 'warning' ? 'text-warning-300' : 'text-text-muted';
  return (
    <motion.div
      layoutId={justLanded ? `stream-${itv.transaction_id}` : undefined}
      layout={!reduceMotion && justLanded}
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={
        justLanded && !reduceMotion
          ? { opacity: 1, y: 0, borderColor: ['rgba(139,92,246,0.6)', 'rgba(42,54,70,1)'] }
          : { opacity: 1, y: 0 }
      }
      transition={{ duration: justLanded ? 0.7 : 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`${chipBase} border-border-strong`}
    >
      <Icon strokeWidth={1.75} className="w-3.5 h-3.5 text-text-muted shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-text-primary truncate">{actionLabel(itv.final_action)}</span>
          <span className={`text-[11.5px] font-mono font-semibold tabular-nums shrink-0 ${itv.recovered ? 'text-success-300' : 'text-text-primary'}`}>
            {itv.recovered ? `+${formatINR(itv.recovered_amount)}` : formatINR(itv.amount)}
          </span>
        </div>
        <div className={`text-[9px] font-mono uppercase tracking-wide mt-0.5 ${toneCls}`}>
          {OUTCOME_LABEL[itv.status] ?? itv.status}
        </div>
      </div>
    </motion.div>
  );
};
