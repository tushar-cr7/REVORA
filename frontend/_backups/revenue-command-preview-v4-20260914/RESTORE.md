# Revenue Command preview v4 — rollback backup

Taken 2026-09-14, before the "final hero evolution" pass — pushing the
approved revenue-flow hero from "beautiful visualization" toward "REVORA
is actually controlling the flow of revenue" (live streams, engine-feel
core, recovery-conversion split, hover interaction). This captures the
hero exactly as approved before that pass. The lower sections (Activity,
Needs Attention, Recovery Status, Top Opportunities) are NOT touched by
this round and are not re-backed-up here — see v3's backup for those if
ever needed; this round only modifies the two files below.

Four backups now exist (v1 -> v4, oldest to newest). **This one (v4) is
what "NAHH — RESTORE" restores to for this round.**

## To restore to v4

| Backup path | Restore to |
|---|---|
| `components/flow/RevenueFlowSystem.tsx` | `frontend/components/flow/RevenueFlowSystem.tsx` |
| `components/ui/AnimatedNumber.tsx` | `frontend/components/ui/AnimatedNumber.tsx` |

`page.tsx` and every lower-section component are unchanged by this round,
so restoring these two files is a complete rollback.
