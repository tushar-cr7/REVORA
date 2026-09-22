'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldAlert, ChevronDown, CircleCheck } from 'lucide-react';
import { Opportunity, Transaction, Decision } from '@/lib/types';
import { formatINR, formatPct } from '@/lib/format';
import { buildWhyBullets, ACTION_COLOR } from './decisionField.utils';

interface DecisionDetailProps {
  opportunity: Opportunity | null;
  transaction: Transaction | null;
  decision: Decision | null;
  detailLoading: boolean;
  executing: boolean;
  justExecuted: boolean;
  onExecute: () => void;
}

export const DecisionDetail: React.FC<DecisionDetailProps> = ({
  opportunity,
  transaction,
  decision,
  detailLoading,
  executing,
  justExecuted,
  onExecute,
}) => {
  const [showTechnical, setShowTechnical] = useState(false);

  if (!opportunity) {
    return (
      <div className="bg-panel border border-border-subtle rounded-md p-8 h-full flex flex-col items-center justify-center text-center">
        <p className="text-text-secondary text-sm font-medium">Select a decision</p>
        <p className="text-text-muted text-xs mt-1 max-w-xs">
          Choose a node in the decision field or a row in the queue to see what REVORA recommends and why.
        </p>
      </div>
    );
  }

  const finalAction = decision?.final_action || opportunity.recommended_action;
  const finalCandidate = decision?.candidates_evaluated.find((c) => c.action === finalAction);
  const likelihood = finalCandidate?.probability ?? opportunity.recovery_probability;
  const recoveryValue = finalCandidate?.expected_value ?? opportunity.expected_recovery;
  const allowed = decision ? decision.policy_allowed : opportunity.policy_allowed;
  const rerouted = decision && decision.ai_proposed_action !== decision.final_action;
  const whyBullets = buildWhyBullets(transaction, decision);
  const rankedCandidates = decision ? [...decision.candidates_evaluated].sort((a, b) => b.expected_value - a.expected_value) : [];

  return (
    <div className="bg-panel border border-border-subtle rounded-md p-5 h-full flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Recovery Decision</span>
          <div className="text-2xl font-display font-semibold text-text-primary mt-1">{formatINR(opportunity.amount)}</div>
          <p className="text-xs text-text-muted mt-0.5 capitalize">{opportunity.leak_type.replace('_', ' ')} at risk</p>
        </div>
        {detailLoading && <div className="w-4 h-4 rounded-full border-2 border-ai-500/30 border-t-ai-400 animate-spin mt-1" />}
      </div>

      <div className="mt-5 pt-4 border-t border-border-divider">
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">REVORA Recommends</span>
        <div className="flex items-baseline gap-3 mt-1.5">
          <span
            className="text-xl font-semibold uppercase tracking-tight"
            style={{ color: ACTION_COLOR[finalAction] || '#8FA3FF' }}
          >
            {finalAction.replace('_', ' ')}
          </span>
          {finalCandidate && (
            <span className="text-xs text-text-secondary font-medium">{formatPct(likelihood)} recovery likelihood</span>
          )}
        </div>
        {recoveryValue > 0 && (
          <p className="text-xs text-text-muted mt-1">Potential recovery: <span className="text-success-300 font-medium">{formatINR(recoveryValue)}</span></p>
        )}
      </div>

      {whyBullets.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border-divider">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Why this decision</span>
          <ul className="mt-2 space-y-1.5">
            {whyBullets.map((b, i) => (
              <li key={i} className="text-[13px] text-text-secondary leading-relaxed flex items-start gap-2">
                <span className="text-ai-400 mt-1 text-[8px]">●</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision && (
        <div className="mt-5 pt-4 border-t border-border-divider">
          <div className={`rounded-md border p-3 flex items-start gap-2.5 ${allowed ? 'bg-success-muted/40 border-success-500/30' : 'bg-warning-muted/40 border-warning-500/30'}`}>
            {allowed ? (
              <ShieldCheck className="w-4 h-4 text-success-400 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-warning-400 shrink-0 mt-0.5" />
            )}
            <div>
              <span className={`text-xs font-semibold uppercase tracking-wide ${allowed ? 'text-success-300' : 'text-warning-300'}`}>
                {allowed ? 'Safety check passed' : 'Review required'}
              </span>
              <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">
                {decision.policy_reason}
                {rerouted && ` Rerouted to ${decision.final_action.replace('_', ' ')}.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {rankedCandidates.length > 1 && (
        <div className="mt-5 pt-4 border-t border-border-divider">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Other paths considered</span>
          <div className="mt-2 space-y-1.5">
            {rankedCandidates.map((c) => (
              <div
                key={c.action}
                className={`flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded ${
                  c.action === finalAction ? 'bg-surface border border-border-strong' : ''
                }`}
              >
                <span className={`font-mono uppercase ${c.action === finalAction ? 'text-text-primary font-medium' : 'text-text-muted'}`}>
                  {c.action.replace('_', ' ')}
                </span>
                <span className="font-mono text-text-muted">
                  {formatPct(c.probability)} · {formatINR(c.expected_value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-5">
        <AnimatePresence mode="wait">
          {justExecuted ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-success-muted border border-success-500/30 text-success-300 text-sm font-medium"
            >
              <CircleCheck className="w-4 h-4" />
              <span>Executed</span>
            </motion.div>
          ) : (
            <motion.button
              key="action"
              onClick={onExecute}
              disabled={executing || detailLoading}
              className="w-full px-4 py-2.5 rounded-md bg-ai-700 hover:bg-ai-600 text-text-primary text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {executing ? 'Processing...' : allowed ? 'Review Decision' : 'Review & Proceed'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {decision && (
        <div className="mt-4 pt-3 border-t border-border-divider">
          <button
            onClick={() => setShowTechnical((s) => !s)}
            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
            View technical details
          </button>
          <AnimatePresence>
            {showTechnical && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-1 font-mono text-[11px] text-text-muted">
                  <div className="flex justify-between"><span>decision_id</span><span className="text-text-secondary">{decision.decision_id}</span></div>
                  <div className="flex justify-between"><span>ai_proposed_action</span><span className="text-text-secondary">{decision.ai_proposed_action}</span></div>
                  <div className="flex justify-between"><span>ai_proposed_ev</span><span className="text-text-secondary">{formatINR(decision.ai_proposed_ev)}</span></div>
                  <div className="flex justify-between"><span>policy_allowed</span><span className="text-text-secondary">{String(decision.policy_allowed)}</span></div>
                  {decision.candidates_evaluated.map((c) => (
                    <div key={c.action} className="flex justify-between pl-3 border-l border-border-divider">
                      <span>{c.action} cost / friction</span>
                      <span className="text-text-secondary">{formatINR(c.cost)} / {c.friction.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
