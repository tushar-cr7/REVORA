'use client';

import React from 'react';
import { Sliders, CheckCircle2, XCircle, Info } from 'lucide-react';

export default function IntegrationsPage() {
  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-sm bg-surface border border-border-strong flex items-center justify-center text-text-secondary">
          <Sliders className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary tracking-tight">Integrations</h2>
          <p className="text-xs text-text-muted mt-0.5">Payment execution providers and external system connections</p>
        </div>
      </div>

      {/* Active Provider */}
      <div className="bg-panel border border-border-subtle rounded-md p-5">
        <div className="flex items-center justify-between pb-3 border-b border-border-divider">
          <h3 className="text-text-primary text-sm font-semibold">Payment Execution Provider</h3>
          <span className="text-[10px] font-mono uppercase bg-success-muted text-success-300 px-2 py-0.5 rounded border border-success-500/30">
            Active
          </span>
        </div>

        <div className="mt-4 p-4 rounded bg-surface border border-border-divider">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded bg-panel border border-border-strong flex items-center justify-center">
                  <span className="text-text-primary font-mono font-bold text-sm">S</span>
                </div>
                <div>
                  <div className="text-text-primary font-semibold text-sm">Simulation Provider</div>
                  <div className="text-text-muted text-xs font-mono">backend/app/integrations/simulation.py</div>
                </div>
              </div>
              <p className="text-text-muted text-xs mt-3 leading-relaxed max-w-lg">
                The active execution provider is <strong className="text-text-secondary">SimulationProvider</strong> — a sandboxed
                execution engine that simulates payment retries, reminder sends, and payment link generation with realistic
                success/failure probabilities. All intervention outcomes are computed deterministically from the transaction features
                and the model&apos;s recovery probability.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-panel border border-border-subtle">
                  <span className="text-[10px] text-text-muted block uppercase">Provider Type</span>
                  <span className="text-text-primary font-bold">Simulation (Sandbox)</span>
                </div>
                <div className="p-2 rounded bg-panel border border-border-subtle">
                  <span className="text-[10px] text-text-muted block uppercase">Interface</span>
                  <span className="text-text-primary font-bold">PaymentExecutionProvider</span>
                </div>
              </div>
            </div>
            <CheckCircle2 className="w-5 h-5 text-success-300 shrink-0 ml-4" />
          </div>
        </div>
      </div>

      {/* Non-active: Razorpay */}
      <div className="bg-panel border border-border-subtle rounded-md p-5">
        <div className="flex items-center justify-between pb-3 border-b border-border-divider">
          <h3 className="text-text-primary text-sm font-semibold">Razorpay Integration</h3>
          <span className="text-[10px] font-mono uppercase bg-surface text-text-muted px-2 py-0.5 rounded border border-border-subtle">
            Not Configured
          </span>
        </div>

        <div className="mt-4 p-4 rounded bg-surface border border-border-divider opacity-60">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded bg-panel border border-border-strong flex items-center justify-center">
                  <span className="text-text-muted font-mono font-bold text-sm">R</span>
                </div>
                <div>
                  <div className="text-text-secondary font-semibold text-sm">Razorpay API</div>
                  <div className="text-text-muted text-xs font-mono">backend/app/integrations/razorpay.py (stub)</div>
                </div>
              </div>
              <p className="text-text-muted text-xs mt-3 leading-relaxed max-w-lg">
                Live Razorpay integration would replace the SimulationProvider for production deployments.
                Only test-mode/sandbox credentials are supported in this project. No live payment credentials are configured.
              </p>
            </div>
            <XCircle className="w-5 h-5 text-text-muted shrink-0 ml-4" />
          </div>
        </div>

        <div className="mt-3 flex items-start space-x-2 text-xs text-text-muted">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-text-muted" />
          <span>
            To enable: set <code className="font-mono text-text-secondary">PAYMENT_PROVIDER=razorpay</code> and provide
            <code className="font-mono text-text-secondary"> RAZORPAY_KEY_ID</code> /
            <code className="font-mono text-text-secondary"> RAZORPAY_KEY_SECRET</code> in <code className="font-mono text-text-secondary">.env</code>.
            Never configure live production credentials in this system.
          </span>
        </div>
      </div>

      {/* Provider Interface */}
      <div className="bg-panel border border-border-subtle rounded-md p-5">
        <h3 className="text-text-primary text-sm font-semibold pb-3 border-b border-border-divider">Provider Abstraction Interface</h3>
        <div className="mt-4 p-4 rounded bg-surface border border-border-divider font-mono text-xs text-text-secondary space-y-1 leading-relaxed">
          <div className="text-ai-300"># backend/app/integrations/base.py</div>
          <div><span className="text-primary-300">class</span> PaymentExecutionProvider(ABC):</div>
          <div className="pl-4"><span className="text-primary-300">def</span> execute(</div>
          <div className="pl-8">tx_dict: Dict[str, Any],</div>
          <div className="pl-8">decision_dict: Dict[str, Any],</div>
          <div className="pl-8">idempotency_key: Optional[str]</div>
          <div className="pl-4">) → Intervention: ...</div>
        </div>
        <p className="text-text-muted text-xs mt-3 leading-relaxed">
          All providers implement this single interface. Switching providers requires only changing the
          <code className="font-mono text-text-secondary"> PAYMENT_PROVIDER</code> env variable — no business logic changes.
        </p>
      </div>
    </div>
  );
}
