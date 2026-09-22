'use client';

import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, ShieldAlert, BrainCircuit, Zap, Receipt, AlertCircle, Clock, User, Database, ChevronRight } from 'lucide-react';
import { formatINR, formatPct, formatTimeAgo } from '@/lib/format';
import { Decision, Transaction } from '@/lib/types';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface TransactionDrawerProps {
  transactionId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

type TabId = 'decision' | 'timeline' | 'customer' | 'raw';

export const TransactionDrawer: React.FC<TransactionDrawerProps> = ({
  transactionId,
  onClose,
  onRefresh,
}) => {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [executing, setExecuting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabId>('decision');

  useEffect(() => {
    if (!transactionId) return;

    const loadDetails = async () => {
      setLoading(true);
      try {
        const txData = await api.getTransactionById(transactionId);
        setTx(txData);
        try {
          const decData = await api.getDecisionById(txData.leak_id);
          setDecision(decData);
        } catch {
          setDecision(null);
        }
      } catch (err: any) {
        console.error('Drawer Load Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
    setActiveTab('decision');
  }, [transactionId]);

  const handleExecute = async () => {
    if (!tx) return;
    setExecuting(true);
    try {
      const idempotencyKey = `drawer_exec_${tx.transaction_id}_${Date.now()}`;
      await api.executeIntervention(tx.transaction_id, idempotencyKey);
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(`Execution Error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <AnimatePresence>
      {transactionId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 overflow-hidden bg-canvas/80 backdrop-blur-sm flex justify-end"
            onClick={onClose}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[500px] bg-panel border-l border-border-strong shadow-2xl h-full flex flex-col justify-between overflow-hidden"
            >
              {/* Header */}
              <div className="p-5 border-b border-border-subtle flex flex-col space-y-4 bg-surface z-10 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-primary-400">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-text-primary text-[15px] font-medium font-mono tracking-tight">{tx?.transaction_id || transactionId}</h2>
                      <p className="text-text-muted text-[12px] mt-0.5">Transaction Deep Dive & Intelligence Trail</p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-md hover:bg-panel-hover text-text-muted hover:text-text-primary transition-colors border border-transparent hover:border-border-subtle"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Tabs */}
                {tx && (
                  <div className="flex items-center space-x-1 border-b border-border-subtle overflow-x-auto custom-scrollbar pb-1">
                    <TabButton id="decision" label="AI Decision" icon={BrainCircuit} active={activeTab === 'decision'} onClick={() => setActiveTab('decision')} />
                    <TabButton id="timeline" label="Timeline" icon={Clock} active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} />
                    <TabButton id="customer" label="Customer" icon={User} active={activeTab === 'customer'} onClick={() => setActiveTab('customer')} />
                    <TabButton id="raw" label="Raw Data" icon={Database} active={activeTab === 'raw'} onClick={() => setActiveTab('raw')} />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
                {loading || !tx ? (
                  <div className="h-full flex flex-col items-center justify-center space-y-4 text-text-muted">
                    <div className="w-8 h-8 rounded-full border-2 border-primary-500/30 border-t-primary-500 animate-spin" />
                    <p className="text-[13px] font-medium animate-pulse">Loading transaction intelligence...</p>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-6"
                    >
                      {activeTab === 'decision' && (
                        <>
                          {/* Amount Hero */}
                          <div className="p-5 rounded-xl bg-surface border border-border-strong flex items-center justify-between shadow-sm">
                            <div>
                              <span className="text-[11px] font-medium text-text-secondary tracking-widest uppercase">At Risk Amount</span>
                              <div className="text-3xl font-display font-semibold text-text-primary mt-1">
                                {formatINR(tx.amount)}
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className={`text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-sm border ${tx.leak_type === 'failed_payment' ? 'bg-risk-900/30 text-risk-400 border-risk-500/30' : tx.leak_type === 'abandoned_checkout' ? 'bg-warning-900/30 text-warning-400 border-warning-500/30' : 'bg-ai-900/30 text-ai-400 border-ai-500/30'}`}>
                                {tx.leak_type.replace('_', ' ')}
                              </span>
                              <span className="text-[12px] text-text-muted mt-2 font-mono flex items-center">
                                <Clock className="w-3 h-3 mr-1" />
                                {tx.hours_since_event}h ago
                              </span>
                            </div>
                          </div>

                          {/* AI Decision Panel */}
                          {decision ? (
                            <div className="rounded-xl border border-ai-500/30 bg-surface overflow-hidden shadow-sm">
                              <div className="p-4 bg-ai-500/5 border-b border-ai-500/20 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <div className="w-6 h-6 rounded-md bg-ai-500/20 flex items-center justify-center text-ai-400">
                                    <BrainCircuit className="w-3.5 h-3.5" />
                                  </div>
                                  <span className="text-[13px] font-medium text-text-primary tracking-wide">AI Recommendation</span>
                                </div>
                                <span className="text-[11px] font-mono text-ai-300 bg-ai-500/20 px-2 py-0.5 rounded-full border border-ai-500/20">
                                  Confidence: {formatPct(decision.ai_proposed_probability)}
                                </span>
                              </div>
                              <div className="p-4 space-y-4">
                                <div className="flex items-center justify-between p-3 rounded-lg bg-panel border border-border-subtle">
                                  <div className="flex flex-col">
                                    <span className="text-[11px] text-text-muted uppercase tracking-wider mb-1">Proposed Action</span>
                                    <span className="text-[14px] font-mono font-semibold uppercase text-ai-400 flex items-center">
                                      {decision.ai_proposed_action}
                                      <ChevronRight className="w-4 h-4 ml-1 opacity-50" />
                                    </span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className="text-[11px] text-text-muted uppercase tracking-wider mb-1">Expected Value</span>
                                    <span className="text-[14px] font-mono font-semibold text-success-400">
                                      {formatINR(decision.ai_proposed_ev)}
                                    </span>
                                  </div>
                                </div>

                                {/* Candidate EV Table */}
                                <div className="pt-2">
                                  <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted block mb-3 pl-1">Candidate Scoring</span>
                                  <div className="space-y-2">
                                    {decision.candidates_evaluated.map((c) => (
                                      <div key={c.action} className="flex items-center justify-between text-[12px] p-2 rounded-md hover:bg-surface transition-colors">
                                        <span className="font-mono text-text-secondary uppercase">{c.action}</span>
                                        <div className="flex items-center space-x-4 font-mono">
                                          <span className="text-text-muted w-16 text-right">P: {formatPct(c.probability)}</span>
                                          <span className="text-text-primary font-medium w-24 text-right">{formatINR(c.expected_value)}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="p-6 rounded-xl border border-dashed border-border-subtle flex flex-col items-center justify-center text-center">
                              <BrainCircuit className="w-8 h-8 text-text-muted/40 mb-3" />
                              <span className="text-[13px] text-text-muted">No AI decision recorded.</span>
                            </div>
                          )}

                          {/* Policy Decision Panel */}
                          {decision && (
                            <div className={`rounded-xl border shadow-sm overflow-hidden ${
                                decision.policy_allowed
                                  ? 'bg-success-900/10 border-success-500/30'
                                  : 'bg-risk-900/10 border-risk-500/40'
                              }`}
                            >
                              <div className={`p-4 border-b flex items-center justify-between ${decision.policy_allowed ? 'bg-success-500/5 border-success-500/20' : 'bg-risk-500/5 border-risk-500/20'}`}>
                                <div className="flex items-center space-x-2">
                                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${decision.policy_allowed ? 'bg-success-500/20 text-success-400' : 'bg-risk-500/20 text-risk-400'}`}>
                                    {decision.policy_allowed ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                                  </div>
                                  <span className={`text-[13px] font-medium tracking-wide ${decision.policy_allowed ? 'text-success-400' : 'text-risk-400'}`}>
                                    Safety Controls
                                  </span>
                                </div>
                                <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-sm ${
                                  decision.policy_allowed
                                    ? 'bg-success-500/20 text-success-400'
                                    : 'bg-risk-500/20 text-risk-400'
                                }`}>
                                  {decision.policy_allowed ? 'ALLOWED' : 'ACTION PAUSED'}
                                </span>
                              </div>
                              <div className="p-4 space-y-3">
                                <p className="text-[13px] text-text-primary leading-relaxed font-medium">
                                  {decision.policy_reason}
                                </p>

                                {!decision.policy_allowed && (
                                  <div className="p-3 rounded-lg bg-surface border border-border-subtle flex items-center justify-between mt-2">
                                    <span className="text-[12px] text-text-muted">Revised Action:</span>
                                    <span className="font-mono text-[13px] font-bold text-warning-400 uppercase">
                                      {decision.final_action}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {activeTab === 'timeline' && (
                        <div className="p-6 rounded-xl border border-dashed border-border-subtle flex flex-col items-center justify-center text-center h-64">
                          <Clock className="w-8 h-8 text-text-muted/40 mb-3" />
                          <span className="text-[14px] font-medium text-text-primary mb-1">Timeline View</span>
                          <span className="text-[13px] text-text-muted">Detailed event history is coming soon.</span>
                        </div>
                      )}

                      {activeTab === 'customer' && (
                        <div className="space-y-4">
                          <div className="p-5 rounded-xl bg-surface border border-border-strong flex items-center space-x-4 shadow-sm">
                            <div className="w-12 h-12 rounded-full bg-panel border border-border-strong flex items-center justify-center text-text-secondary">
                              <User className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="text-[15px] font-medium text-text-primary font-mono">{tx.customer_id}</h3>
                              <p className="text-[12px] text-text-muted mt-0.5">High Value Customer Segment</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-4 rounded-lg bg-surface border border-border-subtle">
                              <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider block mb-1">LTV Bucket</span>
                              <span className="text-[14px] font-semibold text-text-primary uppercase">{tx.ltv_bucket}</span>
                            </div>
                            <div className="p-4 rounded-lg bg-surface border border-border-subtle">
                              <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider block mb-1">Payment Method</span>
                              <span className="text-[14px] font-semibold text-text-primary uppercase">{tx.payment_method}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTab === 'raw' && (
                        <div className="rounded-xl overflow-hidden border border-border-strong bg-canvas">
                          <div className="p-3 border-b border-border-subtle bg-surface flex items-center justify-between">
                            <span className="text-[11px] font-mono text-text-muted uppercase tracking-widest">JSON Payload</span>
                          </div>
                          <div className="p-4 overflow-x-auto">
                            <pre className="text-[11px] font-mono text-text-secondary leading-relaxed">
                              {JSON.stringify(tx, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>

              {/* Footer Execution Trigger */}
              <div className="p-5 border-t border-border-subtle bg-surface shrink-0">
                <button
                  onClick={handleExecute}
                  disabled={executing || !tx}
                  className="w-full py-3 px-4 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-[13px] font-medium flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Zap className={`w-4 h-4 ${executing ? 'animate-spin' : ''}`} />
                  <span>{executing ? 'Executing Action...' : `Execute ${decision?.final_action ? decision.final_action.toUpperCase() : 'Action'}`}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const TabButton: React.FC<{
  id: TabId;
  label: string;
  icon: React.FC<any>;
  active: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-4 py-2 text-[12px] font-medium transition-colors border-b-2 whitespace-nowrap ${
      active
        ? 'text-primary-400 border-primary-500 bg-primary-500/5'
        : 'text-text-muted border-transparent hover:text-text-primary hover:bg-surface'
    }`}
  >
    <Icon className="w-3.5 h-3.5" />
    <span>{label}</span>
  </button>
);
