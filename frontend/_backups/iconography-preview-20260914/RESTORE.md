# Iconography system pass — rollback backup

Taken 2026-09-14, before replacing the generic/inconsistent icon set across
the sidebar and page headers with a coherent REVORA icon system. Purely a
visual pass — no layout, functionality, API, or hero-visual changes.

## To restore ("NAHH — RESTORE")

Copy every file below back to its original path.

| Backup path | Restore to |
|---|---|
| `components/layout/Sidebar.tsx` | `frontend/components/layout/Sidebar.tsx` |
| `app/(dashboard)/transactions/page.tsx` | `frontend/app/(dashboard)/transactions/page.tsx` |
| `app/(dashboard)/recovery-brain/page.tsx` | `frontend/app/(dashboard)/recovery-brain/page.tsx` |
| `app/(dashboard)/copilot/page.tsx` | `frontend/app/(dashboard)/copilot/page.tsx` |
| `app/(dashboard)/settings/page.tsx` | `frontend/app/(dashboard)/settings/page.tsx` |
| `app/(dashboard)/policies/page.tsx` | `frontend/app/(dashboard)/policies/page.tsx` |
| `app/(dashboard)/audit/page.tsx` | `frontend/app/(dashboard)/audit/page.tsx` |
| `app/(dashboard)/analytics/page.tsx` | `frontend/app/(dashboard)/analytics/page.tsx` |
| `app/(dashboard)/integrations/page.tsx` | `frontend/app/(dashboard)/integrations/page.tsx` |
| `app/(dashboard)/revenue-scanner/page.tsx` | `frontend/app/(dashboard)/revenue-scanner/page.tsx` |
| `app/(dashboard)/escalations/page.tsx` | `frontend/app/(dashboard)/escalations/page.tsx` |
| `app/(dashboard)/interventions/page.tsx` | `frontend/app/(dashboard)/interventions/page.tsx` |
| `components/audit/AuditLedgerTable.tsx` | `frontend/components/audit/AuditLedgerTable.tsx` |
| `components/recovery-brain/BrainPanel.tsx` | `frontend/components/recovery-brain/BrainPanel.tsx` |
| `components/kpi/KpiCards.tsx` | `frontend/components/kpi/KpiCards.tsx` |
| `components/drawer/TransactionDrawer.tsx` | `frontend/components/drawer/TransactionDrawer.tsx` |
| `components/action-blocked/ActionBlockedWow.tsx` | `frontend/components/action-blocked/ActionBlockedWow.tsx` |
| `components/simulator/RecoverySimulator.tsx` | `frontend/components/simulator/RecoverySimulator.tsx` |

The six component files carry the same destination icons *inside* pages (the
audit ledger panel, the Recovery Brain panel, the transaction drawer's tabs,
the policy simulator). Leaving them on the old icons would have made the new
sidebar/header set look broken rather than coherent, so they moved with it.

`mission-control/page.tsx` was not touched (it already had no header icon
box, consistent with the new system) and needs no restore.

## What this pass changed, for reference

New coherent icon set (same icon used in both the sidebar and that page's
own header, where a header icon remains):

| Page | Old (sidebar / header) | New |
|---|---|---|
| Revenue Command | LayoutDashboard / (none) | LayoutDashboard / (none, unchanged) |
| Revenue Scanner | Radar / Radar | ScanLine / (icon removed — has its own hero visual) |
| Recovery Brain | BrainCircuit / BrainCircuit | Network |
| Transactions | Receipt / Receipt | Rows3 |
| Interventions | Zap / Zap | Crosshair |
| Recovery Controls | ShieldCheck / Lock (inconsistent) | SlidersHorizontal |
| Escalations | AlertTriangle / AlertTriangle | CircleAlert |
| Audit Trail | FileSpreadsheet / FileSpreadsheet | History |
| Analytics | BarChart3 / Activity (inconsistent) | TrendingUp |
| Integrations | Sliders / Sliders | Waypoints |
| Settings | Settings / Settings | Settings (unchanged) |
| AI Copilot | Bot / Bot | Sparkles |

Page-header icon containers (the colored rounded-square boxes) were removed
in favor of a bare, muted icon directly beside the title, except Revenue
Scanner where the header icon was removed entirely (it already has a
strong signature hero visualization).

Icon state rules applied: default `text-text-muted` at `strokeWidth 1.75`;
hover lifts to `text-text-secondary`; active nav is `text-primary-400` plus
the existing left rail. Semantic color is reserved for real status meaning
(ShieldCheck/ShieldAlert, CheckCircle2, risk/warning/success badges), which
was left untouched — nav and header icons carry no per-item color.

Two icons that were never navigation identity also changed, because their
old glyphs were retired from the app: Analytics' "Pipeline Funnel" section
went `BarChart3` -> `Filter` (an actual funnel), and the Policy Simulator's
empty-chart placeholder went `BarChart3` -> `TrendingUp`.

`Zap` was deliberately NOT changed. It is used app-wide as the verb
"execute a recovery", including inside the protected Revenue Command hero
surfaces, so it stays one concept with one glyph. Only the Interventions
*destination* moved to `Crosshair`.
