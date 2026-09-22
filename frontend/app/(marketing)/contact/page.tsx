import React from 'react';
import type { Metadata } from 'next';
import { Mail, ArrowRight } from 'lucide-react';
import { Container } from '@/components/marketing/Container';
import { Reveal } from '@/components/marketing/Reveal';
import { Pill } from '@/components/marketing/Pill';
import { MarketingButton } from '@/components/marketing/MarketingButton';

export const metadata: Metadata = {
  title: 'Contact — REVORA',
  description: 'Get in touch about REVORA\'s architecture, guardrails, or a walkthrough of the dashboard.',
};

export default function ContactPage() {
  return (
    <section className="py-20 sm:py-28">
      <Container className="max-w-2xl text-center">
        <Reveal>
          <Pill>Contact</Pill>
          <h1 className="mt-6 font-display text-4xl leading-tight text-ink sm:text-5xl">
            Let&apos;s talk about the architecture.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-ink-secondary sm:text-lg">
            REVORA is a working demo — the fastest way to understand it is to see the pipeline
            run. If you&apos;d like a walkthrough, or have questions about the guardrails, reach out.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a
              href="mailto:hello@revora.app?subject=REVORA%20-%20Walkthrough%20request"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-600"
            >
              <Mail size={16} />
              hello@revora.app
            </a>
            <MarketingButton href="/mission-control" variant="secondary" icon={<ArrowRight size={15} />}>
              Explore the dashboard instead
            </MarketingButton>
          </div>

          <p className="mt-8 text-xs text-ink-muted">
            This is a demo environment built for evaluation — responses may take time.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
