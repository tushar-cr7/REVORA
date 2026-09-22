'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Settings, RefreshCw, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { PolicyLimits } from '@/lib/types';
import { RecoverySimulator } from '@/components/simulator/RecoverySimulator';

export default function SettingsPage() {
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPolicies();
      setPolicy(res.active_policy);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-sm bg-surface border border-border-strong flex items-center justify-center text-text-secondary">
            <Settings className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Settings</h2>
            <p className="text-xs text-text-muted mt-0.5">System configuration and policy simulation</p>
          </div>
        </div>
        <button
          id="btn-refresh-settings"
          onClick={loadPolicy}
          disabled={loading}
          className="p-2 rounded-sm bg-panel border border-border-strong text-text-muted hover:text-text-primary transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Info Banner */}
      <div className="flex items-start space-x-2 p-3 rounded bg-surface border border-border-divider text-xs text-text-muted leading-relaxed">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Only settings actually supported by the backend are exposed here.
          The active policy limits are read-only — they can be inspected in the{' '}
          <strong className="text-text-secondary">Policies & Guardrails</strong> page.
          The <strong className="text-text-secondary">Policy Simulator</strong> below lets you run what-if scenarios
          evaluated entirely by the backend — client-side logic does not implement any policy rules.
        </span>
      </div>

      {/* System Info */}
      <div className="bg-panel border border-border-subtle rounded-md p-4">
        <h3 className="text-text-primary text-sm font-semibold pb-3 border-b border-border-divider">System Configuration</h3>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          {[
            { label: 'ML Model', value: 'XGBoost (scikit-learn compatible)' },
            { label: 'Model Version', value: '1.0.0' },
            { label: 'Repository', value: 'InMemoryRepository (non-persistent)' },
            { label: 'Execution Provider', value: 'SimulationProvider (sandbox)' },
            { label: 'Backend', value: 'FastAPI + Python 3.13' },
            { label: 'Frontend', value: 'Next.js 14 + TypeScript + Tailwind' },
            { label: 'Policy Version', value: 'v1 (DEFAULT_POLICY)' },
            { label: 'API Base URL', value: 'http://localhost:8000' },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between p-2.5 rounded bg-surface border border-border-divider">
              <span className="text-text-muted">{item.label}</span>
              <span className="text-text-primary font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Policy Simulator */}
      <RecoverySimulator initialPolicy={policy} />
    </div>
  );
}
