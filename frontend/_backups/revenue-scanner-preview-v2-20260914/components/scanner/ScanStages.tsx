'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

export const SCAN_STAGES = [
  { key: 'ingest', label: 'Ingesting data', detail: 'Reading transaction records' },
  { key: 'detect', label: 'Detecting anomalies', detail: 'Searching for revenue leaks' },
  { key: 'classify', label: 'Classifying issues', detail: 'Mapping to leak categories' },
  { key: 'calculate', label: 'Calculating recovery potential', detail: "Estimating what's recoverable" },
  { key: 'finalize', label: 'Finalizing results', detail: 'Compiling the scan report' },
] as const;

interface ScanStagesProps {
  stageIndex: number;
}

/**
 * Stage narration for the scan in flight. The backend returns one atomic
 * response with no incremental progress, so these stages are honest
 * process narration paced by elapsed time — not a claim about real
 * backend telemetry. The only real number involved (transactions scanned,
 * amount at risk, etc.) only ever appears once the actual response has
 * returned.
 */
export const ScanStages: React.FC<ScanStagesProps> = ({ stageIndex }) => {
  return (
    <div className="space-y-2.5">
      {SCAN_STAGES.map((stage, i) => {
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
                  ? 'bg-primary-900/40 border-primary-500/60 text-primary-300'
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
