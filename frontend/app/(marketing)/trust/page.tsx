import React from 'react';
import type { Metadata } from 'next';
import { AlertTriangle, ArrowRight, Lock, FileClock } from 'lucide-react';
import { Container } from '@/components/marketing/Container';
import { Reveal } from '@/components/marketing/Reveal';
import { Pill } from '@/components/marketing/Pill';
import { MarketingButton } from '@/components/marketing/MarketingButton';
import { GuardrailTable } from '@/components/marketing/GuardrailTable';

export const metadata: Metadata = {
  title: 'Trust & Security — REVORA',
  description: 'The guardrail engine, the audit trail, and REVORA\'s current security posture.',
};

const POSTURE = [
  {
    icon: Lock,
    title: 'Test-mode only',
    desc: 'Razorpay and any LLM provider credentials used in this environment are sandbox/test-mode only — never live payment credentials.',
  },
  {
    icon: FileClock,
    title: 'Full audit trail',
    desc: 'Every decision, policy evaluation, execution attempt, and outcome is logged — including actions deliberately blocked or suppressed.',
  },
  {
    icon: AlertTriangle,
    title: 'Single-tenant demo mode',
    desc: 'Authentication and multi-tenant isolation are not yet built — this is a demo environment, stated plainly rather than implied otherwise.',
  },
];

export default function TrustPage() {
  return (
    <>
      <section className="border-b border-hairline py-20 sm:py-28">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Trust &amp; Security</Pill>
            <h1 className="mt-6 font-display text-4xl leading-tight text-ink sm:text-5xl">
              Policy can override the AI. The AI can never override policy.
            </h1>
            <p className="mt-6 text-base leading-relaxed text-ink-secondary sm:text-lg">
              This is REVORA&apos;s central trust claim, enforced in code — not a UX suggestion.
              The policy engine is deterministic, has no ML or LLM inputs, and is the only
              layer that can approve, downgrade, or block money movement.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-hairline bg-paper-alt py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Guardrails</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              The limits, in full.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              Configurable defaults enforced by <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[13px]">evaluate_policy()</code> on
              every proposed action, before execution.
            </p>
          </Reveal>
          <div className="mt-10">
            <GuardrailTable />
          </div>
        </Container>
      </section>

      <section className="border-b border-hairline py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>When policy blocks an action</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              A block is a feature firing correctly.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              Not an error state. Every blocked action shows the same structure — illustrated here.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-10 rounded-xl border border-red-200 bg-red-50/60 p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-red-100 text-red-600">
                  <AlertTriangle size={18} strokeWidth={1.75} />
                </span>
                <div className="font-display text-lg text-ink">Action Blocked</div>
              </div>

              <dl className="mt-6 flex flex-col gap-4 text-sm">
                <div>
                  <dt className="font-semibold text-ink">Reason</dt>
                  <dd className="mt-1 text-ink-secondary">
                    Retry limit exceeded (2/2) for this transaction.
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">What would happen if we ignored this</dt>
                  <dd className="mt-1 text-ink-secondary">
                    A third automated retry would risk a repeated decline and unnecessary
                    customer friction, with no policy record of why it was attempted.
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-emerald-700">Confirmation</dt>
                  <dd className="mt-1 text-emerald-700">
                    Policy protected the customer and the merchant. The case was routed to
                    escalation instead.
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                disabled
                className="mt-6 cursor-not-allowed rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 opacity-70"
              >
                Escalate Instead
              </button>
              <p className="mt-3 text-[11px] text-ink-muted">Illustrative — the live version of this panel is in the dashboard.</p>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="bg-paper-alt py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Current posture</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              Stated plainly.
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {POSTURE.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.07}>
                <div className="h-full rounded-lg border border-hairline bg-paper-raised p-6">
                  <item.icon size={18} strokeWidth={1.75} className="text-ink" />
                  <div className="mt-3 text-sm font-semibold text-ink">{item.title}</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{item.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-28">
        <Container className="max-w-2xl text-center">
          <Reveal>
            <h2 className="font-display text-3xl text-ink sm:text-4xl">
              Questions about the architecture?
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <MarketingButton href="/contact" variant="primary" icon={<ArrowRight size={16} />}>
                Get in touch
              </MarketingButton>
              <MarketingButton href="/how-it-works" variant="secondary">
                Revisit the pipeline
              </MarketingButton>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
