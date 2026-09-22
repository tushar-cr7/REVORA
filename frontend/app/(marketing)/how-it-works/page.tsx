import React from 'react';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/marketing/Container';
import { Reveal } from '@/components/marketing/Reveal';
import { Pill } from '@/components/marketing/Pill';
import { MarketingButton } from '@/components/marketing/MarketingButton';

export const metadata: Metadata = {
  title: 'How it Works — REVORA',
  description: 'The full pipeline: risk engine, recovery probability model, decision engine, policy engine, execution, and the audit trail.',
};

const STAGES = [
  {
    tag: 'System',
    title: 'Revenue Risk Engine',
    desc: 'Every transaction is categorized into one of four leak types — failed_payment, abandoned_checkout, failed_subscription, or overdue_invoice — the closed vocabulary the rest of the pipeline reasons about.',
  },
  {
    tag: 'Intelligence',
    title: 'Recovery Probability Model',
    desc: 'A trained XGBoost model estimates the probability that a given transaction can actually be recovered, using signals like retry history, prior successful payments, and customer LTV bucket.',
  },
  {
    tag: 'Intelligence',
    title: 'Decision Engine',
    desc: 'Expected value is computed across every candidate action — retry, payment_link, reminder, escalate, suppress — weighing probability against cost and customer friction. This engine proposes. It never executes.',
  },
  {
    tag: 'Policy',
    title: 'Policy / Guardrail Engine',
    desc: 'A deterministic, non-ML rules layer — retry limits, cooldown periods, contact limits, an autonomous-recovery value ceiling, escalation rules — evaluates the proposed action and can only downgrade or block it, never expand it.',
  },
  {
    tag: 'Execution',
    title: 'Execution',
    desc: 'Only policy-authorized actions run, against a simulation provider today (Razorpay test-mode API calls are the spec target). Every execution call is idempotency-key protected.',
  },
  {
    tag: 'Audit',
    title: 'Outcome Measurement + Audit Trail',
    desc: 'The real outcome — recovered, attempted without recovery, suppressed, or escalated — is recorded. Every action, and every action deliberately not taken, is written to the ledger.',
  },
];

const TAG_COLOR: Record<string, string> = {
  System: 'text-accent-600',
  Intelligence: 'text-accent-violet',
  Policy: 'text-ink',
  Execution: 'text-accent-600',
  Audit: 'text-ink-secondary',
};

const TRACE = [
  { field: 'Transaction', value: 'failed_subscription · ₹1,840 · 3rd consecutive renewal attempt' },
  { field: 'Risk Engine', value: 'Categorized as failed_subscription' },
  { field: 'Recovery Probability Model', value: '0.72 — moderate-high confidence' },
  { field: 'Decision Engine', value: 'retry: EV ₹1,270 · payment_link: EV ₹980 · escalate: EV ₹410 → proposes retry' },
  { field: 'Policy Engine', value: 'retries_so_far (1) < max_retries (2), cooldown elapsed → allowed' },
  { field: 'Execution', value: 'Retry attempted via SimulationProvider, Idempotency-Key attached' },
  { field: 'Outcome', value: 'Recovered — ₹1,840 written to the audit ledger' },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-hairline py-20 sm:py-28">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Architecture</Pill>
            <h1 className="mt-6 font-display text-4xl leading-tight text-ink sm:text-5xl">
              From leak to recovery, every step is inspectable.
            </h1>
            <p className="mt-6 text-base leading-relaxed text-ink-secondary sm:text-lg">
              No stage is a black box. Here is the literal pipeline a transaction moves through —
              and exactly where AI reasoning ends and deterministic control begins.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-hairline py-20 sm:py-24">
        <Container className="max-w-3xl">
          <div className="flex flex-col">
            {STAGES.map((stage, i) => (
              <Reveal key={stage.title} delay={i * 0.05}>
                <div className={`flex gap-6 py-8 ${i !== STAGES.length - 1 ? 'border-b border-hairline' : ''}`}>
                  <div className="flex shrink-0 flex-col items-center">
                    <span className="font-mono text-sm text-ink-muted">0{i + 1}</span>
                  </div>
                  <div>
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${TAG_COLOR[stage.tag]}`}>
                      {stage.tag}
                    </span>
                    <div className="mt-1.5 font-display text-xl text-ink">{stage.title}</div>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-secondary">{stage.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-b border-hairline bg-paper-alt py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Worked example</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              One transaction, start to finish.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              An illustrative trace — the shape of what every real transaction produces in the
              audit ledger.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-10 overflow-hidden rounded-xl border border-hairline bg-paper-raised">
              {TRACE.map((row, i) => (
                <div
                  key={row.field}
                  className={`flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6 ${
                    i !== TRACE.length - 1 ? 'border-b border-hairline' : ''
                  }`}
                >
                  <span className="w-56 shrink-0 text-sm font-medium text-ink">{row.field}</span>
                  <span className="font-mono text-[13px] leading-relaxed text-ink-secondary">{row.value}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="py-20 sm:py-28">
        <Container className="max-w-2xl text-center">
          <Reveal>
            <h2 className="font-display text-3xl text-ink sm:text-4xl">
              See the guardrails that keep this safe.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <MarketingButton href="/trust" variant="primary" icon={<ArrowRight size={16} />}>
                Trust &amp; Security
              </MarketingButton>
              <MarketingButton href="/mission-control" variant="secondary">
                Open Dashboard
              </MarketingButton>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
