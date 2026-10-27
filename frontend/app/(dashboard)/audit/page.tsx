'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { api } from '@/lib/api';
import { AuditEvent, Decision, Intervention, PolicyLimits, Transaction } from '@/lib/types';
import { AuditHero } from '@/components/audit/AuditHero';
import { AuditMode, AuditToolbar } from '@/components/audit/AuditToolbar';
import { CaseRecord, CaseRecordSheet } from '@/components/audit/CaseRecord';
import { EventStream } from '@/components/audit/EventStream';
import { DecisionExplorer, PolicyAudit, SystemActivity, TransactionView } from '@/components/audit/AuditModeViews';
import {
  EXECUTION_EVENT_TYPES,
  SimilarCases as SimilarResult,
  StageId,
  buildCustody,
  buildImpact,
  buildKpis,
  describeEvent,
  findSimilarCases,
  groupByTransaction,
  matchesSearch,
  pickDefaultTransaction,
} from '@/components/audit/auditSignals';

const STREAM_LIMIT = 500;
const MODE_LIMIT = 250;
const REFRESH_MS = 20000;

interface CaseData {
  txId: string;
  tx: Transaction | null;
  decision: Decision | null;
  /** This transaction's audit events, oldest first. */
  events: AuditEvent[];
}

interface Meta {
  matched: number;
  counts: Record<string, number>;
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const byNewest = (a: AuditEvent, b: AuditEvent) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

export default function AuditPage() {
  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<AuditMode>('timeline');
  const [eventType, setEventType] = useState('');
  const [search, setSearch] = useState('');

  const [events, setEvents] = useState<AuditEvent[]>([]); // newest first
  const [streamMatched, setStreamMatched] = useState<number | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [policy, setPolicy] = useState<PolicyLimits | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [money, setMoney] = useState<{ atRisk: number; recovered: number } | null>(null);
  // Amounts live on transactions, not audit events — filled in for the rows on screen.
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<StageId>('decision');
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [tracing, setTracing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [decisionEvents, setDecisionEvents] = useState<AuditEvent[]>([]);
  const [blockedEvents, setBlockedEvents] = useState<AuditEvent[]>([]);
  const [modeLoading, setModeLoading] = useState(false);
  const [modeTick, setModeTick] = useState(0);

  const [remote, setRemote] = useState<{ query: string; events: AuditEvent[] } | null>(null);
  const [similar, setSimilar] = useState<SimilarResult | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);

  const inFlight = useRef(false);
  const streamSeq = useRef(0);
  const eventTypeRef = useRef(eventType);
  const leakCache = useRef(new Map<string, Map<string, Transaction>>());
  const requestedAmounts = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    eventTypeRef.current = eventType;
  }, [eventType]);

  /* ── core data: the event stream, whole-log counts, live limits, outcomes ── */

  const loadStream = useCallback(async (type: string) => {
    const seq = ++streamSeq.current;
    const res = await api.getAuditTrail({ limit: STREAM_LIMIT, newest_first: true, status: type || undefined });
    // A newer request (e.g. the filter changed again) owns the stream now.
    if (seq !== streamSeq.current) return;
    setEvents(res.entries);
    setStreamMatched(res.matched ?? res.entries.length);
  }, []);

  const loadMeta = useCallback(async () => {
    const kpi = await api.getAuditTrail({ limit: 1 });
    setMeta({ matched: kpi.matched ?? kpi.entries.length, counts: kpi.counts_by_type ?? {} });
    // Best-effort: the page is still useful without these two.
    api.getPolicies().then((p) => {
      setPolicy(p.active_policy);
      setPolicyVersion(p.policy_version);
    }).catch(() => undefined);
    api.getInterventions(1000).then((r) => setInterventions(r.interventions)).catch(() => undefined);
    api.getAnalytics().then((a) => setMoney({ atRisk: a.total_at_risk, recovered: a.total_recovered })).catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Executed transactions already carry their amount on the intervention record.
  const interventionAmounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of interventions) m[i.transaction_id] = i.amount;
    return m;
  }, [interventions]);
  const interventionAmountsRef = useRef(interventionAmounts);
  useEffect(() => {
    interventionAmountsRef.current = interventionAmounts;
  }, [interventionAmounts]);

  // Look up amounts only for the transactions currently on screen, a few at a time, once each.
  const hydrateAmounts = useCallback((ids: string[]) => {
    const todo = ids.filter((id) => !requestedAmounts.current.has(id) && interventionAmountsRef.current[id] == null);
    if (todo.length === 0) return;
    todo.forEach((id) => requestedAmounts.current.add(id));
    const found: Record<string, number> = {};
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        try {
          found[id] = (await api.getTransactionById(id)).amount;
        } catch {
          // Leave the amount blank rather than guess.
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker)).then(() => {
      if (mounted.current && Object.keys(found).length > 0) setAmounts((prev) => ({ ...prev, ...found }));
    });
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!silent) setLoading(true);
      try {
        await Promise.all([loadStream(eventTypeRef.current), loadMeta()]);
        setErrorMsg(null);
        setHasLoadedOnce(true);
        setLastUpdatedAt(new Date());
      } catch {
        if (!silent) setErrorMsg('Unable to load the audit trail.');
      } finally {
        inFlight.current = false;
        if (!silent) setLoading(false);
      }
    },
    [loadStream, loadMeta]
  );

  const handleManualRefresh = useCallback(() => {
    leakCache.current.clear();
    setModeTick((n) => n + 1);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Event-type filter is applied server-side, exactly as before.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setLoading(true);
    loadStream(eventType)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [eventType, loadStream]);

  // The stream refreshes itself while the tab is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(true);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  /* ── default selection: the newest real outcome, else the newest event ── */

  useEffect(() => {
    if (selectedTxId == null && events.length > 0) {
      setSelectedTxId(pickDefaultTransaction(events));
    }
  }, [events, selectedTxId]);

  /* ── trace the selected transaction: record + decision + its own audit events ── */

  const latestEventIdForSelected = useMemo(
    () => (selectedTxId ? events.find((e) => e.transaction_id === selectedTxId)?.event_id ?? null : null),
    [events, selectedTxId]
  );

  useEffect(() => {
    if (!selectedTxId) {
      setCaseData(null);
      return;
    }
    let cancelled = false;
    setTracing(true);
    (async () => {
      try {
        const [tx, trail] = await Promise.all([
          api.getTransactionById(selectedTxId).catch(() => null),
          api.getAuditTrail({ transaction_id: selectedTxId, newest_first: true, limit: 200 }),
        ]);
        const chronological = [...trail.entries].reverse();
        // The decision that was actually executed, if there was an execution; otherwise the latest one.
        const executed = [...chronological].reverse().find((e) => EXECUTION_EVENT_TYPES.includes(e.event_type));
        const decision =
          (executed?.decision_id ? await api.getDecisionById(executed.decision_id).catch(() => null) : null) ??
          (await api.getDecisionById(selectedTxId).catch(() => null));
        if (!cancelled) setCaseData({ txId: selectedTxId, tx, decision, events: chronological });
      } catch {
        if (!cancelled) setCaseData({ txId: selectedTxId, tx: null, decision: null, events: [] });
      } finally {
        if (!cancelled) setTracing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTxId, latestEventIdForSelected]);

  const custody = useMemo(
    () => (caseData ? buildCustody({ tx: caseData.tx, decision: caseData.decision, events: caseData.events, policy }) : null),
    [caseData, policy]
  );
  const impact = useMemo(
    () => (custody && caseData ? buildImpact(custody, caseData.tx, caseData.decision, caseData.events) : null),
    [custody, caseData]
  );

  /* ── similar cases: same leak type, same action, outcome on record ── */

  const leakType = caseData?.tx?.leak_type ?? null;
  const finalAction = custody?.finalAction ?? null;
  const caseTxId = caseData?.txId ?? null;

  useEffect(() => {
    if (!caseTxId || !leakType || !finalAction) {
      setSimilar(null);
      return;
    }
    let cancelled = false;
    setSimilarLoading(true);
    (async () => {
      let map = leakCache.current.get(leakType);
      if (!map) {
        try {
          const list = await api.getTransactions(1000, leakType);
          map = new Map(list.map((t) => [t.transaction_id, t]));
          leakCache.current.set(leakType, map);
        } catch {
          map = new Map();
        }
      }
      if (!cancelled) {
        setSimilar(findSimilarCases(caseTxId, leakType, finalAction, interventions, map));
        setSimilarLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseTxId, leakType, finalAction, interventions]);

  /* ── per-mode data ── */

  useEffect(() => {
    if (mode !== 'decisions' && mode !== 'policy') return;
    let cancelled = false;
    setModeLoading(true);
    (async () => {
      try {
        if (mode === 'decisions') {
          const [ok, blocked] = await Promise.all([
            api.getAuditTrail({ limit: MODE_LIMIT, newest_first: true, status: 'DECISION_CREATED' }),
            api.getAuditTrail({ limit: MODE_LIMIT, newest_first: true, status: 'ACTION_BLOCKED' }),
          ]);
          if (!cancelled) setDecisionEvents([...ok.entries, ...blocked.entries].sort(byNewest));
        } else {
          const blocked = await api.getAuditTrail({ limit: 500, newest_first: true, status: 'ACTION_BLOCKED' });
          if (!cancelled) setBlockedEvents(blocked.entries);
        }
      } catch {
        // Keep whatever was loaded last; the view shows its own empty state.
      } finally {
        if (!cancelled) setModeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, modeTick]);

  /* ── search: client-side over the loaded stream, with an exact full-log lookup as a fallback ── */

  const trimmed = search.trim();
  const localFiltered = useMemo(() => events.filter((e) => matchesSearch(e, trimmed)), [events, trimmed]);

  useEffect(() => {
    if (trimmed.length < 4 || localFiltered.length > 0) {
      setRemote(null);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const res = await api.getAuditTrail({ transaction_id: trimmed, newest_first: true, limit: 100 });
        setRemote(res.entries.length > 0 ? { query: trimmed, events: res.entries } : null);
      } catch {
        setRemote(null);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [trimmed, localFiltered.length]);

  const showRemote = trimmed !== '' && localFiltered.length === 0 && remote != null && remote.query === trimmed;
  const displayedEvents = showRemote ? remote.events : localFiltered;
  const groups = useMemo(() => groupByTransaction(displayedEvents), [displayedEvents]);
  const decisionRows = useMemo(() => decisionEvents.filter((e) => matchesSearch(e, trimmed)), [decisionEvents, trimmed]);

  const kpis = useMemo(() => (meta ? buildKpis(meta.matched, meta.counts) : null), [meta]);

  /* ── interactions ── */

  // Below desktop width the record opens as a bottom sheet; at desktop width it is already beside the ledger.
  const openRecordIfSheet = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches) setSheetOpen(true);
  }, []);

  const handleOpen = useCallback(
    (txId: string, stage: StageId) => {
      setSelectedTxId(txId);
      setSelectedStage(stage);
      setMode('timeline');
      openRecordIfSheet();
    },
    [openRecordIfSheet]
  );

  const handleSelectEvent = useCallback(
    (evt: AuditEvent) => {
      setSelectedTxId(evt.transaction_id);
      setSelectedStage(describeEvent(evt).stage);
      openRecordIfSheet();
    },
    [openRecordIfSheet]
  );

  const initialLoading = !hasLoadedOnce && !errorMsg;
  const logEmpty = hasLoadedOnce && meta != null && meta.matched === 0;
  const filtersActive = trimmed !== '' || eventType !== '';

  const record = {
    txId: caseData?.txId ?? selectedTxId,
    tx: caseData?.tx ?? null,
    decision: caseData?.decision ?? null,
    events: caseData?.events ?? [],
    custody,
    impact,
    policy,
    focusStage: selectedStage,
    tracing: tracing || initialLoading,
    similar,
    similarLoading,
    onOpenCase: (id: string) => handleOpen(id, 'decision'),
  };

  // What the ledger can show for each row: executed amounts, looked-up amounts, and the open case.
  const knownAmounts = useMemo(
    () => ({ ...interventionAmounts, ...amounts, ...(caseData?.tx ? { [caseData.tx.transaction_id]: caseData.tx.amount } : {}) }),
    [interventionAmounts, amounts, caseData]
  );

  const authorizedTotal = meta?.counts.DECISION_CREATED ?? 0;
  const blockedTotal = meta?.counts.ACTION_BLOCKED ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
      <AuditHero kpis={kpis} money={money} loading={initialLoading} />

      {errorMsg && !hasLoadedOnce ? (
        <div className="bg-panel border border-border-subtle rounded-lg shadow-panel py-16 px-6 text-center">
          <CircleAlert strokeWidth={1.5} className="w-8 h-8 text-risk-300/70 mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">Unable to load the audit trail</p>
          <p className="text-xs text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
            REVORA couldn&apos;t reach the recovery service. Check that the service is running, then try again.
          </p>
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="mt-4 px-4 py-2 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Retrying...' : 'Try again'}
          </button>
        </div>
      ) : (
        <>
          <AuditToolbar
            mode={mode}
            onMode={setMode}
            search={search}
            onSearch={setSearch}
            eventType={eventType}
            onEventType={setEventType}
            loading={loading}
            onRefresh={handleManualRefresh}
            updatedLabel={lastUpdatedAt && !loading ? `Updated ${timeAgo(lastUpdatedAt)}` : null}
          />

          <motion.div key={mode} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            {mode === 'timeline' && (
              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_460px] min-[1536px]:grid-cols-[minmax(0,1fr)_520px]">
                <div className="min-w-0">
                  <EventStream
                    events={displayedEvents}
                    matched={showRemote ? null : streamMatched}
                    windowCount={events.length}
                    searching={trimmed !== '' && !showRemote}
                    selectedTxId={selectedTxId}
                    onSelect={handleSelectEvent}
                    loading={initialLoading}
                    logEmpty={logEmpty}
                    filtersActive={filtersActive}
                    remoteQuery={showRemote ? remote.query : null}
                    autoRefresh={hasLoadedOnce}
                    amounts={knownAmounts}
                    onNeedAmounts={hydrateAmounts}
                  />
                </div>

                <div className="hidden min-w-0 xl:sticky xl:top-4 xl:block">
                  <CaseRecord {...record} />
                </div>
              </div>
            )}

            {mode === 'transactions' && (
              <TransactionView groups={groups} loadedCount={displayedEvents.length} loading={initialLoading} logEmpty={logEmpty} selectedTxId={selectedTxId} onOpen={handleOpen} />
            )}

            {mode === 'decisions' && (
              <DecisionExplorer events={decisionRows} authorizedTotal={authorizedTotal} blockedTotal={blockedTotal} loading={modeLoading} onOpen={handleOpen} />
            )}

            {mode === 'policy' && (
              <PolicyAudit
                blocked={blockedEvents}
                blockedTotal={blockedTotal}
                authorizedTotal={authorizedTotal}
                policy={policy}
                policyVersion={policyVersion}
                loading={modeLoading}
                onOpen={handleOpen}
              />
            )}

            {mode === 'system' && <SystemActivity counts={meta?.counts ?? {}} total={meta?.matched ?? 0} loaded={events} />}
          </motion.div>

          <CaseRecordSheet {...record} open={sheetOpen} onClose={() => setSheetOpen(false)} />
        </>
      )}
    </div>
  );
}
