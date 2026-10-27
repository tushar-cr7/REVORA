'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CircleAlert, X } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { AttentionSummary, REASON_LABEL, ReasonKey } from './escalationSignals';

interface Props {
  summary: AttentionSummary;
  onReviewCases: () => void;
}

/**
 * Escalations' hero — an explicitly approved, scoped exception to
 * REVORA's normal "no 3D illustrations / no glassmorphism / no glow"
 * rule (see CLAUDE.md §5, "Documented exception — Escalations hero").
 *
 * The entire hero — left text panel and right illustration together —
 * is a single image asset cropped directly from the approved reference
 * (`frontend/public/assets/escalations/hero-full.png`), per explicit
 * instruction not to split it back into HTML + artwork or redesign any
 * part of it. Real functionality is layered on top without touching the
 * artwork: two transparent, keyboard-accessible hit-regions sit exactly
 * over the baked-in "Review Cases" / "How Escalations Work" buttons and
 * call the same real handlers a visible button would, and two small
 * live-number chips sit over the two cards that map to real REVORA
 * categories, sourced from `AttentionSummary.byReason` so they can never
 * go stale even though the artwork itself is static.
 */
export const EscalationsHero: React.FC<Props> = ({ summary, onReviewCases }) => {
  const [howOpen, setHowOpen] = useState(false);

  return (
    <>
      <div className="relative w-full overflow-hidden rounded-lg border border-border-subtle bg-canvas" style={{ aspectRatio: '1460 / 268' }}>
        <Image
          src="/assets/escalations/hero-full.png"
          alt="Escalations — Human Attention Queue. Revenue cases that require human decision: REVORA has reached the boundary of autonomous recovery and needs your review."
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />

        {/* Real hit-regions over the artwork's own buttons — invisible, but keyboard/screen-reader accessible. */}
        <button
          onClick={onReviewCases}
          aria-label="Review Cases"
          className="absolute rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning-400"
          style={{ left: '1.4%', top: '69.5%', width: '10.8%', height: '17%' }}
        />
        <button
          onClick={() => setHowOpen(true)}
          aria-label="How Escalations Work"
          className="absolute rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-text-secondary"
          style={{ left: '13.4%', top: '69.5%', width: '14%', height: '17%' }}
        />

        <NumberOverlay leftPct={46.5} topPct={73.5} reasonKey="invoice_age" summary={summary} />
        <NumberOverlay leftPct={56.3} topPct={81.3} reasonKey="retry_limit" summary={summary} />
      </div>

      <HowItWorksModal open={howOpen} onClose={() => setHowOpen(false)} summary={summary} />
    </>
  );
};

/**
 * Live count/amount, positioned over the matching card's baked-in
 * numbers in the reference artwork. A dark backdrop chip sits behind the
 * text so a real figure that no longer matches the static image (once
 * data changes) reads cleanly instead of doubling up with the original
 * pixels underneath.
 */
const NumberOverlay: React.FC<{ leftPct: number; topPct: number; reasonKey: ReasonKey; summary: AttentionSummary }> = ({
  leftPct,
  topPct,
  reasonKey,
  summary,
}) => {
  const lane = summary.byReason[reasonKey];
  return (
    <div
      className="absolute flex flex-col items-start -translate-x-1/2 -translate-y-1/2 rounded px-1.5 py-1 pointer-events-none"
      style={{ left: `${leftPct}%`, top: `${topPct}%`, backgroundColor: 'rgba(18,12,7,0.82)' }}
    >
      <span className="text-[9px] sm:text-[10.5px] text-text-secondary leading-tight whitespace-nowrap">
        {lane.count} case{lane.count === 1 ? '' : 's'}
      </span>
      <span className="text-[10px] sm:text-[12px] font-mono font-semibold text-warning-200 leading-tight whitespace-nowrap">
        {formatINR(lane.amount, true)}
      </span>
    </div>
  );
};

/* ────────────────────────────── how it works ────────────────────────────── */

const HowItWorksModal: React.FC<{ open: boolean; onClose: () => void; summary: AttentionSummary }> = ({ open, onClose, summary }) => {
  const reduceMotion = useReducedMotion();
  const categories = (Object.keys(REASON_LABEL) as ReasonKey[]).map((key) => ({ key, ...summary.byReason[key] }));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={reduceMotion ? { duration: 0.01 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="How Escalations work"
            className="w-full max-w-[480px] max-h-[85vh] overflow-y-auto custom-scrollbar rounded-lg border border-border-strong bg-panel shadow-drawer"
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-border-subtle">
              <div className="flex items-center gap-2.5">
                <CircleAlert className="w-4 h-4 text-warning-300 shrink-0" />
                <h3 className="text-[14px] font-semibold text-text-primary">How Escalations work</h3>
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1 -m-1 rounded text-text-muted hover:text-text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-[12.5px] text-text-secondary leading-relaxed">
                A case lands here when REVORA&apos;s decision engine proposes an action and the deterministic recovery
                controls either block it, or REVORA&apos;s own scoring decides a person should handle it directly.
                Either way, no further automated recovery runs until you route it to your merchant queue.
              </p>
              <div className="space-y-2">
                <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-text-muted pb-1 border-b border-border-divider">
                  Reasons in your current queue
                </div>
                {categories.map((c) => (
                  <div key={c.key} className="flex items-start justify-between gap-3 text-[12px] py-1">
                    <span className="text-text-secondary">{REASON_LABEL[c.key]}</span>
                    <span className="font-mono text-text-muted whitespace-nowrap shrink-0">
                      {c.count} · {formatINR(c.amount, true)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
