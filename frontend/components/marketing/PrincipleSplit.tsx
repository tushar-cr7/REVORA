import React from 'react';
import { Sparkles, ShieldCheck } from 'lucide-react';
import { Reveal } from './Reveal';

const AI_CAN = [
  'Identify patterns across transactions and customer behavior',
  'Estimate the probability a payment can be recovered',
  'Compare candidate actions by expected value',
  'Diagnose the likely cause of a failure',
  'Explain a recommendation in plain language',
];

const POLICY_ONLY = [
  'Approve an action before money moves',
  'Downgrade or block a proposed action',
  'Reroute a case to escalation or suppression',
  'Enforce retry limits and cooldown periods',
  'Cap autonomous recovery value per transaction',
];

export function PrincipleSplit() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Reveal>
        <div className="flex h-full flex-col gap-5 rounded-xl border border-hairline bg-paper-raised p-8">
          <div className="flex items-center gap-2.5 text-accent-violet">
            <Sparkles size={18} strokeWidth={1.75} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">The AI may</span>
          </div>
          <ul className="flex flex-col gap-3">
            {AI_CAN.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-secondary">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-violet" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="flex h-full flex-col gap-5 rounded-xl border border-ink bg-ink p-8">
          <div className="flex items-center gap-2.5 text-emerald-400">
            <ShieldCheck size={18} strokeWidth={1.75} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">Only policy may</span>
          </div>
          <ul className="flex flex-col gap-3">
            {POLICY_ONLY.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-white/80">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  );
}
