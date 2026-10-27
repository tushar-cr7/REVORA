import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/** Types for the React Bits Stepper (Stepper.jsx). `stepStates` / `stepLabels` are the REVORA additions. */
export interface StepperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  stepCircleContainerClassName?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  backButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  disableStepIndicators?: boolean;
  renderStepIndicator?: (args: { step: number; currentStep: number; onStepClick: (step: number) => void }) => ReactNode;
  /** REVORA: one boolean per step — did the flow actually reach it? */
  stepStates?: boolean[];
  /** REVORA: a short visible label and the full name (aria-label / tooltip) per step. */
  stepLabels?: { text: string; name?: string }[];
}

declare const Stepper: (props: StepperProps) => JSX.Element;
export default Stepper;

export declare function Step(props: { children?: ReactNode }): JSX.Element;
