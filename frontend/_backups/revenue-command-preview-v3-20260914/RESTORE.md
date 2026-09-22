# Revenue Command preview v3 — rollback backup

Taken 2026-09-14, before the "surgical polish pass" on the lower sections
(REVORA Activity, Needs Attention, Recovery Status). This captures the
"money in motion" flow-system version exactly as the user approved it as
the signature hero — that hero is NOT touched by the polish pass, but this
backup exists so the lower-section changes can be cleanly reverted without
losing anything if the user says "NAHH — RESTORE" in response to the
polish pass specifically.

There are now three backups:
- v1 (`revenue-command-preview-20260914/`) — pre-overhaul original dashboard.
- v2 (`revenue-command-preview-v2-20260914/`) — first overhaul (KPI cards -> Recovery Pulse/Risk Map/Activity/Needs Attention/Status Panel).
- v3 (this one) — the flow-system "money in motion" version, hero locked in.

**This one (v3) is what "NAHH — RESTORE" restores to for the polish pass.**
Do not touch v1 or v2 unless the user explicitly asks to go back further.

## To restore to v3

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/mission-control/page.tsx` | `frontend/app/(dashboard)/mission-control/page.tsx` |
| `components/flow/RevenueFlowSystem.tsx` | `frontend/components/flow/RevenueFlowSystem.tsx` |
| `components/ui/AnimatedNumber.tsx` | `frontend/components/ui/AnimatedNumber.tsx` |
| `components/kpi/RecoveryStatusPanel.tsx` | `frontend/components/kpi/RecoveryStatusPanel.tsx` |
| `components/recovery-brain/RevoraMissionLog.tsx` | `frontend/components/recovery-brain/RevoraMissionLog.tsx` |
| `components/attention/NeedsAttention.tsx` | `frontend/components/attention/NeedsAttention.tsx` |

The polish pass only edits files in place (no new component files added),
so restoring these six is a complete rollback.
