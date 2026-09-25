'use client';

import React from 'react';
import { Shield, LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Left half of the signature section: makes "bounded autonomy" visually
 * obvious. Static and explanatory — it illustrates the real, fixed
 * policy-gate architecture (see backend/app/domain/policy.py), not a live
 * traffic feed.
 */

const STEPS: { icon: LucideIcon; label: string; detail: string }[] = [
  {
    icon: Shield,
    label: 'REVORA proposes an action',
    detail: 'Highest expected-value recovery action for this case.',
  },
  {
    icon: Shield,
    label: 'Checked against your controls',
    detail: 'Deterministic — the AI cannot approve its own proposal.',
  },
  {
    icon: Shield,
    label: 'Action taken (if allowed)',
    detail: 'Runs automatically within your configured limits.',
  },
];

export function RecoveryBoundaryPanel() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="bg-panel border border-border-subtle rounded-xl p-6 h-full flex flex-col">
      <div className="mb-6">
        <h3 className="text-text-primary text-[15px] font-semibold">Autonomous Recovery Boundary</h3>
        <p className="text-[12px] text-text-muted mt-1">How every proposed action is checked before it runs.</p>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-8 items-center">
        {/* numbered steps */}
        <ol className="relative space-y-6 min-w-0">
          <div aria-hidden className="absolute left-[13px] top-2 bottom-2 w-px bg-border-divider" />
          {STEPS.map((step, i) => (
            <motion.li
              key={step.label}
              initial={reduceMotion ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="relative flex items-start gap-3.5"
            >
              <span className="relative z-10 w-7 h-7 rounded-full border border-primary-500/40 bg-panel-raised text-primary-200 text-[12px] font-mono font-semibold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="text-[13px] font-medium text-text-primary">{step.label}</div>
                <div className="text-[11.5px] text-text-muted mt-0.5 leading-relaxed">{step.detail}</div>
              </div>
            </motion.li>
          ))}
        </ol>

        {/* the gate diagram */}
        <BoundaryDiagram reduceMotion={!!reduceMotion} />
      </div>
    </section>
  );
}

const BoundaryDiagram: React.FC<{ reduceMotion: boolean }> = ({ reduceMotion }) => {
  return (
    <div className="relative w-[168px] h-[168px] mx-auto shrink-0" aria-hidden>
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-primary-500/10 blur-2xl" />

      <motion.span
        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute left-1/2 -translate-x-1/2 -top-2 z-10 text-[9px] font-mono uppercase tracking-[0.14em] text-primary-200 bg-panel-raised border border-primary-500/30 rounded-full px-2.5 py-1 whitespace-nowrap"
      >
        Your policy
      </motion.span>

      <div className="absolute inset-[18px] rounded-full border border-border-strong" />
      <div className="absolute inset-[34px] rounded-full border border-primary-500/30" />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="absolute inset-[50px] rounded-full border border-ai-500/40 bg-panel flex items-center justify-center"
      >
        <Shield className="w-6 h-6 text-ai-300" strokeWidth={1.5} />
      </motion.div>

      <span className="absolute left-1 bottom-3 text-[8.5px] font-mono uppercase tracking-wider text-ai-300 max-w-[58px] leading-tight">
        AI intelligence
      </span>
      <span className="absolute right-1 bottom-3 text-[8.5px] font-mono uppercase tracking-wider text-success-300 max-w-[58px] text-right leading-tight">
        Safe execution
      </span>
    </div>
  );
};
