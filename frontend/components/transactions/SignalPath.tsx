'use client';

import React from 'react';
import { SignalNode } from './caseSignals';

const NODE_CLS: Record<string, { dot: string; ring: string; text: string }> = {
  done: { dot: 'bg-primary-300', ring: 'border-primary-500/50', text: 'text-text-secondary' },
  active: { dot: 'bg-ai-300', ring: 'border-ai-500/60', text: 'text-ai-300' },
  blocked: { dot: 'bg-warning-400', ring: 'border-warning-500/60', text: 'text-warning-300' },
  pending: { dot: 'bg-border-strong', ring: 'border-border-strong', text: 'text-text-muted' },
};

/**
 * The case's own signature visual: Event -> Leak -> Signals -> Recovery.
 * Deliberately compact and non-cinematic — it reports where this single case
 * sits, rather than competing with Revenue Command's system-wide flow.
 */
export const SignalPath: React.FC<{ nodes: SignalNode[] }> = ({ nodes }) => (
  <div className="flex items-center" aria-label="Case progress">
    {nodes.map((n, i) => {
      const cls = NODE_CLS[n.state] ?? NODE_CLS.pending;
      const prev = i > 0 ? nodes[i - 1] : null;
      const connectorLit = prev && prev.state !== 'pending' && n.state !== 'pending';
      return (
        <React.Fragment key={n.key}>
          {i > 0 && (
            <div className={`h-px flex-1 mx-1.5 ${connectorLit ? 'bg-border-strong' : 'bg-border-subtle'}`} />
          )}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <span className={`w-2 h-2 rounded-full border ${cls.dot} ${cls.ring}`} />
            <span className={`text-[9px] font-mono uppercase tracking-wider ${cls.text}`}>{n.label}</span>
          </div>
        </React.Fragment>
      );
    })}
  </div>
);
