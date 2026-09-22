'use client';

import React from 'react';
import { Activity, CheckCircle2, AlertTriangle, ShieldCheck, Clock } from 'lucide-react';
import { formatINR, formatTimeAgo } from '@/lib/format';
import { AuditEvent } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';

interface LiveActivityFeedProps {
  events: AuditEvent[];
}

export const LiveActivityFeed: React.FC<LiveActivityFeedProps> = ({ events }) => {
  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-surface border border-border-subtle flex items-center justify-center text-primary-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Live Recovery Activity</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Real-time operational action & recovery feed</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 px-2 py-1 bg-primary-500/10 rounded-full border border-primary-500/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-500"></span>
          </span>
          <span className="text-[10px] uppercase font-mono font-medium text-primary-400">LIVE</span>
        </div>
      </div>

      {/* Activity Feed List */}
      <div className="mt-4 space-y-3 max-h-[22rem] overflow-y-auto pr-2 custom-scrollbar flex-1">
        {events.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center border border-dashed border-border-subtle rounded-lg">
            <Activity className="w-8 h-8 text-text-muted/50 mb-3" />
            <span className="text-[13px] text-text-muted">No live activity recorded yet.</span>
            <span className="text-[11px] text-text-muted mt-1">Execute an intervention to populate feed.</span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {events.map((evt) => {
              const isSuccess = evt.outcome?.recovered || evt.event_type === 'EXECUTION_SUCCEEDED';
              const isBlocked = evt.event_type === 'ACTION_BLOCKED';
              const isEscalated = evt.action === 'escalate' || evt.event_type === 'ESCALATION_CREATED';

              return (
                <motion.div
                  key={evt.event_id}
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  className="group p-3 rounded-lg bg-surface border border-border-subtle hover:border-border-strong flex items-center justify-between transition-colors shadow-sm"
                >
                  <div className="flex items-center space-x-3.5">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105 ${
                        isSuccess
                          ? 'bg-success-900/40 text-success-400 border border-success-500/30'
                          : isBlocked
                          ? 'bg-risk-900/40 text-risk-400 border border-risk-500/30'
                          : isEscalated
                          ? 'bg-warning-900/40 text-warning-400 border border-warning-500/30'
                          : 'bg-primary-900/40 text-primary-400 border border-primary-500/30'
                      }`}
                    >
                      {isSuccess ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : isBlocked ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                    </div>

                    <div className="flex flex-col space-y-0.5">
                      <div className="flex items-center space-x-2 font-mono">
                        <span className="text-text-primary font-medium text-[13px]">{evt.transaction_id}</span>
                        <span className="text-[10px] uppercase font-sans font-semibold px-1.5 py-0.5 rounded bg-panel border border-border-subtle text-text-secondary">
                          {evt.action}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted flex items-center space-x-1.5">
                        <Clock className="w-3 h-3 opacity-70" />
                        <span>{formatTimeAgo(evt.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  {evt.outcome?.recovered_amount ? (
                    <div className="text-right flex flex-col items-end justify-center">
                      <span className="font-mono font-semibold text-[14px] text-success-400 tracking-tight">
                        +{formatINR(evt.outcome.recovered_amount)}
                      </span>
                      <span className="text-[10px] text-success-500/70 font-medium uppercase mt-0.5">Recovered</span>
                    </div>
                  ) : (
                    <div className="text-right text-[11px] font-mono font-medium text-text-muted uppercase max-w-[100px] leading-tight flex items-center h-full">
                      {evt.event_type.replace('_', ' ')}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
