'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Search, Stethoscope, ShieldCheck, Zap, LineChart } from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { AnalyzeResponse, RecoverResponse, ScanResponse } from '@/lib/types';

interface RecoveryPulseHeaderProps {
  scanData: ScanResponse | null;
  analyzeData: AnalyzeResponse | null;
  recoverData: RecoverResponse | null;
}

const STAGES = [
  { key: 'detect', label: 'Detect', icon: Search },
  { key: 'diagnose', label: 'Diagnose', icon: Stethoscope },
  { key: 'approve', label: 'Approve', icon: ShieldCheck },
  { key: 'recover', label: 'Recover', icon: Zap },
  { key: 'measure', label: 'Measure', icon: LineChart },
] as const;

/**
 * The financial header for Revenue Command: three figures that are one
 * story (money at risk -> what's recoverable -> what's already back) tied
 * together by a single "recovery pulse" — the same detect/diagnose/approve/
 * recover/measure loop REVORA actually runs, shown as a restrained,
 * continuously-live line rather than four disconnected KPI cards.
 */
export const RecoveryPulseHeader: React.FC<RecoveryPulseHeaderProps> = ({
  scanData,
  analyzeData,
  recoverData,
}) => {
  const atRisk = scanData?.total_at_risk || 0;
  const recoverable = analyzeData?.realistically_recoverable || 0;
  const recovered = recoverData?.total_recovered || 0;
  const avgProb = analyzeData?.avg_recovery_probability || 0;
  const recoveryRate = recoverData?.recovery_rate_pct || 0;

  const activeIndex = recoverData ? 5 : analyzeData ? 3 : scanData ? 1 : 0;

  return (
    <div className="bg-panel border border-border-strong rounded-xl shadow-sm overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border-subtle">
        <div className="p-5">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Revenue at Risk</span>
          <div className="mt-2 text-3xl font-display font-semibold text-text-primary tracking-tight">
            {formatINR(atRisk, true)}
          </div>
          <div className="mt-2 text-[13px] text-text-muted">
            <span className="font-mono text-text-secondary">{scanData?.total_transactions_scanned || 0}</span>{' '}
            transactions detected
          </div>
        </div>

        <div className="p-5">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Potential Recovery</span>
          <div className="mt-2 text-3xl font-display font-semibold text-ai-300 tracking-tight">
            {formatINR(recoverable, true)}
          </div>
          <div className="mt-2 text-[13px] text-text-muted">
            <span className="text-ai-400 font-medium">{formatPct(avgProb)}</span> average win probability
          </div>
        </div>

        <div className="p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-success-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
          <span className="text-[13px] font-medium text-success-100 tracking-wide relative z-10">Recovered Revenue</span>
          <div className="mt-2 text-3xl font-display font-semibold text-success-300 tracking-tight relative z-10">
            {formatINR(recovered, true)}
          </div>
          <div className="mt-2 text-[13px] text-success-100/70 relative z-10">
            <span className="text-success-400 font-medium">{formatPct(recoveryRate)}</span> recovery rate
          </div>
        </div>
      </div>

      {/* Recovery Pulse */}
      <div className="px-5 py-4 border-t border-border-subtle bg-surface/60">
        <div className="flex items-center">
          {STAGES.map((stage, i) => {
            const Icon = stage.icon;
            const isDone = i < activeIndex;
            const segmentFilled = i + 1 < activeIndex;
            const segmentFlowing = i < activeIndex && i + 1 >= activeIndex;
            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors duration-500 ${
                      isDone
                        ? 'bg-primary-900/40 border-primary-500/50 text-primary-300'
                        : 'bg-panel-raised border-border-strong text-text-muted'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                  </div>
                  <span
                    className={`mt-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors duration-500 ${
                      isDone ? 'text-text-secondary' : 'text-text-muted'
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className="flex-1 h-px bg-border-subtle mx-2 relative top-[-9px] overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 bg-primary-500/60 transition-all duration-700 ${
                        segmentFilled ? 'w-full' : 'w-0'
                      }`}
                    />
                    {segmentFlowing && (
                      <motion.div
                        className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-primary-300/70 to-transparent"
                        animate={{ x: ['-2rem', '120%'] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
