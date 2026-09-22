// =========================================================================
// REVORA DESIGN LAB — shared synthetic data contract
// =========================================================================
// Every concept (A/B/C) and the landing page reads from THIS module only.
// It is the single source of truth for every number shown anywhere in the
// design lab, so any two screens — in the same concept or across concepts —
// are guaranteed to agree with each other. Nothing here is random at
// render time: all "generated" lists use a fixed seed, so the numbers are
// identical on every load and identical between server render and client
// hydration.
//
// This file is 100% self-contained. It does not import anything from the
// production app (lib/api.ts, lib/types.ts, etc.) — the design lab must be
// able to change freely without risk to, or dependency on, production code.
// =========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeakType = 'failed_payment' | 'abandoned_checkout' | 'failed_subscription' | 'overdue_invoice';
export type ActionType = 'retry' | 'payment_link' | 'reminder' | 'escalate' | 'suppress';
export type Priority = 'high' | 'medium' | 'low';

export const LEAK_TYPES: LeakType[] = ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'];

export const LEAK_LABELS: Record<LeakType, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Failed subscription',
  overdue_invoice: 'Overdue invoice',
};

export const ACTION_LABELS: Record<ActionType, string> = {
  retry: 'Retry payment',
  payment_link: 'Send payment link',
  reminder: 'Send reminder',
  escalate: 'Escalate for review',
  suppress: 'No action',
};

export interface Opportunity {
  id: string;
  customer: string;
  amount: number;
  potentialRecovery: number;
  leakType: LeakType;
  issue: string;
  recommendedAction: ActionType;
  why: string;
  priority: Priority;
  status: 'open' | 'in_progress' | 'recovered' | 'needs_review';
  safetyCheck: 'passed' | 'paused';
  safetyReason?: string;
  createdAt: string;
}

export interface TransactionRow {
  id: string;
  customer: string;
  amount: number;
  leakType: LeakType;
  paymentMethod: string;
  date: string;
  status: 'at_risk' | 'recovered' | 'not_pursued' | 'needs_review';
}

export interface ActivityEntry {
  id: string;
  action: ActionType;
  customer: string;
  amount: number;
  reason: string;
  status: 'completed' | 'sent' | 'paused' | 'failed';
  recovered: boolean;
  timestamp: string;
  leakType: LeakType;
}

export interface AttentionItem {
  id: string;
  customer: string;
  amount: number;
  leakType: LeakType;
  issue: string;
  whyAttention: string;
  recommendedNextStep: string;
  ageDays: number;
}

export interface DecisionEntry {
  id: string;
  customer: string;
  amount: number;
  recommendation: ActionType;
  why: string;
  safetyCheck: 'passed' | 'paused';
  safetyReason?: string;
  nextStep: string;
  timestamp: string;
}

export interface AuditEntry {
  id: string;
  time: string;
  headline: string;
  detail?: string;
  customer: string;
  amount?: number;
  recovered?: boolean;
}

export interface IntegrationItem {
  name: string;
  category: 'Payments' | 'Billing' | 'Commerce' | 'Data';
  status: 'connected' | 'available' | 'simulated' | 'coming_soon';
  description: string;
}

export interface CopilotExchange {
  question: string;
  headline: string;
  body: string;
  metrics: { label: string; value: string }[];
}

export interface RecoveryControl {
  label: string;
  value: string;
  description: string;
}

export interface TrendPoint {
  label: string;
  atRisk: number;
  recovered: number;
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (mulberry32) — fixed seed, same output always.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const int = (min: number, max: number) => Math.floor(min + rng() * (max - min + 1));

const CUSTOMERS = [
  'Acme Media', 'Northwind Traders', 'Bluepeak Studio', 'Solace Wellness', 'Harborline Logistics',
  'Cedarbrook Fitness', 'Vantage Analytics', 'Fernwood & Co', 'Orbit Learning', 'Redcliff Homeware',
  'Meridian Events', 'Kestrel Design', 'Lumen Coworking', 'Alderfield Foods', 'Tidewater SaaS',
  'Pinehill Apparel', 'Granite Consulting', 'Wavelength Studio', 'Copperline Coffee', 'Silverton Legal',
  'Marbrook Interiors', 'Starling Gyms', 'Elmswood Press', 'Anchorpoint Realty', 'Brightfield Retail',
  'Cascade Software', 'Driftwood Travel', 'Ivywell Clinic', 'Junction Books', 'Lakemont Academy',
];

const PAYMENT_METHODS = ['Visa •• 4821', 'Mastercard •• 1190', 'UPI', 'Net Banking', 'Amex •• 3007', 'RuPay •• 5542'];

const ISSUE_TEXT: Record<LeakType, string[]> = {
  failed_payment: ['Card declined on renewal', 'Insufficient funds on last attempt', 'Bank flagged the charge for review'],
  abandoned_checkout: ['Left checkout after entering payment details', 'Cart abandoned at final step', 'Session expired before payment'],
  failed_subscription: ['Subscription renewal failed', 'Recurring charge declined twice', 'Card on file expired'],
  overdue_invoice: ['Invoice unpaid past due date', 'No response to first reminder', 'Payment terms lapsed'],
};

const WHY_TEXT: Record<ActionType, string[]> = {
  retry: [
    'Recent payment activity suggests this customer is likely to complete the payment.',
    'The card has succeeded on similar recent attempts — a retry has a strong chance of working.',
    'This looks like a temporary decline rather than a closed account.',
  ],
  payment_link: [
    'A fresh, trackable payment link converts well for this type of checkout drop-off.',
    'The customer reached checkout before, so a direct link removes the friction that stopped them.',
  ],
  reminder: [
    'A single reminder is usually enough to prompt payment for a customer with this history.',
    'This customer has paid promptly before — a nudge is likely sufficient.',
  ],
  escalate: [
    'This case sits outside what REVORA can safely resolve automatically.',
    'The amount and history here call for a human decision before proceeding.',
  ],
  suppress: [
    'Contacting this customer again today would exceed your configured limits.',
    'Recognizing when not to act protects the customer relationship.',
  ],
};

function iso(daysAgo: number, hour = 9, minute = 0): string {
  const d = new Date('2026-09-11T15:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Top-line metrics — every derived percentage below is computed from these,
// never hand-typed twice, so nothing can drift out of sync.
// ---------------------------------------------------------------------------

export const TOTAL_AT_RISK = 24_586_000; // ₹245.86L
export const TOTAL_RECOVERED = 4_845_000; // ₹48.45L
export const RECOVERY_RATE = (TOTAL_RECOVERED / TOTAL_AT_RISK) * 100; // 19.7%
export const POTENTIAL_RECOVERY = 11_050_000; // ₹110.50L — the subset of at-risk revenue REVORA judges worth pursuing
export const AT_RISK_TRANSACTION_COUNT = 1240;
export const RECOVERED_TRANSACTION_COUNT = 346;

export const LEAK_BREAKDOWN: { leakType: LeakType; amount: number; count: number }[] = [
  { leakType: 'failed_payment', amount: 9_342_680, count: 470 },
  { leakType: 'abandoned_checkout', amount: 3_687_900, count: 186 },
  { leakType: 'failed_subscription', amount: 1_721_420, count: 87 },
  { leakType: 'overdue_invoice', amount: 9_834_000, count: 497 },
];

export const ACTION_BREAKDOWN: { action: ActionType; count: number }[] = [
  { action: 'retry', count: 512 },
  { action: 'payment_link', count: 338 },
  { action: 'reminder', count: 96 },
  { action: 'escalate', count: 214 },
  { action: 'suppress', count: 80 },
];

export const ATTEMPTED_COUNT = ACTION_BREAKDOWN.filter((a) => ['retry', 'payment_link', 'reminder'].includes(a.action)).reduce((s, a) => s + a.count, 0);
export const SUCCESS_RATE = (RECOVERED_TRANSACTION_COUNT / ATTEMPTED_COUNT) * 100;
export const ESCALATED_COUNT = ACTION_BREAKDOWN.find((a) => a.action === 'escalate')!.count;
export const SUPPRESSED_COUNT = ACTION_BREAKDOWN.find((a) => a.action === 'suppress')!.count;

// ---------------------------------------------------------------------------
// Recovery Controls (customer-facing framing of the real policy defaults)
// ---------------------------------------------------------------------------

export const RECOVERY_CONTROLS: RecoveryControl[] = [
  {
    label: 'Automatic retries',
    value: 'At most 2 attempts',
    description: 'REVORA will not retry a payment more than twice within the configured cooldown period.',
  },
  {
    label: 'Cooldown between retries',
    value: '6 hours',
    description: 'REVORA waits at least this long before trying the same payment again.',
  },
  {
    label: 'Customer contact limit',
    value: '1 per day',
    description: 'REVORA will not contact the same customer more than once in a single day.',
  },
  {
    label: 'Automatic recovery ceiling',
    value: '₹25,000',
    description: 'Recoveries above this amount always wait for your review before REVORA acts.',
  },
  {
    label: 'Subscription failure limit',
    value: '2 consecutive failures',
    description: 'REVORA stops retrying a subscription automatically after this many failures in a row.',
  },
  {
    label: 'Overdue invoice threshold',
    value: '30 days',
    description: 'Invoices overdue longer than this are routed to you instead of another automatic reminder.',
  },
];

// ---------------------------------------------------------------------------
// Opportunities — hand-authored for quality and narrative variety.
// ---------------------------------------------------------------------------

export const OPPORTUNITIES: Opportunity[] = [
  { id: 'opp_1001', customer: 'Acme Media', amount: 18400, potentialRecovery: 13900, leakType: 'failed_subscription', issue: 'Subscription payment failed', recommendedAction: 'retry', why: WHY_TEXT.retry[0], priority: 'high', status: 'open', safetyCheck: 'passed', createdAt: iso(0, 8, 12) },
  { id: 'opp_1002', customer: 'Harborline Logistics', amount: 48000, potentialRecovery: 34500, leakType: 'overdue_invoice', issue: 'Invoice 61 days overdue', recommendedAction: 'escalate', why: WHY_TEXT.escalate[1], priority: 'high', status: 'needs_review', safetyCheck: 'paused', safetyReason: 'Invoice older than 30 days — requires your review.', createdAt: iso(0, 7, 40) },
  { id: 'opp_1003', customer: 'Bluepeak Studio', amount: 6200, potentialRecovery: 5100, leakType: 'abandoned_checkout', issue: 'Left checkout after entering card', recommendedAction: 'payment_link', why: WHY_TEXT.payment_link[0], priority: 'medium', status: 'open', safetyCheck: 'passed', createdAt: iso(0, 6, 55) },
  { id: 'opp_1004', customer: 'Vantage Analytics', amount: 31200, potentialRecovery: 27400, leakType: 'failed_payment', issue: 'Card declined on renewal', recommendedAction: 'retry', why: WHY_TEXT.retry[1], priority: 'high', status: 'open', safetyCheck: 'passed', createdAt: iso(1, 14, 5) },
  { id: 'opp_1005', customer: 'Solace Wellness', amount: 4300, potentialRecovery: 3800, leakType: 'failed_payment', issue: 'Insufficient funds on last attempt', recommendedAction: 'retry', why: WHY_TEXT.retry[2], priority: 'low', status: 'in_progress', safetyCheck: 'passed', createdAt: iso(1, 11, 20) },
  { id: 'opp_1006', customer: 'Cedarbrook Fitness', amount: 9800, potentialRecovery: 8200, leakType: 'failed_subscription', issue: 'Recurring charge declined twice', recommendedAction: 'escalate', why: WHY_TEXT.escalate[0], priority: 'medium', status: 'needs_review', safetyCheck: 'paused', safetyReason: 'Retry limit exceeded (2/2) for this subscription.', createdAt: iso(1, 9, 0) },
  { id: 'opp_1007', customer: 'Fernwood & Co', amount: 62000, potentialRecovery: 44900, leakType: 'overdue_invoice', issue: 'Invoice unpaid past due date', recommendedAction: 'reminder', why: WHY_TEXT.reminder[0], priority: 'high', status: 'open', safetyCheck: 'passed', createdAt: iso(2, 16, 30) },
  { id: 'opp_1008', customer: 'Orbit Learning', amount: 2100, potentialRecovery: 1750, leakType: 'abandoned_checkout', issue: 'Cart abandoned at final step', recommendedAction: 'payment_link', why: WHY_TEXT.payment_link[1], priority: 'low', status: 'open', safetyCheck: 'passed', createdAt: iso(2, 10, 15) },
  { id: 'opp_1009', customer: 'Redcliff Homeware', amount: 15600, potentialRecovery: 12300, leakType: 'failed_payment', issue: 'Bank flagged the charge for review', recommendedAction: 'retry', why: WHY_TEXT.retry[0], priority: 'medium', status: 'open', safetyCheck: 'passed', createdAt: iso(2, 8, 45) },
  { id: 'opp_1010', customer: 'Meridian Events', amount: 27400, potentialRecovery: 0, leakType: 'failed_subscription', issue: 'Card on file expired', recommendedAction: 'suppress', why: WHY_TEXT.suppress[0], priority: 'low', status: 'in_progress', safetyCheck: 'paused', safetyReason: 'Daily customer contact limit already reached.', createdAt: iso(3, 13, 10) },
  { id: 'opp_1011', customer: 'Kestrel Design', amount: 5400, potentialRecovery: 4600, leakType: 'abandoned_checkout', issue: 'Session expired before payment', recommendedAction: 'payment_link', why: WHY_TEXT.payment_link[0], priority: 'medium', status: 'open', safetyCheck: 'passed', createdAt: iso(3, 9, 25) },
  { id: 'opp_1012', customer: 'Lumen Coworking', amount: 84000, potentialRecovery: 0, leakType: 'overdue_invoice', issue: 'No response to first reminder', recommendedAction: 'escalate', why: WHY_TEXT.escalate[1], priority: 'high', status: 'needs_review', safetyCheck: 'paused', safetyReason: 'Amount exceeds auto-recovery ceiling (₹25,000).', createdAt: iso(3, 17, 0) },
  { id: 'opp_1013', customer: 'Alderfield Foods', amount: 3600, potentialRecovery: 3100, leakType: 'failed_payment', issue: 'Card declined on renewal', recommendedAction: 'retry', why: WHY_TEXT.retry[1], priority: 'low', status: 'recovered', safetyCheck: 'passed', createdAt: iso(4, 8, 0) },
  { id: 'opp_1014', customer: 'Tidewater SaaS', amount: 41500, potentialRecovery: 35200, leakType: 'failed_subscription', issue: 'Subscription renewal failed', recommendedAction: 'retry', why: WHY_TEXT.retry[0], priority: 'high', status: 'open', safetyCheck: 'passed', createdAt: iso(4, 12, 40) },
  { id: 'opp_1015', customer: 'Pinehill Apparel', amount: 7800, potentialRecovery: 6500, leakType: 'abandoned_checkout', issue: 'Left checkout after entering card', recommendedAction: 'payment_link', why: WHY_TEXT.payment_link[1], priority: 'medium', status: 'open', safetyCheck: 'passed', createdAt: iso(5, 10, 5) },
  { id: 'opp_1016', customer: 'Granite Consulting', amount: 56000, potentialRecovery: 39400, leakType: 'overdue_invoice', issue: 'Payment terms lapsed', recommendedAction: 'reminder', why: WHY_TEXT.reminder[1], priority: 'high', status: 'open', safetyCheck: 'passed', createdAt: iso(5, 15, 20) },
  { id: 'opp_1017', customer: 'Wavelength Studio', amount: 12900, potentialRecovery: 10800, leakType: 'failed_payment', issue: 'Insufficient funds on last attempt', recommendedAction: 'retry', why: WHY_TEXT.retry[2], priority: 'medium', status: 'open', safetyCheck: 'passed', createdAt: iso(6, 9, 50) },
  { id: 'opp_1018', customer: 'Copperline Coffee', amount: 2900, potentialRecovery: 2400, leakType: 'failed_subscription', issue: 'Subscription renewal failed', recommendedAction: 'retry', why: WHY_TEXT.retry[0], priority: 'low', status: 'open', safetyCheck: 'passed', createdAt: iso(6, 11, 15) },
];

// ---------------------------------------------------------------------------
// Attention items (escalations) — a curated subset with fuller narrative.
// ---------------------------------------------------------------------------

export const ATTENTION_ITEMS: AttentionItem[] = [
  { id: 'att_1', customer: 'Harborline Logistics', amount: 48000, leakType: 'overdue_invoice', issue: 'Invoice 61 days overdue', whyAttention: 'Automated recovery is no longer recommended — the invoice has aged well past your review threshold.', recommendedNextStep: 'Reach out directly or extend payment terms.', ageDays: 61 },
  { id: 'att_2', customer: 'Lumen Coworking', amount: 84000, leakType: 'overdue_invoice', issue: 'No response to first reminder', whyAttention: 'This amount is above your automatic recovery ceiling, so REVORA held it for your review.', recommendedNextStep: 'Approve a payment plan or escalate to collections.', ageDays: 34 },
  { id: 'att_3', customer: 'Cedarbrook Fitness', amount: 9800, leakType: 'failed_subscription', issue: 'Recurring charge declined twice', whyAttention: "REVORA already tried twice — retrying again would exceed the retry limit you've set.", recommendedNextStep: 'Ask the customer to update their card on file.', ageDays: 9 },
  { id: 'att_4', customer: 'Meridian Events', amount: 27400, leakType: 'failed_subscription', issue: 'Card on file expired', whyAttention: "REVORA already reached out to this customer today, so it held off on a second contact.", recommendedNextStep: 'Send a personal follow-up when convenient.', ageDays: 5 },
  { id: 'att_5', customer: 'Anchorpoint Realty', amount: 112000, leakType: 'overdue_invoice', issue: 'Invoice 45 days overdue, largest outstanding balance', whyAttention: 'High-value, aged invoice — outside what REVORA will resolve automatically.', recommendedNextStep: 'Loop in account management for a direct conversation.', ageDays: 45 },
  { id: 'att_6', customer: 'Starling Gyms', amount: 6400, leakType: 'failed_subscription', issue: 'Three consecutive subscription failures', whyAttention: 'This subscription has failed too many times in a row to keep retrying automatically.', recommendedNextStep: 'Consider pausing the subscription instead of cancelling.', ageDays: 12 },
  { id: 'att_7', customer: 'Brightfield Retail', amount: 33500, leakType: 'overdue_invoice', issue: 'Invoice 38 days overdue', whyAttention: 'Past your escalation threshold for overdue invoices.', recommendedNextStep: 'Confirm the invoice was received before escalating.', ageDays: 38 },
  { id: 'att_8', customer: 'Driftwood Travel', amount: 19200, leakType: 'failed_payment', issue: 'Card repeatedly declined, possible fraud flag', whyAttention: 'Repeated declines on this card may indicate a closed account rather than a temporary issue.', recommendedNextStep: 'Ask the customer for an alternate payment method.', ageDays: 7 },
];

// ---------------------------------------------------------------------------
// Decision entries — the "recommendation → safety check → next step" story
// at an aggregate level, distinct from a single opportunity's detail view.
// ---------------------------------------------------------------------------

export const DECISIONS: DecisionEntry[] = [
  { id: 'dec_1', customer: 'Acme Media', amount: 18400, recommendation: 'retry', why: WHY_TEXT.retry[0], safetyCheck: 'passed', nextStep: 'Retry scheduled within the hour.', timestamp: iso(0, 8, 12) },
  { id: 'dec_2', customer: 'Harborline Logistics', amount: 48000, recommendation: 'escalate', why: WHY_TEXT.escalate[1], safetyCheck: 'paused', safetyReason: 'Invoice older than 30 days — requires escalation.', nextStep: 'Sent to your review queue.', timestamp: iso(0, 7, 40) },
  { id: 'dec_3', customer: 'Vantage Analytics', amount: 31200, recommendation: 'retry', why: WHY_TEXT.retry[1], safetyCheck: 'passed', nextStep: 'Retry completed successfully.', timestamp: iso(1, 14, 5) },
  { id: 'dec_4', customer: 'Cedarbrook Fitness', amount: 9800, recommendation: 'retry', why: WHY_TEXT.retry[2], safetyCheck: 'paused', safetyReason: 'Retry limit exceeded (2/2).', nextStep: 'Rerouted to escalation instead.', timestamp: iso(1, 9, 0) },
  { id: 'dec_5', customer: 'Fernwood & Co', amount: 62000, recommendation: 'reminder', why: WHY_TEXT.reminder[0], safetyCheck: 'passed', nextStep: 'Reminder sent.', timestamp: iso(2, 16, 30) },
  { id: 'dec_6', customer: 'Meridian Events', amount: 27400, recommendation: 'reminder', why: WHY_TEXT.reminder[1], safetyCheck: 'paused', safetyReason: 'Daily customer contact limit reached.', nextStep: 'Held until tomorrow.', timestamp: iso(3, 13, 10) },
  { id: 'dec_7', customer: 'Lumen Coworking', amount: 84000, recommendation: 'escalate', why: WHY_TEXT.escalate[0], safetyCheck: 'paused', safetyReason: 'Amount exceeds auto-recovery ceiling (₹25,000).', nextStep: 'Sent to your review queue.', timestamp: iso(3, 17, 0) },
  { id: 'dec_8', customer: 'Tidewater SaaS', amount: 41500, recommendation: 'retry', why: WHY_TEXT.retry[0], safetyCheck: 'passed', nextStep: 'Retry scheduled.', timestamp: iso(4, 12, 40) },
  { id: 'dec_9', customer: 'Granite Consulting', amount: 56000, recommendation: 'reminder', why: WHY_TEXT.reminder[1], safetyCheck: 'passed', nextStep: 'Reminder sent.', timestamp: iso(5, 15, 20) },
  { id: 'dec_10', customer: 'Anchorpoint Realty', amount: 112000, recommendation: 'escalate', why: WHY_TEXT.escalate[1], safetyCheck: 'paused', safetyReason: 'Amount exceeds auto-recovery ceiling (₹25,000).', nextStep: 'Sent to your review queue.', timestamp: iso(6, 9, 0) },
  { id: 'dec_11', customer: 'Starling Gyms', amount: 6400, recommendation: 'retry', why: WHY_TEXT.retry[2], safetyCheck: 'paused', safetyReason: 'Consecutive subscription failures exceed retry threshold.', nextStep: 'Rerouted to escalation instead.', timestamp: iso(6, 11, 30) },
  { id: 'dec_12', customer: 'Bluepeak Studio', amount: 6200, recommendation: 'payment_link', why: WHY_TEXT.payment_link[0], safetyCheck: 'passed', nextStep: 'Payment link sent.', timestamp: iso(0, 6, 55) },
];

// ---------------------------------------------------------------------------
// Transactions & Activity — deterministic generated lists for volume.
// ---------------------------------------------------------------------------

function buildTransactions(): TransactionRow[] {
  const rows: TransactionRow[] = [];
  let n = 0;
  for (const bucket of LEAK_BREAKDOWN) {
    const rowCount = Math.round(bucket.count / 6); // sample a representative subset, not all 1240
    for (let i = 0; i < rowCount; i++) {
      n += 1;
      const amount = Math.round((bucket.amount / bucket.count) * (0.4 + rng() * 1.3));
      const statusRoll = rng();
      const status: TransactionRow['status'] = statusRoll < 0.28 ? 'recovered' : statusRoll < 0.42 ? 'needs_review' : statusRoll < 0.5 ? 'not_pursued' : 'at_risk';
      rows.push({
        id: `txn_${1000 + n}`,
        customer: pick(CUSTOMERS),
        amount,
        leakType: bucket.leakType,
        paymentMethod: pick(PAYMENT_METHODS),
        date: iso(int(0, 27), int(7, 19), int(0, 59)),
        status,
      });
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}
export const TRANSACTIONS: TransactionRow[] = buildTransactions();

function buildActivity(): ActivityEntry[] {
  const rows: ActivityEntry[] = [];
  for (const bucket of ACTION_BREAKDOWN) {
    const rowCount = Math.round(bucket.count / 8);
    for (let i = 0; i < rowCount; i++) {
      const leakType = pick(LEAK_TYPES);
      const amount = int(800, 62000);
      const recovered = bucket.action === 'retry' || bucket.action === 'payment_link' ? rng() < 0.42 : bucket.action === 'reminder' ? rng() < 0.3 : false;
      const status: ActivityEntry['status'] =
        bucket.action === 'suppress' ? 'paused' : bucket.action === 'escalate' ? 'paused' : recovered ? 'completed' : rng() < 0.15 ? 'failed' : 'sent';
      const reason =
        bucket.action === 'suppress'
          ? pick(WHY_TEXT.suppress)
          : bucket.action === 'escalate'
          ? pick(WHY_TEXT.escalate)
          : recovered
          ? 'Completed successfully.'
          : status === 'failed'
          ? 'Attempted — not yet recovered.'
          : 'Sent to customer.';
      rows.push({
        id: `act_${rows.length + 1}`,
        action: bucket.action,
        customer: pick(CUSTOMERS),
        amount,
        reason,
        status,
        recovered,
        timestamp: iso(int(0, 13), int(7, 20), int(0, 59)),
        leakType,
      });
    }
  }
  return rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}
export const ACTIVITY: ActivityEntry[] = buildActivity();

function buildAudit(): AuditEntry[] {
  const entries: AuditEntry[] = [];
  ACTIVITY.forEach((a) => {
    const recommended: AuditEntry = {
      id: `${a.id}_rec`,
      time: a.timestamp,
      headline: `${ACTION_LABELS[a.action]} recommended`,
      customer: a.customer,
      amount: a.amount,
    };
    entries.push(recommended);
    if (a.status === 'paused') {
      entries.push({
        id: `${a.id}_pause`,
        time: a.timestamp,
        headline: 'Action paused',
        detail: a.reason,
        customer: a.customer,
        amount: a.amount,
      });
    } else {
      entries.push({
        id: `${a.id}_exec`,
        time: a.timestamp,
        headline: a.recovered ? 'Recovery completed' : a.status === 'failed' ? 'Action attempted' : `${ACTION_LABELS[a.action]} sent`,
        customer: a.customer,
        amount: a.recovered ? a.amount : undefined,
        recovered: a.recovered,
      });
    }
  });
  return entries.sort((x, y) => (x.time < y.time ? 1 : -1));
}
export const AUDIT_TRAIL: AuditEntry[] = buildAudit();

// ---------------------------------------------------------------------------
// Trend data — 12 weeks, internally consistent with TOTAL_AT_RISK / RECOVERED.
// ---------------------------------------------------------------------------

export const TREND: TrendPoint[] = (() => {
  const weeks = 12;
  const points: TrendPoint[] = [];
  let atRiskBase = TOTAL_AT_RISK * 0.7;
  let recoveredBase = TOTAL_RECOVERED * 0.55;
  for (let i = 0; i < weeks; i++) {
    atRiskBase *= 1 + (rng() * 0.06 - 0.015);
    recoveredBase *= 1 + (rng() * 0.09 - 0.02);
    points.push({
      label: `W${i + 1}`,
      atRisk: Math.round(atRiskBase),
      recovered: Math.round(recoveredBase),
    });
  }
  // Force the final week to reconcile exactly with the headline totals.
  points[weeks - 1] = { label: `W${weeks}`, atRisk: TOTAL_AT_RISK, recovered: TOTAL_RECOVERED };
  return points;
})();

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export const INTEGRATIONS: IntegrationItem[] = [
  { name: 'Razorpay', category: 'Payments', status: 'simulated', description: 'Payment retries and links run in a sandboxed simulation today — no live charges are made.' },
  { name: 'Stripe', category: 'Payments', status: 'available', description: 'Connect a Stripe account to bring in real payment failure events.' },
  { name: 'PayPal', category: 'Payments', status: 'coming_soon', description: 'Support for PayPal recovery flows is planned.' },
  { name: 'Chargebee', category: 'Billing', status: 'available', description: 'Sync subscription and invoice data for recovery.' },
  { name: 'Recurly', category: 'Billing', status: 'coming_soon', description: 'Subscription billing sync is planned.' },
  { name: 'QuickBooks', category: 'Billing', status: 'available', description: 'Pull overdue invoices directly from your books.' },
  { name: 'Shopify', category: 'Commerce', status: 'available', description: 'Detect abandoned checkouts as they happen.' },
  { name: 'WooCommerce', category: 'Commerce', status: 'coming_soon', description: 'Storefront checkout recovery is planned.' },
  { name: 'Segment', category: 'Data', status: 'connected', description: 'Customer and event data flowing in for recovery scoring.' },
  { name: 'Google Sheets', category: 'Data', status: 'available', description: 'Export recovery activity and audit history on a schedule.' },
];

// ---------------------------------------------------------------------------
// Copilot canned exchanges
// ---------------------------------------------------------------------------

export const COPILOT_EXCHANGES: CopilotExchange[] = [
  {
    question: 'Why is recovery down this week?',
    headline: 'Recovery is down 6.2% compared with last week.',
    body: "The largest change is a 14% increase in failed subscription payments, concentrated among annual plans renewing this month. ₹38.2L is currently at risk from this group alone. Retry success on these accounts is running below average — most declines are expired cards rather than insufficient funds, so a payment-link nudge is likely to outperform another automatic retry.",
    metrics: [
      { label: 'At risk this week', value: '₹38.2L' },
      { label: 'vs last week', value: '−6.2%' },
      { label: 'Failed subscriptions', value: '+14%' },
    ],
  },
  {
    question: "What's my biggest recovery opportunity right now?",
    headline: 'Anchorpoint Realty — ₹1.12L outstanding.',
    body: 'This is your largest single opportunity this month. Because it exceeds your automatic recovery ceiling, REVORA has held it for your review rather than acting on it automatically. A direct conversation is likely to resolve it faster than another automated reminder.',
    metrics: [
      { label: 'Amount', value: '₹1,12,000' },
      { label: 'Age', value: '45 days' },
      { label: 'Recommended', value: 'Manual review' },
    ],
  },
  {
    question: 'Which recovery action is working best?',
    headline: 'Payment links are converting 3.1× better than reminders this month.',
    body: 'Across abandoned checkouts specifically, a direct payment link recovers revenue more reliably than a generic reminder — the friction of re-entering payment details is usually what stops the customer, not a lack of intent.',
    metrics: [
      { label: 'Payment link success', value: '41%' },
      { label: 'Reminder success', value: '13%' },
      { label: 'Sample size', value: '338 sends' },
    ],
  },
];
