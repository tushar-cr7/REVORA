# Revenue Command preview v2 — rollback backup

Taken 2026-09-14, before the "money in motion" visual evolution (flow
system, mission log, priority queue, etc). This is the exact 7.5/10
version the user reviewed and treated as the known-good fallback for
this round — the first overhaul (KPI cards -> Recovery Pulse/Risk
Map/Activity/Needs Attention/Status Panel), already itself a preview
on top of the original pre-overhaul dashboard.

There are now two backups. This one (v2) is the one to restore to if
the user says "NAHH — RESTORE" in response to THIS round's changes.
The original `revenue-command-preview-20260914/` (v1) restores all the
way back to the pre-overhaul dashboard and must not be touched or used
unless the user explicitly asks to go back further than v2.

## To restore to v2 ("NAHH — RESTORE")

Copy every file below from this backup back to its original path,
overwriting the newer preview.

| Backup path (relative to this folder) | Restore to |
|---|---|
| `app/(dashboard)/mission-control/page.tsx` | `frontend/app/(dashboard)/mission-control/page.tsx` |
| `app/(dashboard)/transactions/page.tsx` | `frontend/app/(dashboard)/transactions/page.tsx` |
| `components/kpi/RecoveryPulseHeader.tsx` | `frontend/components/kpi/RecoveryPulseHeader.tsx` |
| `components/kpi/RecoveryStatusPanel.tsx` | `frontend/components/kpi/RecoveryStatusPanel.tsx` |
| `components/revenue-leak/RevenueRiskMap.tsx` | `frontend/components/revenue-leak/RevenueRiskMap.tsx` |
| `components/recovery-brain/RevoraActivity.tsx` | `frontend/components/recovery-brain/RevoraActivity.tsx` |
| `components/attention/NeedsAttention.tsx` | `frontend/components/attention/NeedsAttention.tsx` |
| `components/action-blocked/ActionBlockedWow.tsx` | `frontend/components/action-blocked/ActionBlockedWow.tsx` |
| `components/opportunities/TopOpportunities.tsx` | `frontend/components/opportunities/TopOpportunities.tsx` |
| `components/live-activity/LiveActivityFeed.tsx` | `frontend/components/live-activity/LiveActivityFeed.tsx` |
| `components/audit/AuditLedgerTable.tsx` | `frontend/components/audit/AuditLedgerTable.tsx` |
| `components/simulator/RecoverySimulator.tsx` | `frontend/components/simulator/RecoverySimulator.tsx` |
| `components/drawer/TransactionDrawer.tsx` | `frontend/components/drawer/TransactionDrawer.tsx` |

Then delete the new files this round adds (safe to remove once the
above are restored):

- `frontend/components/flow/RevenueFlowSystem.tsx`
- `frontend/components/ui/AnimatedNumber.tsx`
- `frontend/components/recovery-brain/RevoraMissionLog.tsx` (replaces `RevoraActivity.tsx` — restore table above brings back the old one)

`RecoveryStatusPanel.tsx` and `NeedsAttention.tsx` were edited in place
this round (not replaced by new files) — the table above restores their
v2 (7.5/10) versions directly.
