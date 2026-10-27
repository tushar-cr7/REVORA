# REVORA

**Intelligent Revenue Recovery**

## Problem

Every merchant has revenue that silently disappears between customer intent
and successful payment — a failed card, an abandoned checkout, a failed
subscription renewal, an overdue invoice. Standard analytics stops at "here's
how much you lost." Merchants are left to manually triage which of it is
worth chasing, and how.

## Solution

REVORA is an intelligent revenue recovery system that continuously:

**Detects → Diagnoses → Predicts → Decides → Executes → Measures → Learns**

For every at-risk transaction, it estimates a recovery probability, computes
expected value across candidate interventions (retry, payment link,
reminder, escalation, or a deliberate no-action), and only executes what a
deterministic policy engine authorizes. The AI proposes; policy controls.
Every action taken — and every action deliberately *not* taken — is written
to an audit trail.

## Core Principle

# AI FOR INTELLIGENCE. RULES FOR CONTROL.

AI/ML may identify patterns, estimate recovery probability, segment
customers, diagnose likely causes, compare interventions, and explain
decisions in plain language. It may never itself authorize money movement.
A deterministic policy layer — retry limits, cooldown periods, contact
limits, autonomous-recovery ceilings, escalation rules — is the only thing
that can approve, downgrade, or block an action, and the AI cannot override
it. This split is REVORA's central trust claim, not a footnote.

## Target Users

Merchants and finance/ops teams processing recurring or high-volume payments
(subscriptions, invoicing, D2C checkout) who need automated recovery that
doesn't come with unbounded autonomy — i.e. anyone who'd reject "an AI that
retries whatever it wants" but wants recovery automation that's provably safe.

## Core Product Loop

```
Transaction data
     ↓
Revenue Risk Engine (categorize: failed payment / abandoned checkout /
                      failed subscription / overdue invoice)
     ↓
Recovery Probability Model  ── AI / prediction layer (XGBoost)
     ↓
Decision Engine (expected value across candidate actions)  ── AI / reasoning layer
     ↓
Policy / Guardrail Engine  ── deterministic, cannot be overridden by the AI
     ↓
Execution (SimulationProvider / Razorpay test-mode API calls + Idempotency)
     ↓
Outcome Measurement + Audit Trail Ledger
```

## Recovery Actions

`retry` · `payment_link` · `reminder` · `escalate` · `suppress` (a
deliberate no-action — recognizing when *not* contacting a customer is the
right call is treated as a first-class product behavior, not an omission).

## Guardrails (current defaults, configurable)

| Guardrail | Default |
|---|---|
| Max retries | 2 |
| Min cooldown between retries | 6 hours |
| Max customer contacts | 1/day |
| Max autonomous recovery value | ₹25,000 |
| High-value transactions | Manual review / escalation |

## Implementation Status

**Built and working today:**
- `backend/` — Modular FastAPI application (`backend/app/main.py`) with clean domain models (`Transaction`, `Decision`, `Intervention`, `AuditEvent`, plus `ScanRun`, `RecoveryCase` and the `ExecutionAttempt` ledger), synthetic data generator, trained XGBoost recovery model, EV decision engine, deterministic policy engine (re-evaluated against the attempt ledger at execution, fail-closed on missing inputs), simulation provider, scoped idempotency (`Idempotency-Key`) and audit logging. See `docs/RECOVERY_LIFECYCLE.md`. Execution is a simulation: nothing real is paid, sent or created.
- **Durable persistence (Phase 2)** — a PostgreSQL repository with versioned SQL migrations, transactions, row locks, unique indexes and CHECK constraints (`backend/app/repositories/postgres.py`, `backend/app/db/`). The backend must be told where to keep state (`REVORA_STORAGE=postgres|memory`) and refuses to start on a misconfiguration; there is no silent in-memory fallback. See `docs/DURABLE_FOUNDATION.md`.
- **Event ingestion foundation (Phase 2)** — a provider-agnostic normalized event contract, `POST /api/ingest/events`, deduplication, out-of-order-safe obligation projection, and a detection boundary that opens/closes *inert* recovery cases for failed payments, failed subscription renewals and overdue invoices. It executes nothing, no real provider adapter exists, and no real merchant data has been connected.
- `backend/tests/` — Automated pytest suite of 462 tests (all passing on 2026-10-23 against PostgreSQL 18.6; this shows the tested behaviour works, not that the system is production-ready): the 185 Phase 1 tests (decision engine, policy engine incl. strict gate, case state machine, executor, pipeline, API, audit filters, recovery-lifecycle / execution-API regressions) plus the remainder for Phase 2 (storage configuration, migrations and every database constraint, repository contract on both repositories, execution safety and multi-connection concurrency on PostgreSQL, interrupted-execution recovery, real-process restart, event contract/projection/ingestion/detection, ingestion API). Database tests run against a real PostgreSQL (a disposable cluster is started from the local binaries, or `REVORA_TEST_DATABASE_URL`); without PostgreSQL they skip and say so.
- `frontend/` — Next.js UI application (React/Tailwind) featuring Mission Control dashboard, Top Opportunities list, interactive recovery pipeline, KPIs, and Audit log.

**Not yet built (spec-only):**
- Live Razorpay (or any real) execution — currently using SimulationProvider for execution.
- A provider webhook adapter — only the interface and an identity adapter exist; there is no verified provider contract.
- Authentication and tenancy — currently single-tenant demo mode; the ingestion and execute endpoints are open and `claimed_merchant_id` is only a claim.
- Making event-derived cases decidable/executable, real revenue-leak detection on connected data, a scheduler for interrupted-execution recovery, audit tamper-evidence, backups/HA.

## Development Setup

### Backend
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Choose where state lives (see .env.example). Durable:
export REVORA_STORAGE=postgres
export DATABASE_URL=postgresql://revora_app:<password>@localhost:5432/revora
python -m backend.app.db.migrate upgrade        # create / update the schema
# ...or, explicitly NOT durable (everything is lost on restart): export REVORA_STORAGE=memory

# Start backend server (it refuses to start if storage is unset or misconfigured)
python -m uvicorn backend.app.main:app --port 8000
```

Instead of exporting variables you can copy `.env.example` to `.env` (gitignored) and edit it; the backend loads the
repo-root `.env` and real environment variables win over it. On Windows, `run.bat` starts both servers, but first
runs `python -m backend.app.preflight`, which checks the storage settings (without connecting to the database) and,
if they are missing or still the sample values, prints what to fix and starts nothing. A reachable database and a
migrated schema are still checked by the backend itself at startup.

### Run Tests
```bash
pytest backend/tests -v          # database tests start a throwaway PostgreSQL if one is installed locally
REVORA_REQUIRE_POSTGRES=1 pytest backend/tests    # fail instead of skipping when PostgreSQL is unavailable
```

## Folder Structure

See [`PROJECT_STRUCTURE.md`](file:///c:/Users/tusha/OneDrive/Desktop/REVORA/PROJECT_STRUCTURE.md).
