'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { RevenueFlowSystem } from '@/components/flow/RevenueFlowSystem';
import { RevoraMissionLog } from '@/components/recovery-brain/RevoraMissionLog';
import { RecoveryStatusPanel } from '@/components/kpi/RecoveryStatusPanel';
import { NeedsAttention } from '@/components/attention/NeedsAttention';
import { TopOpportunities } from '@/components/opportunities/TopOpportunities';
import { ActionBlockedWow } from '@/components/action-blocked/ActionBlockedWow';
import { LiveActivityFeed } from '@/components/live-activity/LiveActivityFeed';
import { AuditLedgerTable } from '@/components/audit/AuditLedgerTable';
import { RecoverySimulator } from '@/components/simulator/RecoverySimulator';
import { TransactionDrawer } from '@/components/drawer/TransactionDrawer';
import { api } from '@/lib/api';
import {
  ScanResponse,
  AnalyzeResponse,
  RecoverResponse,
  Opportunity,
  AuditEvent,
  PolicyLimits,
} from '@/lib/types';

export default function MissionControlPage() {
  const router = useRouter();
  const [scanData, setScanData] = useState<ScanResponse | null>(null);
  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
  const [recoverData, setRecoverData] = useState<RecoverResponse | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [policyLimits, setPolicyLimits] = useState<PolicyLimits | null>(null);
  const [escalationsCount, setEscalationsCount] = useState<number>(0);

  const [isRecovering, setIsRecovering] = useState<boolean>(false);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [highlightLeakType, setHighlightLeakType] = useState<string | null>(null);

  // The signature "follow the money" interaction: illuminate the risk
  // stream the opportunity came from, let that register for a beat, then
  // open the existing Transaction Deep Dive — a traced path, not a table click.
  const handleFollowOpportunity = useCallback((opp: Opportunity) => {
    setHighlightLeakType(opp.leak_type);
    window.setTimeout(() => setSelectedTxId(opp.transaction_id), 380);
    window.setTimeout(() => setHighlightLeakType(null), 1600);
  }, []);

  const loadBackendData = useCallback(async () => {
    try {
      setErrorMsg(null);
      const [opps, audit, pol, escalations] = await Promise.all([
        api.getOpportunities(15).catch(() => []),
        api.getAuditLog(100).catch(() => ({ total: 0, entries: [] })),
        api.getPolicies().catch(() => null),
        api.getEscalations(50).catch(() => ({ total: 0, escalations: [] })),
      ]);
      setOpportunities(opps);
      setAuditLog(audit.entries);
      if (pol) setPolicyLimits(pol.active_policy);
      setEscalationsCount(escalations.total ?? escalations.escalations?.length ?? 0);
    } catch (err: unknown) {
      console.error('Data Load Error:', err);
    }
  }, []);

  const handleBatchRecover = async () => {
    setIsRecovering(true);
    setErrorMsg(null);
    try {
      const recRes = await api.recoverRevenue();
      setRecoverData(recRes);
      await loadBackendData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(`Batch Recovery Failed: ${msg}`);
    } finally {
      setIsRecovering(false);
    }
  };

  useEffect(() => {
    const initBoot = async () => {
      try {
        const scanRes = await api.scanRevenue(100, 42);
        setScanData(scanRes);
        const analyzeRes = await api.analyzeRevenue();
        setAnalyzeData(analyzeRes);
        await loadBackendData();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Init Boot Error:', err);
        setErrorMsg(`Connecting to REVORA backend on http://localhost:8000... (${msg})`);
      }
    };

    initBoot();
  }, [loadBackendData]);

  const reduceMotion = useReducedMotion();
  const stagger = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduceMotion ? 0 : 0.05,
        delayChildren: reduceMotion ? 0 : 0.1,
      },
    },
  };
  const item = {
    hidden: reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] } },
  };

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full"
      variants={stagger}
      initial="hidden"
      animate="show"
    >
      {/* Error Banner */}
      {errorMsg && (
        <div className="p-3 rounded bg-risk-muted border border-risk-500/40 text-risk-300 text-xs font-mono flex items-center justify-between">
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Section Title */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary tracking-tight">Revenue Command</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Where revenue is at risk, what REVORA is doing about it, and what&apos;s safe to execute.
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono font-semibold">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isRecovering ? 'bg-primary-400 animate-pulse' : analyzeData ? 'bg-success-400' : 'bg-text-muted'
            }`}
          />
          <span className={isRecovering ? 'text-primary-300' : analyzeData ? 'text-success-300' : 'text-text-muted'}>
            {isRecovering ? 'RECOVERING' : analyzeData ? 'SYSTEM READY' : 'STANDING BY'}
          </span>
        </div>
      </motion.div>

      {/* 1. The signature flow — revenue in motion, risk to REVORA to recovery */}
      <motion.div variants={item} className="py-2">
        <RevenueFlowSystem
          scanData={scanData}
          analyzeData={analyzeData}
          recoverData={recoverData}
          onSelectCategory={(leakType) => router.push(`/transactions?leak_type=${leakType}`)}
          highlightLeakType={highlightLeakType}
        />
      </motion.div>

      {/* 2. What REVORA is doing — the operational feed */}
      <motion.div variants={item} className="py-1">
        <RevoraMissionLog opportunities={opportunities} auditLog={auditLog} />
      </motion.div>

      {/* 3. What needs attention & what's safe to execute */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-stretch">
        <NeedsAttention
          opportunities={opportunities}
          policyBlockedCount={analyzeData?.policy_blocked_count || 0}
          escalationsCount={escalationsCount}
          onFollowOpportunity={handleFollowOpportunity}
        />
        <RecoveryStatusPanel
          analyzeData={analyzeData}
          recoverData={recoverData}
          onRunBatchRecover={handleBatchRecover}
          isRecovering={isRecovering}
        />
      </motion.div>

      {/* 4. Top Recovery Opportunities */}
      <motion.div variants={item} id="opportunities">
        <TopOpportunities
          opportunities={opportunities}
          onSelectTransaction={(id) => setSelectedTxId(id)}
          onRefresh={loadBackendData}
        />
      </motion.div>

      {/* 5. Action Blocked WOW Moment Panel */}
      <motion.div variants={item}>
        <ActionBlockedWow onRefresh={loadBackendData} />
      </motion.div>

      {/* 6. Tertiary Grid: Live Activity Feed & Recovery Simulator */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LiveActivityFeed events={auditLog} />
        <RecoverySimulator initialPolicy={policyLimits} />
      </motion.div>

      {/* 7. Audit Trail Ledger */}
      <motion.div variants={item}>
        <AuditLedgerTable auditLog={auditLog} />
      </motion.div>

      {/* Transaction Deep Dive Drawer */}
      <TransactionDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onRefresh={loadBackendData}
      />
    </motion.div>
  );
}
