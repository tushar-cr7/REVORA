import { RotateCw, IndianRupee, RefreshCcw, CalendarClock, UserCheck, ShieldQuestion, LucideIcon } from 'lucide-react';
import { ReasonKey } from './escalationSignals';

/** One restrained icon per escalation reason, matching REVORA's existing per-category iconography. */
export const REASON_ICON: Record<ReasonKey, LucideIcon> = {
  retry_limit: RotateCw,
  auto_recovery_ceiling: IndianRupee,
  subscription_threshold: RefreshCcw,
  invoice_age: CalendarClock,
  manual_review: UserCheck,
  policy_controlled: ShieldQuestion,
};

export function reasonIcon(key: ReasonKey): LucideIcon {
  return REASON_ICON[key];
}
