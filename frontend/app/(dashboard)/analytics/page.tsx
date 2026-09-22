'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Filter, RefreshCw, TrendingUp, TrendingDown, Activity, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AnalyticsResponse } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getAnalytics();
      setAnalytics(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load analytics: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const notAvailable = <span className="text-text-muted font-mono">—</span>;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full relative">
      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center space-x-3">
          <TrendingUp strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Performance Analytics</h2>
            <p className="text-[13px] text-text-muted mt-0.5">Recovery performance summary from backend pipeline</p>
          </div>
        </div>
        <button
          id="btn-refresh-analytics"
          onClick={loadAnalytics}
          disabled={loading}
          className="px-4 py-2 rounded-md bg-surface border border-border-strong text-text-primary hover:bg-panel-hover text-[12px] font-medium flex items-center space-x-2 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-lg bg-risk-900/20 border border-risk-500/40 text-risk-400 text-[13px] font-medium flex items-center relative z-10">{errorMsg}</div>
      )}

      {!analytics && !loading && (
        <div className="bg-panel border border-border-strong rounded-xl p-12 text-center flex flex-col items-center shadow-sm">
          <TrendingUp strokeWidth={1.5} className="w-12 h-12 text-text-muted/40 mb-4" />
          <p className="text-text-primary font-medium">No analytics data available</p>
          <p className="text-text-muted text-[13px] mt-1.5 max-w-sm">Run a batch recovery from Revenue Command to generate real-time analytics data.</p>
        </div>
      )}

      {loading && !analytics && (
        <div className="bg-panel border border-border-strong rounded-xl p-12 text-center flex flex-col items-center shadow-sm">
          <RefreshCw className="w-10 h-10 animate-spin text-primary-500/50 mb-4" />
          <p className="text-text-muted text-[13px] mt-1">Crunching pipeline metrics...</p>
        </div>
      )}

      {analytics && (
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6 relative z-10"
        >
          {/* Primary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 relative overflow-hidden shadow-sm group hover:border-risk-500/30 transition-colors">
              <div className="absolute top-0 right-0 w-32 h-32 bg-risk-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none group-hover:bg-risk-500/10 transition-colors" />
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-risk-400 to-risk-600" />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase text-text-muted tracking-wider">Total at Risk</span>
                <div className="w-6 h-6 rounded bg-risk-900/20 flex items-center justify-center text-risk-400 border border-risk-500/20"><TrendingDown className="w-3 h-3" /></div>
              </div>
              <div className="text-3xl font-display font-bold text-text-primary tracking-tight">
                {analytics.total_at_risk > 0 ? formatINR(analytics.total_at_risk, true) : notAvailable}
              </div>
              <p className="text-[12px] text-text-muted mt-2 border-t border-border-subtle pt-2">Gross revenue at risk universe</p>
            </motion.div>

            <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 relative overflow-hidden shadow-sm group hover:border-success-500/30 transition-colors">
              <div className="absolute top-0 right-0 w-32 h-32 bg-success-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none group-hover:bg-success-500/10 transition-colors" />
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-success-400 to-success-600" />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase text-text-muted tracking-wider">Total Recovered</span>
                <div className="w-6 h-6 rounded bg-success-900/20 flex items-center justify-center text-success-400 border border-success-500/20"><TrendingUp className="w-3 h-3" /></div>
              </div>
              <div className="text-3xl font-display font-bold text-success-400 tracking-tight">
                {analytics.total_recovered > 0 ? formatINR(analytics.total_recovered, true) : notAvailable}
              </div>
              <p className="text-[12px] text-text-muted mt-2 border-t border-border-subtle pt-2">Actual recovered revenue</p>
            </motion.div>

            <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 relative overflow-hidden shadow-sm group hover:border-ai-500/30 transition-colors">
              <div className="absolute top-0 right-0 w-32 h-32 bg-ai-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none group-hover:bg-ai-500/10 transition-colors" />
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-ai-400 to-ai-600" />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase text-text-muted tracking-wider">Recovery Rate</span>
                <div className="w-6 h-6 rounded bg-ai-900/20 flex items-center justify-center text-ai-400 border border-ai-500/20"><Activity className="w-3 h-3" /></div>
              </div>
              <div className="text-3xl font-display font-bold text-ai-400 tracking-tight flex items-baseline">
                {analytics.recovery_rate_pct > 0 ? (
                  <>
                    <span>{analytics.recovery_rate_pct.toFixed(1)}</span>
                    <span className="text-lg ml-1 text-ai-500">%</span>
                  </>
                ) : notAvailable}
              </div>
              <p className="text-[12px] text-text-muted mt-2 border-t border-border-subtle pt-2">Recovered / at-risk</p>
            </motion.div>

            <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-5 relative overflow-hidden shadow-sm group hover:border-primary-500/30 transition-colors">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none group-hover:bg-primary-500/10 transition-colors" />
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary-400 to-primary-600" />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase text-text-muted tracking-wider">Intervention Success</span>
                <div className="w-6 h-6 rounded bg-primary-900/20 flex items-center justify-center text-primary-400 border border-primary-500/20"><ArrowUpRight className="w-3 h-3" /></div>
              </div>
              <div className="text-3xl font-display font-bold text-text-primary tracking-tight flex items-baseline">
                {analytics.intervention_success_rate_pct > 0 ? (
                  <>
                    <span>{analytics.intervention_success_rate_pct.toFixed(1)}</span>
                    <span className="text-lg ml-1 text-text-muted">%</span>
                  </>
                ) : notAvailable}
              </div>
              <p className="text-[12px] text-text-muted mt-2 border-t border-border-subtle pt-2">Successful / attempted</p>
            </motion.div>
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <motion.div variants={itemVariants} className="bg-surface border border-border-subtle rounded-xl p-5 shadow-sm">
              <span className="text-[11px] font-mono uppercase text-text-secondary tracking-wider">Recovered Transactions</span>
              <div className="text-2xl font-mono font-bold text-success-400 mt-2">
                {analytics.recovered_count > 0 ? analytics.recovered_count : notAvailable}
              </div>
              <div className="text-[12px] text-text-muted mt-1.5 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-success-500/50 mr-2" />
                of {analytics.attempted_count > 0 ? analytics.attempted_count : '—'} attempted interventions
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="bg-surface border border-border-subtle rounded-xl p-5 shadow-sm">
              <span className="text-[11px] font-mono uppercase text-text-secondary tracking-wider">Policy Blocked</span>
              <div className="text-2xl font-mono font-bold text-risk-400 mt-2">
                {analytics.policy_blocked_count > 0 ? analytics.policy_blocked_count : notAvailable}
              </div>
              <div className="text-[12px] text-text-muted mt-1.5 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-risk-500/50 mr-2" />
                AI actions overridden by safety engine
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="bg-surface border border-border-subtle rounded-xl p-5 shadow-sm">
              <span className="text-[11px] font-mono uppercase text-text-secondary tracking-wider">Escalations Created</span>
              <div className="text-2xl font-mono font-bold text-warning-400 mt-2">
                {analytics.escalation_count > 0 ? analytics.escalation_count : notAvailable}
              </div>
              <div className="text-[12px] text-text-muted mt-1.5 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-warning-500/50 mr-2" />
                Rerouted to merchant for review
              </div>
            </motion.div>
          </div>

          {/* Recovery Funnel */}
          <motion.div variants={itemVariants} className="bg-panel border border-border-strong rounded-xl p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
            
            <h3 className="text-text-primary text-[15px] font-semibold mb-6 flex items-center space-x-2 border-b border-border-subtle pb-4">
              <Filter strokeWidth={1.75} className="w-4 h-4 text-text-muted shrink-0" />
              <span>Pipeline Funnel</span>
              <span className="ml-auto text-[10px] text-text-muted font-mono uppercase tracking-wider bg-surface px-2 py-0.5 rounded border border-border-subtle">Real-time Data</span>
            </h3>

            <div className="space-y-5">
              {[
                { label: 'Revenue at Risk', value: analytics.total_at_risk, max: analytics.total_at_risk, color: 'bg-risk-500', display: formatINR(analytics.total_at_risk, true) },
                { label: 'Recovery Attempted', value: analytics.attempted_count, max: Math.max(1, analytics.recovered_count + analytics.attempted_count), color: 'bg-primary-500', display: `${analytics.attempted_count} interventions` },
                { label: 'Successfully Recovered', value: analytics.recovered_count, max: Math.max(1, analytics.attempted_count), color: 'bg-success-500', display: `${analytics.recovered_count} transactions` },
                { label: 'Total Revenue Recovered', value: analytics.total_recovered, max: Math.max(1, analytics.total_at_risk), color: 'bg-success-500', display: formatINR(analytics.total_recovered, true) },
              ].map((row, idx) => {
                const pct = row.max > 0 ? Math.min(100, (row.value / row.max) * 100) : 0;
                return (
                  <div key={row.label} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-text-secondary">{row.label}</span>
                      <span className="text-[14px] font-mono font-bold text-text-primary tracking-tight">{row.display}</span>
                    </div>
                    <div className="h-2 w-full bg-surface rounded-full overflow-hidden border border-border-subtle/50">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(2, pct)}%` }}
                        transition={{ duration: 1, delay: 0.2 + (idx * 0.1), ease: "easeOut" }}
                        className={`h-full rounded-full ${row.color}`} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="p-4 rounded-xl bg-surface border border-border-subtle text-[12px] text-text-secondary leading-relaxed flex items-start space-x-3">
            <Activity className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
            <div>
              <strong className="text-text-primary font-medium mr-1">Data Pipeline:</strong>
              All values are computed from the real backend state via <code className="font-mono text-text-primary bg-panel px-1 py-0.5 rounded border border-border-subtle mx-1">GET /api/analytics</code>.
              Numbers reflect the actual in-memory repository state.
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
