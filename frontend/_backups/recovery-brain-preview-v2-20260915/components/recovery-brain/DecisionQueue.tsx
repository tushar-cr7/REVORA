'use client';

import React from 'react';
import { Opportunity } from '@/lib/types';
import { formatINR } from '@/lib/format';
import { ACTION_COLOR, confidenceTier, TIER_META } from './decisionField.utils';

interface DecisionQueueProps {
  opportunities: Opportunity[];
  selectedId: string | null;
  onSelect: (opp: Opportunity) => void;
}

export const DecisionQueue: React.FC<DecisionQueueProps> = ({ opportunities, selectedId, onSelect }) => {
  return (
    <div className="bg-panel border border-border-subtle rounded-md flex flex-col">
      <div className="px-4 py-3 border-b border-border-divider flex items-center justify-between shrink-0">
        <h3 className="text-text-primary text-sm font-semibold">Decisions</h3>
        <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">{opportunities.length} surfaced</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto custom-scrollbar divide-y divide-border-divider">
        {opportunities.length === 0 ? (
          <p className="text-text-muted text-xs p-4">No decisions match the current filter.</p>
        ) : (
          opportunities.map((opp, idx) => {
            const isSelected = opp.transaction_id === selectedId;
            const tier = confidenceTier(opp.recovery_probability);
            return (
              <button
                key={opp.transaction_id}
                onClick={() => onSelect(opp)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                  isSelected ? 'bg-panel-raised' : 'hover:bg-surface/60'
                }`}
              >
                <span className="text-[11px] font-mono text-text-disabled w-6 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ACTION_COLOR[opp.recommended_action] || '#8FA3FF' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-text-primary text-[13px]">{formatINR(opp.amount)}</span>
                    <span className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                      {opp.recommended_action.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-text-muted capitalize">{opp.leak_type.replace('_', ' ')}</span>
                    {!opp.policy_allowed ? (
                      <span className="text-[10px] font-medium text-warning-300">Action paused</span>
                    ) : (
                      <span className={`text-[10px] font-medium ${TIER_META[tier].color}`}>{TIER_META[tier].label}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
