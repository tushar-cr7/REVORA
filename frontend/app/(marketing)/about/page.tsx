import React from 'react';
import type { Metadata } from 'next';
import { CheckCircle2, Circle } from 'lucide-react';
import { Container } from '@/components/marketing/Container';
import { Reveal } from '@/components/marketing/Reveal';
import { Pill } from '@/components/marketing/Pill';
import { PrincipleSplit } from '@/components/marketing/PrincipleSplit';

export const metadata: Metadata = {
  title: 'About — REVORA',
  description: 'Why REVORA exists, and the architectural boundary between AI intelligence and deterministic policy control.',
};

const PHILOSOPHY = [
  {
    title: 'No fake functionality',
    desc: 'A button that says "Execute Action" calls the real endpoint and renders the real response — including failure.',
  },
  {
    title: 'No decorative numbers',
    desc: "If a figure can't be computed from actual pipeline output, it doesn't appear on screen. We mark it unbuilt instead.",
  },
  {
    title: 'One system of record',
    desc: 'One decision engine, one policy engine, one audit ledger. No parallel "v2" logic living quietly beside the real one.',
  },
  {
    title: 'Blocks are a feature, not an error',
    desc: 'When policy stops an action, that\'s the system working correctly — shown calmly, not as a failure state.',
  },
];

const BUILT = [
  'Modular FastAPI backend with a trained XGBoost recovery model',
  'Expected-value decision engine and deterministic policy engine',
  'Simulated execution provider with idempotency key support',
  'Full structured audit logging across the pipeline',
  '22 passing automated backend tests',
];

const NOT_YET = [
  'PostgreSQL persistence (currently an in-memory repository behind a swappable interface)',
  'Live Razorpay execution (currently a probability-based simulation provider)',
  'Authentication (currently single-tenant demo mode)',
];

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-hairline py-20 sm:py-28">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>About REVORA</Pill>
            <h1 className="mt-6 font-display text-4xl leading-tight text-ink sm:text-5xl">
              Recovery automation that doesn&apos;t come with unbounded autonomy.
            </h1>
            <p className="mt-6 text-base leading-relaxed text-ink-secondary sm:text-lg">
              REVORA is built for merchants and finance/ops teams processing recurring or
              high-volume payments — anyone who&apos;d reject &ldquo;an AI that retries whatever
              it wants,&rdquo; but still wants recovery automation that&apos;s provably safe.
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-hairline bg-paper-alt py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Why we built this</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              The gap isn&apos;t detection. It&apos;s judgment.
            </h2>
            <div className="mt-6 flex flex-col gap-4 text-base leading-relaxed text-ink-secondary">
              <p>
                Every merchant has revenue that silently disappears between customer intent and
                successful payment. Most tooling stops at reporting the loss. What&apos;s missing
                is the judgment layer — deciding which failures are worth chasing, with which
                action, and under what limits.
              </p>
              <p>
                REVORA treats that judgment as two separate jobs done by two separate systems:
                a model that estimates and proposes, and a deterministic engine that decides what
                is actually allowed to happen. Neither job is allowed to do the other&apos;s work.
              </p>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="border-b border-hairline py-20 sm:py-24">
        <Container>
          <Reveal>
            <Pill>The boundary, in practice</Pill>
            <h2 className="mt-5 max-w-2xl font-display text-3xl text-ink sm:text-4xl">
              The relationship is one-way.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-secondary">
              Policy can override the AI. The AI can never override policy. No code path lets a
              model&apos;s output directly trigger money movement without passing through the
              policy layer first — including any new intervention type added later.
            </p>
          </Reveal>
          <div className="mt-10">
            <PrincipleSplit />
          </div>
        </Container>
      </section>

      <section className="border-b border-hairline bg-paper-alt py-20 sm:py-24">
        <Container>
          <Reveal>
            <Pill>How we build</Pill>
            <h2 className="mt-5 max-w-2xl font-display text-3xl text-ink sm:text-4xl">
              Product philosophy
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {PHILOSOPHY.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.06}>
                <div className="h-full rounded-lg border border-hairline bg-paper-raised p-6">
                  <div className="font-display text-lg text-ink">{item.title}</div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{item.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <Pill>Where things stand</Pill>
            <h2 className="mt-5 font-display text-3xl text-ink sm:text-4xl">
              Built today, and what isn&apos;t yet.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              We&apos;d rather tell you exactly what&apos;s real than let a design document imply
              it.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            <Reveal>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Built and working
              </div>
              <ul className="mt-4 flex flex-col gap-3">
                {BUILT.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-secondary">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Spec-only, not yet built
              </div>
              <ul className="mt-4 flex flex-col gap-3">
                {NOT_YET.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-secondary">
                    <Circle size={16} className="mt-0.5 shrink-0 text-ink-muted" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </Container>
      </section>
    </>
  );
}
