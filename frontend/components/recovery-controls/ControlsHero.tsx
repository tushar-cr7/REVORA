'use client';

import React from 'react';
import { TrendingUp, HeartHandshake, Gauge } from 'lucide-react';
import { ControlPhilosophyVisual } from './ControlPhilosophyVisual';

/**
 * The page's opening statement: REVORA's central trust claim (AI suggests,
 * a deterministic gate decides, the merchant's rules control the outcome)
 * given its own dedicated hero illustration between the tagline and the
 * control philosophy list, rather than squeezed into a small badge.
 */
export function ControlsHero() {
  return (
    <div className="rounded-xl border border-border-subtle bg-panel p-6 lg:p-8 relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-24 right-0 w-[520px] h-[360px] bg-ai-500/10 rounded-full blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 w-[400px] h-[260px] bg-primary-500/5 rounded-full blur-3xl" />

      <div className="relative grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px_216px] gap-8 xl:items-center">
        {/* ── Copy ── */}
        <div className="min-w-0">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.22em] text-text-muted flex items-center gap-2 flex-wrap">
            <span>Controls</span>
            <span className="text-border-strong">&middot;</span>
            <span>Policy-driven</span>
            <span className="text-border-strong">&middot;</span>
            <span>Safe recovery</span>
          </div>

          <h1 className="text-[34px] sm:text-[44px] font-semibold text-text-primary tracking-tight leading-[1.05] mt-3">
            Recovery Controls
          </h1>

          <p className="text-[17px] sm:text-[19px] text-text-secondary font-medium mt-2">
            AI for Intelligence. Rules for Control.
          </p>

          <p className="text-[13px] text-text-muted mt-3 max-w-md leading-relaxed">
            Define how REVORA can act, who it can contact, and when to escalate. You stay in control, always.
          </p>
        </div>

        {/* ── Hero illustration ── */}
        <ControlPhilosophyVisual />

        {/* ── Control philosophy ── */}
        <div className="w-full xl:w-[216px] shrink-0 mx-auto xl:mx-0 max-w-sm">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">Control philosophy</div>
          <p className="text-[12.5px] text-text-secondary leading-relaxed mt-1.5">
            Intelligence finds the opportunity. Your rules decide what happens.
          </p>
          <ul className="mt-3 space-y-2">
            <PhilosophyRow icon={TrendingUp} tone="success" text="Maximize recovered revenue" />
            <PhilosophyRow icon={HeartHandshake} tone="primary" text="Respect customer experience" />
            <PhilosophyRow icon={Gauge} tone="warning" text="Stay within your risk boundaries" />
          </ul>
        </div>
      </div>
    </div>
  );
}

const PhilosophyRow: React.FC<{ icon: React.ElementType; tone: 'success' | 'primary' | 'warning'; text: string }> = ({
  icon: Icon,
  tone,
  text,
}) => {
  const color = tone === 'success' ? 'text-success-400 border-success-500/30 bg-success-muted/40' : tone === 'primary' ? 'text-primary-300 border-primary-500/30 bg-primary-muted/40' : 'text-warning-300 border-warning-500/30 bg-warning-muted/40';
  return (
    <li className="flex items-center gap-2">
      <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-2.5 h-2.5" strokeWidth={2} />
      </span>
      <span className="text-[12px] text-text-secondary">{text}</span>
    </li>
  );
};
