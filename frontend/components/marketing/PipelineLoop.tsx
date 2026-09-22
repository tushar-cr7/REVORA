import React from 'react';
import { Search, Stethoscope, LineChart, Split, Zap, Ruler, Brain } from 'lucide-react';
import { Reveal } from './Reveal';

const STAGES = [
  { label: 'Detect', icon: Search, desc: 'Categorize every silent leak — failed payment, abandoned checkout, failed renewal, overdue invoice.' },
  { label: 'Diagnose', icon: Stethoscope, desc: 'Identify the likely cause behind the failure signal.' },
  { label: 'Predict', icon: LineChart, desc: 'Estimate recovery probability with a trained model.' },
  { label: 'Decide', icon: Split, desc: 'Score expected value across every candidate action.' },
  { label: 'Execute', icon: Zap, desc: 'Only run what the deterministic policy engine authorizes.' },
  { label: 'Measure', icon: Ruler, desc: 'Record the real outcome — recovered, attempted, or blocked.' },
  { label: 'Learn', icon: Brain, desc: 'Feed verified outcomes back into the system.' },
];

export function PipelineLoop() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7 lg:gap-3">
      {STAGES.map((stage, i) => (
        <Reveal key={stage.label} delay={i * 0.05} className="relative">
          <div className="flex h-full flex-col gap-3 rounded-lg border border-hairline bg-paper-raised p-5">
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-paper-alt text-ink">
                <stage.icon size={17} strokeWidth={1.75} />
              </span>
              <span className="font-mono text-xs text-ink-muted">0{i + 1}</span>
            </div>
            <div>
              <div className="font-display text-lg text-ink">{stage.label}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{stage.desc}</p>
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
