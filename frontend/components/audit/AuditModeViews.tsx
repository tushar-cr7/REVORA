'use client';

import React, { useMemo } from 'react';
import { ChevronRight, History } from 'lucide-react';
import { AuditEvent, PolicyLimits } from '@/lib/types';
import { formatTimeAgo } from '@/lib/format';
import { actionLabel } from '@/lib/actionMeta';
import { StateIndicator } from '@/components/grammar';
import { SplitBar } from './SplitBar';
import {
  EVENT_TYPE_OPTIONS,
  StageId,
  TONE,
  Tone,
  TransactionGroup,
  describeEvent,
  formatCount,
  formatDateTime,
  humanize,
  providerLabel,
  ruleCatalog,
  ruleFromReason,
} from './auditSignals';

type Open = (transactionId: string, stage: StageId) => void;

/* ────────────────────────────── shared ────────────────────────────── */

const Panel: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, right, children }) => (
  <section className="rv-surface min-w-0 overflow-hidden">
    <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
      <div className="min-w-0">
        <h3 className="rv-section-title">{title}</h3>
        {subtitle && <p className="rv-meta mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </header>
    {children}
  </section>
);

const Empty: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="py-12 px-6 text-center">
    <History strokeWidth={1.5} className="w-9 h-9 text-text-muted/40 mx-auto mb-3" />
    <p className="text-[13px] font-medium text-text-primary">{title}</p>
    <p className="text-[12px] text-text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">{body}</p>
  </div>
);

const Loading: React.FC = () => (
  <div className="p-4 space-y-3 animate-pulse">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="h-9 rounded bg-border-subtle" />
    ))}
  </div>
);

const Chip: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => <StateIndicator chip label={children} tone={tone} />;

/** A figure that sits on the page, not in a tile: number over a one-line meaning. */
const Figure: React.FC<{ label: string; value: string; tone: Tone }> = ({ label, value, tone }) => (
  <div className="min-w-0">
    <div className={`rv-amount rv-amount--md ${tone === 'neutral' ? '' : TONE[tone].text}`}>{value}</div>
    <div className="rv-meta mt-1.5">{label}</div>
  </div>
);

function verdictOf(evt: AuditEvent): { text: string; tone: Tone; final: string } {
  if (evt.event_type === 'ACTION_BLOCKED') {
    const final = evt.policy_result?.final_action ?? 'suppress';
    return final === 'escalate' ? { text: 'Rerouted to humans', tone: 'warning', final } : { text: 'Blocked', tone: 'risk', final };
  }
  return { text: 'Authorized', tone: 'success', final: evt.action };
}

/* ────────────────────────────── Transaction View ────────────────────────────── */

export const TransactionView: React.FC<{
  groups: TransactionGroup[];
  loadedCount: number;
  loading: boolean;
  logEmpty: boolean;
  selectedTxId: string | null;
  onOpen: Open;
}> = ({ groups, loadedCount, loading, logEmpty, selectedTxId, onOpen }) => (
  <Panel title="Transactions" subtitle={`Grouped from the latest ${formatCount(loadedCount)} audit events — most recently active first.`}>
    {loading && groups.length === 0 ? (
      <Loading />
    ) : groups.length === 0 ? (
      logEmpty ? (
        <Empty title="No audit events recorded yet" body="Scan your revenue and run an intelligence pass — every decision and action is written to the trail as it happens." />
      ) : (
        <Empty title="No transactions to show" body="No audit events match the current search or filter." />
      )
    ) : (
      <>
        <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_80px_110px_24px] gap-3 px-4 py-2 border-b border-border-divider text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted">
          <span>Transaction</span>
          <span>Latest event</span>
          <span className="text-right">Events</span>
          <span className="text-right">Last activity</span>
          <span />
        </div>
        <ul className="max-h-[620px] overflow-y-auto custom-scrollbar">
          {groups.slice(0, 120).map((g) => {
            const v = describeEvent(g.latest);
            return (
              <li key={g.transactionId}>
                <button
                  onClick={() => onOpen(g.transactionId, v.stage)}
                  aria-current={g.transactionId === selectedTxId ? 'true' : undefined}
                  className="w-full text-left grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_80px_110px_24px] items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-border-divider hover:bg-surface/70 transition-colors focus:outline-none focus-visible:bg-panel-hover"
                >
                  <span className="font-mono text-[12.5px] text-text-primary truncate">{g.transactionId}</span>
                  <span className="flex items-center gap-2 min-w-0 order-3 md:order-none col-span-2 md:col-span-1">
                    <span className="w-[92px] shrink-0">{v.chip && <Chip tone={v.chip.tone}>{v.chip.text}</Chip>}</span>
                    <span className="text-[12px] text-text-secondary truncate">{v.title}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[12px] text-text-secondary md:text-right">{g.count} {g.count === 1 ? 'event' : 'events'}</span>
                  <span className="hidden md:block text-[11px] text-text-muted text-right">{formatTimeAgo(g.latest.timestamp)}</span>
                  <ChevronRight className="hidden md:block w-3.5 h-3.5 text-text-disabled" />
                </button>
              </li>
            );
          })}
        </ul>
      </>
    )}
  </Panel>
);

/* ────────────────────────────── Decision Explorer ────────────────────────────── */

function tallyActions(events: AuditEvent[], type: string): { n: number; rows: [string, number][] } {
  const counts = new Map<string, number>();
  let n = 0;
  for (const e of events) {
    if (e.event_type !== type) continue;
    counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    n += 1;
  }
  return { n, rows: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]) };
}

export const DecisionExplorer: React.FC<{
  events: AuditEvent[];
  authorizedTotal: number;
  blockedTotal: number;
  loading: boolean;
  onOpen: Open;
}> = ({ events, authorizedTotal, blockedTotal, loading, onOpen }) => {
  const total = authorizedTotal + blockedTotal;
  const overrideShare = total > 0 ? blockedTotal / total : 0;

  // Kept as two separate tallies: the loaded sample takes the newest decisions of each kind, so a
  // blended share across both would not reflect the real authorized/overridden split.
  const authorizedMix = useMemo(() => tallyActions(events, 'DECISION_CREATED'), [events]);
  const overriddenMix = useMemo(() => tallyActions(events, 'ACTION_BLOCKED'), [events]);

  return (
    <div className="space-y-4">
      <Panel title="AI recommends. Rules authorize." subtitle="Every decision REVORA's intelligence proposed, and what the recovery controls did with it.">
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <Figure label="Decisions recorded" value={formatCount(total)} tone="neutral" />
            <Figure label="of which authorized as proposed" value={formatCount(authorizedTotal)} tone="success" />
            <Figure
              label={total > 0 ? `of which overridden by rules · ${(overrideShare * 100).toFixed(1)}%` : 'of which overridden by rules'}
              value={formatCount(blockedTotal)}
              tone="risk"
            />
          </div>
          <SplitBar
            wide
            parts={[
              { key: 'authorized', value: authorizedTotal, tone: 'success', label: `${formatCount(authorizedTotal)} authorized as proposed` },
              { key: 'overridden', value: blockedTotal, tone: 'risk', label: `${formatCount(blockedTotal)} overridden by rules` },
            ]}
          />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] items-start">
        <Panel title="Decisions" subtitle={`The latest ${formatCount(events.length)} decisions, newest first.`}>
          {loading && events.length === 0 ? (
            <Loading />
          ) : events.length === 0 ? (
            <Empty title="No decisions match" body="Run an intelligence pass to create decisions, or clear the search." />
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] gap-3 px-4 py-2 border-b border-border-divider text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted">
                <span>Transaction</span>
                <span>AI proposed</span>
                <span>Rules verdict</span>
                <span>Final action</span>
              </div>
              <ul className="max-h-[560px] overflow-y-auto custom-scrollbar">
                {events.slice(0, 150).map((e) => {
                  const v = verdictOf(e);
                  return (
                    <li key={e.event_id}>
                      <button
                        onClick={() => onOpen(e.transaction_id, 'policy')}
                        className="w-full text-left grid grid-cols-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 border-b border-border-divider hover:bg-surface/70 transition-colors focus:outline-none focus-visible:bg-panel-hover"
                      >
                        <span className="font-mono text-[12px] text-text-primary truncate">{e.transaction_id}</span>
                        <span className="text-[12px] text-ai-300 truncate">{actionLabel(e.action)}</span>
                        <span className="min-w-0">
                          <Chip tone={v.tone}>{v.text}</Chip>
                        </span>
                        <span className="text-[12px] text-text-primary truncate">{actionLabel(v.final)}</span>
                        {e.event_type === 'ACTION_BLOCKED' && e.policy_result?.reason && (
                          <span className="col-span-2 md:col-span-4 text-[11px] text-text-muted leading-snug">{e.policy_result.reason}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="What the AI proposes" subtitle="Proposed actions, split by what the rules did with them.">
          {events.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-text-muted">No decisions loaded.</p>
          ) : (
            <div className="p-4 space-y-5">
              <MixList title="Authorized" tone="success" sample={authorizedMix} />
              <MixList title="Overridden by rules" tone="risk" sample={overriddenMix} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

const MixList: React.FC<{ title: string; tone: Tone; sample: { n: number; rows: [string, number][] } }> = ({ title, tone, sample }) => {
  const max = sample.rows.length ? sample.rows[0][1] : 1;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <Chip tone={tone}>{title}</Chip>
        <span className="text-[10px] font-mono text-text-muted">latest {formatCount(sample.n)}</span>
      </div>
      {sample.rows.length === 0 ? (
        <p className="text-[11.5px] text-text-muted">None in the loaded decisions.</p>
      ) : (
        <div className="space-y-2.5">
          {sample.rows.map(([action, n]) => (
            <div key={action}>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-text-secondary">{actionLabel(action)}</span>
                <span className="font-mono tabular-nums text-text-muted">{formatCount(n)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-border-subtle overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, (n / max) * 100)}%`, backgroundColor: TONE[tone].hex, opacity: 0.8 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ────────────────────────────── Policy Audit ────────────────────────────── */

export const PolicyAudit: React.FC<{
  blocked: AuditEvent[];
  blockedTotal: number;
  authorizedTotal: number;
  policy: PolicyLimits | null;
  policyVersion: string | null;
  loading: boolean;
  onOpen: Open;
}> = ({ blocked, blockedTotal, authorizedTotal, policy, policyVersion, loading, onOpen }) => {
  const catalog = useMemo(() => ruleCatalog(policy), [policy]);

  const byRule = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of blocked) {
      const key = ruleFromReason(e.policy_result?.reason ?? '').key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [blocked]);
  const maxCount = Math.max(1, ...Array.from(byRule.values()));
  const otherCount = byRule.get('other') ?? 0;
  const sampled = blocked.length < blockedTotal;

  return (
    <div className="space-y-4">
      <Panel
        title="Deterministic controls"
        subtitle={`${policyVersion ? `Policy v${policyVersion} · ` : ''}Live limits from the policy engine, with how often each one actually stopped an AI proposal.`}
        right={
          <div className="text-right shrink-0">
            <div className="font-mono tabular-nums text-[16px] font-semibold text-risk-300 leading-none">{formatCount(blockedTotal)}</div>
            <div className="text-[10px] text-text-muted mt-1">of {formatCount(blockedTotal + authorizedTotal)} decisions stopped</div>
          </div>
        }
      >
        {catalog.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-text-muted">Live policy limits couldn&apos;t be loaded.</p>
        ) : (
          <ul>
            {catalog.map((r) => {
              const n = byRule.get(r.key) ?? 0;
              return (
                <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)] items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-border-divider">
                  <span className="text-[12.5px] text-text-primary">{r.label}</span>
                  <span className="text-[11.5px] text-text-muted text-right md:text-left">{r.limit}</span>
                  <span className="col-span-2 md:col-span-1 flex items-center gap-3">
                    <span className="flex-1 h-1.5 rounded-full bg-border-subtle overflow-hidden">
                      <span className="block h-full rounded-full bg-risk-500/80" style={{ width: `${n === 0 ? 0 : Math.max(4, (n / maxCount) * 100)}%` }} />
                    </span>
                    <span className="w-24 text-right font-mono tabular-nums text-[11px] text-text-secondary shrink-0">
                      {n === 0 ? 'Never stopped' : `${formatCount(n)} stopped`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-4 py-2.5 text-[10.5px] text-text-muted leading-relaxed">
          {sampled ? `Counts are from the latest ${formatCount(blocked.length)} blocked actions. ` : ''}
          {otherCount > 0 ? `${formatCount(otherCount)} stopped by a control not listed above. ` : ''}
          Limits are read from the policy engine — the AI cannot change them.
        </p>
      </Panel>

      <Panel title="Recently stopped" subtitle="AI proposals the rules blocked or rerouted, newest first.">
        {loading && blocked.length === 0 ? (
          <Loading />
        ) : blocked.length === 0 ? (
          <Empty title="Nothing has been stopped" body="No AI proposal has been blocked by the recovery controls yet." />
        ) : (
          <ul className="max-h-[420px] overflow-y-auto custom-scrollbar">
            {blocked.slice(0, 80).map((e) => {
              const v = verdictOf(e);
              return (
                <li key={e.event_id}>
                  <button
                    onClick={() => onOpen(e.transaction_id, 'policy')}
                    className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border-divider hover:bg-surface/70 transition-colors focus:outline-none focus-visible:bg-panel-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[12px] text-text-primary truncate">{e.transaction_id}</span>
                        <Chip tone={v.tone}>{v.text}</Chip>
                      </span>
                      <span className="block text-[11.5px] text-text-muted mt-1 leading-snug">
                        {actionLabel(e.action)} — {e.policy_result?.reason}
                      </span>
                    </span>
                    <span className="text-[10.5px] text-text-muted shrink-0 mt-0.5">{formatTimeAgo(e.timestamp)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
};

/* ────────────────────────────── System Activity ────────────────────────────── */

const EVENT_LABEL: Record<string, string> = {
  ...Object.fromEntries(EVENT_TYPE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label])),
  DECISION_CREATED: 'Decisions authorized',
};
const EVENT_TONE: Record<string, Tone> = {
  DECISION_CREATED: 'ai',
  ACTION_BLOCKED: 'risk',
  EXECUTION_SUCCEEDED: 'success',
  EXECUTION_FAILED: 'warning',
  ESCALATION_CREATED: 'warning',
  SUPPRESSION_CREATED: 'neutral',
};

export const SystemActivity: React.FC<{
  counts: Record<string, number>;
  total: number;
  loaded: AuditEvent[];
}> = ({ counts, total, loaded }) => {
  const mix = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxCount = mix.length ? mix[0][1] : 1;

  const provenance = useMemo(() => {
    const tally = (pick: (e: AuditEvent) => string) => {
      const m = new Map<string, number>();
      for (const e of loaded) m.set(pick(e), (m.get(pick(e)) ?? 0) + 1);
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    };
    const times = loaded.map((e) => new Date(e.timestamp).getTime()).filter((n) => !Number.isNaN(n));
    return {
      providers: tally((e) => providerLabel(e.provider)),
      models: tally((e) => `v${e.model_version}`),
      policies: tally((e) => `v${e.policy_version}`),
      idempotent: loaded.filter((e) => !!e.idempotency_key).length,
      oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
      newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
    };
  }, [loaded]);

  if (total === 0) {
    return (
      <Panel title="System activity">
        <Empty title="No system activity yet" body="Activity appears here as soon as REVORA records its first decision." />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2 items-start">
      <Panel title="What the system has recorded" subtitle={`${formatCount(total)} audit events across the whole log.`}>
        <div className="p-4 space-y-3.5">
          {mix.map(([type, n]) => (
            <div key={type}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-text-secondary">{EVENT_LABEL[type] ?? humanize(type.toLowerCase())}</span>
                <span className="font-mono tabular-nums text-text-muted">
                  {formatCount(n)} <span className="text-text-disabled">· {((n / total) * 100).toFixed(1)}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-border-subtle overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (n / maxCount) * 100)}%`, backgroundColor: TONE[EVENT_TONE[type] ?? 'neutral'].hex, opacity: 0.85 }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recorded by" subtitle={`Provenance stamped on each of the latest ${formatCount(loaded.length)} events.`}>
        <dl className="divide-y divide-border-divider">
          <Provenance label="Execution provider" values={provenance.providers} note="Simulated — no real payment network" />
          <Provenance label="Model version" values={provenance.models} />
          <Provenance label="Policy version" values={provenance.policies} />
          <div className="flex items-baseline justify-between gap-3 px-4 py-3 text-[12px]">
            <dt className="text-text-muted">Idempotent executions</dt>
            <dd className="font-mono tabular-nums text-text-primary">{formatCount(provenance.idempotent)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-4 py-3 text-[12px]">
            <dt className="text-text-muted">Window</dt>
            <dd className="font-mono text-[11px] text-text-secondary text-right">
              {formatDateTime(provenance.oldest)} → {formatDateTime(provenance.newest)}
            </dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
};

const Provenance: React.FC<{ label: string; values: [string, number][]; note?: string }> = ({ label, values, note }) => (
  <div className="px-4 py-3 text-[12px]">
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text-primary font-mono text-[11.5px]">
        {values.length === 0 ? '—' : values.map(([v, n]) => `${v} (${formatCount(n)})`).join(' · ')}
      </dd>
    </div>
    {note && <div className="text-[10.5px] text-text-muted mt-1 text-right">{note}</div>}
  </div>
);
