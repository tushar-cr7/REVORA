'use client';

import React, { useState } from 'react';
import { Target, ArrowUpRight, ShieldCheck, ShieldAlert, Zap, Layers } from 'lucide-react';
import { formatINR, formatPct } from '@/lib/format';
import { Opportunity } from '@/lib/types';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface TopOpportunitiesProps {
  opportunities: Opportunity[];
  onSelectTransaction: (txId: string) => void;
  onRefresh: () => void;
}

export const TopOpportunities: React.FC<TopOpportunitiesProps> = ({
  opportunities,
  onSelectTransaction,
  onRefresh,
}) => {
  const [executingId, setExecutingId] = useState<string | null>(null);

  const handleExecute = async (e: React.MouseEvent, opp: Opportunity) => {
    e.stopPropagation();
    setExecutingId(opp.transaction_id);
    try {
      const idempotencyKey = `ui_exec_${opp.transaction_id}_${Date.now()}`;
      await api.executeIntervention(opp.transaction_id, idempotencyKey);
      onRefresh();
    } catch (err: any) {
      alert(`Execution Error: ${err.message}`);
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-success-400">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Top Recovery Opportunities</h3>
            <p className="text-text-muted text-[12px] mt-0.5">High expected value interventions authorized for execution</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-[12px] font-mono text-text-muted bg-surface px-3 py-1 rounded-full border border-border-subtle shadow-inner">
          <Layers className="w-3.5 h-3.5" />
          <span>{opportunities.length} opportunities</span>
        </div>
      </div>

      {/* Opportunities Table */}
      <div className="mt-4 overflow-x-auto custom-scrollbar pb-2">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-subtle text-[11px] font-mono text-text-muted uppercase tracking-wider">
              <th className="py-3 px-4 font-medium">Customer & Transaction</th>
              <th className="py-3 px-4 font-medium">Issue</th>
              <th className="py-3 px-4 font-medium text-right">Amount at Risk</th>
              <th className="py-3 px-4 font-medium text-center">Recovery Prob</th>
              <th className="py-3 px-4 font-medium text-right">Expected Value</th>
              <th className="py-3 px-4 font-medium text-center">Safety Status</th>
              <th className="py-3 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-text-muted border-b border-dashed border-border-subtle">
                  <div className="flex flex-col items-center">
                    <Target className="w-8 h-8 text-text-muted/50 mb-3" />
                    <span>No pending opportunities.</span>
                    <span className="text-[11px] mt-1">Run an intelligence pass to discover leak interventions.</span>
                  </div>
                </td>
              </tr>
            ) : (
              <AnimatePresence>
                {opportunities.map((opp, idx) => {
                  const isExecuting = executingId === opp.transaction_id;

                  return (
                    <motion.tr
                      key={opp.transaction_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05, duration: 0.2 }}
                      onClick={() => onSelectTransaction(opp.transaction_id)}
                      className="border-b border-border-divider hover:bg-surface/50 transition-colors cursor-pointer group"
                    >
                      {/* Transaction ID & Customer */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col space-y-1">
                          <span className="font-medium text-text-primary text-[13px] tracking-tight">{opp.customer_id}</span>
                          <div className="font-mono text-text-muted text-[11px] flex items-center space-x-1 group-hover:text-primary-400 transition-colors">
                            <span>{opp.transaction_id}</span>
                            <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity -ml-1" />
                          </div>
                        </div>
                      </td>

                      {/* Leak Type */}
                      <td className="py-3.5 px-4">
                        <span className="capitalize text-text-secondary font-medium tracking-tight">
                          {opp.leak_type.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-text-primary tracking-tight">
                        {formatINR(opp.amount)}
                      </td>

                      {/* Recovery Probability Ring/Pill */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex justify-center">
                          <span
                            className={`inline-flex items-center justify-center font-mono text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                              opp.recovery_probability >= 0.7
                                ? 'bg-success-900/20 text-success-400 border-success-500/30'
                                : opp.recovery_probability >= 0.4
                                ? 'bg-ai-900/20 text-ai-400 border-ai-500/30'
                                : 'bg-risk-900/20 text-risk-400 border-risk-500/30'
                            }`}
                          >
                            {formatPct(opp.recovery_probability)}
                          </span>
                        </div>
                      </td>

                      {/* Expected Recovery */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-success-400 tracking-tight">
                        {formatINR(opp.expected_recovery)}
                      </td>

                      {/* Policy Status */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex justify-center">
                          {opp.policy_allowed ? (
                            <span className="inline-flex items-center space-x-1.5 text-[11px] font-medium text-success-400 bg-success-900/20 px-2.5 py-1 rounded-full border border-success-500/20 shadow-sm">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Allowed</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1.5 text-[11px] font-medium text-risk-400 bg-risk-900/20 px-2.5 py-1 rounded-full border border-risk-500/20 shadow-sm">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Blocked</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Action Button */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={(e) => handleExecute(e, opp)}
                          disabled={isExecuting}
                          className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-all shadow-sm inline-flex items-center space-x-2 ${
                            opp.recommended_action === 'retry'
                              ? 'bg-primary-600 hover:bg-primary-500 text-white border border-primary-500/50'
                              : opp.recommended_action === 'payment_link'
                              ? 'bg-ai-600 hover:bg-ai-500 text-white border border-ai-500/50'
                              : opp.recommended_action === 'escalate'
                              ? 'bg-transparent border border-risk-500/50 text-risk-400 hover:bg-risk-500/10'
                              : 'bg-surface border border-border-strong text-text-secondary hover:text-text-primary'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <Zap className={`w-3.5 h-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
                          <span>
                            {isExecuting
                              ? 'Executing...'
                              : opp.recommended_action === 'retry'
                              ? 'Retry Now'
                              : opp.recommended_action === 'payment_link'
                              ? 'Send Link'
                              : opp.recommended_action === 'reminder'
                              ? 'Send Reminder'
                              : opp.recommended_action === 'escalate'
                              ? 'Escalate'
                              : 'Suppress'}
                          </span>
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
