'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Zap, RefreshCw, CheckCircle2, AlertCircle, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { Intervention } from '@/lib/types';
import { formatINR, formatTimeAgo } from '@/lib/format';

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  recovered:               { label: 'Recovered',       color: 'text-success-300', bg: 'bg-success-muted border-success-500/30', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  attempted_no_recovery:   { label: 'No Recovery',     color: 'text-text-muted',  bg: 'bg-surface border-border-subtle',         icon: <AlertCircle className="w-3.5 h-3.5" /> },
  suppressed:              { label: 'Suppressed',      color: 'text-text-muted',  bg: 'bg-panel border-border-subtle',           icon: <Clock className="w-3.5 h-3.5" /> },
  escalated_to_merchant:   { label: 'Escalated',       color: 'text-warning-300', bg: 'bg-warning-muted border-warning-500/30',  icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

const ACTION_META: Record<string, { color: string; bg: string }> = {
  retry:        { color: 'text-primary-300', bg: 'bg-primary-muted border-primary-500/30' },
  payment_link: { color: 'text-ai-300',      bg: 'bg-ai-muted border-ai-500/30' },
  reminder:     { color: 'text-success-300', bg: 'bg-success-muted border-success-500/30' },
  escalate:     { color: 'text-warning-300', bg: 'bg-warning-muted border-warning-500/30' },
  suppress:     { color: 'text-text-muted',  bg: 'bg-surface border-border-subtle' },
};

export default function InterventionsPage() {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadInterventions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getInterventions(500);
      setInterventions(res.interventions);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load interventions: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInterventions();
  }, [loadInterventions]);

  const totalRecovered = interventions.filter(i => i.recovered).reduce((s, i) => s + i.recovered_amount, 0);
  const recoveredCount = interventions.filter(i => i.recovered).length;
  const escalatedCount = interventions.filter(i => i.status === 'escalated_to_merchant').length;
  const suppressedCount = interventions.filter(i => i.status === 'suppressed').length;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-sm bg-primary-muted border border-primary-500/30 flex items-center justify-center text-primary-300">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Interventions</h2>
            <p className="text-xs text-text-muted mt-0.5">All executed recovery interventions with outcomes</p>
          </div>
        </div>
        <button
          id="btn-refresh-interventions"
          onClick={loadInterventions}
          disabled={loading}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-sm bg-panel border border-border-strong text-text-secondary hover:text-text-primary text-xs transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {/* Summary KPIs */}
      {interventions.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Interventions', value: interventions.length.toString(), color: 'text-text-primary', accent: 'bg-primary-500' },
            { label: 'Recovered', value: `${recoveredCount} (${formatINR(totalRecovered, true)})`, color: 'text-success-300', accent: 'bg-success-500' },
            { label: 'Escalated', value: escalatedCount.toString(), color: 'text-warning-300', accent: 'bg-warning-500' },
            { label: 'Suppressed', value: suppressedCount.toString(), color: 'text-text-muted', accent: 'bg-border-strong' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-panel border border-border-subtle rounded-md p-4 relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-1 h-full ${kpi.accent}`} />
              <span className="text-[11px] font-mono uppercase text-text-muted">{kpi.label}</span>
              <div className={`text-xl font-mono font-bold mt-2 ${kpi.color}`}>{kpi.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-panel border border-border-subtle rounded-md shadow-panel overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border-divider text-[11px] font-mono text-text-muted uppercase">
              <th className="py-3 px-4">Intervention ID</th>
              <th className="py-3 px-4">Transaction / Customer</th>
              <th className="py-3 px-4">AI Proposed</th>
              <th className="py-3 px-4">Policy Gate</th>
              <th className="py-3 px-4">Final Action</th>
              <th className="py-3 px-4">Provider</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider font-mono">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-text-muted italic font-sans">Loading interventions...</td>
              </tr>
            ) : interventions.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-text-muted italic font-sans">
                  No interventions executed yet. Run a batch recovery from Mission Control.
                </td>
              </tr>
            ) : (
              interventions.map((itv) => {
                const statusMeta = STATUS_META[itv.status] || STATUS_META.attempted_no_recovery;
                const actionMeta = ACTION_META[itv.final_action] || { color: 'text-text-secondary', bg: 'bg-surface border-border-subtle' };

                return (
                  <tr key={itv.intervention_id} className="hover:bg-panel-hover transition">
                    <td className="py-3 px-4">
                      <div className="text-text-primary font-medium truncate max-w-[120px]">{itv.intervention_id}</div>
                      {itv.idempotency_key && (
                        <div className="text-[10px] text-text-muted truncate max-w-[120px]">{itv.idempotency_key}</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-text-primary">{itv.transaction_id}</div>
                      <div className="text-[11px] text-text-muted">{itv.customer_id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-ai-300 font-semibold capitalize">{itv.ai_proposed_action}</span>
                    </td>
                    <td className="py-3 px-4">
                      {itv.policy_allowed ? (
                        <span className="inline-flex items-center space-x-1 text-success-300 text-[11px]">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Allowed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-risk-300 text-[11px]" title={itv.policy_reason}>
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[100px]">Blocked</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${actionMeta.bg} ${actionMeta.color}`}>
                        {itv.final_action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-muted uppercase text-[11px]">{itv.provider}</td>
                    <td className="py-3 px-4 text-right">
                      {itv.recovered ? (
                        <span className="font-bold text-success-300">+{formatINR(itv.recovered_amount)}</span>
                      ) : (
                        <span className="text-text-muted">{formatINR(itv.amount)}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center space-x-1.5 text-[11px] px-2 py-0.5 rounded border ${statusMeta.bg} ${statusMeta.color}`}>
                        {statusMeta.icon}
                        <span>{statusMeta.label}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-muted text-[11px]">{formatTimeAgo(itv.timestamp)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
