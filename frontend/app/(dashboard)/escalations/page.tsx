'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CircleAlert, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Decision } from '@/lib/types';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadEscalations = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getEscalations(200);
      setEscalations(res.escalations);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load escalations: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEscalations();
  }, [loadEscalations]);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <CircleAlert strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Escalations</h2>
            <p className="text-xs text-text-muted mt-0.5">AI-proposed actions rerouted to merchant by the policy engine</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-xs font-mono text-text-muted">{escalations.length} escalations</span>
          <button
            id="btn-refresh-escalations"
            onClick={loadEscalations}
            disabled={loading}
            className="p-2 rounded-sm bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono">{errorMsg}</div>
      )}

      {/* Note */}
      <div className="p-3 rounded bg-warning-muted/30 border border-warning-500/20 text-xs text-text-muted leading-relaxed">
        <strong className="text-warning-300">What is an escalation? </strong>
        When the policy engine blocks the AI&apos;s proposed action (e.g., due to retry limit breach, high-value ceiling, or subscription failure threshold),
        the final action is rerouted to <code className="font-mono text-text-secondary">escalate</code> — meaning the merchant must review and action manually.
        These are real records from the backend policy evaluation.
      </div>

      {/* Table */}
      <div className="bg-panel border border-border-subtle rounded-md shadow-panel overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border-divider text-[11px] font-mono text-text-muted uppercase">
              <th className="py-3 px-4">Decision ID</th>
              <th className="py-3 px-4">Transaction / Leak</th>
              <th className="py-3 px-4">AI Proposed</th>
              <th className="py-3 px-4 text-right">AI EV Score</th>
              <th className="py-3 px-4">Policy Gate</th>
              <th className="py-3 px-4">Policy Reason</th>
              <th className="py-3 px-4">Final Action</th>
              <th className="py-3 px-4">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-divider font-mono">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-muted italic font-sans">Loading escalations...</td>
              </tr>
            ) : escalations.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center font-sans">
                  <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-text-muted mx-auto mb-2" />
                  <p className="text-text-muted text-xs">No escalations recorded yet.</p>
                  <p className="text-text-muted text-[11px] mt-1">Run a scan and batch recovery — escalations are generated when policy limits are breached.</p>
                </td>
              </tr>
            ) : (
              escalations.map((esc) => (
                <tr key={esc.decision_id} className="hover:bg-panel-hover transition">
                  <td className="py-3 px-4">
                    <div className="text-text-primary truncate max-w-[100px]" title={esc.decision_id}>{esc.decision_id}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-text-primary">{esc.transaction_id}</div>
                    <div className="text-[11px] text-text-muted">{esc.leak_id}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-ai-300 font-semibold capitalize">{esc.ai_proposed_action}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="font-semibold text-text-primary">{formatINR(esc.ai_proposed_ev)}</div>
                    <div className="text-[11px] text-ai-300">{formatPct(esc.ai_proposed_probability)}</div>
                  </td>
                  <td className="py-3 px-4">
                    {esc.policy_allowed ? (
                      <span className="inline-flex items-center space-x-1 text-success-300 text-[11px]">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Allowed</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-risk-300 text-[11px]">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Blocked</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-text-secondary text-[11px] max-w-[180px] leading-relaxed font-sans">
                    {esc.policy_reason}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded border bg-warning-muted border-warning-500/30 text-warning-300">
                      {esc.final_action}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-text-muted text-[11px]">{formatTimeAgo(esc.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
