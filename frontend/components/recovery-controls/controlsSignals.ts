import { Intervention, Opportunity } from '@/lib/types';
import { deriveQueue } from '@/components/interventions/interventionSignals';

export { deriveQueue };

/**
 * Honest substitutes for the reference design's "Actions within limits,"
 * "Manually escalated," and "Customers contacted" figures. The backend
 * keeps no historical time series (in-memory only, resets on restart), so
 * a "last 30 days" or "this month" number could only ever be invented.
 * These are instead computed live from the same "decided" universe
 * Interventions and Analytics already use.
 */

const CONTACT_ACTIONS = new Set(['reminder', 'payment_link']);

export interface ControlsKpis {
  decidedCount: number;
  withinLimitsCount: number;
  withinLimitsPct: number;
  escalatedCount: number;
  escalatedPct: number;
  customersContacted: number;
}

export function computeControlsKpis(opportunities: Opportunity[], interventions: Intervention[]): ControlsKpis {
  const queue = deriveQueue(opportunities, interventions);
  const decidedCount = queue.length + interventions.length;

  const withinLimitsCount =
    queue.filter((o) => o.policy_allowed).length + interventions.filter((i) => i.policy_allowed).length;
  const escalatedCount =
    queue.filter((o) => o.recommended_action === 'escalate').length +
    interventions.filter((i) => i.final_action === 'escalate').length;

  const customersContacted = new Set(
    interventions.filter((i) => CONTACT_ACTIONS.has(i.final_action)).map((i) => i.customer_id)
  ).size;

  return {
    decidedCount,
    withinLimitsCount,
    withinLimitsPct: decidedCount > 0 ? (withinLimitsCount / decidedCount) * 100 : 0,
    escalatedCount,
    escalatedPct: decidedCount > 0 ? (escalatedCount / decidedCount) * 100 : 0,
    customersContacted,
  };
}
