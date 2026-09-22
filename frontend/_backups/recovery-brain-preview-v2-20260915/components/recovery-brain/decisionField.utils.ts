import { Transaction, Decision, Opportunity } from '@/lib/types';

/** Deterministic PRNG so node jitter is stable across renders (no hydration mismatch). */
export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export type ActionKey = 'retry' | 'payment_link' | 'reminder' | 'escalate' | 'suppress';

export const LANES: { key: ActionKey; label: string }[] = [
  { key: 'retry', label: 'Retry' },
  { key: 'payment_link', label: 'Payment Link' },
  { key: 'reminder', label: 'Reminder' },
  { key: 'escalate', label: 'Escalate' },
  { key: 'suppress', label: 'Suppress' },
];

export const ACTION_COLOR: Record<string, string> = {
  retry: '#8FA3FF',
  payment_link: '#B69AFF',
  reminder: '#5FE3AD',
  escalate: '#FFD37A',
  suppress: '#6C7789',
};

export type ConfidenceTier = 'high' | 'medium' | 'low';

export function confidenceTier(p: number): ConfidenceTier {
  if (p >= 0.7) return 'high';
  if (p >= 0.4) return 'medium';
  return 'low';
}

export const TIER_META: Record<ConfidenceTier, { label: string; color: string }> = {
  high: { label: 'High confidence', color: 'text-success-300' },
  medium: { label: 'Medium confidence', color: 'text-ai-300' },
  low: { label: 'Low confidence', color: 'text-text-muted' },
};

export interface FieldNode {
  opp: Opportunity;
  laneIndex: number;
  x: number;
  y: number;
  r: number;
  prominence: number; // 0..1, drives opacity/brightness at rest
}

export const VB_W = 760;
export const VB_H = 300;
const TOP_MARGIN = 26;
const SIDE_MARGIN = 34;
const LANE_H = (VB_H - TOP_MARGIN) / LANES.length;

/** Lays out opportunities into lane bands: x = recovery probability, y = lane band + stable jitter, r = amount magnitude. */
export function layoutField(opportunities: Opportunity[], compact: boolean = false): FieldNode[] {
  if (opportunities.length === 0) return [];

  const amounts = opportunities.map((o) => o.amount);
  const minAmt = Math.min(...amounts);
  const maxAmt = Math.max(...amounts);
  const ampRange = Math.max(1, maxAmt - minAmt);

  const prominenceRaw = opportunities.map((o) => o.recovery_probability * o.expected_recovery);
  const maxProm = Math.max(...prominenceRaw, 1);

  return opportunities.map((opp, i) => {
    const laneIndex = Math.max(0, LANES.findIndex((l) => l.key === opp.recommended_action));
    const rng = mulberry32(hashString(opp.leak_id || opp.transaction_id || String(i)));

    const confidence = Math.min(1, Math.max(0, opp.recovery_probability));
    const x = SIDE_MARGIN + confidence * (VB_W - SIDE_MARGIN * 2);

    const laneTop = TOP_MARGIN + laneIndex * LANE_H;
    const jitter = (rng() - 0.5) * (LANE_H * 0.56);
    const y = laneTop + LANE_H / 2 + jitter;

    const sizeT = (opp.amount - minAmt) / ampRange;
    const r = compact ? 3.4 + sizeT * 5.2 : 2.1 + sizeT * 3.6;

    const prominence = Math.max(0.12, Math.min(1, prominenceRaw[i] / maxProm));

    return { opp, laneIndex, x, y, r, prominence };
  });
}

export function laneY(laneIndex: number) {
  return TOP_MARGIN + laneIndex * LANE_H;
}

export { LANE_H, TOP_MARGIN, SIDE_MARGIN };

/** Business-facing "why" bullets computed only from real transaction/decision fields — never fabricated. */
export function buildWhyBullets(tx: Transaction | null, decision: Decision | null): string[] {
  if (!tx) return [];
  const bullets: string[] = [];

  if (decision && decision.candidates_evaluated?.length) {
    const ranked = [...decision.candidates_evaluated].sort((a, b) => b.expected_value - a.expected_value);
    const rank = ranked.findIndex((c) => c.action === decision.final_action);
    const n = ranked.length;
    if (rank === 0) {
      bullets.push(`Highest expected value among ${n} recovery paths REVORA evaluated`);
    } else if (rank > 0) {
      bullets.push(`Selected after policy review of ${n} evaluated recovery paths`);
    }
  }

  if (tx.prior_successful_payments >= 3) {
    bullets.push(`${tx.prior_successful_payments} prior successful payments from this customer`);
  } else if (tx.prior_successful_payments === 0) {
    bullets.push('No prior payment history on file for this customer');
  }

  if (tx.retries_so_far === 0) {
    bullets.push('No previous recovery attempts made on this transaction');
  } else {
    bullets.push(`${tx.retries_so_far} previous retry attempt${tx.retries_so_far === 1 ? '' : 's'} already made`);
  }

  if (tx.ltv_bucket === 'high') {
    bullets.push('High lifetime-value customer segment');
  }

  if (tx.hours_since_event <= 24) {
    bullets.push('Recent failure — within the optimal recovery window');
  }

  return bullets.slice(0, 4);
}
