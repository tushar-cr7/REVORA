'use client';

import React from 'react';
import { Sparkles, Search, Stethoscope, ShieldCheck, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AnalyzeResponse, AuditEvent } from '@/lib/types';
import { formatTimeAgo } from '@/lib/format';
import { motion } from 'framer-motion';

interface RevoraActivityProps {
  analyzeData: AnalyzeResponse | null;
  auditLog: AuditEvent[];
}

const STEPS = [
  { key: 'detect', label: 'Detect', icon: Search, color: 'text-text-muted', activeColor: 'text-ai-400', activeBg: 'bg-ai-900/40 border-ai-500/40' },
  { key: 'diagnose', label: 'Diagnose', icon: Stethoscope, color: 'text-text-muted', activeColor: 'text-primary-400', activeBg: 'bg-primary-900/40 border-primary-500/40' },
  { key: 'approve', label: 'Approve', icon: ShieldCheck, color: 'text-text-muted', activeColor: 'text-success-400', activeBg: 'bg-success-900/40 border-success-500/40' },
  { key: 'recover', label: 'Recover', icon: Zap, color: 'text-text-muted', activeColor: 'text-warning-400', activeBg: 'bg-warning-900/40 border-warning-500/40' },
] as const;

/**
 * REVORA's own words for what it's doing, without exposing model names or
 * internal scoring — this is the "REVORA is actively watching" moment.
 * Replaces the old "REVORA Intelligence / CORE-V2" panel.
 */
export const RevoraActivity: React.FC<RevoraActivityProps> = ({ analyzeData, auditLog }) => {
  const recent = auditLog.slice(0, 3);

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between h-full">
      <div className="absolute top-0 right-0 w-64 h-64 bg-ai-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

      <div>
        <div className="flex items-center justify-between pb-4 border-b border-border-subtle relative z-10">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-ai-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-text-primary text-[14px] font-medium tracking-wide">REVORA Activity</h3>
              <p className="text-text-muted text-[12px] mt-0.5">What REVORA is doing about your revenue</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-ai-500/10 rounded-full border border-ai-500/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ai-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-ai-500" />
            </span>
            <span className="text-[10px] uppercase font-mono font-medium text-ai-400">Live</span>
          </div>
        </div>

        {/* What REVORA sees */}
        <div className="mt-5 p-3.5 rounded-lg bg-surface border border-border-subtle text-[13px] text-text-secondary leading-relaxed relative z-10 flex items-start space-x-3">
          <Sparkles className="w-4 h-4 text-ai-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-text-primary">REVORA recommends: </span>
            {analyzeData?.explanation || 'Waiting for the next pass over your revenue at risk.'}
          </div>
        </div>

        {/* Pipeline */}
        <div className="mt-6 relative z-10">
          <h4 className="text-[11px] font-mono text-text-muted uppercase tracking-widest mb-4">Recovery Pipeline</h4>
          <div className="flex items-center justify-between">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <React.Fragment key={step.key}>
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm z-10 relative border transition-colors ${
                        analyzeData ? step.activeBg : 'bg-panel-raised border-border-strong'
                      } ${analyzeData ? step.activeColor : 'text-text-muted'}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-[10px] mt-2 font-medium transition-colors ${analyzeData ? step.activeColor : 'text-text-muted'}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 h-px bg-border-strong mx-2 relative">
                      {analyzeData && (
                        <motion.div
                          className="absolute top-0 left-0 h-full bg-ai-400/50"
                          initial={{ x: '-100%' }}
                          animate={{ x: '250%' }}
                          transition={{ duration: 2.2, delay: i * 0.3, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ width: '40%' }}
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

      {/* Recent activity ticker */}
      <div className="mt-6 pt-4 border-t border-border-subtle relative z-10">
        <h4 className="text-[11px] font-mono text-text-muted uppercase tracking-widest mb-2.5">Recent</h4>
        {recent.length === 0 ? (
          <p className="text-[12px] text-text-muted">No recovery actions recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map((evt) => {
              const isSuccess = evt.outcome?.recovered || evt.event_type === 'EXECUTION_SUCCEEDED';
              const isBlocked = evt.event_type === 'ACTION_BLOCKED';
              return (
                <div key={evt.event_id} className="flex items-center gap-2 text-[12px] text-text-secondary">
                  {isSuccess ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-success-400 shrink-0" />
                  ) : isBlocked ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-risk-400 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                  )}
                  <span className="capitalize">{evt.action.replace('_', ' ')}</span>
                  <span className="text-text-muted">on {evt.transaction_id}</span>
                  <span className="text-text-muted ml-auto shrink-0">{formatTimeAgo(evt.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
