'use client';

import React from 'react';
import { Network, Cpu, Sparkles, ShieldCheck, Zap, ArrowRight } from 'lucide-react';
import { AnalyzeResponse } from '@/lib/types';
import { motion } from 'framer-motion';

interface BrainPanelProps {
  analyzeData: AnalyzeResponse | null;
}

export const BrainPanel: React.FC<BrainPanelProps> = ({ analyzeData }) => {
  const proposedCounts = analyzeData?.proposed_action_counts || {};

  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between h-full">
      {/* Background Accent */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-ai-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border-subtle relative z-10">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-ai-400">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-text-primary text-[14px] font-medium tracking-wide flex items-center space-x-2">
                <span>REVORA Intelligence</span>
                <span className="text-[10px] font-mono bg-ai-500/10 text-ai-400 px-1.5 py-0.5 rounded border border-ai-500/20">
                  CORE-V2
                </span>
              </h3>
              <p className="text-text-muted text-[12px] mt-0.5">Autonomous Decision Engine</p>
            </div>
          </div>
          <Cpu className="w-4 h-4 text-ai-500/50" />
        </div>

        {/* Diagnostic Summary */}
        <div className="mt-5 p-3.5 rounded-lg bg-surface border border-border-subtle text-[13px] text-text-secondary leading-relaxed relative z-10 flex items-start space-x-3">
          <Sparkles className="w-4 h-4 text-ai-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-text-primary">Diagnostic Synthesis: </span>
            {analyzeData?.explanation || 'Awaiting intelligence pass to generate predictive diagnostic summary for the current risk universe.'}
          </div>
        </div>

        {/* Pipeline Visualization */}
        <div className="mt-6 relative z-10">
          <h4 className="text-[11px] font-mono text-text-muted uppercase tracking-widest mb-4">Decision Pipeline</h4>
          <div className="flex items-center justify-between">
            {/* Step 1: Signals */}
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-panel-raised border border-border-strong flex items-center justify-center text-text-muted shadow-sm z-10 relative">
                <ActivityIcon />
              </div>
              <span className="text-[10px] text-text-muted mt-2 font-medium">Signals</span>
            </div>
            
            <div className="flex-1 h-px bg-border-strong mx-2 relative">
              {analyzeData && (
                <motion.div 
                  className="absolute top-0 left-0 h-full bg-ai-500/50" 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1, ease: 'linear', repeat: Infinity }}
                />
              )}
            </div>

            {/* Step 2: Detection */}
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm z-10 relative transition-colors ${analyzeData ? 'bg-ai-900/40 border border-ai-500/40 text-ai-400' : 'bg-panel-raised border border-border-strong text-text-muted'}`}>
                <Network className="w-3.5 h-3.5" />
              </div>
              <span className={`text-[10px] mt-2 font-medium transition-colors ${analyzeData ? 'text-ai-400' : 'text-text-muted'}`}>Detection</span>
            </div>

            <div className="flex-1 h-px bg-border-strong mx-2 relative">
              {analyzeData && (
                <motion.div 
                  className="absolute top-0 left-0 h-full bg-primary-500/50" 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1, delay: 0.2, ease: 'linear', repeat: Infinity }}
                />
              )}
            </div>

            {/* Step 3: Safety */}
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm z-10 relative transition-colors ${analyzeData ? 'bg-primary-900/40 border border-primary-500/40 text-primary-400' : 'bg-panel-raised border border-border-strong text-text-muted'}`}>
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <span className={`text-[10px] mt-2 font-medium transition-colors ${analyzeData ? 'text-primary-400' : 'text-text-muted'}`}>Safety</span>
            </div>

            <div className="flex-1 h-px bg-border-strong mx-2 relative">
              {analyzeData && (
                <motion.div 
                  className="absolute top-0 left-0 h-full bg-success-500/50" 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1, delay: 0.4, ease: 'linear', repeat: Infinity }}
                />
              )}
            </div>

            {/* Step 4: Action */}
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm z-10 relative transition-colors ${analyzeData ? 'bg-success-900/40 border border-success-500/40 text-success-400' : 'bg-panel-raised border border-border-strong text-text-muted'}`}>
                <Zap className="w-3.5 h-3.5" />
              </div>
              <span className={`text-[10px] mt-2 font-medium transition-colors ${analyzeData ? 'text-success-400' : 'text-text-muted'}`}>Action</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Breakdown Summary */}
      <div className="mt-8 pt-4 border-t border-border-subtle grid grid-cols-3 gap-3 text-center relative z-10">
        <div className="flex flex-col p-2.5 rounded-lg bg-surface border border-border-subtle">
          <span className="text-[11px] text-text-muted font-medium mb-1">Retries</span>
          <span className="font-display font-semibold text-lg text-primary-400">{proposedCounts['retry'] || 0}</span>
        </div>
        <div className="flex flex-col p-2.5 rounded-lg bg-surface border border-border-subtle">
          <span className="text-[11px] text-text-muted font-medium mb-1">Escalated</span>
          <span className="font-display font-semibold text-lg text-warning-400">{proposedCounts['escalate'] || 0}</span>
        </div>
        <div className="flex flex-col p-2.5 rounded-lg bg-surface border border-border-subtle">
          <span className="text-[11px] text-text-muted font-medium mb-1">Suppressed</span>
          <span className="font-display font-semibold text-lg text-text-secondary">{proposedCounts['suppress'] || 0}</span>
        </div>
      </div>
    </div>
  );
};

function ActivityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>
  );
}
