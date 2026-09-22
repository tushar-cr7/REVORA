import { Transaction } from '@/lib/types';

/**
 * Recovery-probability tiers. Thresholds match the ones already used
 * app-wide (Top Opportunities, Recovery Brain, the previous Transactions
 * table) — 70% and 40% — so a transaction reads the same wherever it
 * appears.
 */
export type RecoveryTier = 'high' | 'medium' | 'low' | 'unscored';

export function recoveryTier(prob: number | null | undefined): RecoveryTier {
  if (prob == null) return 'unscored';
  if (prob >= 0.7) return 'high';
  if (prob >= 0.4) return 'medium';
  return 'low';
}

export const TIER_META: Record<RecoveryTier, { label: string; text: string; pill: string; rail: string }> = {
  high: {
    label: 'High',
    text: 'text-success-300',
    pill: 'bg-success-muted text-success-300 border-success-500/30',
    rail: 'bg-success-500',
  },
  medium: {
    label: 'Medium',
    text: 'text-ai-300',
    pill: 'bg-ai-muted text-ai-300 border-ai-500/30',
    rail: 'bg-ai-500',
  },
  low: {
    label: 'Low',
    text: 'text-risk-300',
    pill: 'bg-risk-muted text-risk-300 border-risk-500/30',
    rail: 'bg-risk-500',
  },
  unscored: {
    label: 'Unscored',
    text: 'text-text-muted',
    pill: 'bg-surface text-text-muted border-border-subtle',
    rail: 'bg-border-strong',
  },
};

export const LEAK_META: Record<string, { label: string; color: string; bg: string }> = {
  failed_payment: { label: 'Failed Payment', color: 'text-risk-300', bg: 'bg-risk-muted border-risk-500/30' },
  abandoned_checkout: { label: 'Abandoned Checkout', color: 'text-warning-300', bg: 'bg-warning-muted border-warning-500/30' },
  failed_subscription: { label: 'Subscription Fail', color: 'text-ai-300', bg: 'bg-ai-muted border-ai-500/30' },
  overdue_invoice: { label: 'Overdue Invoice', color: 'text-primary-300', bg: 'bg-primary-muted border-primary-500/30' },
};

export const LEAK_TYPES = ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'] as const;

/** A transaction REVORA has already retried more than once — automated recovery is struggling. */
export const REPEATED_FAILURE_THRESHOLD = 2;
/** "Recent" window, in hours since the revenue event. */
export const RECENT_WINDOW_HOURS = 24;

export type SignalFilter = 'all' | 'high_recovery' | 'repeated_failures' | 'high_value' | 'recent';

export const SIGNAL_FILTERS: { key: SignalFilter; label: string }[] = [
  { key: 'high_recovery', label: 'High recovery' },
  { key: 'repeated_failures', label: 'Repeated failures' },
  { key: 'high_value', label: 'High value' },
  { key: 'recent', label: 'Recent' },
];

/**
 * High-value cutoff is the top third of the currently loaded set rather
 * than a hard-coded rupee figure, so it stays meaningful across datasets
 * without inventing a threshold.
 */
export function highValueCutoff(transactions: Transaction[]): number {
  if (transactions.length === 0) return Infinity;
  const sorted = transactions.map((t) => t.amount).sort((a, b) => b - a);
  return sorted[Math.floor(sorted.length * 0.33)] ?? sorted[sorted.length - 1];
}

export function matchesSignal(tx: Transaction, filter: SignalFilter, cutoff: number): boolean {
  switch (filter) {
    case 'high_recovery':
      return tx.model_recovery_prob != null && tx.model_recovery_prob >= 0.7;
    case 'repeated_failures':
      return tx.retries_so_far >= REPEATED_FAILURE_THRESHOLD;
    case 'high_value':
      return tx.amount >= cutoff;
    case 'recent':
      return tx.hours_since_event <= RECENT_WINDOW_HOURS;
    default:
      return true;
  }
}

export function matchesSearch(tx: Transaction, search: string): boolean {
  if (search === '') return true;
  const q = search.toLowerCase();
  return (
    tx.transaction_id.toLowerCase().includes(q) ||
    tx.customer_id.toLowerCase().includes(q) ||
    tx.leak_id.toLowerCase().includes(q)
  );
}

export interface LedgerSummary {
  exposure: number;
  count: number;
  /** null when nothing in the set has been scored by an intelligence pass yet. */
  highRecovery: number | null;
  repeatedFailures: number;
}

/** Every figure here is derived from the already-loaded records — nothing is fetched or invented. */
export function summarize(transactions: Transaction[]): LedgerSummary {
  const anyScored = transactions.some((t) => t.model_recovery_prob != null);
  return {
    exposure: transactions.reduce((sum, t) => sum + t.amount, 0),
    count: transactions.length,
    highRecovery: anyScored ? transactions.filter((t) => recoveryTier(t.model_recovery_prob) === 'high').length : null,
    repeatedFailures: transactions.filter((t) => t.retries_so_far >= REPEATED_FAILURE_THRESHOLD).length,
  };
}

export type SortKey = 'natural' | 'amount' | 'recovery' | 'age';
export type SortDir = 'asc' | 'desc';

/** Sorting is opt-in: 'natural' preserves the order the API returned. */
export function sortTransactions(transactions: Transaction[], key: SortKey, dir: SortDir): Transaction[] {
  if (key === 'natural') return transactions;
  const sign = dir === 'asc' ? 1 : -1;
  return [...transactions].sort((a, b) => {
    switch (key) {
      case 'amount':
        return (a.amount - b.amount) * sign;
      case 'recovery': {
        // Unscored transactions always sort last, regardless of direction.
        const pa = a.model_recovery_prob;
        const pb = b.model_recovery_prob;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return (pa - pb) * sign;
      }
      case 'age':
        return (a.hours_since_event - b.hours_since_event) * sign;
      default:
        return 0;
    }
  });
}
