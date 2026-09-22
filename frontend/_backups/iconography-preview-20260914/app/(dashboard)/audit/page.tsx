'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileSpreadsheet, RefreshCw, ShieldCheck, ShieldAlert, Search, ChevronDown, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { AuditEvent } from '@/lib/types';
import { formatINR, formatTimeAgo } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';

const EVENT_TYPES = [
  '', 'DECISION_CREATED', 'ACTION_BLOCKED', 'EXECUTION_SUCCEEDED',
  'EXECUTION_FAILED', 'ESCALATION_CREATED', 'SUPPRESSION_CREATED',
];

export default function AuditPage() {
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');

  const loadAuditLog = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getAuditLog(1000, undefined, eventTypeFilter || undefined);
      setAuditLog(res.entries);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Failed to load audit log: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [eventTypeFilter]);

  useEffect(() => {
    loadAuditLog();
  }, [loadAuditLog]);

  const filtered = auditLog.filter((evt) =>
    search === '' ||
    evt.event_id.toLowerCase().includes(search.toLowerCase()) ||
    evt.transaction_id.toLowerCase().includes(search.toLowerCase()) ||
    evt.action.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 rounded-xl bg-surface border border-border-strong flex items-center justify-center text-text-secondary shadow-sm">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Audit Trail Ledger</h2>
            <p className="text-[13px] text-text-muted mt-0.5">Verifiable, immutable-style record of all decisions, policy gates & outcomes</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-[12px] font-mono text-text-muted bg-surface px-3 py-1 rounded-full border border-border-subtle shadow-inner mr-2 hidden sm:flex">
            <Layers className="w-3.5 h-3.5" />
            <span>{filtered.length} entries</span>
          </div>
          <button
            id="btn-refresh-audit"
            onClick={loadAuditLog}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-surface border border-border-strong text-text-primary hover:bg-panel-hover text-[12px] font-medium flex items-center space-x-2 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-lg bg-risk-900/20 border border-risk-500/40 text-risk-400 text-[13px] font-medium flex items-center">{errorMsg}</div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            id="input-audit-search"
            type="text"
            placeholder="Search by Event ID, Transaction ID, Action..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-panel border border-border-strong rounded-lg text-[13px] text-text-primary placeholder:text-text-muted/70 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/50 transition-all font-mono"
          />
        </div>
        <div className="relative">
          <select
            id="select-event-type"
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2.5 bg-panel border border-border-strong rounded-lg text-[13px] text-text-primary focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/50 transition-all font-mono w-full sm:w-auto"
          >
            <option value="">All Event Types</option>
            {EVENT_TYPES.slice(1).map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-panel border border-border-strong rounded-xl shadow-sm overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-subtle text-[11px] font-mono text-text-muted uppercase tracking-wider bg-surface/50">
              <th className="py-4 px-5 font-medium">Event & Timestamp</th>
              <th className="py-4 px-5 font-medium">Transaction</th>
              <th className="py-4 px-5 font-medium">Event Type</th>
              <th className="py-4 px-5 font-medium">Action</th>
              <th className="py-4 px-5 font-medium">Safety Gate</th>
              <th className="py-4 px-5 font-medium">Intelligence</th>
              <th className="py-4 px-5 font-medium text-right">Outcome</th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-text-muted">
                  <div className="flex flex-col items-center justify-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-primary-400/50 mb-3" />
                    <span>Loading audit ledger...</span>
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center font-sans">
                  <div className="flex flex-col items-center justify-center">
                    <FileSpreadsheet className="w-10 h-10 text-text-muted/40 mb-3" />
                    <p className="text-text-muted text-[13px]">
                      {auditLog.length === 0
                        ? 'No audit events recorded yet. Run a scan and batch recovery to populate the audit trail.'
                        : 'No events match your search parameters.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              <AnimatePresence>
                {filtered.slice(0, 500).map((evt, idx) => (
                  <motion.tr
                    key={evt.event_id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.5), duration: 0.2 }}
                    className="border-b border-border-divider hover:bg-surface/50 transition-colors group"
                  >
                    {/* Event ID & Time */}
                    <td className="py-3.5 px-5">
                      <div className="flex flex-col space-y-1">
                        <div className="text-text-primary text-[12px] font-medium font-mono truncate max-w-[120px] group-hover:text-primary-400 transition-colors" title={evt.event_id}>{evt.event_id}</div>
                        <div className="text-[11px] text-text-muted">{formatTimeAgo(evt.timestamp)}</div>
                      </div>
                    </td>

                    {/* Transaction ID */}
                    <td className="py-3.5 px-5 font-mono font-medium text-primary-400 tracking-tight">
                      {evt.transaction_id}
                    </td>

                    {/* Event Type */}
                    <td className="py-3.5 px-5">
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
                    <td className="py-3.5 px-5 capitalize font-medium text-text-primary tracking-tight">
                      {evt.action}
                    </td>

                    {/* Policy Gate */}
                    <td className="py-3.5 px-5">
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

                    {/* Model / Provider */}
                    <td className="py-3.5 px-5">
                      <div className="flex flex-col space-y-1 text-[11px] font-mono text-text-muted">
                        <span>{evt.model_version}</span>
                        <span className="uppercase text-text-secondary">{evt.provider}</span>
                      </div>
                    </td>

                    {/* Outcome */}
                    <td className="py-3.5 px-5 text-right">
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
        {filtered.length > 500 && (
          <div className="px-5 py-3 border-t border-border-divider text-[11px] text-text-muted font-mono bg-surface/30">
            Showing first 500 of {filtered.length} entries.
          </div>
        )}
      </div>
    </div>
  );
}
