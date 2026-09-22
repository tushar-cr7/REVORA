'use client';

import React, { useState, useCallback } from 'react';
import { BrainCircuit, Cpu, Sparkles, RefreshCw, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { AnalyzeResponse } from '@/lib/types';
import { formatINR, formatPct } from '@/lib/format';

export default function RecoveryBrainPage() {
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRunPass = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // Scan first to ensure data is available, then analyze
      await api.scanRevenue(10000, 42);
      const res = await api.analyzeRevenue();
      setAnalyzeData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Intelligence pass failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const metadata = analyzeData?.model_metadata;
  const proposedCounts = analyzeData?.proposed_action_counts || {};

  const actionEntries = Object.entries(proposedCounts).sort(([, a], [, b]) => b - a);
  const totalActions = actionEntries.reduce((s, [, v]) => s + v, 0);

  const ACTION_META: Record<string, { color: string; bar: string }> = {
    retry:        { color: 'text-primary-300', bar: 'bg-primary-500' },
    payment_link: { color: 'text-ai-300',      bar: 'bg-ai-500' },
    reminder:     { color: 'text-success-300', bar: 'bg-success-500' },
    escalate:     { color: 'text-warning-300', bar: 'bg-warning-500' },
    suppress:     { color: 'text-text-muted',  bar: 'bg-border-strong' },
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-sm bg-ai-muted border border-ai-500/30 flex items-center justify-center text-ai-300">
            <BrainCircuit className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Recovery Brain</h2>
            <p className="text-xs text-text-muted mt-0.5">Predictive ML model and expected value scoring engine</p>
          </div>
        </div>
        <button
          id="btn-run-intelligence-pass"
          onClick={handleRunPass}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 rounded-sm bg-ai-700 hover:bg-ai-600 text-text-primary text-xs font-semibold transition disabled:opacity-50"
        >
          <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Running...' : 'Run Intelligence Pass'}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {!analyzeData && !loading && (
        <div className="bg-panel border border-border-subtle rounded-md p-10 text-center">
          <BrainCircuit className="w-10 h-10 text-ai-500/50 mx-auto mb-3" />
          <p className="text-text-muted text-sm">No intelligence data available.</p>
          <p className="text-text-muted text-xs mt-1">Run an intelligence pass to see model scores, proposed actions, and policy interactions.</p>
        </div>
      )}

      {analyzeData && (
        <>
          {/* Architecture Banner */}
          <div className="bg-ai-muted/30 border border-ai-500/20 rounded-md p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Sparkles className="w-4 h-4 text-ai-300 shrink-0" />
              <div className="text-xs text-ai-100 leading-relaxed max-w-3xl">
                <strong className="text-ai-300">Intelligence Synthesis: </strong>
                {analyzeData.explanation}
              </div>
            </div>
          </div>

          {/* Model Info + Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Model Card */}
            <div className="bg-panel border border-border-subtle rounded-md p-4">
              <div className="flex items-center space-x-2 pb-3 border-b border-border-divider">
                <Cpu className="w-4 h-4 text-ai-300" />
                <h3 className="text-text-primary text-sm font-semibold">Model Information</h3>
                <span className="text-[10px] font-mono bg-ai-muted text-ai-300 px-1.5 py-0.5 rounded border border-ai-500/20 ml-auto">
                  {metadata?.dataset_type || 'XGBoost'} v{metadata?.model_version || '1.0.0'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 bg-surface rounded border border-border-divider">
                  <span className="text-[10px] uppercase text-text-muted block">ROC AUC Score</span>
                  <span className="text-2xl font-bold text-ai-300 mt-1 block">{metadata?.metrics?.auc?.toFixed(4) ?? '—'}</span>
                  <p className="text-text-muted text-[10px] mt-1">Classification signal strength</p>
                </div>
                <div className="p-3 bg-surface rounded border border-border-divider">
                  <span className="text-[10px] uppercase text-text-muted block">Brier Score</span>
                  <span className="text-2xl font-bold text-success-300 mt-1 block">{metadata?.metrics?.brier?.toFixed(4) ?? '—'}</span>
                  <p className="text-text-muted text-[10px] mt-1">Probability calibration (lower = better)</p>
                </div>
                <div className="p-3 bg-surface rounded border border-border-divider">
                  <span className="text-[10px] uppercase text-text-muted block">Avg Recovery P</span>
                  <span className="text-2xl font-bold text-text-primary mt-1 block">{formatPct(analyzeData.avg_recovery_probability)}</span>
                  <p className="text-text-muted text-[10px] mt-1">Mean across all transactions</p>
                </div>
                <div className="p-3 bg-surface rounded border border-border-divider">
                  <span className="text-[10px] uppercase text-text-muted block">Realistically Recoverable</span>
                  <span className="text-xl font-bold text-success-300 mt-1 block">{formatINR(analyzeData.realistically_recoverable, true)}</span>
                  <p className="text-text-muted text-[10px] mt-1">EV-weighted recoverable amount</p>
                </div>
              </div>
            </div>

            {/* Action Distribution */}
            <div className="bg-panel border border-border-subtle rounded-md p-4">
              <div className="flex items-center space-x-2 pb-3 border-b border-border-divider">
                <TrendingUp className="w-4 h-4 text-primary-300" />
                <h3 className="text-text-primary text-sm font-semibold">Proposed Action Distribution</h3>
                <span className="ml-auto text-xs font-mono text-text-muted">{totalActions} decisions</span>
              </div>

              <div className="mt-4 space-y-3">
                {actionEntries.map(([action, count]) => {
                  const meta = ACTION_META[action] || { color: 'text-text-secondary', bar: 'bg-border-strong' };
                  const pct = totalActions > 0 ? (count / totalActions) * 100 : 0;
                  return (
                    <div key={action} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`capitalize font-medium ${meta.color}`}>{action}</span>
                        <span className="font-mono text-text-primary font-bold">{count} <span className="text-text-muted">({pct.toFixed(1)}%)</span></span>
                      </div>
                      <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${meta.bar} transition-all duration-700`} style={{ width: `${Math.max(2, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Policy Interaction */}
              <div className="mt-4 pt-3 border-t border-border-divider">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Policy Engine Blocked</span>
                  <span className="font-mono font-bold text-risk-300">{analyzeData.policy_blocked_count} actions</span>
                </div>
                <p className="text-text-muted text-[10px] mt-1 leading-relaxed">
                  These were AI-proposed actions that the deterministic policy engine overrode. The AI never bypasses the policy gate.
                </p>
              </div>
            </div>
          </div>

          {/* Architecture Flow */}
          <div className="bg-panel border border-border-subtle rounded-md p-4">
            <h3 className="text-text-primary text-sm font-semibold mb-4 flex items-center space-x-2">
              <BrainCircuit className="w-4 h-4 text-ai-300" />
              <span>Decision Architecture</span>
              <span className="ml-auto text-[10px] font-mono text-text-muted uppercase tracking-wider">AI for Intelligence · Rules for Control</span>
            </h3>
            <div className="flex items-stretch gap-1">
              {[
                { label: 'ML Model', sub: 'XGBoost — predicts P(recovery)', color: 'border-ai-500/40 bg-ai-muted/30', text: 'text-ai-300', arrow: true },
                { label: 'Decision Engine', sub: 'Scores all candidate actions by Expected Value', color: 'border-ai-500/30 bg-ai-muted/20', text: 'text-ai-300', arrow: true },
                { label: 'Policy Gate', sub: 'Deterministic guardrails — blocks, downgrades, or allows', color: 'border-risk-500/40 bg-risk-muted/30', text: 'text-risk-300', arrow: true },
                { label: 'Executor', sub: 'Executes authorized action via simulation provider', color: 'border-success-500/40 bg-success-muted/30', text: 'text-success-300', arrow: false },
              ].map((step, idx) => (
                <React.Fragment key={idx}>
                  <div className={`flex-1 p-3 rounded border ${step.color} text-center`}>
                    <div className={`text-xs font-semibold font-mono ${step.text}`}>{step.label}</div>
                    <div className="text-[10px] text-text-muted mt-1 leading-tight">{step.sub}</div>
                  </div>
                  {step.arrow && (
                    <div className="flex items-center px-1 text-text-muted text-xs">→</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
