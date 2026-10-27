import type { CSSProperties, ReactNode } from 'react';

/** Types for the React Bits StatusMark (StatusMark.jsx, unmodified). */
export interface StatusMarkProps {
  status?: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  /** 0–1. With `status="running"`, shows real progress instead of the indeterminate spinner. */
  progress?: number;
  label?: ReactNode;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  size?: number;
  strokeWidth?: number;
  dashes?: number;
  fontSize?: number;
  spinDuration?: number;
  arcLength?: number;
  drawDuration?: number;
  fillOpacity?: number;
  strike?: boolean;
  strikeDelay?: number;
  className?: string;
  style?: CSSProperties;
}

declare const StatusMark: (props: StatusMarkProps) => JSX.Element;
export default StatusMark;
