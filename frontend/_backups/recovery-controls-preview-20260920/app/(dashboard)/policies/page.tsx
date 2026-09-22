'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, RefreshCw, ChevronRight, ArrowDown, Lock, GitMerge, Settings2, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { PolicyLimits } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';

export default function PoliciesPage() {
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getPolicies();
      setPolicy(res.active_policy);
      setPolicyVersion(res.policy_version);
      setDescription(res.description);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load policies: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const policyRules = policy ? [
    {
      key: 'max_retries',
      label: 'Max Retries Per Transaction',
      value: `${policy.max_retries} attempts`,
      description: 'Transactions that have already been retried this many times will not be retried again — action is rerouted to escalate.',
      riskColor: 'text-risk-400 bg-risk-900/20 border-risk-500/30',
    },
    {
      key: 'min_cooldown_hours',
      label: 'Minimum Cooldown Period',
      value: `${policy.min_cooldown_hours} hours`,
      description: 'A transaction cannot be acted upon again until this many hours have passed since the last attempt.',
      riskColor: 'text-warning-400 bg-warning-900/20 border-warning-500/30',
    },
    {
      key: 'max_customer_contacts_per_day',
      label: 'Customer Contact Frequency',
      value: `${policy.max_customer_contacts_per_day} / day`,
      description: 'A customer cannot receive more than this many outbound contacts in a single calendar day across all their transactions.',
      riskColor: 'text-ai-400 bg-ai-900/20 border-ai-500/30',
    },
    {
      key: 'max_auto_recovery_value',
      label: 'Auto-Recovery Amount Ceiling',
      value: formatINR(policy.max_auto_recovery_value),
      description: 'Transactions above this amount cannot be auto-recovered — they are escalated to the merchant for manual review.',
      riskColor: 'text-primary-400 bg-primary-900/20 border-primary-500/30',
    },
    {
      key: 'max_subscription_consecutive_failures_for_retry',
      label: 'Subscription Failure Tolerance',
      value: `${policy.max_subscription_consecutive_failures_for_retry} consecutive failures`,
      description: 'If a subscription has failed consecutively more than this many times, retry is blocked — escalation is triggered.',
      riskColor: 'text-risk-400 bg-risk-900/20 border-risk-500/30',
    },
    {
      key: 'invoice_escalation_age_days',
      label: 'Invoice Escalation Age',
      value: `${policy.invoice_escalation_age_days} days`,
      description: 'Overdue invoices older than this threshold are automatically escalated rather than sent reminders.',
      riskColor: 'text-warning-400 bg-warning-900/20 border-warning-500/30',
    },
  ] : [];

  const architectureSteps = [
    { label: 'ML MODEL', icon: <Settings2 className="w-4 h-4 mr-2" />, sub: 'XGBoost predicts P(recovery) for each transaction', color: 'border-ai-500/30 bg-ai-900/10 text-ai-400', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.1)]' },
    { label: 'DECISION ENGINE', icon: <GitMerge className="w-4 h-4 mr-2" />, sub: 'Scores all candidate actions by Expected Value — picks highest EV action', color: 'border-ai-500/40 bg-ai-900/20 text-ai-300', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.15)]' },
    { label: 'POLICY GATE', icon: <Lock className="w-4 h-4 mr-2" />, sub: 'Checks AI proposal against these deterministic limits. The AI cannot override this step.', color: 'border-risk-500/50 bg-risk-900/30 text-risk-300', glow: 'shadow-[0_0_20px_rgba(239,68,68,0.2)]' },
    { label: 'EXECUTOR', icon: <ShieldCheck className="w-4 h-4 mr-2" />, sub: 'If allowed: executes. If blocked: reroutes to escalate or suppress.', color: 'border-success-500/40 bg-success-900/20 text-success-400', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.15)]' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full relative">
      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center space-x-3">
          <SlidersHorizontal strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Recovery Controls</h2>
            <p className="text-[13px] text-text-muted mt-0.5">Deterministic safety limits — these cannot be overridden by AI</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {policyVersion && (
            <div className="flex items-center space-x-2 text-[12px] font-mono text-text-muted bg-surface px-3 py-1 rounded-full border border-border-subtle shadow-inner mr-2 hidden sm:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-success-500 mr-1 animate-pulse" />
              <span>Policy {policyVersion}</span>
            </div>
          )}
          <button
            id="btn-refresh-policies"
            onClick={loadPolicies}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-surface border border-border-strong text-text-primary hover:bg-panel-hover text-[12px] font-medium flex items-center space-x-2 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-lg bg-risk-900/20 border border-risk-500/40 text-risk-400 text-[13px] font-medium flex items-center relative z-10">{errorMsg}</div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        {/* Architecture Diagram */}
        <div className="lg:col-span-5 bg-panel border border-border-strong rounded-xl p-6 shadow-sm flex flex-col h-full relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-ai-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
          
          <h3 className="text-text-primary text-[15px] font-semibold mb-6 flex items-center space-x-2 relative z-10 pb-4 border-b border-border-subtle">
            <span>Decision Control Flow</span>
            <span className="ml-auto text-[10px] font-mono uppercase bg-ai-900/20 text-ai-400 px-2 py-0.5 rounded-sm border border-ai-500/20 tracking-wider">AI for Intelligence · Rules for Control</span>
          </h3>

          <div className="flex-1 flex flex-col items-center justify-center space-y-3 font-mono relative z-10 py-4">
            {architectureSteps.map((step, idx, arr) => (
              <React.Fragment key={idx}>
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1, duration: 0.3 }}
                  className={`w-full max-w-sm p-4 rounded-lg border flex flex-col justify-center ${step.color} ${step.glow} transition-all hover:scale-[1.02] cursor-default`}
                >
                  <div className="font-bold text-[12px] tracking-wider flex items-center">
                    {step.icon}
                    {step.label}
                  </div>
                  <div className="text-text-muted font-sans text-[12px] mt-2 leading-relaxed opacity-90">{step.sub}</div>
                </motion.div>
                {idx < arr.length - 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.1 + 0.1 }}
                  >
                    <ArrowDown className="w-5 h-5 text-border-strong" />
                  </motion.div>
                )}
              </React.Fragment>
            ))}
          </div>

          {description && (
            <p className="text-[12px] text-text-muted mt-6 text-center leading-relaxed relative z-10 p-3 bg-surface rounded-lg border border-border-subtle italic">"{description}"</p>
          )}
        </div>

        {/* Policy Rules */}
        <div className="lg:col-span-7 bg-panel border border-border-strong rounded-xl p-6 shadow-sm flex flex-col h-full relative overflow-hidden">
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-primary-500/5 rounded-full blur-3xl -mr-20 -mb-20 pointer-events-none" />

          {loading && !policy ? (
            <div className="flex flex-col items-center justify-center h-full space-y-4 text-text-muted relative z-10 py-20">
              <RefreshCw className="w-6 h-6 animate-spin text-primary-400/50" />
              <span className="text-[13px]">Loading policy configuration...</span>
            </div>
          ) : policy ? (
            <>
              <h3 className="text-text-primary text-[15px] font-semibold pb-4 border-b border-border-subtle flex items-center space-x-2 relative z-10">
                <ShieldCheck className="w-5 h-5 text-success-400" />
                <span>Active Safety Guardrails</span>
                <span className="ml-auto text-[10px] text-text-muted font-mono bg-surface px-2 py-0.5 rounded border border-border-subtle uppercase tracking-wider">Read-only — Enforced Server-Side</span>
              </h3>

              <div className="mt-5 space-y-3 relative z-10 flex-1 overflow-y-auto custom-scrollbar pr-2">
                <AnimatePresence>
                  {policyRules.map((rule, idx) => (
                    <motion.div 
                      key={rule.key}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-4 rounded-xl bg-surface border border-border-subtle hover:border-border-strong flex flex-col sm:flex-row sm:items-start justify-between gap-4 transition-colors group"
                    >
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 rounded bg-panel border border-border-subtle flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary-900/10 group-hover:border-primary-500/20 group-hover:text-primary-400 transition-colors">
                          <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-primary-400" />
                        </div>
                        <div>
                          <div className="text-text-primary text-[14px] font-medium">{rule.label}</div>
                          <div className="text-text-muted text-[12px] mt-1.5 leading-relaxed max-w-lg">{rule.description}</div>
                        </div>
                      </div>
                      <div className={`text-[12px] font-mono font-bold shrink-0 px-2.5 py-1 rounded border tracking-tight ${rule.riskColor}`}>
                        {rule.value}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div className="mt-5 p-4 rounded-xl bg-risk-900/10 border border-risk-500/20 text-[12px] text-text-secondary leading-relaxed relative z-10 flex items-start space-x-3">
                <Lock className="w-4 h-4 text-risk-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-risk-400 font-medium mr-1">Immutable Architecture:</strong>
                  These limits are deterministically enforced by the policy engine in <code className="font-mono text-text-primary bg-panel px-1 py-0.5 rounded border border-border-subtle mx-1">backend/app/domain/policy.py</code>.
                  No AI generation or client-side bypass can override these constraints.
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
