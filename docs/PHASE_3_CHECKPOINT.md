# Phase 3 checkpoint — 3.0: workspace foundation and database-enforced demo isolation (2026-10-27)

Scope: the first increment of Phase 3 (merchant-data-first). It registers workspaces and makes the database refuse
synthetic demo data anywhere but in a registered demo workspace. **It is not authentication and not tenant isolation**:
nothing proves who is calling, and reads are not scoped by workspace yet. A passing suite is not a production-readiness
claim.

## 1. Migration `0003_workspaces.sql`

Forward-only, applied by the existing runner (checksummed, contiguous numbering, one transaction, advisory lock).
Migrations 0001 and 0002 are unchanged.

**`workspaces`** — `seq`, `workspace_id` (PK), `kind` (`demo` | `merchant`), `display_name`, `base_currency`
(`^[A-Z]{3}$`), `timezone`, `execution_mode` (`simulation` | `recommend_only`), `origin`
(`pre_phase3_backfill` | `demo_seed` | `explicit`), `created_at`.

| Constraint / trigger | Rule |
|---|---|
| `workspaces_merchant_never_simulates` | `kind = 'demo' OR execution_mode = 'recommend_only'` — real records never get a simulated outcome |
| `workspaces_no_change` (trigger) | `workspace_id`, `kind`, `origin`, `created_at` can never change; a workspace can never be deleted (delete + re-insert would change its kind). Like the audit trigger, a guard against mistakes: the table owner can drop it. |
| `workspaces_id_shape` | 1–128 chars, no control characters (the shape the ingestion contract accepts for a merchant claim); ids found in pre-existing data are registered as they are |
| `workspaces_kind_key` | `UNIQUE (workspace_id, kind)` — target of the runs' composite FK |

**`scan_runs.workspace_kind`** (new column)

| Constraint / trigger | Rule |
|---|---|
| `scan_runs_workspace_kind` (trigger) | on insert, and on any change of `merchant_id` / `workspace_kind`, the kind is **looked up in the registry**, never taken from the caller (NULL for an unregistered id) |
| `scan_runs_workspace_fk` | `(merchant_id, workspace_kind) → workspaces (workspace_id, kind)`: a stated kind must be the workspace's real kind (defence in depth behind the trigger) |
| `scan_runs_synthetic_has_workspace` | a synthetic scan run must belong to a registered workspace |
| `scan_runs_synthetic_only_in_demo` | a synthetic scan run must belong to a **demo** workspace |

**Backfill.** Every workspace id present in **every** table that carries one — `scan_runs`, `transactions`,
`recovery_cases`, `execution_attempts`, `interventions`, `idempotency_records`, `audit_events`, `source_events`,
`revenue_obligations` (`decisions` and `source_event_raw` carry none) — is registered once as a **demo** workspace with
`origin = 'pre_phase3_backfill'`, `execution_mode = 'simulation'`, `base_currency = 'INR'` (every pre-Phase-3 case is
INR-only), `timezone = 'UTC'` (no timezone was ever recorded), `display_name = 'Backfilled: <id>'`. No id is promoted to
a merchant workspace: before Phase 3 only synthetic data and fixtures existed (CLAUDE.md §9). Then the documented demo
workspace `merch_001` (default of `POST /api/scan`) is seeded with `origin = 'demo_seed'` unless the data already
contained it. Existing runs get their `workspace_kind` (all `demo`). No row in any existing table is changed apart from
that column.

Works from an empty schema and from a database at 0002 (both tested). There is no down-migration: code without 0003
refuses a schema that has applied it (`SchemaNotReady`), by design.

## 2. Workspace invariants and where each is enforced

| Invariant | Domain (`domain/workspaces.py`) | Repositories (memory + PostgreSQL) | Service / API | Database |
|---|---|---|---|---|
| Synthetic data only in a registered demo workspace | `require_demo_workspace` | `register_scan_run` refuses (`UnknownWorkspace` / `SyntheticDataNotAllowed`), nothing stored | `scan_revenue` checks before generating anything; `POST /api/scan` → 422 `unknown_workspace` / 409 `synthetic_data_not_allowed` | trigger + 2 CHECKs + FK on `scan_runs` |
| A workspace is never created implicitly | — | only `create_workspace` creates one; it requires `origin = 'explicit'` | no endpoint creates one (none exists yet) | — |
| Merchant workspaces never simulate | `Workspace.validate` | `create_workspace` validates first | — | `workspaces_merchant_never_simulates` |
| Kind is immutable; workspaces are never deleted | — | no update/delete method; getters return copies; `clear()` keeps the registry | — | `workspaces_no_change` trigger |
| A fresh store holds exactly the demo workspace | `demo_seed_workspace` | in-memory seeds it in `__init__` | — | migration seed |

Error bodies follow the existing convention: `{"detail": <plain string>, "code": ..., "workspace_id": ...}`.

## 3. Files changed

New: `backend/app/db/migrations/0003_workspaces.sql`, `backend/app/domain/workspaces.py`,
`backend/tests/integration/test_workspaces.py`, `backend/tests/unit/test_workspace_rules.py`, this file.

Modified: `backend/app/repositories/base.py` (three abstract workspace methods; `register_scan_run` / `clear` docs),
`backend/app/repositories/postgres.py` (workspace methods, demo check in `register_scan_run`),
`backend/app/repositories/in_memory.py` (seeded registry, workspace methods, demo check in `register_scan_run`),
`backend/app/services/recovery_service.py` (guard at the top of `scan_revenue`), `backend/app/api/routes.py` (typed
errors on `/scan`), `backend/tests/support.py` (`ensure_demo_workspace`: `register_run` registers its test workspace
explicitly), `backend/tests/integration/test_postgres_schema.py` and `test_durability_processes.py` (migration head
2 → 3; one raw insert moved from an unregistered id to the fixture's registered workspace so it still reaches the
unique index it tests).

Unchanged: policy rules, the recovery lifecycle, execution, the provider, ingestion and detection code, the active-run
index and queries, every frontend file. Backup + `RESTORE.md`: `backend/_backups/workspace-foundation-phase3-0-20261027/`.

## 4. Tests executed (2026-10-27, this session)

All runs used a **throwaway PostgreSQL 18.6 cluster** started by the test harness from
`C:\Program Files\PostgreSQL\18\bin` (initdb in a temp dir, free localhost port), with `REVORA_TEST_DATABASE_URL`
forced empty so no configured server could be used. The installed PostgreSQL service and its data were not touched.

| Run | Result |
|---|---|
| Baseline before any change: `REVORA_REQUIRE_POSTGRES=1 python -m pytest backend/tests -p no:cacheprovider -q --ignore=backend/tests/tools` | **470 passed**, 0 failed (137 s) |
| Focused: `test_workspace_rules.py`, `test_workspaces.py`, `test_postgres_schema.py` | **70 passed**, 0 failed |
| Full suite after the change (same command as baseline) | **516 passed**, 0 failed (138 s) — 470 existing + 46 new |

New coverage: fresh-schema migration; upgrade from 0002 with a distinct workspace id in each of the nine tables (plus a
duplicate and an empty id) — all backfilled exactly once as demo, row counts unchanged; seed added when the data never
used `merch_001`; raw-SQL refusal of a synthetic run in a merchant / unknown workspace (also when the caller claims
`demo`, and when an existing run is moved); the FK refusing a misstated kind with the trigger disabled; kind / id /
origin / created_at changes and deletes refused; merchant + simulation refused on insert and update; vocabulary checks;
the repository contract on both implementations (seed, explicit create, duplicate, invalid input, copies, refusal leaves
nothing behind, `clear()` keeps workspaces, events for a registered merchant workspace still open inert cases); the scan
service refusing unknown and merchant workspaces **before generating anything**; demo scans still working; the HTTP
422 / 409 bodies.

Not run: `backend/tests/tools/mutation_check.py` (it rewrites `postgres.py` in place and deletes
`postgres.py.mutation_backup`, which must be kept). No mutation entries were added for 0003. No frontend build (no
frontend file changed).

## 5. Known limitations (deliberately left for later increments)

- **No authentication, no tenant isolation.** Any caller can name any workspace. `/api/scan` still takes
  `merchant_id` from the request body.
- **Reads are not scoped by workspace**, and the active run is still global (`scan_runs_one_active`). Next increment.
- **Child rows are not tied to their run's workspace.** `transactions.merchant_id`, `recovery_cases.merchant_id`, etc.
  are not constrained to equal their run's `merchant_id`. Needed before reads are scoped by workspace.
- **Ingestion runs for unregistered ids are still accepted** (`workspace_kind` NULL), so Phase 2 ingestion behaves as
  before for unauthenticated claims; their cases remain inert (never active, never executable). A registered merchant
  workspace's ingestion run is labelled `merchant`.
- **No workspace API or UI**: workspaces can be created only through the repository (`create_workspace`).
- **`execution_mode` is stored but not yet read by execution.** Merchant workspaces cannot have executable cases today
  (their only runs are inert ingestion runs), but the execution guard itself is the next increment's job.
- Timezone is checked for shape only (the tz database is not reliably present on Windows hosts).
- `merch_001` is fixed in the migration; `DEFAULT_MERCHANT_ID` in `config.py` is not read by anything.
- Verified on PostgreSQL 18.6 / Windows only. The browser UI was not exercised in this increment.
