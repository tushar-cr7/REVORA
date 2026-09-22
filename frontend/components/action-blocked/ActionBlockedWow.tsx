'use client';

import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, Hexagon, Shield, Network } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { ForceRetryBlockResponse } from '@/lib/types';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface ActionBlockedWowProps {
  onRefresh: () => void;
}

export const ActionBlockedWow: React.FC<ActionBlockedWowProps> = ({ onRefresh }) => {
  const [demoData, setDemoData] = useState<ForceRetryBlockResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [executedStatus, setExecutedStatus] = useState<string | null>(null);

  const fetchBlockedDemoBeat = async () => {
    setLoading(true);
    setExecutedStatus(null);
    try {
      const res = await api.forceRetryBlockDemo();
      setDemoData(res);
    } catch (err: any) {
      alert(`Demo Beat Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEscalateInstead = async () => {
    if (!demoData) return;
    setLoading(true);
    try {
      const idempotencyKey = `demo_block_escalate_${demoData.transaction_id}_${Date.now()}`;
      await api.executeIntervention(demoData.transaction_id, idempotencyKey);
      setExecutedStatus('Escalation created & recorded to Audit Ledger');
      onRefresh();
    } catch (err: any) {
      alert(`Escalation Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-panel border border-risk-500/30 rounded-xl p-6 shadow-sm relative overflow-hidden group">
      {/* Risk Accent Background */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-risk-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none group-hover:bg-risk-500/10 transition-colors duration-1000" />
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-risk-400 to-risk-600" />

      <div className="flex items-center justify-between pb-4 border-b border-border-subtle relative z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-risk-900/20 border border-risk-500/30 flex items-center justify-center text-risk-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-text-primary text-[15px] font-medium tracking-wide flex items-center space-x-2">
              <span>Safety Controls: Intercept</span>
              <span className="text-[10px] font-mono uppercase bg-risk-900/40 text-risk-300 px-2 py-0.5 rounded-sm border border-risk-500/20 tracking-wider">
                Live Demo
              </span>
            </h3>
            <p className="text-text-muted text-[12px] mt-0.5">Observe REVORA overriding a risky ML recommendation in real-time</p>
          </div>
        </div>

        <button
          onClick={fetchBlockedDemoBeat}
          disabled={loading}
          className="px-4 py-2 rounded-md bg-surface border border-border-strong text-text-primary hover:bg-panel-hover hover:border-risk-500/50 text-[12px] font-medium flex items-center space-x-2 transition-all shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Simulate Policy Block</span>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {!demoData ? (
          <motion.div 
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-12 flex flex-col items-center justify-center text-center relative z-10"
          >
            <Shield className="w-10 h-10 text-border-strong mb-4" />
            <span className="text-[13px] text-text-secondary max-w-md">
              Click <span className="font-semibold text-text-primary">"Simulate Policy Block"</span> to force an AI recommendation that exceeds your deterministic safety thresholds (e.g. max retries).
            </span>
          </motion.div>
        ) : (
          <motion.div 
            key="content"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 space-y-4 relative z-10"
          >
            {/* Contrast: AI Recommendation vs Policy Decision */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AI Recommendation */}
              <div className="p-4 rounded-xl bg-ai-900/10 border border-ai-500/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between font-mono font-medium mb-3">
                    <span className="text-ai-400 text-[11px] tracking-widest uppercase flex items-center"><Network className="w-3.5 h-3.5 mr-1.5" /> Intelligence Engine</span>
                  </div>
                  <div className="text-text-primary text-[14px] leading-relaxed">
                    AI proposed a <strong className="font-mono font-semibold text-ai-300 uppercase bg-ai-900/30 px-1.5 py-0.5 rounded">{demoData.attempted_action}</strong> action.
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-ai-500/20 text-text-muted text-[11px] font-mono flex items-center justify-between">
                  <span>TX: {demoData.transaction_id}</span>
                  <span className="text-text-primary font-semibold">{formatINR(demoData.amount)}</span>
                </div>
              </div>

              {/* Policy Decision */}
              <div className="p-4 rounded-xl bg-risk-900/10 border border-risk-500/30 flex flex-col justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-risk-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                <div>
                  <div className="flex items-center justify-between font-mono font-medium mb-3 relative z-10">
                    <span className="text-risk-400 text-[11px] tracking-widest uppercase flex items-center"><ShieldAlert className="w-3.5 h-3.5 mr-1.5" /> Safety Controls</span>
                    <span className="text-[10px] uppercase bg-risk-500/20 text-risk-300 px-2 py-0.5 rounded-sm tracking-wider font-bold shadow-sm">
                      Intercepted
                    </span>
                  </div>
                  <div className="text-[14px] text-text-primary font-medium leading-relaxed relative z-10">
                    {demoData.policy_reason}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-risk-500/20 text-success-400 text-[11px] flex items-center space-x-1.5 font-medium relative z-10">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Customer relationship protected.</span>
                </div>
              </div>
            </div>

            {/* Action Rerouting & Button */}
            <div className="p-4 rounded-xl bg-surface border border-border-strong flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3 text-text-secondary">
                <div className="w-8 h-8 rounded-full bg-warning-900/20 border border-warning-500/30 flex items-center justify-center text-warning-400">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] text-text-muted uppercase tracking-wider font-medium">Deterministic Reroute</span>
                  <span className="text-[13px] font-mono font-bold text-text-primary uppercase mt-0.5">{demoData.final_action}</span>
                </div>
              </div>

              <button
                onClick={handleEscalateInstead}
                disabled={loading || !!executedStatus}
                className="px-5 py-2.5 rounded-md border border-risk-500/50 bg-risk-500/5 text-risk-400 hover:bg-risk-500 hover:text-white font-medium text-[12px] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <span>{executedStatus ? 'Escalation Created' : 'Escalate Instead'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {executedStatus && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-3.5 rounded-lg bg-success-900/20 border border-success-500/30 text-success-400 text-[12px] font-medium flex items-center justify-center space-x-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{executedStatus}</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
