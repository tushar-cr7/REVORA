# Revenue Scanner preview v2 — rollback backup

Taken 2026-09-14, before the "X-ray / scan field" redesign. This captures
the flow-based scanner (streams converging into REVORA, mirroring Revenue
Command's visual language) — functionally solid and already reviewed as
a working preview, but flagged as too visually similar to Revenue Command.

Two backups now exist:
- v1 (`revenue-scanner-preview-20260914/`) — the very original conventional
  dashboard-style scanner.
- v2 (this one) — the flow-based redesign.

**This one (v2) is what "NAHH — RESTORE" restores to for this round.**

## To restore to v2

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/revenue-scanner/page.tsx` | `frontend/app/(dashboard)/revenue-scanner/page.tsx` |
| `components/scanner/ScannerFlowVisual.tsx` | `frontend/components/scanner/ScannerFlowVisual.tsx` |
| `components/scanner/ScanStages.tsx` | `frontend/components/scanner/ScanStages.tsx` |
| `components/scanner/ScanReportHeader.tsx` | `frontend/components/scanner/ScanReportHeader.tsx` |
| `components/scanner/RevenueLeakMap.tsx` | `frontend/components/scanner/RevenueLeakMap.tsx` |
| `components/scanner/ScanInsights.tsx` | `frontend/components/scanner/ScanInsights.tsx` |
| `components/scanner/RecommendedActions.tsx` | `frontend/components/scanner/RecommendedActions.tsx` |

Then delete any new files this round adds that aren't in the list above
(e.g. `TransactionField.tsx`, `RiskDensityMap.tsx`, `seededRandom.ts` if
added) — safe to remove once the files above are restored.
