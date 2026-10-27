# Phase 2 checkpoint — final verification (2026-10-27)

Scope: durable PostgreSQL persistence + normalized event ingestion (`docs/DURABLE_FOUNDATION.md`).
Everything below was run in the closing session unless marked otherwise. A passing suite is not a
production-readiness claim.

## 1. Burst / deadlock regression

- The deadlock occurs inside one `INSERT` (two speculative inserts into the obligation's two unique indexes). It
  cannot be forced from outside the server without PostgreSQL injection points, so
  `test_bursts_of_first_events_for_brand_new_objects_never_deadlock` **cannot be made deterministic**. With the fix
  reverted it still passes (mutation run: "1 failed, 1 passed" — the burst test is the one that passes).
  It stays as a stress test; it is **not** a regression detector.
- The guarantee that prevents the interleaving is tested deterministically instead:
  `test_the_first_event_about_an_object_waits_on_that_objects_advisory_lock_before_inserting` (a separate session
  holds the object's advisory lock; the worker must be seen waiting on it in `pg_locks`, then proceed on release).
  It passes on the real code and **fails** when the fix is reverted. Two mutation entries cover it
  ("burst fix reverted", "obligation advisory lock removed").
- Production code was not changed. `backend/app/repositories/postgres.py` was verified byte-identical to
  `postgres.py.interrupted-sweep-copy` after the sweep; the advisory lock and `ON CONFLICT DO NOTHING`
  (line ~1288/1295) are present; no mutation is applied.

## 2. Mutation sweep (`backend/tests/tools/mutation_check.py`)

19 mutations: **19 CAUGHT, 0 NOT CAUGHT**. Run through a scratch wrapper (session scratchpad, outside the repo)
that suppresses the tool's deletion of `postgres.py.mutation_backup`, so both backup files still exist.

## 3. Build and test results

| Check | Result |
|---|---|
| `REVORA_REQUIRE_POSTGRES=1 python -m pytest backend/tests -p no:cacheprovider -q` | **462 passed**, 0 failed, 204 s (PostgreSQL 18.6 / Windows). 461 earlier + the new deterministic test. |
| `npm run build` (in `frontend/`) | Succeeded: compiled, types valid, 22/22 static pages. |
| Browser smoke test | Performed — see §6. |

## 4. Files changed in this closing session

- `docs/DURABLE_FOUNDATION.md` (§12: sweep result and the burst-test caveat)
- `docs/PHASE_2_CHECKPOINT.md` (this file)
- Not changed: `CLAUDE.md` and `docs/PHASE_IMPLEMENTATION_NOTES.md` already carried 462 tests, the Phase 2
  "functionally complete, not production-ready" status and a pointer to these caveats. `.revora/git-handoff.json`
  not updated (see verdict). The earlier tool-fix and test additions (mutation entries, deterministic test) predate
  this session. No Git commands run; no files deleted.
- Kept pending your approval to delete: `postgres.py.mutation_backup`, `postgres.py.interrupted-sweep-copy`.

## 5. Outstanding limitations

No authentication/tenancy; `SimulationProvider` only; no real provider adapter or merchant data; event-derived cases
cannot be decided/executed; audit log not tamper-evident; no backup/HA/retention; pull-based recovery of
interrupted reservations; whole-run reads; PostgreSQL 18.6 on Windows only; no load testing; the burst stress test
has no regression-detecting power on its own; the browser run (§6) used a throwaway PostgreSQL cluster, not the
application's configured database; `run.bat` does not set `REVORA_STORAGE`/`DATABASE_URL`.

## 6. Browser smoke test (2026-10-27)

**Database used — read this first.** The installed PostgreSQL service (`postgresql-x64-18`, port 5432) is running, but
this repository has no `.env` and no `DATABASE_URL`, and I have no credentials for it (I did not try to obtain or
guess any). So this was **not** run against the application's own database. I ran against a **throwaway PostgreSQL
18 cluster** (initdb in the session scratchpad, 127.0.0.1:55432, trust auth, fsync off, database `revora_smoke`),
migrated with `python -m backend.app.db.migrate upgrade` (applied 1, 2), `REVORA_STORAGE=postgres`. It has been
stopped. Frontend: the production build (`next start`, port 3000). Browser: Chromium via Playwright 1.63.0,
installed with `npm install --no-save` (sha256 of `package.json` / `package-lock.json` identical before, after
install and after `npm uninstall --no-save`; `node_modules/playwright` is gone again).

**Root cause of "Failed to load data".** `run.bat` — the documented way to start the app — launches
`python -m uvicorn backend.app.main:app` with no `REVORA_STORAGE`. Since Phase 2 the backend refuses to start without
it (`ConfigurationError: REVORA_STORAGE is not set …`; reproduced), so nothing listens on :8000 and every page's
fetch fails (`net::ERR_CONNECTION_REFUSED`). Reproduced in the browser by stopping the backend: Interventions shows
"Unable to load recovery operations — REVORA couldn't reach the recovery service", Revenue Command shows ₹0 with
`Init Boot Error: TypeError: Failed to fetch`. It is a startup-configuration problem, not a data or code defect:
with `REVORA_STORAGE=postgres` + `DATABASE_URL` set, everything loads. **Not fixed in this session** — `run.bat`/docs
are unchanged; the fix is a `.env` (see `.env.example`) or having `run.bat` set the variables. Your call.

**Initialization.** The DB started empty (`/api/transactions` → `[]`). Revenue Command's own mount logic calls
`POST /api/scan` (100 tx, seed 42) then `POST /api/analyze`; that was the only seeding, and it only touched the
throwaway database. Nothing was reset or deleted.

| Check | Result |
|---|---|
| All 12 dashboard routes at 1440px, first load | No "Unable to load" message, no failed requests, no non-200 `/api` responses. Revenue Scanner, Recovery Brain, Integrations make no API call on load (design as-is). |
| Monetary metrics | Revenue at risk ₹2.39L = `/api/analytics` `total_at_risk` 238 943.29; Policies ₹25,000 cap; Escalations, Analytics, Audit, Copilot show non-zero rupee values. |
| Execute one intervention (API, `tx_fp_000004` retry, key `smoke-…`) | `recovered`, ₹6 891.41; analytics recovered 6 891.41, 1 attempt. |
| Backend stopped, then restarted on the same database | `/api/analytics` and `/api/interventions` byte-identical before and after; run `run_08a97719fd204e04` still the only, active run (the page's re-scan re-activated it: `scan_count` 2); Interventions/Audit in the browser show the recovered ₹6.9k after restart. |
| Responsive 1024px and 390px (Revenue Command, Transactions, Interventions, Audit) | Loaded, no UI error, figures present. Layout was only checked by text/screenshot capture, not reviewed visually in detail. |
| Browser console | Only the known pre-existing `<circle> attribute r` error on Revenue Command (CLAUDE.md §17). None elsewhere. The only other errors were the connection-refused ones while the backend was deliberately down. |

**Not covered:** the installed PostgreSQL / the application's real database (no credentials), UI-driven execute click
(execution was via API), other browsers, load, real providers.

## 7. Verdict

**Phase 2 can be closed on the evidence available**: backend suite 462/462, 19/19 mutations caught, production build
passes, and the dashboard loads from and survives a restart on a real PostgreSQL 18 instance. Two caveats, stated
plainly: (1) the browser run used a throwaway cluster, not the application's configured database, because none is
configured in this repo; (2) the user-facing "Failed to load data" is still reproducible with `run.bat` until
`REVORA_STORAGE`/`DATABASE_URL` are supplied. I did not update `.revora/git-handoff.json`; that and deleting the two
retained backup files are for you to decide.

## 8. Local startup fix (2026-10-27)

**Root cause** (see §6): `run.bat` launched the backend with no storage configuration, and the repo has no `.env`;
the backend (correctly) refuses to start, so the dashboard showed "Failed to load data". A second gap found while
inspecting: `.env.example` ships `DATABASE_URL=…:CHANGE_ME@…`, but the placeholder check only matched
`user:password@`, so copying the example unchanged passed validation and failed later at connect time.

**Changes** (no recovery, execution, policy, migration or frontend code touched; no fallback to memory added):
- `backend/app/preflight.py` (new): `python -m backend.app.preflight` runs the existing `load_storage_config`
  validation (no database connection) and prints an actionable message with exit code 1, or a confirmation
  (labelling memory mode NOT durable) with exit code 0.
- `run.bat`: runs the preflight first; on failure prints the message, starts nothing, exits 1. Also starts the
  services with explicit working directories (`/d`) so they no longer depend on the caller's directory.
- `backend/app/config.py`: placeholder check also rejects `:CHANGE_ME@` (case-insensitive); message mentions both.
- `.env.example`, `README.md`: how to create `.env` and what `run.bat` checks. `.env` loading itself was already
  supported (`load_dotenv(override=False)` from `config.py`, which finds the repo-root `.env` regardless of cwd).
- `backend/tests/unit/test_preflight.py` (new, 8 tests incl. "`.env.example` as shipped is refused").

**Configure:** copy `.env.example` to `.env`; set `REVORA_STORAGE=postgres` and a real `DATABASE_URL`; run
`python -m backend.app.db.migrate upgrade` once; then `run.bat`. For a non-durable demo: `REVORA_STORAGE=memory`.

**Verified:** new + existing config unit tests 28 passed; full suite `REVORA_REQUIRE_POSTGRES=1 pytest backend/tests`
**470 passed** (462 + 8 new), 0 failed, 190 s. `run.bat` executed with no configuration (no `.env`, variables
unset): printed the message above, exit 1, nothing listening on 8000/3000. Preflight with `REVORA_STORAGE=memory`:
exit 0. `.env` discovery from an unrelated cwd confirmed with a scratch copy of the mechanism (not a repo `.env`).

**Not verified:** a full `run.bat` launch with a valid configuration (it would open two console windows and start
servers; the equivalent backend/frontend launch was verified earlier in §6 on the throwaway cluster); anything
against the user's installed PostgreSQL (not connected to, no credentials); `CLAUDE.md` / notes were updated
afterwards from 462 to 470 tests. `.revora/git-handoff.json` not updated: this is a minor fix, below the §19 threshold.
