'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network, Sparkles, Cpu, ChevronDown, Search, Scale, ShieldCheck, Target } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { api } from '@/lib/api';
import { AnalyzeResponse, Opportunity, Transaction, Decision } from '@/lib/types';
import { formatPct } from '@/lib/format';
import { DecisionField } from '@/components/recovery-brain/DecisionField';
import { DecisionQueue } from '@/components/recovery-brain/DecisionQueue';
import { DecisionDetail } from '@/components/recovery-brain/DecisionDetail';
import { DecisionStages, DECISION_STAGES } from '@/components/recovery-brain/DecisionStages';
import { LANES, ActionKey } from '@/components/recovery-brain/decisionField.utils';

type QualityFilter = 'all' | 'high_value' | 'high_confidence' | 'needs_review';
type Phase = 'idle' | 'scanning' | 'completing' | 'results' | 'error';

const OPPORTUNITY_LIMIT = 80;

// Time-paced stage narration while the real scan -> analyze -> opportunities
// request chain is in flight. The backend has no incremental progress API,
// so this narrates the process honestly rather than claiming live telemetry
// (same principle Revenue Scanner's ScanStages uses).
const STAGE_DELAYS_MS = [900, 2200, 3600, 5200];

const PIPELINE_STEPS = [
  { key: 'analyze', icon: Search, label: 'Analyze', detail: 'Understand customer context' },
  { key: 'evaluate', icon: Scale, label: 'Evaluate', detail: 'Weigh recovery likelihood' },
  { key: 'check', icon: ShieldCheck, label: 'Check', detail: 'Apply safety constraints' },
  { key: 'recommend', icon: Target, label: 'Recommend', detail: 'Surface the best next action' },
] as const;

export default function RecoveryBrainPage() {
  const reduceMotion = useReducedMotion();
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [justExecuted, setJustExecuted] = useState(false);

  const [actionFilter, setActionFilter] = useState<ActionKey | 'all'>('all');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
  const [showTechnical, setShowTechnical] = useState(false);

  const timersRef = useRef<number[]>([]);
  const clearTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };
  useEffect(() => clearTimers, []);

  const scanning = phase === 'scanning' || phase === 'completing';

  const handleRunPass = useCallback(async () => {
    setErrorMsg(null);
    setPhase('scanning');
    setStageIndex(0);
    clearTimers();
    STAGE_DELAYS_MS.forEach((delay, i) => {
      timersRef.current.push(window.setTimeout(() => setStageIndex(i + 1), delay));
    });
    try {
      await api.scanRevenue(10000, 42);
      const analyzeRes = await api.analyzeRevenue();
      const oppsRes = await api.getOpportunities(OPPORTUNITY_LIMIT);
      clearTimers();
      setStageIndex(DECISION_STAGES.length);
      setAnalyzeData(analyzeRes);
      setOpportunities(oppsRes);
      setPhase('completing');
      // Held just long enough to let the scan line finish a visible pass
      // before the field crossfades into the real, data-driven layout.
      timersRef.current.push(window.setTimeout(() => setPhase('results'), reduceMotion ? 100 : 1400));
    } catch (err: unknown) {
      clearTimers();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Intelligence pass failed: ${msg}`);
      setPhase(analyzeData ? 'results' : 'error');
    }
  }, [analyzeData, reduceMotion]);

  const handleSelect = useCallback((opp: Opportunity) => {
    setSelectedOpp(opp);
    setJustExecuted(false);
    setTransaction(null);
    setDecision(null);
    setDetailLoading(true);

    api
      .getTransactionById(opp.transaction_id)
      .then(setTransaction)
      .catch(() => setTransaction(null));

    api
      .getDecisionById(opp.leak_id)
      .then(setDecision)
      .catch(() => setDecision(null))
      .finally(() => setDetailLoading(false));
  }, []);

  const handleExecute = useCallback(async () => {
    if (!selectedOpp) return;
    setExecuting(true);
    try {
      const idempotencyKey = `brain_exec_${selectedOpp.transaction_id}_${Date.now()}`;
      await api.executeIntervention(selectedOpp.transaction_id, idempotencyKey);
      setJustExecuted(true);
      const refreshed = await api.getOpportunities(OPPORTUNITY_LIMIT);
      setOpportunities(refreshed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Execution failed: ${msg}`);
    } finally {
      setExecuting(false);
    }
  }, [selectedOpp]);

  const availableActions = useMemo(() => {
    const present = new Set(opportunities.map((o) => o.recommended_action));
    return LANES.filter((l) => present.has(l.key));
  }, [opportunities]);

  const highValueCutoff = useMemo(() => {
    if (opportunities.length === 0) return Infinity;
    const sorted = [...opportunities].map((o) => o.expected_recovery).sort((a, b) => b - a);
    return sorted[Math.floor(sorted.length * 0.33)] ?? sorted[sorted.length - 1];
  }, [opportunities]);

  const isMatch = useCallback(
    (opp: Opportunity) => {
      if (actionFilter !== 'all' && opp.recommended_action !== actionFilter) return false;
      if (qualityFilter === 'high_value' && opp.expected_recovery < highValueCutoff) return false;
      if (qualityFilter === 'high_confidence' && opp.recovery_probability < 0.7) return false;
      if (qualityFilter === 'needs_review' && opp.policy_allowed) return false;
      return true;
    },
    [actionFilter, qualityFilter, highValueCutoff]
  );

  const filterActive = actionFilter !== 'all' || qualityFilter !== 'all';
  const queueOpportunities = useMemo(
    () => (filterActive ? opportunities.filter(isMatch) : opportunities),
    [opportunities, filterActive, isMatch]
  );

  const metadata = analyzeData?.model_metadata;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Network strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Recovery Brain</h2>
            <p className="text-xs text-text-muted mt-0.5">How REVORA decides what revenue to recover</p>
          </div>
        </div>
        <button
          id="btn-run-intelligence-pass"
          onClick={handleRunPass}
          disabled={scanning}
          className="flex items-center space-x-2 px-4 py-2 rounded-sm bg-ai-700 hover:bg-ai-600 text-text-primary text-xs font-semibold transition disabled:opacity-50"
        >
          <Sparkles className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          <span>{scanning ? 'Analyzing...' : phase === 'results' ? 'Run Again' : 'Run Intelligence Pass'}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {/* BEFORE — idle / error: a premium "ready" state, not an empty card */}
      {(phase === 'idle' || phase === 'error') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-7">
            <div>
              <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Ready to analyze recovery opportunities</h1>
              <p className="text-[13px] text-text-secondary mt-2.5 leading-relaxed max-w-md">
                REVORA will evaluate recovery opportunities, understand customer context, apply safety checks, and recommend the best next action for each one.
              </p>
            </div>

            <div>
              {PIPELINE_STEPS.map((step, i) => (
                <div key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full border border-border-strong bg-panel flex items-center justify-center text-ai-300 shrink-0">
                      <step.icon strokeWidth={1.75} className="w-4 h-4" />
                    </div>
                    {i < PIPELINE_STEPS.length - 1 && <div className="w-px flex-1 bg-border-subtle my-1" />}
                  </div>
                  <div className={i < PIPELINE_STEPS.length - 1 ? 'pb-6' : ''}>
                    <div className="text-[13px] font-semibold text-text-primary">{step.label}</div>
                    <div className="text-xs text-text-muted mt-0.5">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <button
                id="btn-run-intelligence-pass-hero"
                onClick={handleRunPass}
                className="px-6 py-3 rounded-md bg-ai-700 hover:bg-ai-600 text-text-primary text-sm font-semibold transition-colors inline-flex items-center gap-2 shadow-sm"
              >
                <Sparkles className="w-4 h-4" />
                Run Intelligence Pass
              </button>
              <p className="text-[11px] text-text-muted mt-2">Typically takes a few seconds.</p>
            </div>
          </div>

          <div className="lg:col-span-7">
            <DecisionField
              phase="idle"
              opportunities={[]}
              selectedId={null}
              onSelect={() => {}}
              candidates={null}
              finalAction={null}
              isMatch={() => false}
              filterActive={false}
            />
          </div>
        </div>
      )}

      {/* DURING — scanning / completing: REVORA visibly evaluating the universe */}
      {scanning && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text-primary">Analyzing recovery opportunities</h2>
              <p className="text-xs text-text-muted mt-1">REVORA is evaluating your recovery universe.</p>
            </div>
            <DecisionStages stageIndex={stageIndex} />
          </div>
          <div className="lg:col-span-8">
            <DecisionField
              phase="scanning"
              opportunities={[]}
              selectedId={null}
              onSelect={() => {}}
              candidates={null}
              finalAction={null}
              isMatch={() => false}
              filterActive={false}
            />
          </div>
        </div>
      )}

      {/* AFTER — results: preserved exactly, only gated behind phase now */}
      {phase === 'results' && (
        <>
          {analyzeData?.explanation && (
            <div className="bg-ai-muted/30 border border-ai-500/20 rounded-md p-3.5 flex items-start space-x-3">
              <Sparkles className="w-4 h-4 text-ai-300 shrink-0 mt-0.5" />
              <p className="text-xs text-ai-100 leading-relaxed max-w-4xl">{analyzeData.explanation}</p>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={actionFilter === 'all'} onClick={() => setActionFilter('all')} label="All" />
            {availableActions.map((l) => (
              <FilterChip key={l.key} active={actionFilter === l.key} onClick={() => setActionFilter(l.key)} label={l.label} />
            ))}
            <span className="w-px h-4 bg-border-strong mx-1" />
            <FilterChip
              active={qualityFilter === 'high_value'}
              onClick={() => setQualityFilter((q) => (q === 'high_value' ? 'all' : 'high_value'))}
              label="High Value"
            />
            <FilterChip
              active={qualityFilter === 'high_confidence'}
              onClick={() => setQualityFilter((q) => (q === 'high_confidence' ? 'all' : 'high_confidence'))}
              label="High Confidence"
            />
            <FilterChip
              active={qualityFilter === 'needs_review'}
              onClick={() => setQualityFilter((q) => (q === 'needs_review' ? 'all' : 'needs_review'))}
              label="Needs Review"
            />
          </div>

          {/* Signature hero: the decision field */}
          <DecisionField
            phase="results"
            opportunities={opportunities}
            selectedId={selectedOpp?.transaction_id ?? null}
            onSelect={handleSelect}
            candidates={decision?.candidates_evaluated ?? null}
            finalAction={decision?.final_action ?? null}
            isMatch={isMatch}
            filterActive={filterActive}
          />

          {/* Detail + queue */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7">
              <DecisionDetail
                opportunity={selectedOpp}
                transaction={transaction}
                decision={decision}
                detailLoading={detailLoading}
                executing={executing}
                justExecuted={justExecuted}
                onExecute={handleExecute}
              />
            </div>
            <div className="lg:col-span-5">
              <DecisionQueue opportunities={queueOpportunities} selectedId={selectedOpp?.transaction_id ?? null} onSelect={handleSelect} />
            </div>
          </div>

          {/* Technical details — collapsed by default; model internals for technical users */}
          <div className="border-t border-border-subtle pt-4">
            <button
              onClick={() => setShowTechnical((s) => !s)}
              className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
              View technical details
            </button>

            {showTechnical && (
              <div className="mt-4 space-y-4">
                <div className="bg-panel border border-border-subtle rounded-md p-4">
                  <div className="flex items-center space-x-2 pb-3 border-b border-border-divider">
                    <Cpu className="w-4 h-4 text-ai-300" />
                    <h3 className="text-text-primary text-sm font-semibold">Model Information</h3>
                    <span className="text-[10px] font-mono bg-ai-muted text-ai-300 px-1.5 py-0.5 rounded border border-ai-500/20 ml-auto">
                      {metadata?.dataset_type || 'XGBoost'} v{metadata?.model_version || '1.0.0'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-3 bg-surface rounded border border-border-divider">
                      <span className="text-[10px] uppercase text-text-muted block">ROC AUC Score</span>
                      <span className="text-xl font-bold text-ai-300 mt-1 block">{metadata?.metrics?.auc?.toFixed(4) ?? '—'}</span>
                    </div>
                    <div className="p-3 bg-surface rounded border border-border-divider">
                      <span className="text-[10px] uppercase text-text-muted block">Brier Score</span>
                      <span className="text-xl font-bold text-success-300 mt-1 block">{metadata?.metrics?.brier?.toFixed(4) ?? '—'}</span>
                    </div>
                    <div className="p-3 bg-surface rounded border border-border-divider">
                      <span className="text-[10px] uppercase text-text-muted block">Avg Recovery P</span>
                      <span className="text-xl font-bold text-text-primary mt-1 block">{formatPct(analyzeData?.avg_recovery_probability ?? 0)}</span>
                    </div>
                    <div className="p-3 bg-surface rounded border border-border-divider">
                      <span className="text-[10px] uppercase text-text-muted block">Policy Blocked</span>
                      <span className="text-xl font-bold text-risk-300 mt-1 block">{analyzeData?.policy_blocked_count ?? 0}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-panel border border-border-subtle rounded-md p-4">
                  <h3 className="text-text-primary text-sm font-semibold mb-4 flex items-center space-x-2">
                    <Network className="w-4 h-4 text-ai-300" />
                    <span>Decision Architecture</span>
                    <span className="ml-auto text-[10px] font-mono text-text-muted uppercase tracking-wider">AI for Intelligence · Rules for Control</span>
                  </h3>
                  <div className="flex items-stretch gap-1">
                    {[
                      { label: 'ML Model', sub: 'Predicts P(recovery)', color: 'border-ai-500/40 bg-ai-muted/30', text: 'text-ai-300' },
                      { label: 'Decision Engine', sub: 'Scores candidates by Expected Value', color: 'border-ai-500/30 bg-ai-muted/20', text: 'text-ai-300' },
                      { label: 'Policy Gate', sub: 'Deterministic guardrails', color: 'border-risk-500/40 bg-risk-muted/30', text: 'text-risk-300' },
                      { label: 'Executor', sub: 'Executes the authorized action', color: 'border-success-500/40 bg-success-muted/30', text: 'text-success-300' },
                    ].map((step, idx, arr) => (
                      <React.Fragment key={idx}>
                        <div className={`flex-1 p-3 rounded border ${step.color} text-center`}>
                          <div className={`text-xs font-semibold font-mono ${step.text}`}>{step.label}</div>
                          <div className="text-[10px] text-text-muted mt-1 leading-tight">{step.sub}</div>
                        </div>
                        {idx < arr.length - 1 && <div className="flex items-center px-1 text-text-muted text-xs">→</div>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const FilterChip: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
      active
        ? 'bg-panel-raised border-border-strong text-text-primary'
        : 'bg-transparent border-border-subtle text-text-muted hover:text-text-secondary hover:border-border-strong'
    }`}
  >
    {label}
  </button>
);
