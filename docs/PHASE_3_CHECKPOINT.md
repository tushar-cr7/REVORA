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

> **Superseded in part by Phase 3.1 (see the section below):** reads are now scoped by workspace, each workspace has its
> own active run, child rows are tied to their run's workspace, ingestion rejects unregistered workspaces, and
> `execution_mode` is enforced. The list is kept as it was written at the end of 3.0.

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

---

# Phase 3.1 — workspace isolation and execution safety (2026-10-27)

Scope: one workspace can no longer read, change or execute another workspace's records, and nothing executes outside a
`simulation` workspace. **A workspace id is a SELECTION made by the caller, not authentication.** Nothing here proves who
is asking; there is still no login, no membership and no row-level security. Do not read this section as "tenant
security is done" — it is the data-integrity and execution-safety foundation that authentication will later sit on.

## 6. Migration `0004_workspace_isolation.sql`

Forward-only, applied by the existing runner. 0001–0003 are unchanged. It works from a fresh schema and from a version-3
database (both tested). There is no down-migration.

**Pre-checks first.** Before any change, every constraint below is validated against the existing rows by a temporary
(`pg_temp`) helper. A violating row stops the migration — and rolls it back whole — with a message naming the rule, the
count and up to five offending rows, e.g. `transaction run_x/tx_1 claims workspace 'ws_two', its run belongs to 'ws_one'`.
**No row is deleted, rewritten or reassigned to make a constraint pass.** The one data change is a *label repair*: a run
whose workspace was registered after the run was created (0003 left `workspace_kind` NULL) gets the kind the registry
records. An event claim for a workspace nobody registered (Phase 3.0 accepted those) blocks the migration until a person
registers the workspace deliberately; REVORA never creates one from an unauthenticated claim.

| Change | Rule |
|---|---|
| `scan_runs_one_active_per_workspace` (replaces `scan_runs_one_active`) | at most one **active** run **per workspace**: `UNIQUE (merchant_id) WHERE status = 'active'` |
| `scan_runs.workspace_kind NOT NULL` | every run names a registered workspace (0003 allowed NULL for unregistered ingestion claims) |
| `ws_transactions_run_fk`, `ws_cases_run_fk` | `(run_id, merchant_id) → scan_runs`: a transaction / case names its run's workspace |
| `ws_decisions_case_run_fk` | `(case_id, run_id) → recovery_cases`: a decision is in its case's run |
| `ws_attempts_run_fk`, `ws_attempts_case_run_fk` | an attempt names its run's workspace, and is in its case's run |
| `ws_interventions_run_fk`, `_case_run_fk`, `_attempt_fk` | an intervention names its run's workspace, its case's run, its attempt's workspace |
| `ws_idempotency_case_fk`, `_attempt_fk` | `(case_id\|attempt_id, merchant_id)`: a key protects a case / attempt of the **same** workspace |
| `ws_audit_workspace_fk`, `_run_fk`, `_case_fk`, `_attempt_fk` | an audit event names a registered workspace and, when it carries a run / case / attempt, that parent's workspace |
| `ws_obligations_workspace_fk`, `_run_fk`, `_case_fk` | same for revenue obligations |
| `ws_source_events_workspace_fk` | an event belongs to a **registered** workspace; an event about an unknown one cannot be stored |
| `execution_attempts_executable_workspace` (trigger) | no attempt (`reserved`/`completed`/`failed`) can **start** unless the workspace's `execution_mode` is `simulation` |
| supporting `UNIQUE` keys, two indexes | `(run_id, merchant_id)`, `(case_id, run_id)`, `(case_id, merchant_id)`, `(attempt_id, merchant_id)`; `audit_events (merchant_id, seq)`, `source_events (merchant_id, seq DESC)` |

The `ws_` prefix is deliberate: `PostgresRepository` turns a violation of any `ws_*` rule into a typed
`WorkspaceMismatch` (or `UnknownWorkspace` for `*_workspace_fk`, `ExecutionNotAvailable` for the trigger) with a generic
message — the driver's own text names the offending key values and is never shown.

**The trigger never strands an open attempt.** It checks a *new* attempt, or a denied one becoming counted. Closing an
attempt that already exists (the provider returned; the startup sweep; an abort) is never refused, so an operator
switching a workspace off mid-flight cannot leave a case stuck `executing`.

**Deliberately not constrained:** `source_events` has no run or case, so it is tied to the registry only; `decisions`
carry no workspace column, so they are tied to their case and run (and through the case to the workspace); the
database cannot tell a "synthetic" row from any other except by its run's `kind` (so the 3.0 rule remains a rule about
*runs*: raw SQL can still write a transaction row under a demo run, but only one that names that run's workspace).

## 7. Repositories: an explicit workspace on everything

Every method that reads or changes workspace-owned records takes a **required keyword-only `workspace_id`** — on
PostgreSQL and in memory alike. There is no default and no fallback to "whichever run is active": a missing value is a
`TypeError`/`ValueError`, and a workspace that has not been scanned simply has no data.

- `run_id=None` means *that workspace's* active run; `"all"` means all runs *of that workspace*; a run id is honoured only
  if the workspace owns it. A case, decision, attempt, intervention, event or obligation id from another workspace is
  **not found** — the same answer as an id that never existed.
- Mutations check ownership: `update_transaction_analysis(es)`, `lock_cases`, `mark_source_event`, `activate_run` only touch
  the workspace's own rows; `save_case` refuses to move a case to another workspace/run; `create_case` /
  `update_source_transaction` refuse a run of another workspace; `save_attempt` / `save_intervention` /
  `save_idempotency_record` / `save_audit_event` / `save_decision` refuse a record that disagrees with its parent.
- Scans serialize **per workspace** (advisory lock per workspace id; the supersede is `WHERE merchant_id = …`), so scans in
  different workspaces never wait for or supersede one another. Tested with concurrent scans on separate connections.
- The in-memory repository mirrors every rule *where the parent exists* (it has no foreign keys, so a missing parent is
  not an error there). `list_reserved_attempts` is the single deliberate cross-workspace read: the startup sweep of
  interrupted reservations; each attempt names its own workspace for what follows. A structural test
  (`test_every_workspace_owned_repository_method_requires_an_explicit_workspace`) lists every repository method that has
  no `workspace_id` and fails when a new one appears without a reason.

## 8. Execution safety

`ExecutionService` checks, **first** — before a key is read, a case is found, an undecided case is decided (model +
policy + audit write) or a provider is reached:

1. the workspace is registered (`UnknownWorkspace`, 422);
2. its `execution_mode` is `simulation` (`ExecutionNotAvailable`, 409 `execution_not_available` — every merchant
   workspace is `recommend_only`);
3. that mode is the one of the provider that would run (a mismatch is refused, not guessed).

It repeats the check *inside the reservation unit of work*, together with: the case belongs to the workspace, the run is
the workspace's active run, and the case, run and transaction all name the same workspace — otherwise
`ExecutionNotAvailable` before any attempt exists. The trigger in §6 is the last line of defence. The case lookup is
scoped, so another workspace's case id is `404 case_not_found` and cannot be told from one that never existed. Bulk
`recover_revenue` is refused up front for such a workspace. Policy evaluation, idempotency (scoped by workspace +
operation + key, so the same key in two workspaces is two independent requests), the attempt ledger and audit semantics
are unchanged. Analytics report the *workspace's* `execution_mode` (a recommend-only workspace never claims
`simulation`). Merchant workspaces still produce **no** simulated outcome of any kind.

## 9. Event ingestion

`POST /api/ingest/events` now rejects an event whose `claimed_merchant_id` is not a registered workspace:
`422 {"code": "unknown_workspace"}` **before** anything is stored, so an unverified claim creates no workspace, event,
obligation, run or case. PostgreSQL enforces the same (`ws_source_events_workspace_fk`), as do both repositories
(`get_or_create_ingestion_run`, `insert_source_event`, `lock_obligation`). For a *registered* workspace the claim is still
unauthenticated — anyone who can reach the endpoint can add events to it (`merchant_assertion` stays
`unauthenticated_claim`) — but the cases they open are inert: they live in the workspace's ingestion run, which is
`standby` (never active), so they are not dashboard data and cannot be executed. Projection, detection and idempotency are
untouched. The GET endpoints (`/ingest/events`, `/ingest/events/{id}`, `/ingest/obligations`) read one workspace.
**API change:** their optional `claimed_merchant_id` filter is replaced by `workspace_id` (a selection, default demo);
without the filter they no longer return every workspace's events.

## 10. API

Every endpoint that touches workspace data takes **`?workspace_id=`**, default **`merch_001`** (the demo workspace), so the
existing dashboard — which sends nothing — keeps working unchanged against the demo workspace. This is a documented
compatibility default, not a global active run: it can never return another workspace's data. Unknown workspace → `422
unknown_workspace` (never created). `POST /api/scan` keeps its body field `merchant_id` (the same selection). The policy
endpoints (`GET /policies`) are process-wide configuration, not workspace data, and take no workspace.

| Situation | Answer |
|---|---|
| unknown workspace (any endpoint) | `422 {"detail", "code": "unknown_workspace", "workspace_id"}` |
| merchant / recommend-only workspace, execute or bulk recover | `409 execution_not_available` |
| a case / transaction / event / decision of another workspace | `404` (execute: `404 case_not_found`), indistinguishable from "never existed" |
| a record that names the wrong workspace (internal write) | `409 workspace_mismatch` (typed `WorkspaceMismatch`) |

**How the frontend adopts it in Phase 3.2:** add `workspace_id` to the API client (`frontend/lib/api.ts`) from a workspace
selector; until then every existing call is the demo workspace. No frontend file changed in 3.1.

## 11. Folded-in follow-ups from the Phase 3.0 audit

Two small defects the independent audit recommended fixing, in files this increment already changes:
`Workspace.validate` used `Pattern.match` with `$`, which accepts a trailing newline (`'acme\n'`, `'INR\n'`) — now
`fullmatch`, so both repositories agree; and the in-memory `register_scan_run` checked the workspace before the
case/run shape, unlike PostgreSQL (so the existing `…cannot_belong_to_another` test passed for the wrong reason on
memory) — the order is now identical.

## 12. Files changed

New: `backend/app/db/migrations/0004_workspace_isolation.sql`, `backend/tests/integration/test_workspace_isolation.py`.
Application: `domain/workspaces.py` (`WorkspaceMismatch`, `ExecutionNotAvailable`; `fullmatch`), `repositories/base.py`,
`postgres.py`, `in_memory.py`, `services/recovery_service.py`, `execution_service.py`, `ingestion_service.py`,
`detection_service.py`, `audit_service.py`, `api/routes.py`, `api/ingestion_routes.py`, `main.py` (a handler turning any
workspace error into the typed body). Tests/fixtures: `tests/support.py`, `events_support.py`, and the suites that call the
repositories and services (workspace made explicit; ~490 call sites rewritten mechanically with an AST tool, then reviewed
per failing test). Backup + restore table: `backend/_backups/workspace-isolation-phase3-1-20261027/`.

Existing tests whose *meaning* changed on purpose: the global "one active run" test is now "one per workspace"; "a
scan cannot slip between authorization and reservation" scans the **same** workspace (a scan elsewhere correctly no longer
waits); event-derived cases now answer `execution_not_available` in a merchant workspace and `run_superseded` only in a
demo one; the demo dashboard's `/api/runs` no longer lists another workspace's ingestion runs; an idempotency record can no
longer be filed under a merchant other than its case's.

## 13. Tests executed (2026-10-27, this session)

All runs used the harness's **throwaway PostgreSQL 18.6 cluster** (initdb in a temp directory, a free localhost port) with
`REVORA_TEST_DATABASE_URL` forced empty. The installed PostgreSQL service and its data were not touched.

Command: `REVORA_TEST_DATABASE_URL= REVORA_REQUIRE_POSTGRES=1 python -m pytest backend/tests -p no:cacheprovider -q --ignore=backend/tests/tools`

| Run | Result |
|---|---|
| Baseline at the start of 3.1 (the Phase 3.0 tree) | **516 passed**, 0 failed |
| First full run after the signatures changed (many tests not yet updated) | 45 failed, 531 passed — expected: the failures were tests still calling the old API, plus tests whose meaning changed on purpose (§12) |
| Second full run, after updating the existing suites and adding `test_workspace_isolation.py` | **573 passed, 4 failed** (163 s). All 4 were test-design errors in new/just-edited tests, none in product code: one assertion that still expected the demo dashboard to list another workspace's runs, and three raw-SQL tests that hit a *unique* key before the ownership foreign key they meant to exercise |
| After fixing those four: `test_workspace_isolation.py` + `test_ingestion_api.py` | **80 passed**, 0 failed |
| Isolation tests on an unmutated **scratch copy** of `backend/` | **61 passed** |

**Every pre-existing Phase 1 and Phase 2 lifecycle, idempotency, concurrency, ingestion and migration test passed in the
second full run** (they were updated only to name their workspace; the one exception is a test whose assertion
changed meaning on purpose — see §12). `test_workspace_isolation.py` adds **61** tests (577 collected = 516 + 61).

**Safeguard-removal checks** (on a scratch copy of `backend/`, never the repository; `mutation_check.py` was not run
because it rewrites live code and deletes the retained backups). Each safeguard was removed on its own and the isolation
tests were run: **8 of 8 caught** — executor workspace gate removed (7 failures), PostgreSQL fallback to every workspace's
active run (6), in-memory fallback to another workspace's active run (6), `ws_attempts_run_fk` dropped from the migration
(2), execution trigger dropped (2), per-workspace index replaced by the old global one (12 + 2 errors),
unknown-workspace rejection removed from ingestion (3), the transaction pre-check of the migration disabled (1). (A first
run of this check labelled everything "not caught" because of a bug in the checking script — a doubled `-q` hid pytest's
summary line — and one mutation left the original text in place; both were corrected and the run repeated.)

**NOT verified in this session — read this:** the full suite was **not re-run on the final tree** after the last four test
fixes (the tool-permission classifier in this environment returned no verdict for every shell command at the end, so the
command could not be started). What is established: the second full run (573 passed) preceded only test-file edits, and
the two files those edits touched pass on their own (80). What is **not** established: that all 577 collected tests
pass together on the final tree. Run the command above before relying on it.

## 14. Remaining limitations (not solved here)

- **No authentication, no membership, no row-level security.** `workspace_id` is chosen by the caller. Anyone who can reach
  the API can select any registered workspace, read its data, add events to it, and (for a demo workspace) execute its
  simulated actions. Do not expose the API outside a trusted network. The ingestion and execute endpoints are open.
- `execution_mode` is stored per workspace and nothing lets an operator change it through the API. In the database a
  workspace's id, kind, origin and creation time are immutable (migration 0003), and a merchant workspace can never be
  `simulation`; but `base_currency`, `timezone`, `display_name` and a *demo* workspace's `execution_mode` can still be
  edited by whoever owns the database.
- The defence-in-depth trigger and foreign keys are guards against mistakes: the table owner can drop them (as with the
  audit trigger). The audit log is still not tamper-evident.
- Cross-workspace reads for administration (a system view over all workspaces) do not exist, by design.
- `list_reserved_attempts` (startup sweep) reads across workspaces; it is not reachable from the API.
- The model is trained on synthetic data only; analysis of merchant data is not offered yet (merchant workspaces have no
  active run, so `/analyze` and `/recover` have nothing to act on).
- Browser UI not exercised: no frontend file changed, and `npm run build` was not run.

## 15. Reserved for Phase 3.2 and later

Workspace selector and header propagation in the frontend; workspace creation API/UI and onboarding; CSV/XLSX import,
orders/payments/refunds and reconciliation; merchant analytics; authentication and workspace membership (then
`merchant_assertion = 'authenticated'` and PostgreSQL RLS); a decision on how an event-derived or imported case becomes
analysable and, one day, executable (needs decision-time `hours_since_event` / `age_days`, model features the events
cannot supply, and a real provider).
