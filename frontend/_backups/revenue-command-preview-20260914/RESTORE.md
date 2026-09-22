# Revenue Command preview — rollback backup

Taken 2026-09-14, before the "Revenue Control Room" presentation overhaul.
This is the exact known-good version of Revenue Command the user reviewed
and approved as the fallback.

## To restore ("NAHH — RESTORE")

Copy every file below from this backup back to its original path,
overwriting the preview version. No debate, no partial restore.

| Backup path (relative to this folder) | Restore to |
|---|---|
| `app/(dashboard)/mission-control/page.tsx` | `frontend/app/(dashboard)/mission-control/page.tsx` |
| `app/(dashboard)/transactions/page.tsx` | `frontend/app/(dashboard)/transactions/page.tsx` |
| `components/kpi/KpiCards.tsx` | `frontend/components/kpi/KpiCards.tsx` |
| `components/revenue-leak/LeakBreakdownChart.tsx` | `frontend/components/revenue-leak/LeakBreakdownChart.tsx` |
| `components/recovery-brain/BrainPanel.tsx` | `frontend/components/recovery-brain/BrainPanel.tsx` |
| `components/action-blocked/ActionBlockedWow.tsx` | `frontend/components/action-blocked/ActionBlockedWow.tsx` |
| `components/opportunities/TopOpportunities.tsx` | `frontend/components/opportunities/TopOpportunities.tsx` |
| `components/live-activity/LiveActivityFeed.tsx` | `frontend/components/live-activity/LiveActivityFeed.tsx` |
| `components/audit/AuditLedgerTable.tsx` | `frontend/components/audit/AuditLedgerTable.tsx` |
| `components/simulator/RecoverySimulator.tsx` | `frontend/components/simulator/RecoverySimulator.tsx` |
| `components/drawer/TransactionDrawer.tsx` | `frontend/components/drawer/TransactionDrawer.tsx` |

Then delete the new preview-only files the overhaul added (safe to remove,
nothing else references them once the above are restored):

- `frontend/components/kpi/RecoveryPulseHeader.tsx`
- `frontend/components/kpi/RecoveryStatusPanel.tsx`
- `frontend/components/revenue-leak/RevenueRiskMap.tsx`
- `frontend/components/recovery-brain/RevoraActivity.tsx`
- `frontend/components/attention/NeedsAttention.tsx`

Of the eleven backed-up files, only five were actually modified in the
preview (`mission-control/page.tsx`, `transactions/page.tsx`, and the three
originals that were functionally replaced by the new components above —
`KpiCards.tsx`, `LeakBreakdownChart.tsx`, `BrainPanel.tsx`, which may have
been left in place unused or removed from the render tree). The rest were
backed up as a precaution and were not changed. Restoring all eleven is
always safe regardless.
