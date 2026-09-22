'use client';

import React from 'react';
import { AlertCircle, Network, CheckCircle2, Zap } from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { AnalyzeResponse, RecoverResponse, ScanResponse } from '@/lib/types';
import { motion } from 'framer-motion';

interface KpiCardsProps {
  scanData: ScanResponse | null;
  analyzeData: AnalyzeResponse | null;
  recoverData: RecoverResponse | null;
  onRunBatchRecover: () => void;
  isRecovering: boolean;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export const KpiCards: React.FC<KpiCardsProps> = ({
  scanData,
  analyzeData,
  recoverData,
  onRunBatchRecover,
  isRecovering,
}) => {
  const atRisk = scanData?.total_at_risk || 0;
  const recoverable = analyzeData?.realistically_recoverable || 0;
  const recovered = recoverData?.total_recovered || 0;
  const avgProb = analyzeData?.avg_recovery_probability || 0;
  const recoveryRate = recoverData?.recovery_rate_pct || 0;

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
    >
      {/* 1. Revenue at Risk Card */}
      <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Revenue at Risk</span>
          <div className="w-8 h-8 rounded-full bg-surface border border-border-subtle flex items-center justify-center text-risk-400 group-hover:scale-110 transition-transform">
            <AlertCircle className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="text-3xl font-display font-semibold text-text-primary tracking-tight">
            {formatINR(atRisk, true)}
          </div>
          <div className="flex items-center space-x-2 mt-2 text-[13px] text-text-muted">
            <span className="font-mono text-text-secondary">{scanData?.total_transactions_scanned || 0}</span>
            <span>detected transactions</span>
          </div>
        </div>
      </motion.div>

      {/* 2. Potential Recovery Card */}
      <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] font-medium text-text-secondary tracking-wide">Potential Recovery</span>
          <div className="w-8 h-8 rounded-full bg-surface border border-border-subtle flex items-center justify-center text-ai-400 group-hover:scale-110 transition-transform">
            <Network className="w-4 h-4" />
          </div>
        </div>
        <div>
          <div className="text-3xl font-display font-semibold text-text-primary tracking-tight">
            {formatINR(recoverable, true)}
          </div>
          <div className="flex items-center space-x-2 mt-2 text-[13px] text-text-muted">
            <span>Win probability:</span>
            <span className="text-ai-400 font-medium">{formatPct(avgProb)}</span>
          </div>
        </div>
      </motion.div>

      {/* 3. Recovered Revenue Card */}
      <motion.div variants={itemVariants} className="bg-success-900/20 border border-success-500/30 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-success-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
        <div className="flex items-center justify-between mb-4 relative z-10">
          <span className="text-[13px] font-medium text-success-100 tracking-wide">Recovered Revenue</span>
          <div className="w-8 h-8 rounded-full bg-success-950 border border-success-500/40 flex items-center justify-center text-success-400 group-hover:scale-110 transition-transform">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="relative z-10">
          <div className="text-3xl font-display font-semibold text-success-300 tracking-tight">
            {formatINR(recovered, true)}
          </div>
          <div className="flex items-center space-x-2 mt-2 text-[13px] text-success-100/70">
            <span>Recovery rate:</span>
            <span className="text-success-400 font-medium">{formatPct(recoveryRate)}</span>
          </div>
        </div>
      </motion.div>

      {/* 4. Controls & Execution Card */}
      <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium text-text-secondary tracking-wide">Active Controls</span>
            <div className="w-8 h-8 rounded-full bg-surface border border-border-subtle flex items-center justify-center text-primary-400">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div className="text-2xl font-display font-semibold text-text-primary">
              {analyzeData?.policy_blocked_count || 0}
            </div>
            <span className="text-[11px] text-risk-300 bg-risk-500/10 px-2 py-0.5 rounded-full border border-risk-500/20 font-medium">
              Actions Paused
            </span>
          </div>
        </div>

        <button
          onClick={onRunBatchRecover}
          disabled={isRecovering || !analyzeData}
          className="mt-4 w-full py-2.5 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-[13px] font-medium flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 shadow-sm"
        >
          <Zap className={`w-4 h-4 ${isRecovering ? 'animate-spin' : ''}`} />
          <span>{isRecovering ? 'Executing...' : 'Execute Recovery Pass'}</span>
        </button>
      </motion.div>
    </motion.div>
  );
};
