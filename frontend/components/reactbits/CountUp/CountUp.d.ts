/** Types for the React Bits CountUp (CountUp.jsx, unmodified). */
export interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  /** Seconds. */
  delay?: number;
  /** Seconds (nominal — it parameterises the spring). */
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

declare const CountUp: (props: CountUpProps) => JSX.Element;
export default CountUp;
