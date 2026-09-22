'use client';

import React from 'react';
import { Sparkles, Lock, CheckCircle2, UserCheck, PauseCircle, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * The page's signature visual: makes "bounded autonomy" visually obvious.
 * Static and explanatory — it illustrates the real, fixed policy-gate
 * architecture (see backend/app/domain/policy.py), not a live traffic feed.
 */
export function RecoveryBoundaryPanel() {
  const outcomes = [
    {
      key: 'execute',
      icon: CheckCircle2,
      label: 'Execute automatically',
      detail: 'Action runs immediately — no merchant step required.',
      color: 'text-success-500',
      border: 'border-success-500/30',
      bg: 'bg-success-500/10',
    },
    {
      key: 'escalate',
      icon: UserCheck,
      label: 'Escalate to merchant',
      detail: 'Handed to you for review before anything happens.',
      color: 'text-warning-500',
      border: 'border-warning-500/30',
      bg: 'bg-warning-500/10',
    },
    {
      key: 'hold',
      icon: PauseCircle,
      label: 'Hold (suppress)',
      detail: 'A deliberate no-action — REVORA waits rather than acts.',
      color: 'text-text-muted',
      border: 'border-border-strong',
      bg: 'bg-surface',
    },
  ];

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-6 lg:p-8 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-40 bg-primary-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between relative z-10 mb-8">
        <div>
          <h3 className="text-text-primary text-[15px] font-semibold">Autonomous Recovery Boundary</h3>
          <p className="text-[12px] text-text-muted mt-1">How every proposed action is decided before it ever touches a customer or a payment.</p>
        </div>
        <span className="hidden sm:inline-flex text-[10px] font-mono uppercase bg-ai-900/20 text-ai-400 px-2.5 py-1 rounded-sm border border-ai-500/20 tracking-wider shrink-0">
          AI for Intelligence · Rules for Control
        </span>
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-xl mx-auto">
        {/* Node 1: AI proposal */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm flex items-center gap-3 px-4 py-3 rounded-lg border border-ai-500/30 bg-ai-900/10"
        >
          <Sparkles className="w-4 h-4 text-ai-400 shrink-0" />
          <div>
            <div className="text-[13px] font-medium text-text-primary">REVORA proposes an action</div>
            <div className="text-[11px] text-text-muted">Highest expected-value recovery action for this case</div>
          </div>
        </motion.div>

        <ChevronDown className="w-4 h-4 text-border-strong my-2" />

        {/* Node 2: the deterministic gate */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="w-full max-w-sm flex items-center gap-3 px-4 py-3 rounded-lg border border-primary-500/40 bg-primary-900/10"
        >
          <Lock className="w-4 h-4 text-primary-400 shrink-0" />
          <div>
            <div className="text-[13px] font-medium text-text-primary">Checked against your recovery controls</div>
            <div className="text-[11px] text-text-muted">Deterministic — the AI cannot approve its own proposal</div>
          </div>
        </motion.div>

        <ChevronDown className="w-4 h-4 text-border-strong my-2" />

        {/* Node 3: the three real outcomes */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
          {outcomes.map((o, idx) => {
            const Icon = o.icon;
            return (
              <motion.div
                key={o.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 + idx * 0.06 }}
                className={`flex flex-col items-start gap-1.5 p-3.5 rounded-lg border ${o.border} ${o.bg}`}
              >
                <Icon className={`w-4 h-4 ${o.color}`} />
                <div className={`text-[12.5px] font-medium ${o.color}`}>{o.label}</div>
                <div className="text-[11px] text-text-muted leading-snug">{o.detail}</div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <p className="relative z-10 text-[11.5px] text-text-muted text-center leading-relaxed mt-7 max-w-lg mx-auto">
        Every action REVORA proposes passes through this gate before anything happens. The gate is fixed —
        it can be tightened by you, but it cannot be talked around by the AI.
      </p>
    </div>
  );
}
