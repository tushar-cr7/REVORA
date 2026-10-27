'use client';

/*
 * React Bits — Stepper (JS-CSS), official source: https://reactbits.dev/r/Stepper-JS-CSS.json
 *
 * This is the official component. Its structure, animation and behaviour are unchanged.
 * Every REVORA addition is marked `REVORA:` and is additive — with none of the new props
 * passed, the component behaves exactly as published. A pristine copy of the original is in
 * `_backups/audit-trail-reactbits-official-preview-20261005/official-originals/`.
 *
 *   1. `stepStates`  optional array of booleans, one per step: did the flow actually reach it?
 *                    The published component decides "complete" purely by position (everything
 *                    before the viewed step shows a check). For an audit record that would put a
 *                    check on an action that never ran, so when `stepStates` is supplied a step
 *                    is "complete" only if it was reached; the connector after it fills only if
 *                    the next step was reached.
 *   2. `stepLabels`  optional array of { text, name }: a short visible label under each
 *                    indicator, and the full name for assistive tech / tooltip.
 *   3. Accessibility the published indicators are clickable <div>s with no keyboard access; they
 *                    now have role="button", tabIndex, Enter/Space, aria-current and an aria-label.
 *   4. Colours       the animated hex values (purple / grey) are REVORA's tokens: neutral for
 *                    reached, blue for the viewed step, quiet grey for not reached.
 */

import React, { useState, Children, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

import './Stepper.css';

export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = '',
  stepContainerClassName = '',
  contentClassName = '',
  footerClassName = '',
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = 'Back',
  nextButtonText = 'Continue',
  disableStepIndicators = false,
  renderStepIndicator,
  // REVORA: real step states and labels (see the note at the top of this file)
  stepStates,
  stepLabels,
  ...rest
}) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [direction, setDirection] = useState(0);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = newStep => {
    setCurrentStep(newStep);
    if (newStep > totalSteps) {
      onFinalStepCompleted();
    } else {
      onStepChange(newStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (!isLastStep) {
      setDirection(1);
      updateStep(currentStep + 1);
    }
  };

  const handleComplete = () => {
    setDirection(1);
    updateStep(totalSteps + 1);
  };

  return (
    <div className="outer-container" {...rest}>
      <div
        className={`step-circle-container ${stepCircleContainerClassName}`}
        style={{ border: '1px solid var(--border-primary, #222)' }}
      >
        <div className={`step-indicator-row ${stepContainerClassName}`}>
          {stepsArray.map((_, index) => {
            const stepNumber = index + 1;
            const isNotLastStep = index < totalSteps - 1;
            return (
              <React.Fragment key={stepNumber}>
                {renderStepIndicator ? (
                  renderStepIndicator({
                    step: stepNumber,
                    currentStep,
                    onStepClick: clicked => {
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    }
                  })
                ) : (
                  <StepIndicator
                    step={stepNumber}
                    disableStepIndicators={disableStepIndicators}
                    currentStep={currentStep}
                    reached={stepStates ? !!stepStates[index] : undefined /* REVORA */}
                    label={stepLabels ? stepLabels[index] : undefined /* REVORA */}
                    onClickStep={clicked => {
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    }}
                  />
                )}
                {isNotLastStep && (
                  <StepConnector
                    isComplete={stepStates ? !!stepStates[stepNumber] /* REVORA: the next step was reached */ : currentStep > stepNumber}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <StepContentWrapper
          isCompleted={isCompleted}
          currentStep={currentStep}
          direction={direction}
          className={`step-content-default ${contentClassName}`}
        >
          {stepsArray[currentStep - 1]}
        </StepContentWrapper>

        {!isCompleted && (
          <div className={`footer-container ${footerClassName}`}>
            <div className={`footer-nav ${currentStep !== 1 ? 'spread' : 'end'}`}>
              {currentStep !== 1 && (
                <button
                  onClick={handleBack}
                  className={`back-button ${currentStep === 1 ? 'inactive' : ''}`}
                  {...backButtonProps}
                >
                  {backButtonText}
                </button>
              )}
              <button onClick={isLastStep ? handleComplete : handleNext} className="next-button" {...nextButtonProps}>
                {isLastStep ? 'Complete' : nextButtonText}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepContentWrapper({ isCompleted, currentStep, direction, children, className }) {
  const [parentHeight, setParentHeight] = useState(0);

  return (
    <motion.div
      className={className}
      style={{ position: 'relative', overflow: 'hidden' }}
      animate={{ height: isCompleted ? 0 : parentHeight }}
      transition={{ type: 'spring', duration: 0.4 }}
    >
      <AnimatePresence initial={false} mode="sync" custom={direction}>
        {!isCompleted && (
          <SlideTransition key={currentStep} direction={direction} onHeightReady={h => setParentHeight(h)}>
            {children}
          </SlideTransition>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SlideTransition({ children, direction, onHeightReady }) {
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    if (containerRef.current) onHeightReady(containerRef.current.offsetHeight);
  }, [children, onHeightReady]);

  return (
    <motion.div
      ref={containerRef}
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.4 }}
      style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
    >
      {children}
    </motion.div>
  );
}

const stepVariants = {
  enter: dir => ({
    x: dir >= 0 ? '-100%' : '100%',
    opacity: 0
  }),
  center: {
    x: '0%',
    opacity: 1
  },
  exit: dir => ({
    x: dir >= 0 ? '50%' : '-50%',
    opacity: 0
  })
};

export function Step({ children }) {
  return <div className="step-default">{children}</div>;
}

function StepIndicator({ step, currentStep, onClickStep, disableStepIndicators, reached, label }) {
  // REVORA: with real step states, "complete" means the flow reached the step; the viewed step is
  // "active" only if it was reached. Without them, the published positional logic applies.
  const status =
    reached === undefined
      ? currentStep === step
        ? 'active'
        : currentStep < step
          ? 'inactive'
          : 'complete'
      : reached
        ? currentStep === step
          ? 'active'
          : 'complete'
        : 'inactive';

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) onClickStep(step);
  };

  return (
    <motion.div
      onClick={handleClick}
      className="step-indicator"
      style={disableStepIndicators ? { pointerEvents: 'none', opacity: 0.5 } : {}}
      animate={status}
      initial={false}
      // REVORA: keyboard and assistive-tech access
      role="button"
      tabIndex={disableStepIndicators ? -1 : 0}
      aria-label={label ? label.name || label.text : undefined}
      title={label ? label.name || label.text : undefined}
      aria-current={currentStep === step ? 'step' : undefined}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <motion.div
        variants={{
          // REVORA: colours — quiet grey (not reached) · REVORA blue (the viewed step) · neutral (reached)
          inactive: { scale: 1, backgroundColor: '#1A212B', color: '#6C7685' },
          active: { scale: 1, backgroundColor: '#4F7CFF', color: '#4F7CFF' },
          complete: { scale: 1, backgroundColor: '#343D4A', color: '#8B95A3' }
        }}
        transition={{ duration: 0.3 }}
        className="step-indicator-inner"
      >
        {status === 'complete' ? (
          <CheckIcon className="check-icon" />
        ) : status === 'active' ? (
          <div className="active-dot" />
        ) : (
          <span className="step-number">{step}</span>
        )}
      </motion.div>
      {label ? <span className="step-label">{label.text}</span> : null /* REVORA */}
    </motion.div>
  );
}

function StepConnector({ isComplete }) {
  const lineVariants = {
    incomplete: { width: 0, backgroundColor: 'transparent' },
    // REVORA: colour
    complete: { width: '100%', backgroundColor: '#6C7685' }
  };

  return (
    <div className="step-connector">
      <motion.div
        className="step-connector-inner"
        variants={lineVariants}
        initial={false}
        animate={isComplete ? 'complete' : 'incomplete'}
        transition={{ duration: 0.4 }}
      />
    </div>
  );
}

function CheckIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.1, type: 'tween', ease: 'easeOut', duration: 0.3 }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
