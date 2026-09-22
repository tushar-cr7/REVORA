import { RotateCw, Link2, Bell, Flag, CircleSlash, LucideIcon } from 'lucide-react';

/** One restrained icon per action, matching REVORA's existing iconography system (1.75 stroke, muted by default). */
export const ACTION_ICON: Record<string, LucideIcon> = {
  retry: RotateCw,
  payment_link: Link2,
  reminder: Bell,
  escalate: Flag,
  suppress: CircleSlash,
};

export function actionIcon(action: string): LucideIcon {
  return ACTION_ICON[action] ?? RotateCw;
}
