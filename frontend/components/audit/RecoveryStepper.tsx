'use client';

import React from 'react';
import Stepper, { Step } from '@/components/reactbits/Stepper/Stepper';
import type { Tone } from '@/lib/grammar';
import './reactbits-adapt.css';

export interface RecoveryStep {
  key: string;
  /** Short enough to sit under an indicator: "Recommend". */
  label: string;
  /** The full name: "Recommendation". */
  name: string;
  /** Did the flow actually reach this step? Only what the audit record supports — never a guess. */
  reached: boolean;
  tone?: Tone;
  /** The step in one line: "Retry payment blocked". */
  title: string;
  detail: React.ReactNode;
}

/**
 * The reasoning flow of one recovery — the official React Bits Stepper:
 *
 *   Event → Diagnosis → Recommend → Policy → Action → Outcome
 *
 * It answers "how did REVORA get from this event to this outcome?". The published component
 * supplies the indicators, the filling connectors and the sliding step content; REVORA supplies
 * what each step *is*: the six steps are the same six the timeline below walks through, each with
 * the one-line account of itself the audit record supports. Indicators are drawn from real state
 * (`reached`), not from where the viewer has moved to: a step the flow never reached is never
 * given a check.
 *
 * The stepper only ever changes what is in view. Choosing a step reports it (`onSelect`) so the
 * record can bring the matching timeline row forward; it never touches the case.
 *
 * The published stepper is uncontrolled, so it opens on `initialKey` and is re-created when
 * `resetKey` changes — a different record, or an event chosen from the ledger — and left alone
 * otherwise, so its own step transitions play.
 */
export function RecoveryStepper({
  steps,
  initialKey,
  onSelect,
  resetKey,
  label,
  className,
}: {
  steps: RecoveryStep[];
  initialKey: string;
  onSelect: (key: string) => void;
  resetKey: string;
  label: string;
  className?: string;
}) {
  const initialStep = Math.max(1, steps.findIndex((s) => s.key === initialKey) + 1);

  return (
    <div className={`rv-stepper ${className ?? ''}`}>
      <Stepper
        key={resetKey}
        role="group"
        aria-label={label}
        initialStep={initialStep}
        onStepChange={(n) => {
          const step = steps[n - 1];
          if (step) onSelect(step.key);
        }}
        stepStates={steps.map((s) => s.reached)}
        stepLabels={steps.map((s) => ({ text: s.label, name: `${s.name}: ${s.title}` }))}
      >
        {steps.map((s) => (
          <Step key={s.key}>
            <div>
              <div className="rv-stepper-title" data-tone={s.tone}>
                <span className="rv-stepper-name">{s.name}</span>
                <span className="rv-stepper-headline">{s.title}</span>
              </div>
              <div className="rv-stepper-detail">{s.detail}</div>
            </div>
          </Step>
        ))}
      </Stepper>
    </div>
  );
}
