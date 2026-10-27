# REVORA Phase Implementation Study Notes

> **Comprehensive Architectural Guide:** Evolution from In-Memory Prototype to High-Assurance Revenue Recovery Infrastructure.  
> **Core Operating Principle:** *AI for Intelligence. Rules for Control.*

---

## 1. Executive Roadmap & High-Level Architecture

REVORA recovers at-risk revenue (failed payments, abandoned checkouts, failed subscriptions, overdue invoices) by combining machine learning expected-value optimization with strict, deterministic policy safety guardrails.

To ensure financial safety, the system has progressed through structured implementation phases:

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 0: Baseline Prototype                                                       │
│ • XGBoost ML scoring + EV decision engine + Basic deterministic policy            │
│ • Synthetic data generation + in-memory prototype + Next.js UI                     │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ Audit revealed R1–R4 vulnerabilities
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Execution Safety & Recovery State Machine (COMPLETED 2026-10-14)         │
│ • Explicit RecoveryCase state machine (open → authorized/blocked → executing...)  │
│ • ExecutionAttempt ledger as single source of truth for counts & cooldowns        │
│ • Execution-time strict policy re-evaluation (fail-closed) inside atomic reserve  │
│ • Merchant-scoped idempotency with SHA-256 request fingerprinting                │
│ • Scan runs (deterministic data fingerprints; re-activates instead of overwriting)│
│ • Unified bulk recovery path through single execution engine                      │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ Memory-only, single-process limits
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Durable Foundation & Event Ingestion (FUNCTIONALLY COMPLETE 2026-10-23)  │
│ • PostgreSQL persistence with SELECT ... FOR UPDATE row-locking in atomic()       │
│ • Event-driven ingestion: normalized source events + out-of-order safe projections│
│ • RevenueObligation abstraction (derived purely from event history)              │
│ • Automated DetectionService opening cases from live event streams                │
│ • Multi-process connection pooling & container composition root                   │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: Live Provider Execution & Webhook Automation (PLANNED)                   │
│ • Real payment gateway integration (Razorpay live test/prod API)                  │
│ • Outbound webhooks, asynchronous provider callbacks & webhook signature verif.   │
│ • Automated reaper for in-flight reservation timeouts                             │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The Catalyst: Pre-Phase Audit Findings (Vulnerabilities R1 – R4)

Before Phase 1, an architectural security audit discovered four critical vulnerabilities in the prototype:

| Risk Code | Vulnerability Discovered | Real Code Reproduction | Impact / Danger |
| :--- | :--- | :--- | :--- |
| **R1 & R2** | **Unbounded Re-execution & Inflated Recoveries** | Calling `POST /interventions/{id}/execute` 40 times on a single ₹2,146 transaction resulted in **19 separate "recoveries"** and **₹40,778** in analytics. `POST /recover` rerolled all decisions on every call. | Financial disaster: duplicate customer charges, broken metrics, policy limits completely bypassed. |
| **R3** | **Global Idempotency Key Collision** | The idempotency cache was a simple global hash map. Submitting a duplicate key for a *different* transaction returned the *first* transaction's intervention data. | Cross-account contamination, wrong intervention executed on wrong customer. |
| **R4** | **Scan In-Place Mutation Desynchronization** | Re-scanning updated transactions in-place while decisions, interventions, and audit events remained. 66/100 shared transaction IDs had different amounts across scans. | State corruption: a ₹780 decision/intervention was linked to a ₹851 transaction. |

---

## 3. Phase 1 Deep Dive: Execution Safety & State Machine

*Completed on 2026-10-14 | Backed up in `backend/_backups/recovery-lifecycle-phase1-20261014/` | Test count: 172 tests*

### 3.1. The Scan Run Lifecycle (`ScanRun`)
- **Deterministic Run Identity:** A run is uniquely identified by `(merchant_id, n_total, seed)`.
- **Run Re-activation:** If a scan arrives with identical parameters, REVORA **re-activates the existing run** (`reused_existing_run: true`). It retains all case states, decisions, and attempts without resetting them.
- **Superseding:** If new scan parameters arrive, the old run transitions to `superseded`—it is **never deleted**. All entities carry a `run_id`.
- **Run Scoping:** Reads default to the **active** run. Superceded cases cannot be executed (`409 run_superseded`).

### 3.2. Explicit Recovery Case State Machine (`RecoveryCase`)
Every transaction is wrapped in a `RecoveryCase`. State transitions are strictly validated against `CASE_TRANSITIONS`:

```
                       ┌──────────────┐
                       │     open     │
                       └──────┬───────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
        ┌──────────────┐              ┌──────────────┐
        │  authorized  │◄────────────►│   blocked    │
        └──────┬───────┘              └──────┬───────┘
               │ (reserve attempt)           │ (execute alternative)
               └──────────────┬──────────────┘
                              ▼
                       ┌──────────────┐
                       │  executing   │
                       └──────┬───────┘
         ┌────────────┬───────┴────────┬────────────┐
         ▼            ▼                ▼            ▼
  ┌───────────┐ ┌───────────┐   ┌─────────────┐ ┌───────────┐
  │ recovered │ │escalated  │   │ suppressed  │ │attempted_ │
  │(TERMINAL) │ │(TERMINAL) │   │ (TERMINAL)  │ │no_recovery│
  └───────────┘ └───────────┘   └─────────────┘ └─────┬─────┘
                                                      │ (retry allowed)
                                                      ▼
                                                ┌───────────┐
                                                │ executing │
                                                └───────────┘
```

- **Valid Transitions:** Any transition not defined in `CASE_TRANSITIONS` immediately raises `InvalidCaseTransition`.
- **Terminal States:** `recovered`, `escalated`, `suppressed` can never transition again.
- **Attempted No Recovery:** Allows safe future retries only if policy allows at that future point in time.

### 3.3. ExecutionAttempt Ledger
Instead of tracking retry counters on mutable transaction objects, REVORA introduced an immutable **ledger**:
- **Attempt Statuses:**
  - `reserved`: Authorized and reserved in critical section; provider call in-flight. (Counts against limits).
  - `completed`: Provider returned valid result. (Counts against limits).
  - `failed`: Provider failed or returned contradictory data. (Counts against limits as precaution).
  - `denied`: Policy refused at execution time; never reached provider. (**Does not** count against retry limits).
- **Facts Derived from Ledger:**
  - `retries_so_far`: Baseline count + counted `retry` attempts for that case.
  - `contacts_today`: Trailing 24-hour count of `reminder` and `payment_link` against that customer.
  - `hours_since_last_attempt`: Time elapsed since the most recent retry attempt.

### 3.4. Execution-Time Strict Policy Re-Evaluation (`evaluate_policy_strict`)
- **Fail-Closed Rule:** AI proposal alone is never trusted at execution time. Inside the reservation lock, current facts are pulled from the ledger.
- If any required policy input (e.g. `retries_so_far`, `hours_since_last_attempt`, `consecutive_failures`) is `None`, negative, or NaN, policy **fails closed**: the action is denied and rerouted to `escalate`.
- **Subscription Rule Order Fix:** Subscription failure limits are evaluated before cooldown rules to prevent cooldown logic from accidentally preempting subscription caps.

### 3.5. Scoped & Fingerprinted Idempotency
- **Scope:** Triple of `(merchant_id, operation, key)`.
- **Fingerprint:** SHA-256 hash of `(operation, merchant_id, case_id, expected_action)`.
- **Enforcement:**
  - Same key + matching fingerprint → Replays stored result with HTTP header `Idempotent-Replayed: true` (no re-execution, no duplicate audit event).
  - Same key + mismatched parameters → HTTP `422 idempotency_key_reuse`.
  - Same key + in-flight execution → HTTP `409 request_in_progress`.
  - New key on terminal case → HTTP `409 case_not_executable`.

### 3.6. Atomic Reservation Pattern (Concurrency Safety)
```
1. Enter atomic() Critical Section (Mutex / Lock):
   - Check case state (refuse if executing or terminal)
   - Check idempotency record
   - Re-evaluate policy strictly using live attempt ledger facts
   - If denied: Write DENIED attempt + ACTION_BLOCKED audit, return 409
   - If allowed: Record RESERVED attempt, set case to 'executing'
2. Exit atomic() Critical Section:
   - Call Payment Provider (I/O, network call outside the lock!)
3. Enter atomic() Critical Section:
   - Record attempt outcome (COMPLETED or FAILED)
   - Update RecoveryCase state (recovered, attempted_no_recovery, etc.)
   - Store IdempotencyRecord
   - Write structured AuditEvent
```

### 3.7. Unified Bulk Recovery (`POST /recover`)
- Replaces the old separate bulk loop.
- Calls `ExecutionService.execute` individually per case.
- Generates deterministic bulk keys: `bulk:{case_id}:{decision_id}`.
- Second call to `POST /recover` simply replays stored outcomes without re-executing.
- Computes `policy_violations` invariant (must strictly equal 0).

---

## 4. Phase 2 Deep Dive: Durable Foundation & Event Ingestion

*Implemented in Backend | Backed up 2026-10-22 | Test count: 462 tests (verified passing 2026-10-23 against PostgreSQL 18.6)*

> **Status:** functionally complete and verified by the test suite, mutation checks and an HTTP-level restart smoke test (see `docs/PHASE_2_CHECKPOINT.md`). **Not production-ready:** no authentication or tenancy, simulated execution provider only, no real merchant data or provider adapter, audit log not tamper-evident, no backup/HA story, tested on PostgreSQL 18.6 / Windows only, and the UI has not been exercised in a browser against PostgreSQL. A passing suite is not a production-readiness claim.

While Phase 1 solved the logic and lifecycle, it was restricted to single-process in-memory execution and synthetic batch scans. Phase 2 transforms REVORA into a **durable, event-driven system**.

### 4.1. PostgreSQL Durability & Concurrency Model (`PostgresRepository`)
- **Multi-Process Concurrency:** Instead of a Python threading mutex, `atomic()` uses PostgreSQL database transactions with **`SELECT ... FOR UPDATE`** row-level locks on `recovery_cases` and **`FOR SHARE`** locks on active runs.
- **Fail-Fast Configuration:** `Container` composition root (`backend/app/container.py`) validates `REVORA_STORAGE=postgres` at startup. If PostgreSQL is unreachable or migrations are pending, the application fails immediately with a descriptive `ConfigurationError` rather than silently degrading to memory.
- **Strict Decimal Arithmetic:** Replaced floating-point money representations with `to_money()` utility, validating exact 2-decimal minor units (`NUMERIC(16,2)`) to eliminate rounding discrepancies.

### 4.2. Database Migrations
- `0001_core_recovery_schema.sql`:
  - `scan_runs`: Track scan run status (`active`, `superseded`).
  - `recovery_cases`: Includes unique constraint ensuring at most one in-flight attempt per case and at most one recovery per case.
  - `execution_attempts`: Ledger table enforcing attempt sequences.
  - `idempotency_records`: Unique index on `(merchant_id, operation, key)`.
  - `audit_events`: Ordered, structured append-only event ledger.
- `0002_event_ingestion.sql`:
  - `source_events`: Store raw events deduplicated on `(merchant_id, source, source_event_id)`.
  - `revenue_obligations`: Track payment obligations projected from events.

### 4.3. Event Ingestion Architecture (`/api/ingest/events`)
Instead of relying solely on periodic CSV or database batch scans, REVORA can consume live merchant events:

```
Provider Webhook / App Event
         │
         ▼
 POST /api/ingest/events (NormalizedEventIn)
         │
 ┌───────┴───────────────────────────────────────────┐
 │ STEP 1: Durable Ingestion (Unit of Work 1)        │
 │ • Deduplicate on (merchant, source, event_id)     │
 │ • Store raw SourceEvent (never edited)            │
 └───────┬───────────────────────────────────────────┘
         │
 ┌───────┴───────────────────────────────────────────┐
 │ STEP 2: Pure State Projection                     │
 │ • Aggregate all SourceEvents for this reference   │
 │ • Sort total order: source_time → tiebreak → id   │
 │ • Fold into deterministic RevenueObligation       │
 └───────┬───────────────────────────────────────────┘
         │
 ┌───────┴───────────────────────────────────────────┐
 │ STEP 3: Detection Service Evaluation              │
 │ • If obligation is at-risk → Open RecoveryCase    │
 │ • If obligation settled/paid → Close RecoveryCase │
 └───────────────────────────────────────────────────┘
```

### 4.4. Pure Projections & Out-of-Order Safety (`projection.py`)
In distributed systems, webhooks and events arrive out of order or duplicated.
- **Order Invariant:** Events for an obligation are deterministically sorted:
  `timestamp` → `settle/void preference over failure if identical timestamp` → `event_id`.
- **Tie-Break Safety:** If a success and failure event share the exact same millisecond timestamp, the **success wins**. (Cost of chasing a customer who already paid is far worse than missing a transient failure).
- **Idempotent Fold:** Delivering events in any sequence yields the exact same `RevenueObligation` projection.

---

## 5. Phase Comparison Matrix

| Feature / Dimension | Phase 0 (Prototype) | Phase 1 (Execution Safety) | Phase 2 (Durable & Event-Driven) | Phase 3 (Live Execution - Future) |
| :--- | :--- | :--- | :--- | :--- |
| **Storage Backend** | In-Memory dictionaries | In-Memory with `atomic()` locks | **PostgreSQL (Row Locks)** / In-Memory option | PostgreSQL + Distributed Locks |
| **Execution Trigger** | UI button calls unvalidated endpoint | `POST /interventions/{id}/execute` & `/recover` via single engine | Single engine + event-driven automated pipeline | Automated background workers / queues |
| **Case Lifecycle** | Implicit (boolean recovered flag) | **Formal State Machine** (8 explicit states) | Formal State Machine + Ingestion Run scoping | Formal State Machine with auto-reaper |
| **Policy Enforcement** | Single check at decision time | **Dual check: Decision-time + Execution-time strict** | Execution-time strict + live DB row validation | Execution-time strict + provider rate limiters |
| **Attempt Tracking** | Stored on transaction (lost/overwritten) | **ExecutionAttempt Ledger** | **Durable DB Ledger** with constraints | Durable DB Ledger with provider transaction IDs |
| **Idempotency** | Global string dictionary | **Merchant-scoped + SHA-256 fingerprint** | **Durable DB unique constraints** | Distributed Redis/DB idempotency |
| **Data Ingestion** | Synthetic batch generator only | Scoped `ScanRun`s (fingerprinted & reusable) | **Normalized Live Event Ingestion** (`/api/ingest/events`) | Webhook adapters (Stripe, Razorpay, Recurly) |
| **Provider** | Simulated | `SimulationProvider` | `SimulationProvider` | **Live Razorpay / Payment Gateway API** |
| **Test Suite** | 21 tests | 172 tests | **462 tests (incl. multi-pool concurrency)** | Comprehensive E2E integration suite |

---

## 6. Key Architecture Principles for Study & Review

1. **AI Proposes, Policy Authorizes, Execution Enforces:**
   - ML model generates a probability ($P_{rec}$).
   - Decision engine computes Expected Value ($EV = P_{rec} \times Amount - Cost$).
   - Policy engine checks hard deterministic boundaries (Max 2 retries, 6h cooldown, 1 contact/day, ₹25k ceiling).
   - Execution engine re-checks these boundaries against real database facts before touching money.
2. **Fail-Closed by Design:**
   - Missing data never defaults to permission. If a policy variable is missing, the system escalates to human review.
3. **Out-of-Lock Provider I/O:**
   - Never hold database transactions or critical locks while awaiting third-party HTTP responses (Razorpay, Stripe). Always reserve state, release lock, execute network I/O, then re-acquire lock to complete.
4. **Source of Truth is Append-Only:**
   - Never overwrite attempt numbers, audit logs, or source events. Derive current state through append-only ledgers and deterministic projections.
