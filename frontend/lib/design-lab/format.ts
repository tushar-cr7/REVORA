// Self-contained formatting helpers for the design lab.
// Deliberately NOT importing from the production frontend/lib/format.ts —
// the design lab must not depend on (or be able to break) production code.

export function formatINR(amount: number, compact = false): string {
  if (compact) {
    if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
    if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  }
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatCompactINR(amount: number): string {
  return formatINR(amount, true);
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

/** Deterministic "time ago" from a fixed reference clock, so server and client render identically. */
const REFERENCE_NOW = new Date('2026-09-11T15:00:00Z').getTime();

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = REFERENCE_NOW - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
