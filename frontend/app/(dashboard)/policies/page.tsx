'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Info, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { Intervention, Opportunity, PolicyLimits } from '@/lib/types';
import { ControlsHero } from '@/components/recovery-controls/ControlsHero';
import { ControlsKpiRow } from '@/components/recovery-controls/ControlsKpiRow';
import { RecoveryBoundaryPanel } from '@/components/recovery-controls/RecoveryBoundaryPanel';
import { ActionPermissions } from '@/components/recovery-controls/ActionPermissions';
import { GateBanner } from '@/components/recovery-controls/GateBanner';
import { ControlGroups } from '@/components/recovery-controls/ControlGroups';
import { computeControlsKpis } from '@/components/recovery-controls/controlsSignals';
import { latestByTransaction } from '@/components/interventions/interventionSignals';

const OPPORTUNITY_LIMIT = 100;
const INTERVENTION_LIMIT = 500;

export default function PoliciesPage() {
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inFlight = useRef(false);

  const loadAll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [policiesRes, oppRes, intRes] = await Promise.all([
        api.getPolicies(),
        api.getOpportunities(OPPORTUNITY_LIMIT),
        api.getInterventions(INTERVENTION_LIMIT),
      ]);
      setPolicy(policiesRes.active_policy);
      setPolicyVersion(policiesRes.policy_version);
      setOpportunities(oppRes);
      setInterventions(latestByTransaction(intRes.interventions));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load recovery controls: ${msg}`);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const kpis = useMemo(() => computeControlsKpis(opportunities, interventions), [opportunities, interventions]);
  const controlsActive = !errorMsg && !!policy;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      <ControlsHero />

      {errorMsg && (
        <div className="p-4 rounded-lg bg-risk-900/20 border border-risk-500/40 text-risk-400 text-[13px] font-medium flex items-center">
          {errorMsg}
        </div>
      )}

      <ControlsKpiRow kpis={kpis} policyVersion={policyVersion} controlsActive={controlsActive} loading={loading} onRefresh={loadAll} />

      {/* Two-column only once each side has real room to breathe — a JS
          breakpoint here would render a different tree on the server than
          the client and break hydration, so this stays pure CSS (same
          technique Interventions already uses for its own two-column
          split). */}
      <div className="grid grid-cols-1 min-[1440px]:grid-cols-2 gap-4 items-stretch">
        <RecoveryBoundaryPanel />
        <ActionPermissions />
      </div>

      <GateBanner />

      <ControlGroups policy={policy} loading={loading} error={!!errorMsg} />

      <div className="p-4 rounded-xl bg-panel border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Info className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-medium text-text-primary">Read-only configuration</div>
            <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed max-w-xl">
              These controls are currently read-only because the policy update API is not yet available. Values
              shown here are the active policies from your backend.
            </p>
          </div>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-surface border border-border-strong text-text-primary hover:bg-panel-hover text-[12px] font-medium transition-colors shrink-0 whitespace-nowrap"
        >
          <span>Request Policy Update</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
