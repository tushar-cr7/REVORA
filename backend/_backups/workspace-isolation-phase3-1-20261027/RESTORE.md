# Restore — Phase 3.1 workspace isolation and execution safety (2026-10-27)

What this round changed: migration `0004_workspace_isolation.sql` (one active run per workspace instead of one for the
whole database; composite `ws_*` foreign keys so child rows cannot name a workspace other than their run's; every
workspace id must be a registered workspace; a trigger that refuses to start an execution attempt outside a
`simulation` workspace; pre-checks that stop the migration with a diagnostic rather than reassign any row). Every
repository method that reads or writes workspace-owned records now takes a required keyword-only `workspace_id`
(PostgreSQL and in-memory alike). The executor refuses a workspace that is not `simulation` before it decides,
reserves or calls a provider. Ingestion rejects events about unregistered workspaces. HTTP endpoints take
`?workspace_id=` (default: the demo workspace). Also folds in the two audit follow-ups from Phase 3.0
(`fullmatch` validation of workspace fields; same order of checks in both `register_scan_run`s). Details:
`docs/PHASE_3_CHECKPOINT.md`, section "Phase 3.1".

## What is in this directory

`backend/app/**/*.py` and `backend/tests/**/*.py` exactly as they were BEFORE this round (64 files, original
timestamps preserved), plus `docs/PHASE_3_CHECKPOINT.md`. To restore, copy a file from here over the file at the same
path relative to the repository root. Restoring everything under `backend/app` and `backend/tests` restores the
code; the files below must also be removed.

## New files (delete to restore)

- `backend/app/db/migrations/0004_workspace_isolation.sql`
- `backend/tests/integration/test_workspace_isolation.py`

## Files this round modified (the backup of each is in this directory)

Application: `backend/app/domain/workspaces.py`, `backend/app/repositories/base.py`,
`backend/app/repositories/postgres.py`, `backend/app/repositories/in_memory.py`,
`backend/app/services/recovery_service.py`, `backend/app/services/execution_service.py`,
`backend/app/services/ingestion_service.py`, `backend/app/services/detection_service.py`,
`backend/app/services/audit_service.py`, `backend/app/api/routes.py`, `backend/app/api/ingestion_routes.py`,
`backend/app/main.py`.

Tests/fixtures: `backend/tests/support.py`, `backend/tests/events_support.py`, and the suites that call the
repositories and services (`integration/test_recovery_lifecycle.py`, `test_postgres_execution.py`,
`test_postgres_repository.py`, `test_ingestion_flow.py`, `test_postgres_ingestion.py`, `test_ingestion_api.py`,
`test_pipeline.py`, `test_postgres_schema.py`, `test_durability_processes.py`, `test_workspaces.py`, and any other
under `backend/tests` that differs from its copy here).

## Database caution

A database that has applied migration 0004 cannot be restored by copying files: code without 0004 refuses a schema
that is ahead of it (`SchemaNotReady: ... ahead of this code`), by design, and there are no down-migrations. Restoring
is only safe for databases that never ran 0004 (every disposable test cluster; the user's installed database was not
migrated in this round).

After restoring, re-run:
`REVORA_TEST_DATABASE_URL= REVORA_REQUIRE_POSTGRES=1 python -m pytest backend/tests -p no:cacheprovider -q --ignore=backend/tests/tools`
(baseline before this round: 516 passed).

## Not touched

`backend/app/repositories/postgres.py.mutation_backup` and `postgres.py.interrupted-sweep-copy` (retained at the
owner's request; checksums recorded before and after this round) and every other `_backups/` directory.
