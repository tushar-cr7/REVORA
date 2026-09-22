'use client';

import React from 'react';
import { Zap, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { AnalyzeResponse, RecoverResponse } from '@/lib/types';

interface RecoveryStatusPanelProps {
  analyzeData: AnalyzeResponse | null;
  recoverData: RecoverResponse | null;
  onRunBatchRecover: () => void;
  isRecovering: boolean;
}

/**
 * The control surface: is it safe to let REVORA act, right now. Every
 * status here reflects real state — nothing is claimed "passed" or
 * "0 violations" unless a recovery pass has actually run and confirmed it.
 */
export const RecoveryStatusPanel: React.FC<RecoveryStatusPanelProps> = ({
  analyzeData,
  recoverData,
  onRunBatchRecover,
  isRecovering,
}) => {
  const retries = analyzeData?.proposed_action_counts?.['retry'] || 0;
  const escalated = analyzeData?.proposed_action_counts?.['escalate'] || 0;
  const suppressed = analyzeData?.proposed_action_counts?.['suppress'] || 0;
  const policyBlocked = analyzeData?.policy_blocked_count || 0;
  const hasRun = !!recoverData;
  const violations = recoverData?.policy_violations ?? 0;

  const state: { label: string; dot: string; text: string } = isRecovering
    ? { label: 'RECOVERING', dot: 'bg-primary-400 animate-pulse', text: 'text-primary-300' }
    : analyzeData
    ? { label: 'SYSTEM READY', dot: 'bg-success-400', text: 'text-success-300' }
    : { label: 'STANDING BY', dot: 'bg-text-muted', text: 'text-text-muted' };

  return (
    <div className="bg-panel border border-border-strong rounded-xl shadow-sm h-full flex flex-col justify-between overflow-hidden">
      <div>
        <div className="px-5 pt-5 pb-4 border-b border-border-subtle">
          <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Recovery Status</h3>
          <p className="text-text-muted text-[12px] mt-0.5">Is it safe to let REVORA act right now</p>
        </div>

        <div className="px-5 pt-4">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${state.dot}`} />
          <span className={`font-display font-semibold text-2xl tracking-tight ${state.text}`}>{state.label}</span>
        </div>

        <div className="mt-4 h-px bg-gradient-to-r from-border-strong via-border-subtle to-transparent" />

        {policyBlocked > 0 && (
          <div className="mt-3 text-[12px] text-warning-300 bg-warning-500/10 border border-warning-500/20 rounded-md px-2.5 py-1.5 inline-block">
            {policyBlocked} action{policyBlocked === 1 ? '' : 's'} paused by policy
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-surface border border-border-subtle p-2">
            <div className="font-display font-semibold text-base text-primary-400">{retries}</div>
            <div className="text-[10px] text-text-muted mt-0.5">Retries</div>
          </div>
          <div className="rounded-lg bg-surface border border-border-subtle p-2">
            <div className="font-display font-semibold text-base text-warning-400">{escalated}</div>
            <div className="text-[10px] text-text-muted mt-0.5">Escalated</div>
          </div>
          <div className="rounded-lg bg-surface border border-border-subtle p-2">
            <div className="font-display font-semibold text-base text-text-secondary">{suppressed}</div>
            <div className="text-[10px] text-text-muted mt-0.5">Suppressed</div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-border-subtle space-y-1.5">
          <SafetyRow label="Intelligence" value={analyzeData ? 'ONLINE' : 'STANDBY'} ok={!!analyzeData} />
          <SafetyRow label="Recovery" value={isRecovering ? 'RUNNING' : analyzeData ? 'READY' : 'STANDBY'} ok={!!analyzeData} />
          <SafetyRow label="Safety" value="ENFORCED" ok />
          {!hasRun ? (
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-text-muted">Safety check</span>
              <span className="font-mono font-medium flex items-center gap-1.5 text-text-secondary">
                <ShieldQuestion className="w-3 h-3" />
                NOT RUN
              </span>
            </div>
          ) : violations === 0 ? (
            <SafetyRow label="Safety check" value="PASSED · 0 violations" ok />
          ) : (
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-text-muted">Safety check</span>
              <span className="font-mono font-medium flex items-center gap-1.5 text-risk-400">
                <ShieldAlert className="w-3 h-3" />
                {violations} violation{violations === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        <button
          onClick={onRunBatchRecover}
          disabled={isRecovering || !analyzeData}
          className="w-full py-2.5 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-[13px] font-medium flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 shadow-sm"
        >
          <Zap className={`w-4 h-4 ${isRecovering ? 'animate-spin' : ''}`} />
          <span>{isRecovering ? 'Executing...' : 'Execute Recovery Pass'}</span>
        </button>
      </div>
    </div>
  );
};

function SafetyRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className={`font-mono font-medium flex items-center gap-1.5 ${ok ? 'text-success-400' : 'text-text-secondary'}`}>
        {ok && <ShieldCheck className="w-3 h-3" />}
        {value}
      </span>
    </div>
  );
}
