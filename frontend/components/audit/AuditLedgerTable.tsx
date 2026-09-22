'use client';

import React from 'react';
import { History, ShieldCheck, ShieldAlert, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import { formatINR, formatTimeAgo } from '@/lib/format';
import { AuditEvent } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';

interface AuditLedgerTableProps {
  auditLog: AuditEvent[];
}

export const AuditLedgerTable: React.FC<AuditLedgerTableProps> = ({ auditLog }) => {
  return (
    <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
        <div className="flex items-center space-x-3">
          <History strokeWidth={1.75} className="w-4 h-4 text-text-muted shrink-0" />
          <div>
            <h3 className="text-text-primary text-[14px] font-medium tracking-wide">Audit Trail Ledger</h3>
            <p className="text-text-muted text-[12px] mt-0.5">Verifiable, immutable-style record of all decisions, policy gates, & outcomes</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-[12px] font-mono text-text-muted bg-surface px-3 py-1 rounded-full border border-border-subtle shadow-inner">
          <Layers className="w-3.5 h-3.5" />
          <span>{auditLog.length} events logged</span>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="mt-4 overflow-x-auto custom-scrollbar pb-2">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-subtle text-[11px] font-mono text-text-muted uppercase tracking-wider">
              <th className="py-3 px-4 font-medium">Event & Time</th>
              <th className="py-3 px-4 font-medium">Transaction</th>
              <th className="py-3 px-4 font-medium">Event Type</th>
              <th className="py-3 px-4 font-medium">Action</th>
              <th className="py-3 px-4 font-medium">Safety Gate</th>
              <th className="py-3 px-4 font-medium text-right">Outcome</th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {auditLog.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-text-muted border-b border-dashed border-border-subtle">
                  <div className="flex flex-col items-center">
                    <History strokeWidth={1.5} className="w-8 h-8 text-text-muted/50 mb-3" />
                    <span>No audit log entries recorded yet.</span>
                  </div>
                </td>
              </tr>
            ) : (
              <AnimatePresence>
                {auditLog.map((evt, idx) => (
                  <motion.tr
                    key={evt.event_id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, duration: 0.2 }}
                    className="border-b border-border-divider hover:bg-surface/50 transition-colors group"
                  >
                    {/* Event ID & Time */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col space-y-1">
                        <span className="font-mono text-text-primary text-[12px] font-medium tracking-tight truncate max-w-[140px] group-hover:text-primary-400 transition-colors" title={evt.event_id}>
                          {evt.event_id}
                        </span>
                        <span className="text-[11px] text-text-muted">{formatTimeAgo(evt.timestamp)}</span>
                      </div>
                    </td>

                    {/* Transaction */}
                    <td className="py-3.5 px-4 font-mono font-medium text-primary-400 tracking-tight">{evt.transaction_id}</td>

                    {/* Event Type */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center justify-center font-mono text-[10px] font-bold px-2 py-0.5 rounded border tracking-wider uppercase ${
                          evt.event_type === 'ACTION_BLOCKED'
                            ? 'bg-risk-900/20 text-risk-400 border-risk-500/30'
                            : evt.event_type === 'EXECUTION_SUCCEEDED'
                            ? 'bg-success-900/20 text-success-400 border-success-500/30'
                            : evt.event_type === 'ESCALATION_CREATED'
                            ? 'bg-warning-900/20 text-warning-400 border-warning-500/30'
                            : 'bg-surface text-text-secondary border-border-strong'
                        }`}
                      >
                        {evt.event_type.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 capitalize font-medium text-text-primary tracking-tight">{evt.action}</td>

                    {/* Policy Gate */}
                    <td className="py-3.5 px-4">
                      {evt.policy_result?.allowed ? (
                        <span className="inline-flex items-center space-x-1.5 text-[11px] font-medium text-success-400">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Allowed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1.5 text-[11px] font-medium text-risk-400" title={evt.policy_result?.reason}>
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate max-w-[140px]">{evt.policy_result?.reason || 'Blocked'}</span>
                        </span>
                      )}
                    </td>

                    {/* Outcome Amount */}
                    <td className="py-3.5 px-4 text-right">
                      {evt.outcome?.recovered_amount ? (
                        <span className="font-mono font-bold text-success-400 tracking-tight">+{formatINR(evt.outcome.recovered_amount)}</span>
                      ) : (
                        <span className="text-text-muted text-[11px] font-mono uppercase tracking-widest">{evt.outcome?.status || 'recorded'}</span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
