'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, RefreshCw, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { PolicyLimits } from '@/lib/types';
import { RecoveryBoundaryPanel } from '@/components/recovery-controls/RecoveryBoundaryPanel';
import { ActionPermissions } from '@/components/recovery-controls/ActionPermissions';
import { ControlGroups } from '@/components/recovery-controls/ControlGroups';

export default function PoliciesPage() {
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getPolicies();
      setPolicy(res.active_policy);
      setPolicyVersion(res.policy_version);
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

  const controlsActive = !errorMsg && !!policy;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <SlidersHorizontal strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Recovery Controls</h2>
            <p className="text-[13px] text-text-muted mt-0.5">REVORA is operating within merchant-defined recovery boundaries.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center space-x-2 text-[11px] font-mono px-3 py-1.5 rounded-full border ${controlsActive ? 'bg-surface border-border-subtle text-success-500' : 'bg-risk-900/10 border-risk-500/30 text-risk-400'}`}>
            <span className="relative flex h-1.5 w-1.5">
              {controlsActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />}
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${controlsActive ? 'bg-success-500' : 'bg-risk-500'}`} />
            </span>
            <span className="tracking-wide font-medium">{controlsActive ? 'CONTROLS ACTIVE' : 'UNAVAILABLE'}</span>
          </div>
          {policyVersion && (
            <div className="text-[12px] font-mono text-text-muted bg-surface px-3 py-1.5 rounded-full border border-border-subtle hidden sm:flex items-center">
              Policy {policyVersion}
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
        <div className="p-4 rounded-lg bg-risk-900/20 border border-risk-500/40 text-risk-400 text-[13px] font-medium flex items-center">{errorMsg}</div>
      )}

      <RecoveryBoundaryPanel />

      <ActionPermissions />

      <ControlGroups policy={policy} loading={loading} error={!!errorMsg} />

      <div className="p-4 rounded-xl bg-risk-900/10 border border-risk-500/20 text-[12px] text-text-secondary leading-relaxed flex items-start space-x-3">
        <Lock className="w-4 h-4 text-risk-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-risk-400 font-medium mr-1">Read-only by design:</strong>
          These limits are deterministically enforced by the policy engine in{' '}
          <code className="font-mono text-text-primary bg-panel px-1 py-0.5 rounded border border-border-subtle mx-1">backend/app/domain/policy.py</code>
          . They cannot be edited from this page — no AI generation or client-side action can override them. To test a hypothetical
          change, use the policy simulator in Settings.
        </div>
      </div>
    </div>
  );
}
