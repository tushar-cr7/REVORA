'use client';

import React, { useState } from 'react';
import { Sliders, Play, RefreshCcw, Activity, ShieldCheck, ShieldAlert, BarChart3 } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { PolicyLimits, SimulateResponse } from '@/lib/types';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface RecoverySimulatorProps {
  initialPolicy: PolicyLimits | null;
}

export const RecoverySimulator: React.FC<RecoverySimulatorProps> = ({ initialPolicy }) => {
  const [maxRetries, setMaxRetries] = useState<number>(initialPolicy?.max_retries || 2);
  const [cooldownHours, setCooldownHours] = useState<number>(initialPolicy?.min_cooldown_hours || 6);
  const [contactsPerDay, setContactsPerDay] = useState<number>(initialPolicy?.max_customer_contacts_per_day || 1);
  const [autoRecoveryLimit, setAutoRecoveryLimit] = useState<number>(initialPolicy?.max_auto_recovery_value || 25000);

  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [simulating, setSimulating] = useState<boolean>(false);

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const res = await api.simulatePolicy({
        max_retries: maxRetries,
        min_cooldown_hours: cooldownHours,
        max_customer_contacts_per_day: contactsPerDay,
        max_auto_recovery_value: autoRecoveryLimit,
      });
      setSimResult(res);
    } catch (err: any) {
      alert(`Simulation Error: ${err.message}`);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-6 shadow-sm relative overflow-hidden">
      {/* Background Accent */}
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-primary-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border-subtle relative z-10">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-primary-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Policy Simulator</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Forecast recovery outcomes across deterministic limits</p>
          </div>
        </div>
        <span className="text-[10px] font-mono uppercase bg-primary-900/20 text-primary-400 px-2.5 py-1 rounded-sm border border-primary-500/20 tracking-wider">
          What-If Engine
        </span>
      </div>

      {/* Controls & Output Split */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
        {/* Controls */}
        <div className="space-y-5">
          <div className="space-y-1">
            <div className="flex justify-between items-end mb-2">
              <span className="text-[11px] font-mono text-text-secondary uppercase tracking-widest">Max Retries Limit</span>
              <span className="text-[14px] font-display font-semibold text-primary-400">{maxRetries}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full accent-primary-500 bg-surface h-1.5 rounded-full cursor-pointer appearance-none outline-none border border-border-subtle"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-end mb-2">
              <span className="text-[11px] font-mono text-text-secondary uppercase tracking-widest">Min Cooldown Hours</span>
              <span className="text-[14px] font-display font-semibold text-primary-400">{cooldownHours}h</span>
            </div>
            <input
              type="range"
              min={1}
              max={24}
              value={cooldownHours}
              onChange={(e) => setCooldownHours(Number(e.target.value))}
              className="w-full accent-primary-500 bg-surface h-1.5 rounded-full cursor-pointer appearance-none outline-none border border-border-subtle"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-end mb-2">
              <span className="text-[11px] font-mono text-text-secondary uppercase tracking-widest">Daily Contacts / Customer</span>
              <span className="text-[14px] font-display font-semibold text-primary-400">{contactsPerDay}</span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              value={contactsPerDay}
              onChange={(e) => setContactsPerDay(Number(e.target.value))}
              className="w-full accent-primary-500 bg-surface h-1.5 rounded-full cursor-pointer appearance-none outline-none border border-border-subtle"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-end mb-2">
              <span className="text-[11px] font-mono text-text-secondary uppercase tracking-widest">Auto-Recovery Ceiling</span>
              <span className="text-[14px] font-mono font-semibold text-primary-400">{formatINR(autoRecoveryLimit)}</span>
            </div>
            <input
              type="range"
              min={10000}
              max={100000}
              step={5000}
              value={autoRecoveryLimit}
              onChange={(e) => setAutoRecoveryLimit(Number(e.target.value))}
              className="w-full accent-primary-500 bg-surface h-1.5 rounded-full cursor-pointer appearance-none outline-none border border-border-subtle"
            />
          </div>

          <button
            onClick={handleSimulate}
            disabled={simulating}
            className="w-full py-2.5 px-4 rounded-md bg-primary-600 hover:bg-primary-500 text-white font-medium text-[13px] flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 shadow-sm mt-2"
          >
            {simulating ? (
              <Activity className="w-4 h-4 animate-pulse" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            <span>{simulating ? 'Processing Pipeline...' : 'Run Forecast Simulation'}</span>
          </button>
        </div>

        {/* Results */}
        <div className="bg-surface border border-border-subtle rounded-xl flex flex-col justify-between overflow-hidden shadow-sm">
          {!simResult ? (
            <div className="h-full flex flex-col items-center justify-center text-text-muted text-center p-8 space-y-4">
              <div className="w-12 h-12 rounded-full bg-panel border border-border-strong flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-text-muted/50" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-text-primary">Ready for Simulation</p>
                <p className="text-[12px] mt-1 text-text-secondary max-w-[200px] mx-auto">Configure your safety guardrails and run the forecast to evaluate impact.</p>
              </div>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col h-full"
            >
              <div className="p-5 flex-1 flex flex-col justify-center border-b border-border-subtle bg-gradient-to-br from-success-900/10 to-transparent">
                <span className="text-[11px] text-text-secondary uppercase tracking-widest font-mono mb-2">Simulated Expected Value</span>
                <div className="text-3xl font-display font-bold text-success-400">
                  {formatINR(simResult.simulated_total_expected_value, true)}
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x divide-border-subtle border-b border-border-subtle">
                <div className="p-4 bg-panel flex flex-col justify-center items-center">
                  <div className="flex items-center space-x-1.5 mb-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-risk-400" />
                    <span className="text-[10px] text-text-muted font-mono tracking-widest uppercase">Policy Blocked</span>
                  </div>
                  <span className="text-xl font-display font-bold text-risk-400">{simResult.blocked_count}</span>
                </div>
                <div className="p-4 bg-panel flex flex-col justify-center items-center">
                  <div className="flex items-center space-x-1.5 mb-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-ai-400" />
                    <span className="text-[10px] text-text-muted font-mono tracking-widest uppercase">Total Evaluated</span>
                  </div>
                  <span className="text-xl font-display font-bold text-text-primary">{simResult.total_transactions}</span>
                </div>
              </div>

              <div className="p-4 bg-surface text-[11px] font-mono">
                <span className="text-text-muted uppercase tracking-widest block mb-2">Action Distribution Forecast</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(simResult.proposed_action_counts).map(([act, cnt]) => (
                    <div key={act} className="flex items-center space-x-1.5 bg-panel border border-border-strong px-2 py-1 rounded">
                      <span className="text-text-secondary uppercase">{act}:</span>
                      <span className="text-text-primary font-bold">{cnt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
