'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ScanLine,
  RefreshCw,
  Activity,
  TrendingUp,
  ArrowRight,
  LayoutDashboard,
  Network,
  Rows3,
  Crosshair,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ScanResponse, AnalyzeResponse } from '@/lib/types';
import { formatPct, formatTimeAgo } from '@/lib/format';
import { TransactionField, FieldPhase } from '@/components/scanner/TransactionField';
import { ScanStages } from '@/components/scanner/ScanStages';
import { ScanReportHeader } from '@/components/scanner/ScanReportHeader';
import { RiskDensityMap } from '@/components/scanner/RiskDensityMap';
import { ScanInsights } from '@/components/scanner/ScanInsights';
import { RecommendedActions } from '@/components/scanner/RecommendedActions';

type Phase = 'idle' | 'scanning' | 'completing' | 'results' | 'error';

const TARGET_COUNT = 10000;

// Time-paced stage advancement while the real scan request is in flight.
// The backend returns one atomic response with no incremental progress, so
// this narrates the process rather than claiming live telemetry.
const STAGE_DELAYS_MS = [900, 2000, 3300, 4500];

const CONNECTIONS = [
  { href: '/mission-control', label: 'Revenue Command', icon: LayoutDashboard, desc: 'See where money is at risk' },
  { href: '/recovery-brain', label: 'Recovery Brain', icon: Network, desc: 'Understand the recommendation' },
  { href: '/transactions', label: 'Transactions', icon: Rows3, desc: 'Investigate individual leaks' },
  { href: '/interventions', label: 'Interventions', icon: Crosshair, desc: 'Recover what REVORA can act on' },
];

export default function RevenueScannerPage() {
  const reduceMotion = useReducedMotion();
  const [scanData, setScanData] = useState<ScanResponse | null>(null);
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanCompletedAt, setScanCompletedAt] = useState<Date | null>(null);

  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };
  useEffect(() => clearTimers, []);

  const scanning = phase === 'scanning' || phase === 'completing';

  const handleScan = useCallback(async () => {
    setErrorMsg(null);
    setPhase('scanning');
    setStageIndex(0);
    clearTimers();
    STAGE_DELAYS_MS.forEach((delay, i) => {
      timersRef.current.push(window.setTimeout(() => setStageIndex(i + 1), delay));
    });
    try {
      const res = await api.scanRevenue(TARGET_COUNT, 42);
      clearTimers();
      setScanData(res);
      setScanCompletedAt(new Date());
      setPhase('completing');
      // Held long enough to watch the field's discovery reveal play out
      // (the scan line's final pass + staggered node reveal, ~2.2s) before
      // the full report surfaces underneath it.
      timersRef.current.push(window.setTimeout(() => setPhase('results'), reduceMotion ? 100 : 2200));
    } catch (err: unknown) {
      clearTimers();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(msg);
      setPhase(scanData ? 'results' : 'error');
    }
  }, [scanData, reduceMotion]);

  const handleAnalyze = useCallback(async () => {
    if (!scanData) {
      setErrorMsg('Run a scan first.');
      return;
    }
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

  const fieldPhase: FieldPhase =
    phase === 'scanning' ? 'scanning' : phase === 'completing' || phase === 'results' ? 'complete' : phase === 'error' ? 'error' : 'idle';

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary tracking-tight">Revenue Scanner</h2>
          <p className="text-xs text-text-muted mt-0.5">REVORA looks inside your revenue universe</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            id="btn-run-scan"
            onClick={handleScan}
            disabled={scanning}
            aria-label={scanning ? 'Scan in progress' : scanData ? 'Run scan again' : 'Run scan'}
            className="flex items-center space-x-2 px-4 py-2 rounded-sm bg-panel border border-border-strong text-text-secondary hover:text-text-primary hover:border-primary-500/50 text-xs font-medium transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin text-primary-300' : ''}`} />
            <span>{scanning ? 'Scanning...' : scanData ? 'Run Scan Again' : 'Run Scan'}</span>
          </button>
          <button
            id="btn-run-intelligence"
            onClick={handleAnalyze}
            disabled={analyzing || !scanData || scanning}
            aria-label={analyzing ? 'Intelligence pass in progress' : 'Run intelligence pass'}
            className="flex items-center space-x-2 px-4 py-2 rounded-sm bg-ai-700 hover:bg-ai-600 text-text-primary text-xs font-semibold transition disabled:opacity-50"
          >
            <Activity className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
            <span>{analyzing ? 'Analyzing...' : 'Run Intelligence Pass'}</span>
          </button>
        </div>
      </div>

      {errorMsg && phase !== 'error' && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {/* Hero: the scan field + diagnostic readout, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
        <div>
          {(phase === 'idle' || phase === 'scanning') && (
            <div className="mb-3">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-muted">
                {phase === 'scanning' ? 'Scanning Your Revenue' : 'Revenue Scanner'}
              </span>
              <h3 className="mt-1 text-xl sm:text-2xl font-display font-semibold text-text-primary tracking-tight">
                {phase === 'scanning' ? `Target: ${TARGET_COUNT.toLocaleString()} transactions` : 'Ready to map your revenue'}
              </h3>
              {phase === 'idle' && (
                <p className="mt-1 text-[13px] text-text-muted max-w-md">
                  {TARGET_COUNT.toLocaleString()} transactions waiting to be analyzed across payments, checkouts, invoices, and subscriptions.
                </p>
              )}
              {phase === 'scanning' && (
                <div className="mt-2.5 w-full max-w-xs h-1.5 rounded-full bg-surface border border-border-subtle/50 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary-500"
                    initial={{ width: '3%' }}
                    animate={{ width: '92%' }}
                    transition={{ duration: 6.5, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              )}
            </div>
          )}
          {phase === 'error' && (
            <div className="mb-3">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-risk-400">Scan Interrupted</span>
              <h3 className="mt-1 text-xl sm:text-2xl font-display font-semibold text-text-primary tracking-tight">
                REVORA couldn&apos;t complete the revenue scan
              </h3>
              {errorMsg && <p className="mt-1 text-[13px] text-text-muted max-w-md font-mono">{errorMsg}</p>}
            </div>
          )}
          <TransactionField phase={fieldPhase} breakdown={scanData?.breakdown} />
        </div>

        {/* Diagnostic readout panel */}
        <div className="rounded-lg border border-border-subtle bg-surface/40 p-4 lg:min-h-[240px] flex flex-col">
          {phase === 'idle' && (
            <div className="flex flex-col h-full justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Instrument Status</span>
                <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
                  Connect payments, checkouts, invoices, and subscriptions to REVORA and begin a full diagnostic pass.
                </p>
              </div>
              <button
                onClick={handleScan}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors shadow-sm"
              >
                <ScanLine className="w-4 h-4" />
                Run Scan
              </button>
            </div>
          )}

          {phase === 'scanning' && (
            <>
              <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-3">Diagnostic Sequence</span>
              <ScanStages stageIndex={stageIndex} />
            </>
          )}

          {(phase === 'completing' || phase === 'results') && scanData && (
            <AnimatePresence mode="wait">
              {phase === 'completing' ? (
                <motion.div
                  key="completing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center text-center h-full py-6"
                >
                  <CheckCircle2 className="w-6 h-6 text-success-400 mb-2" />
                  <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-success-400">Scan Complete</div>
                  <div className="mt-2 text-lg font-display font-semibold text-text-primary tabular-nums">
                    {scanData.total_transactions_scanned.toLocaleString()} analyzed
                  </div>
                  <div className="mt-1 text-[12px] text-text-muted">
                    {scanData.breakdown.length} leak categor{scanData.breakdown.length === 1 ? 'y' : 'ies'} identified
                  </div>
                </motion.div>
              ) : (
                <motion.div key="results-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-400" />
                    <span className="text-success-300 font-semibold uppercase tracking-wider">Scan Complete</span>
                  </div>
                  {scanCompletedAt && (
                    <p className="mt-2 text-[12px] text-text-muted">Scanned {formatTimeAgo(scanCompletedAt.toISOString())}</p>
                  )}
                  <p className="mt-3 text-[13px] text-text-secondary leading-relaxed">
                    {scanData.breakdown.length} revenue leak categories identified across {scanData.total_transactions_scanned.toLocaleString()} transactions. Full report below.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {phase === 'error' && (
            <div className="flex flex-col h-full justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-risk-400 shrink-0 mt-0.5" />
                <p className="text-[13px] text-text-secondary leading-relaxed">
                  The transaction field stayed dormant — nothing was scanned. Try again when ready.
                </p>
              </div>
              <button
                onClick={handleScan}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Scan
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results report */}
      <AnimatePresence>
        {phase === 'results' && scanData && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
          >
            <ScanReportHeader scanData={scanData} analyzeData={analyzeData} scanCompletedAt={scanCompletedAt} />
            <RiskDensityMap scanData={scanData} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ScanInsights scanData={scanData} />
              <RecommendedActions scanData={scanData} />
            </div>

            {/* Intelligence Analysis (technical detail, kept available but secondary) */}
            {analyzeData && (
              <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
                <div className="flex items-center space-x-2 pb-3 border-b border-border-subtle">
                  <TrendingUp className="w-4 h-4 text-ai-300" />
                  <h3 className="text-text-primary text-sm font-semibold">Intelligence Analysis</h3>
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

            {/* Connect to the rest of REVORA */}
            <div className="pt-2">
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-3">Scan → Understand → Investigate → Recover</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {CONNECTIONS.map((c) => {
                  const Icon = c.icon;
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="group flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-3 hover:border-primary-500/40 hover:bg-panel-hover transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-text-primary truncate">{c.label}</div>
                          <div className="text-[10.5px] text-text-muted truncate">{c.desc}</div>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-text-muted group-hover:text-primary-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
