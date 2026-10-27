# Durable data foundation & event ingestion (Phase 2)

> **Status:** implemented and tested against PostgreSQL 18 (see §12 for exactly what was and was not
> verified). **Not production-ready.** There is still no authentication or tenancy, the execution provider is
> still a simulation, no real merchant data has ever flowed through this code, and the revenue-leak detection
> covers three event-derived rules on data nobody has connected yet.

**AI recommends. Deterministic policy authorizes. The execution layer enforces authorization against current
state.** Phase 2 changes where that state lives (a database, not a dict) and adds the first way for facts about
real payments to arrive (events). It does not change who may authorize what.

## 1. What changed

```
                       ┌─────────────────────────────┐
 POST /api/ingest/events│  validate (pydantic, 422)   │   source_events  (unique per source identity)
 ──────────────────────►│  store once (unit of work 1)│──► source_event_raw (provider payload, apart)
                       │  detect     (unit of work 2)│
                       └──────────────┬──────────────┘
                                      │ fold ALL events of one object, order-insensitively
                                      ▼
                         revenue_obligations  (one row per payment / billing cycle / invoice; the row lock)
                                      │ open / refresh / close
                                      ▼
   ingestion run (kind='ingestion', never active) ── RecoveryCase (state: open)   ← inert: nothing decided,
                                                                                    nothing executable
 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 POST /scan, /analyze, /interventions/{id}/execute, /recover  ──► same services as Phase 1, now over
   PostgresRepository: runs, transactions, cases, decisions(+policy limits), attempt ledger, interventions,
   idempotency records, audit events — all durable, all constrained.
```

| Area | Before | Now |
|---|---|---|
| Storage | `InMemoryRepository` singleton wired into `routes.py` | `REVORA_STORAGE=postgres` (durable) or `memory` (explicit, labelled non-durable). No default, no fallback |
| Atomicity | A process-local lock; writes were never rolled back | A database transaction per unit of work, row locks, unique indexes, CHECK constraints, an optimistic version on cases |
| Execution | Refusals raised *inside* the critical section | Refusals are committed, then raised (raising inside would roll the record back) |
| Crash mid-execution | Impossible to observe in memory | A reservation survives, blocks duplicates while it may be alive, and is closed as a failed, counted attempt after a timeout |
| Source facts | Rows pre-labelled as leaks by a generator | Normalized events → obligations → cases, kept in separate tables |

## 2. Database choice

**PostgreSQL**, through `psycopg2` (already installed here; added to `backend/requirements.txt` as
`psycopg2-binary`). Reasons:

* `.env.example` already named PostgreSQL as the intended store (`DATABASE_URL=postgresql://…`), and PostgreSQL 18
  is installed on the development machine.
* The safety properties rely on features SQLite does not have or implements differently: partial unique indexes
  (`one in-flight attempt per case`, `one recovery per case`), `SELECT … FOR UPDATE` / `FOR SHARE`, advisory
  locks, transactional DDL, `INSERT … ON CONFLICT DO NOTHING` that waits for a concurrent inserter, and real
  multi-connection concurrency. A SQLite test would **not** have verified any of the concurrency claims, so there
  is no SQLite mode.
* No SQLAlchemy / Alembic: the repository speaks SQL to psycopg2, which was already present. Migrations are
  numbered `.sql` files applied by a ~200-line runner (§4). Trade-off: no autogeneration, no downgrade scripts.

`InMemoryRepository` remains, selected explicitly, for isolated unit tests and demos. It is **not** durable and
does not roll back; `atomic()` documents the difference.

**Configuration** (`backend/app/config.py`, `.env.example`): `REVORA_STORAGE` must be `postgres` or `memory`;
`postgres` needs `DATABASE_URL`. A missing/invalid value, the `.env.example` placeholder credentials, an
unreachable server, or a schema that is missing / behind / ahead of the code **stops the process at import** with
a message that says how to fix it. `memory` is refused when `ENV=production`. Error messages never contain the
database URL or password. `GET /api/health/ready` reports `{"storage": {"backend", "durable", "schema_version"}}`
(`/api/health` is unchanged).

## 3. Schema

Migration `0001` (core) and `0002` (ingestion). Money is `NUMERIC(16,2)`; the repository **refuses** a value it
would have to round (`MoneyPrecisionError`), it never rounds silently. Reads convert to `float`, so the API shape
and values are unchanged. Model outputs (probabilities, expected values) are `DOUBLE PRECISION`. Event money is
integer minor units (`BIGINT`). Timestamps are `TIMESTAMPTZ` (UTC); `transactions.event_time` stays `TEXT` so it
reads back exactly as supplied. Nothing cascades a delete.

| Table | Key | Constraints that carry safety |
|---|---|---|
| `scan_runs` | `run_id` | `UNIQUE(source_fingerprint)`; **at most one `active`** (partial unique index); `kind` ∈ {`synthetic_scan`,`ingestion`}; an ingestion run is always `standby`, a scan never is |
| `transactions` | `(run_id, transaction_id)` | `UNIQUE(run_id, leak_id)`; closed `leak_type` vocabulary; safety-critical figures **nullable** (unknown stays NULL → fails closed) |
| `recovery_cases` | `case_id` | FK to the transaction; **one case per transaction per run**; `state='executing' ⇔ active_attempt_id IS NOT NULL`; `recovered_amount ≤ amount`; `state='recovered'` needs a recovering attempt; `version` for optimistic concurrency |
| `decisions` | `decision_id` | FK run/case; closed action vocabulary; **`policy_limits` snapshot** + `policy_version` |
| `execution_attempts` | `attempt_id` | `UNIQUE(case_id, sequence)`; `UNIQUE(case_id, attempt_number)`; **one `reserved` attempt per case**; **one `recovered` attempt per case**; denied ⇒ no attempt number / no executed action; the **authorization snapshot** (verdict, limits, inputs) in `authorization_snapshot` |
| `interventions` | `intervention_id` | **one per attempt**; **one recovered per case**; `recovered ⇔ recovered_amount > 0`; FKs run/case/attempt |
| `idempotency_records` | `(merchant_id, operation, key)` | the scope is the primary key; fingerprint immutable (`save` refuses to rebind it) |
| `audit_events` | `event_id` | FKs run/case/attempt/decision/intervention (nullable); `BEFORE UPDATE OR DELETE` trigger rejects edits |
| `source_events` | `event_id` | **`UNIQUE(merchant_id, source, source_event_id)`**; `merchant_assertion` ∈ {`unauthenticated_claim`,`authenticated`}; amount ⇔ currency; a `failed` event must carry a reason |
| `source_event_raw` | `event_id` | provider payload, apart from the normalized fields; never read by detection, never returned by the API |
| `revenue_obligations` | `obligation_id` | `UNIQUE(merchant_id, reference_kind, reference_id)`; **`UNIQUE(case_id)`** (one case per obligation) |

Every constraint above is attempted with raw SQL in `test_postgres_schema.py` and must be refused **by the named
constraint** (a test that only checks "some error" would pass for the wrong reason, which it did once while
this was being written).

**The audit table is append-only by convention and by a trigger that stops accidental edits. It is not
tamper-evident:** the table owner or a superuser can drop the trigger (a test asserts this, so nobody mistakes the
guard for a security control), and nothing hashes or signs rows. Do not describe the audit log as immutable.

## 4. Migrations

`python -m backend.app.db.migrate status|upgrade [--target N]` (reads `DATABASE_URL`, `REVORA_DB_SCHEMA`), or
`REVORA_DB_AUTO_MIGRATE=1` for local development (off by default).

* Each file runs in its own transaction; a failure rolls the file back whole and records nothing.
* Applied files are checksummed (line endings normalised); a changed file, a database ahead of the code, or an
  unknown applied version aborts. Fix forward with a new file.
* Concurrent migrators serialize on an advisory lock; each migration runs exactly once (tested with 4 racers).
* `0002` is a genuine incremental migration (adds `scan_runs.kind`, widens two CHECKs); upgrading a populated
  version-1 database without losing rows is tested.
* Writing the schema surfaced one defect before it shipped: `authorization` is a reserved word in PostgreSQL, so
  the column is `authorization_snapshot`.

## 5. Repository interface changes

Contract (`repositories/base.py`) — new or changed:

| Method | Why |
|---|---|
| `atomic()` (semantics) | now a transaction on PostgreSQL: commit on exit, **rollback on exception**; case reads take `FOR UPDATE`, `get_active_run` takes `FOR SHARE`; nested blocks join the outer one |
| `lock_customer(merchant, customer)` | advisory lock so the daily contact cap cannot be raced across a customer's different cases |
| `lock_cases(run, tx_ids)` | one locking statement per analysis chunk |
| `insert_idempotency_record` | raises `DuplicateIdempotencyKey`; `save_*` can no longer rebind a fingerprint |
| `update_transaction_analysis(es)` | persists `model_recovery_prob` / `contacts_today` (Phase 1 mutated a live object and never saved it) |
| `list_attempts_since`, `list_reserved_attempts` | bulk analysis reads; interrupted-reservation recovery |
| ingestion: `insert_source_event`, `list_events_for_reference`, `lock_obligation`, `save_obligation`, `get_or_create_ingestion_run`, `create_case`, `update_source_transaction`, `mark_source_event`, … | event store, obligations, the inert ingestion run |
| `describe()` | readiness endpoint |

**Getters return copies on PostgreSQL**; every mutation must be followed by its `save_*`. Phase 1 relied on live
objects in one place it should not have: `_abort_reservation` mutated the attempt and case and never saved them,
which would have left a case stuck in `executing` on any real database. It now saves, and a test fails when it
doesn't. `StaleWrite` is raised if a save would overwrite a newer version of a case.

## 6. Execution safety on a database

### Atomic boundaries (`execution_service.py`)

| # | Unit of work | Contents (all-or-nothing) |
|---|---|---|
| 0 | **Reclaim** (own unit, committed first) | if the case is `executing` on a reservation older than the timeout, close it (§6.2) |
| 1 | **Reserve** | lock the case row → idempotency lookup + request fingerprint → state guard → lock the customer → current ledger facts → strict policy → **insert the attempt (reserved *or* denied) with its authorization snapshot** → move the case → insert the idempotency record → audit events |
| — | **Provider call** | **no transaction, no connection held** |
| 2 | **Complete** | lock the case → close the attempt → insert the intervention → move the case → complete the idempotency record → audit event |
| 3 | **Abort** (only if 2 failed) | a *separate* transaction closing the reservation as a failed, still-counted attempt |

* A **refusal** (policy denial, provider failure) is *returned* from the unit and raised after it commits;
  raising inside would erase the record of the refusal. Mutation-tested.
* Two requests racing on a **new idempotency key**: the unique key makes the loser's insert wait for the
  winner and then fail with `DuplicateIdempotencyKey`; the loser's whole unit rolls back (no attempt, no state
  change, no audit residue) and it re-evaluates against the committed winner, answering `422 idempotency_key_reuse`
  / replay / `409 request_in_progress` — never a 500.
* **Defense in depth.** Row locks give the clean answers. If they are bypassed (tested by replacing the locking
  read with a plain one) the unique indexes still allow only one provider call / attempt / recovery, and the
  version check refuses the stale overwrite instead of letting a `blocked` write clobber a `recovered` case.
  That test found that the indexes alone do *not* stop a lost update — hence the `version` column.

### 6.2 If the process stops after reservation and before completion

The reservation (`reserved` attempt, case `executing`, idempotency record `in_progress`) is durable. It is **not
left stuck**:

1. While younger than `REVORA_RESERVATION_TIMEOUT_SECONDS` (default 900 s) it is presumed alive: the same key gets
   `409 request_in_progress`, any other key `409 case_not_executable`.
2. Older than that, it is closed as a **failed attempt that still counts** (`failure_reason` starts
   `interrupted:`), the case becomes `attempted_no_recovery`, the idempotency record is completed (`500
   execution_interrupted`, so the key replays instead of hanging) and an `EXECUTION_FAILED` event with
   `outcome.status="interrupted"` is written. Triggers: **the next request for that case**, **application
   startup** (`recover_interrupted()`), or a future scheduled worker calling the same method.
3. It keeps counting toward retry/cooldown/contact limits because the provider **may have acted**. With a live
   provider, reconcile by idempotency key before allowing another attempt on an interrupted case.
4. If the provider returns *after* its reservation was closed, the result is **not recorded**
   (`409 reservation_expired`, logged); there is no state in which a late result silently becomes revenue.

The timeout must exceed the slowest legitimate provider call; a live attempt closed underneath its worker is the
failure mode of setting it too low. There is no provider timeout in this phase because there is no real provider.

## 7. Event ingestion

### Contract (`ingestion/schemas.py`, `NormalizedEventIn`)

```json
{
  "source": "internal",                         "source_event_id": "evt_001",
  "claimed_merchant_id": "merch_001",           "event_type": "payment.attempt_failed",
  "occurred_at": "2026-10-20T10:00:00+05:30",   "reference": {"kind": "payment", "id": "ord_123"},
  "customer_ref": "cust_9",                     "amount_minor": 249900, "currency": "INR",
  "data": {"failure_code": "card_declined"},    "raw": {"…provider payload…": 1}
}
```

* Types: `payment.attempt_failed|succeeded`, `subscription.payment_failed|succeeded`,
  `invoice.issued|overdue|paid|voided`, `checkout.started|abandoned`. Required: identity, type, tz-aware
  `occurred_at`, reference, and the per-type fields (`failure_code` for failures). Amount, currency, customer are
  optional — **providers do not all supply them, and nothing is invented.**
* `claimed_merchant_id` is named and stored as a **claim** (`merchant_assertion='unauthenticated_claim'`); nothing
  authorizes on it. A bare `merchant_id` is rejected as an unknown field.
* `reference.id` must identify what a later success **settles**. For a gateway that mints a new payment id per
  attempt that is the order/intent, not the attempt. Provider adapters own that mapping.
* Strict: unknown keys rejected, money is integer minor units (no floats, no strings), currency is ISO-4217,
  strings are bounded and control-character free, `raw` ≤ 64 KB, `occurred_at` more than 5 minutes ahead of the
  server clock is `422 occurred_at_in_future`.
* `ingestion/adapters.py` defines the provider boundary (`verify` then `normalize`); only an identity
  `InternalAdapter` exists. **No real provider adapter is implemented — there is no verified provider contract.**

### Endpoints (`api/ingestion_routes.py`)

| | |
|---|---|
| `POST /api/ingest/events` | `201` stored (first delivery) · `200` duplicate (identical content; acknowledged, no effect) · `409 event_identity_conflict` (same identity, different content; original kept) · `422` field errors, or `{detail, code}` for semantic rejections · `500` storage error without driver text |
| `GET /api/ingest/events`, `/events/{id}` | reconciliation: filter by status / source / claimed merchant. Never returns `raw` |
| `GET /api/ingest/obligations` | the derived projection |

**No authentication.** Do not expose these endpoints (or any other) outside a trusted network; see §11.

### Idempotence, ordering, replay

* **Dedup is a database constraint**, not a lookup. The internal `event_id` is derived from
  `(merchant, source, source_event_id)`, so it is stable across redelivery, replay and restore. The content
  fingerprint (everything except `raw`) distinguishes redelivery from id reuse.
* **Store first, process second** (two units of work): a valid event is never lost. If detection fails, the event
  stays, marked `failed` with the reason; `reprocess(event_id)` / `reprocess_failed()` replays it; a redelivery of
  a still-`received`/`failed` event retries it automatically.
* **Out-of-order delivery is safe by construction.** The obligation is `fold(all stored events about the object)`
  in a total order (occurred_at, then settle/void after failure at the same instant, then event id) — a function
  of the *set*, not the arrival order (exhaustively tested over permutations). The obligation row is locked while
  an event is evaluated, so concurrent events about one object serialize; the invariant "a settled object never
  keeps an open case" is race-tested with a forced interleaving and mutation-tested.

## 8. Detection boundary (`services/detection_service.py`)

`DetectionService.evaluate(merchant, kind, id)` is the seam future detection logic grows from: given the stored
events for one object it opens, refreshes or closes **the** recovery case, idempotently, in one unit of work.

| Rule | Opens a case when | Closes it when |
|---|---|---|
| failed payment | `payment.attempt_failed` stands unsettled | `payment.attempt_succeeded` is the latest relevant fact |
| failed subscription | `subscription.payment_failed` stands | `subscription.payment_succeeded` |
| overdue invoice | `invoice.overdue` stands | `invoice.paid` / `invoice.voided` |

Outcomes (`DetectionOutcome`): `case_opened`, `case_updated`, `case_resolved_at_source`, `unchanged`,
`not_at_risk`, `insufficient_data` (no positive amount / non-INR / no customer — stored, not guessed),
`settled_while_frozen` (settlement after the case was executing/finished: the case is **not** rewritten, the
obligation is flagged for reconciliation), `reopen_refused` (a failure *after* settlement does not reopen a
resolved case), `not_supported`.

**What a detected case is — and is not.** It is `open`: no decision, no attempt, no policy evaluation, no model
call. It lives in a per-merchant **ingestion run** (`kind='ingestion'`, `standby`, can never be active), so it
is invisible to the dashboard's active-run reads and `POST …/execute` on it returns `409 run_superseded`.
Receiving an event can therefore never cause an action. Making live cases actionable is a later, explicit step.
`RESOLVED_AT_SOURCE` is a new final state, deliberately **not** in `TERMINAL_CASE_STATES` (REVORA's own outcomes;
a Phase 1 test pins that set) but in `CLOSED_CASE_STATES`, which the execution guard uses. A source-resolved case
is not a recovery and never adds to recovered revenue.

**Facts are never invented.** Fields a source did not report are NULL; the strict evaluator then fails closed.
`retries_so_far` is the source's own attempt count minus one — **never** inferred from how many events happened
to be delivered (a missed delivery would undercount). Time-varying figures (`hours_since_event`, `age_days`) are
not stored at all, because they would be stale when read.

**Not implemented, and why**
* *Abandoned checkout.* `checkout.*` events are accepted and stored (`ignored`) but never open cases: the model
  has no field linking a checkout to the payment that later completes it, so a customer who paid another way would
  be chased.
* *Making event-derived cases decidable/executable.* Needs (a) decision-time computation of `hours_since_event` /
  `age_days` from `event_time` and the execution clock, (b) model features the events cannot supply
  (`ltv_bucket`, `prior_successful_payments`, `merchant_segment`) or a model trained without them, (c) an
  authenticated merchant, (d) a decision on how/when a live run becomes the active one.
* *Any claim of real leak detection.* No real source is connected.

## 9. Compatibility

* Existing endpoints keep their shapes. Additive only: `decision.policy_limits`, `run.kind`, the new
  `/api/health/ready`, `/api/ingest/*`, new audit types (`CASE_OPENED_FROM_EVENTS`, `CASE_RESOLVED_AT_SOURCE`) and
  case state (`resolved_at_source`), which only appear for event-derived cases. `RecoveryCase.version` is storage
  bookkeeping and is not in any response.
* **Ids are wider.** Phase 1 truncated UUIDs to 32–40 bits; in memory a collision silently overwrote, in a
  database it is a hard primary-key failure (≈1 % per 10k interventions at 32 bits). `new_id` now uses ≥ 64 bits.
  Ids are opaque strings to the UI (checked: no frontend code depends on their length or shape).
* 500 responses no longer echo database driver text (SQL fragments, hosts); they are logged and replaced.
* Frontend: no source change was needed. `tsc --noEmit` and `npm run build` pass. **The UI was not tested in a
  browser.**

## 10. Performance (measured, local PostgreSQL 18, same machine, one run each — indicative, not a benchmark)

| Operation | In-memory | PostgreSQL |
|---|---|---|
| scan 10 000 | 4.5 s | 6.0 s |
| first analysis, 10 000 | 0.5 s | 14.7 s |
| re-analysis (nothing changed), 10 000 | 0.4 s | 1.9 s |
| `/recover`, 2 000 cases | 0.3 s | 20.5 s (≈ 10 ms per execution) |

Analysis was restructured (chunks of 200 cases: one locking statement, bulk reads, one bulk update) from
≈ 30 s / ≈ 20 s. First-time analysis is dominated by writing 10 000 decisions, case updates and audit events one
statement at a time. The dashboard only triggers bulk recovery on 100 cases (Mission Control); a 10 000-case
bulk recovery would take ≈ 2 minutes. Both are optimization targets, not correctness issues.

## 11. Known limitations & remaining production blockers

1. **No authentication, no tenancy.** One global active run; `merchant_id` scopes idempotency keys and
   events but nothing proves who is calling. The ingestion and execute endpoints are open.
2. **Simulation only.** `SimulationProvider` draws outcomes; nothing is paid, sent or created. A live provider
   needs timeouts, retry/backoff, reconciliation by idempotency key, and a re-review of §6.2.
3. **Denied-request growth.** Each distinct key that is denied adds a `denied` ledger row and an audit event.
4. **Audit is not tamper-evident.** No hash chain or signing; the trigger is a guard against accidents.
5. **Single database, no HA/backup/retention story**, no connection-level TLS configured, no row-level
   security, no PII handling for `source_event_raw` (a provider payload can contain personal data).
6. **Interrupted-reservation recovery is pull-based** (next request, startup). No scheduler exists, so an idle
   case stays `executing` until one of those happens. `recover_interrupted()` is ready for a worker.
7. **Analysis uses bulk-read hints** for the ledger and contact window; every case is re-checked under its lock
   and execution never uses them, but a decision may reflect a contact count a few milliseconds old.
8. **Policy facts for event-derived cases are incomplete by design** (§8), so they cannot be decided yet.
9. **`GET` endpoints load whole runs** (e.g. `/api/transactions` reads all 10 000 rows then slices). Fine for the
   demo, not for scale. No pagination was added (API shape preserved).
10. **PostgreSQL ≥ 12** assumed (`hashtextextended`, `starts_with`); tested on 18.6 only.
11. The `leak_type` filter of `/api/audit` is a pre-existing quirk (first two letters of the value against the
    leak-id prefix, or exact action); preserved identically on both repositories rather than silently changed.

## 12. Verification performed

See the final report for exact counts. In short: the Phase 1 suite and the new suites run against both
repositories where the behavior is shared (`any_repo` fixture); PostgreSQL-only guarantees run against a
disposable PostgreSQL cluster started from the local binaries (`backend/tests/pg_support.py`; it never touches
the installed service). Concurrency tests use **separate connection pools** (each stands in for a separate
worker process). A scripted mutation sweep (`python backend/tests/tools/mutation_check.py`) removes one safeguard
at a time (customer lock, case row lock, active-run lock, scan-registry lock, obligation lock, analysis chunk lock,
duplicate-key retry, committed-denial, abort-path save, reclaim-in-own-unit, late-result guard, version check,
contact-cap read) and confirms a named test fails for each. Last full sweep (2026-10-27): 19 mutations, 19 caught,
0 missed. Four tests had no teeth on the first attempt (the race was not actually forced, or an unrelated
mechanism made the test pass) and were rewritten until the mutation was caught.

**Caveat — obligation-creation deadlock.** The original deadlock happens *inside one `INSERT`* (two speculative
inserts into the obligation's two unique indexes) and cannot be forced from outside the server (no injection
points on a stock build). `test_bursts_of_first_events_for_brand_new_objects_never_deadlock` is therefore a
probabilistic stress test: with the fix reverted it still passed on PostgreSQL 18.6 (0 of 6 runs failed, plus the
mutation run), so **it does not by itself detect a regression**. What is mutation-proven is the guarantee that
prevents the interleaving: `test_the_first_event_about_an_object_waits_on_that_objects_advisory_lock_before_inserting`
holds the object's advisory lock from a separate session and asserts (via `pg_locks`) that a first event waits on
it and cannot insert past it. Reverting the fix fails that test. It proves the serialization is present, not that
PostgreSQL would deadlock without it on every version. Real OS processes verify restart durability, the migrate CLI, startup recovery and misconfiguration
refusal. **Not verified:** any other PostgreSQL version, any other OS, real network latency, load, the UI in a
browser, real merchant data, any real provider.

## 13. Independent-review checklist (for Gemini / Antigravity)

Read, do not trust the report.

1. `backend/app/db/migrations/*.sql` — does each safety claim in §3 actually have a constraint? Look for a state
   the CHECKs allow that the state machine forbids.
2. `execution_service.py` — walk the four units (§6). Is anything slow (provider) inside a transaction? Is any
   refusal raised *inside* an `atomic()` block? Is every mutated object followed by its `save_*`?
3. `postgres.py` — which reads take locks (`get_case`, `get_case_for_transaction`, `lock_cases`,
   `get_active_run`, `lock_obligation`) and in what order? Check for a lock-order inversion (deadlock). Case row →
   active-run share lock → customer advisory lock → inserts is the intended order.
4. Try to break dedup: same `(merchant, source, source_event_id)` with different amounts, different offsets for
   the same instant, a reused id under another merchant.
5. Try to make a settled object keep an open case: reorder, duplicate and interleave events.
6. `config.py` / `container.py` — can any path yield an in-memory repository without `REVORA_STORAGE=memory`?
   Can any error message contain the password?
7. `api/routes.py` — is there a remaining place where a driver exception text reaches a response?
8. Run `REVORA_REQUIRE_POSTGRES=1 pytest backend/tests -p no:cacheprovider`, then
   `python backend/tests/tools/mutation_check.py`; a safeguard whose removal leaves its test green is a finding.
   Also try your own single-line mutations of anything in §6.
9. Confirm no frontend file changed and that no dashboard page reads the new fields.
10. Re-read §11 against the code for claims the code does not support.
