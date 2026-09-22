import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Container } from '@/components/marketing/Container';
import { Reveal } from '@/components/marketing/Reveal';
import { Pill } from '@/components/marketing/Pill';
import { MarketingButton } from '@/components/marketing/MarketingButton';
import { LeakTypeCards } from '@/components/marketing/LeakTypeCards';
import { PipelineLoop } from '@/components/marketing/PipelineLoop';
import { PrincipleSplit } from '@/components/marketing/PrincipleSplit';
import { ActionChips } from '@/components/marketing/ActionChips';
import { GuardrailTable } from '@/components/marketing/GuardrailTable';

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-hairline">
        <Container className="grid gap-14 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-28">
          <Reveal>
            <Pill>Revenue Recovery Infrastructure</Pill>
            <h1 className="mt-6 font-display text-[2.75rem] leading-[1.08] tracking-tight text-ink sm:text-6xl">
              The revenue you already earned doesn&apos;t have to disappear.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-secondary sm:text-lg">
              Every merchant loses money between customer intent and successful payment — a
              declined card, an abandoned checkout, a failed renewal, an overdue invoice.
              REVORA estimates, decides, and recovers it — inside limits a deterministic
              policy engine controls, not the AI.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <MarketingButton href="/mission-control" variant="primary" icon={<ArrowRight size={16} />}>
                Open Dashboard
              </MarketingButton>
              <MarketingButton href="/how-it-works" variant="secondary">
                See how it works
              </MarketingButton>
            </div>
            <div className="mt-10 flex items-center gap-2 text-xs text-ink-muted">
              <CheckCircle2 size={14} className="text-ink-secondary" />
              Every action — and every action deliberately not taken — is written to an audit trail.
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="rounded-xl border border-hairline bg-paper-raised p-6 shadow-[0_1px_2px_rgba(20,21,26,0.04)]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Illustrative decision trace
              </div>
              <div className="mt-5 flex flex-col gap-0">
                {[
                  { label: 'Leak detected', value: 'failed_subscription · ₹1,840' },
                  { label: 'Recovery probability', value: '72%', accent: 'violet' },
                  { label: 'AI proposes', value: 'retry', accent: 'violet' },
                  { label: 'Policy check', value: 'within limits — allowed', accent: 'success' },
                  { label: 'Executed', value: 'recovered', accent: 'success' },
                ].map((row, i, arr) => (
                  <div
                    key={row.label}
                    className={`flex items-center justify-between py-3 ${i !== arr.length - 1 ? 'border-b border-hairline' : ''}`}
                  >
                    <span className="text-sm text-ink-secondary">{row.label}</span>
                    <span
                      className={
                        'font-mono text-sm font-medium ' +
                        (row.accent === 'violet'
                          ? 'text-accent-violet'
                          : row.accent === 'success'
                          ? 'text-emerald-600'
                          : 'text-ink')
                      }
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] text-ink-muted">
                Illustrative example — the real trace for every transaction is visible in the audit ledger.
              </p>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Problem */}
      <section className="border-b border-hairline py-20 sm:py-24">
        <Container>
          <Reveal>
            <Pill>The problem</Pill>
            <h2 className="mt-5 max-w-2xl font-display text-3xl text-ink sm:text-4xl">
              Standard analytics stops at &ldquo;here&apos;s how much you lost.&rdquo;
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-secondary">
              Merchants are left to manually triage which of it is worth chasing, and how.
              Revenue leaks in four recognizable shapes:
            </p>
          </Reveal>
          <div className="mt-10">
            <LeakTypeCards />
          </div>
        </Container>
      </section>

      {/* Core loop */}
      <section className="border-b border-hairline py-20 sm:py-24">
        <Container wide>
          <Reveal>
            <Pill>The core loop</Pill>
            <h2 className="mt-5 max-w-2xl font-display text-3xl text-ink sm:text-4xl">
              Detect. Diagnose. Predict. Decide. Execute. Measure. Learn.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-secondary">
              A continuous loop, running for every at-risk transaction — not a one-time report.
            </p>
          </Reveal>
          <div className="mt-10">
            <PipelineLoop />
          </div>
          <div className="mt-8">
            <MarketingButton href="/how-it-works" variant="ghost" icon={<ArrowRight size={15} />}>
              Walk through the full architecture
            </MarketingButton>
          </div>
        </Container>
      </section>

      {/* Core principle */}
      <section className="border-b border-hairline bg-paper-alt py-20 sm:py-24">
        <Container>
          <Reveal>
            <Pill>The core principle</Pill>
            <h2 className="mt-5 max-w-2xl font-display text-3xl text-ink sm:text-4xl">
              AI for intelligence. Rules for control.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-secondary">
              AI may identify patterns, estimate recovery probability, and compare interventions.
              It may never itself authorize money movement. That split is REVORA&apos;s central
              trust claim — not a footnote.
            </p>
          </Reveal>
          <div className="mt-10">
            <PrincipleSplit />
          </div>
        </Container>
      </section>

      {/* Recovery actions */}
      <section className="border-b border-hairline py-20 sm:py-24">
        <Container>
          <Reveal>
            <Pill>Recovery actions</Pill>
            <h2 className="mt-5 max-w-2xl font-display text-3xl text-ink sm:text-4xl">
              Five candidate actions. One policy gate.
            </h2>
          </Reveal>
          <div className="mt-10">
            <ActionChips />
          </div>
        </Container>
      </section>

      {/* Guardrails */}
      <section className="border-b border-hairline bg-paper-alt py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Guardrails</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              Configurable. Deterministic. Non-negotiable by the AI.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              Current defaults — the same limits enforced in the live policy engine.
            </p>
          </Reveal>
          <div className="mt-10">
            <GuardrailTable />
          </div>
        </Container>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-28">
        <Container className="max-w-2xl text-center">
          <Reveal>
            <h2 className="font-display text-3xl text-ink sm:text-4xl">
              See the pipeline run on real logic, not a mockup.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              The dashboard is fully wired to a live decision engine, policy engine, and audit trail.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <MarketingButton href="/mission-control" variant="primary" icon={<ArrowRight size={16} />}>
                Open Dashboard
              </MarketingButton>
              <MarketingButton href="/trust" variant="secondary">
                Read about trust &amp; security
              </MarketingButton>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
