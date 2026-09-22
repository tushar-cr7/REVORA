'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

// Mirrors Revenue Scanner's ScanStages: the backend returns one atomic
// response with no incremental progress, so this is honest time-paced
// process narration, not a claim about real backend telemetry. No number
// here is ever invented — the only real numbers (amounts, counts) appear
// once the actual API response has returned, in the results state.
export const DECISION_STAGES = [
  { key: 'ingest', label: 'Ingesting opportunities', detail: 'Loading recovery opportunities' },
  { key: 'evaluate', label: 'Evaluating recovery paths', detail: 'Comparing possible actions' },
  { key: 'safety', label: 'Applying safety checks', detail: 'Checking recovery constraints' },
  { key: 'rank', label: 'Calculating recommendations', detail: 'Ranking recovery paths' },
  { key: 'finalize', label: 'Finalizing', detail: 'Preparing the decision queue' },
] as const;

interface DecisionStagesProps {
  stageIndex: number;
}

export const DecisionStages: React.FC<DecisionStagesProps> = ({ stageIndex }) => {
  return (
    <div className="space-y-2.5">
      {DECISION_STAGES.map((stage, i) => {
        const done = i < stageIndex;
        const current = i === stageIndex;
        return (
          <motion.div
            key={stage.key}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: done ? 0.55 : 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-3"
          >
            <div
              className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors duration-300 ${
                done
                  ? 'bg-success-900/30 border-success-500/40 text-success-400'
                  : current
                  ? 'bg-ai-900/40 border-ai-500/60 text-ai-300'
                  : 'bg-panel-raised border-border-strong text-text-muted'
              }`}
            >
              {done ? (
                <Check className="w-3 h-3" />
              ) : (
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-current"
                  animate={current ? { opacity: [0.4, 1, 0.4] } : undefined}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </div>
            <div>
              <div
                className={`text-[13px] font-medium transition-colors duration-300 ${
                  current ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
                }`}
              >
                {stage.label}
              </div>
              {current && <div className="text-[11px] text-text-muted mt-0.5">{stage.detail}</div>}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
