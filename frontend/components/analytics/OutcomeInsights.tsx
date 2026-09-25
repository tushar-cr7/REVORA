'use client';

import React from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Insight } from './analyticsSignals';

/**
 * Plain-language read of the same computed facts shown elsewhere on the
 * page — never AI-generated prose, never an LLM call (REVORA's Copilot is
 * template-based today; this is simpler still, pure arithmetic over loaded
 * records). Two columns: what's producing results, and what still needs a
 * human.
 */

interface OutcomeInsightsProps {
  working: Insight[];
  attention: Insight[];
}

export const OutcomeInsights: React.FC<OutcomeInsightsProps> = ({ working, attention }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <InsightColumn
        icon={CircleCheck}
        tone="success"
        eyebrow="Working"
        title="What's working"
        items={working}
      />
      <InsightColumn
        icon={TriangleAlert}
        tone="warning"
        eyebrow="Attention"
        title="Where attention remains"
        items={attention}
      />
    </div>
  );
};

const InsightColumn: React.FC<{
  icon: React.ElementType;
  tone: 'success' | 'warning';
  eyebrow: string;
  title: string;
  items: Insight[];
}> = ({ icon: Icon, tone, eyebrow, title, items }) => {
  const dot = tone === 'success' ? 'bg-success-400' : 'bg-warning-400';
  const iconColor = tone === 'success' ? 'text-success-300' : 'text-warning-300';

  return (
    <section className="rounded-lg border border-border-subtle bg-panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon strokeWidth={1.75} className={`w-4 h-4 ${iconColor} shrink-0`} />
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">{eyebrow}</div>
          <h3 className="text-[14px] font-semibold text-text-primary tracking-tight -mt-0.5">{title}</h3>
        </div>
      </div>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${dot}`} />
            <p className="text-[12.5px] text-text-secondary leading-relaxed">{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};
