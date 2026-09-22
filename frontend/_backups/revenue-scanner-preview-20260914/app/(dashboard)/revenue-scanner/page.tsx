'use client';

import React, { useState, useCallback } from 'react';
import { Radar, RefreshCw, AlertCircle, TrendingUp, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { ScanResponse, AnalyzeResponse } from '@/lib/types';
import { formatINR, formatPct } from '@/lib/format';

const CATEGORY_META: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  failed_payment:      { label: 'Failed Payments',      color: 'text-risk-300',    bg: 'bg-risk-muted',    border: 'border-risk-500/30',    dot: 'bg-risk-500' },
  abandoned_checkout:  { label: 'Abandoned Checkouts',  color: 'text-warning-300', bg: 'bg-warning-muted', border: 'border-warning-500/30', dot: 'bg-warning-500' },
  failed_subscription: { label: 'Subscription Failures',color: 'text-ai-300',      bg: 'bg-ai-muted',      border: 'border-ai-500/30',      dot: 'bg-ai-500' },
  overdue_invoice:     { label: 'Overdue Invoices',     color: 'text-primary-300', bg: 'bg-primary-muted', border: 'border-primary-500/30', dot: 'bg-primary-500' },
};

export default function RevenueScannerPage() {
  const [scanData, setScanData] = useState<ScanResponse | null>(null);
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setErrorMsg(null);
    try {
      const res = await api.scanRevenue(10000, 42);
      setScanData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Scan failed: ${msg}`);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!scanData) { setErrorMsg('Run a scan first.'); return; }
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const res = await api.analyzeRevenue();
      setAnalyzeData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Analysis failed: ${msg}`);
    } finally {
      setAnalyzing(false);
    }
  }, [scanData]);

  const totalAtRisk = scanData?.total_at_risk ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-sm bg-primary-muted border border-primary-500/30 flex items-center justify-center text-primary-300">
            <Radar className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Revenue Scanner</h2>
            <p className="text-xs text-text-muted mt-0.5">Detect and classify all active revenue leaks</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            id="btn-run-scan"
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center space-x-2 px-4 py-2 rounded-sm bg-panel border border-border-strong text-text-secondary hover:text-text-primary hover:border-primary-500/50 text-xs font-medium transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin text-primary-300' : ''}`} />
            <span>{scanning ? 'Scanning...' : 'Run Scan'}</span>
          </button>
          <button
            id="btn-run-intelligence"
            onClick={handleAnalyze}
            disabled={analyzing || !scanData}
            className="flex items-center space-x-2 px-4 py-2 rounded-sm bg-ai-700 hover:bg-ai-600 text-text-primary text-xs font-semibold transition disabled:opacity-50"
          >
            <Activity className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
            <span>{analyzing ? 'Analyzing...' : 'Run Intelligence Pass'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {/* Status */}
      {!scanData && (
        <div className="bg-panel border border-border-subtle rounded-md p-10 text-center">
          <Radar className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted text-sm">No scan data available.</p>
          <p className="text-text-muted text-xs mt-1">Click <strong className="text-text-primary">Run Scan</strong> to detect revenue leaks across 10,000 transactions.</p>
        </div>
      )}

      {scanData && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-panel border border-border-subtle rounded-md p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-risk-500" />
              <span className="text-[11px] font-mono uppercase text-text-muted">Transactions Scanned</span>
              <div className="text-3xl font-mono font-bold text-text-primary mt-2">
                {scanData.total_transactions_scanned.toLocaleString()}
              </div>
              <p className="text-xs text-text-muted mt-1">All at-risk transactions detected</p>
            </div>
            <div className="bg-panel border border-border-subtle rounded-md p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-warning-500" />
              <span className="text-[11px] font-mono uppercase text-text-muted">Total Revenue at Risk</span>
              <div className="text-3xl font-mono font-bold text-text-primary mt-2">
                {formatINR(totalAtRisk, true)}
              </div>
              <p className="text-xs text-text-muted mt-1">Gross recoverable universe</p>
            </div>
            <div className="bg-panel border border-border-subtle rounded-md p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-ai-500" />
              <span className="text-[11px] font-mono uppercase text-text-muted">Realistically Recoverable</span>
              <div className="text-3xl font-mono font-bold text-ai-100 mt-2">
                {analyzeData ? formatINR(analyzeData.realistically_recoverable, true) : '—'}
              </div>
              <p className="text-xs text-text-muted mt-1">
                {analyzeData
                  ? `Avg P(recovery): ${formatPct(analyzeData.avg_recovery_probability)}`
                  : 'Run intelligence pass to compute'}
              </p>
            </div>
          </div>

          {/* Leak Breakdown */}
          <div className="bg-panel border border-border-subtle rounded-md p-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-divider">
              <div>
                <h3 className="text-text-primary text-sm font-semibold tracking-tight flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-risk-300" />
                  <span>Leak Category Breakdown</span>
                </h3>
                <p className="text-text-muted text-xs mt-0.5">Categorized risk universe from detection engine</p>
              </div>
              <span className="font-mono text-xs text-text-muted">{scanData.breakdown.length} categories</span>
            </div>

            <div className="mt-4 space-y-4">
              {scanData.breakdown.map((item) => {
                const meta = CATEGORY_META[item.leak_type] || {
                  label: item.leak_type, color: 'text-text-secondary',
                  bg: 'bg-panel-raised', border: 'border-border-subtle', dot: 'bg-primary-500',
                };
                const pct = totalAtRisk > 0 ? (item.amount_at_risk / totalAtRisk) * 100 : 0;
                const recoverability = analyzeData?.proposed_action_counts
                  ? Object.entries(analyzeData.proposed_action_counts)
                      .filter(([a]) => a !== 'suppress')
                      .reduce((s, [, v]) => s + v, 0)
                  : null;

                return (
                  <div key={item.leak_type} className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${meta.dot}`} />
                        <div>
                          <div className="text-text-primary text-sm font-medium">{meta.label}</div>
                          <div className="text-text-muted text-xs font-mono">{item.count} transactions</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold text-text-primary text-sm">{formatINR(item.amount_at_risk)}</div>
                        <div className={`text-xs font-mono font-bold ${meta.color}`}>{pct.toFixed(1)}% of risk</div>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${meta.dot} transition-all duration-700`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Intelligence Results (if available) */}
          {analyzeData && (
            <div className="bg-panel border border-border-subtle rounded-md p-4">
              <div className="flex items-center space-x-2 pb-3 border-b border-border-divider">
                <TrendingUp className="w-4 h-4 text-ai-300" />
                <h3 className="text-text-primary text-sm font-semibold">Intelligence Analysis Results</h3>
              </div>
              <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
                <div className="bg-surface rounded border border-border-divider p-3">
                  <span className="text-[10px] uppercase text-text-muted block">Actions Proposed</span>
                  {Object.entries(analyzeData.proposed_action_counts).map(([action, count]) => (
                    <div key={action} className="flex justify-between mt-1">
                      <span className="capitalize text-text-secondary">{action}</span>
                      <span className="text-text-primary font-bold">{count}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-surface rounded border border-border-divider p-3">
                  <span className="text-[10px] uppercase text-text-muted block mb-1">Policy Blocked</span>
                  <span className="text-2xl font-bold text-risk-300">{analyzeData.policy_blocked_count}</span>
                  <p className="text-text-muted text-[10px] mt-1">Prevented by guardrails</p>
                </div>
                <div className="bg-surface rounded border border-border-divider p-3">
                  <span className="text-[10px] uppercase text-text-muted block mb-1">Avg Recovery Prob</span>
                  <span className="text-2xl font-bold text-ai-300">{formatPct(analyzeData.avg_recovery_probability)}</span>
                  <p className="text-text-muted text-[10px] mt-1">Across all transactions</p>
                </div>
                <div className="bg-surface rounded border border-border-divider p-3">
                  <span className="text-[10px] uppercase text-text-muted block mb-1">Model</span>
                  <span className="text-base font-bold text-text-primary">{analyzeData.model_metadata?.dataset_type || 'XGBoost'}</span>
                  <p className="text-text-muted text-[10px] mt-1">v{analyzeData.model_metadata?.model_version || '1.0.0'}</p>
                </div>
              </div>
              <div className="mt-4 p-3 rounded bg-ai-muted/30 border border-ai-500/20 text-xs text-ai-100 leading-relaxed">
                <strong className="text-ai-300">Intelligence Synthesis: </strong>
                {analyzeData.explanation}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
