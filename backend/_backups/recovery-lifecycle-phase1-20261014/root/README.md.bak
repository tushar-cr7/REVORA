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
- `backend/` — Modular FastAPI application (`backend/app/main.py`) with clean domain models (`Transaction`, `Decision`, `Intervention`, `AuditEvent`), synthetic data generator, trained XGBoost recovery model, EV decision engine, deterministic policy engine, simulation provider, in-memory repository boundary, idempotency key header support (`Idempotency-Key`), and full audit logging.
- `backend/tests/` — Automated pytest test suite containing 21 passing unit & integration tests (`test_decision_engine.py`, `test_policy_engine.py`, `test_executor.py`, `test_pipeline.py`, `test_api.py`).
- `frontend/` — Next.js UI application (React/Tailwind) featuring Mission Control dashboard, Top Opportunities list, interactive recovery pipeline, KPIs, and Audit log.

**Not yet built (spec-only):**
- PostgreSQL persistence — current backend holds state behind `InMemoryRepository` interface for seamless migration to `PostgresRepository`.
- Live Razorpay execution — currently using SimulationProvider for execution.
- Authentication — currently single-tenant demo mode.

## Development Setup

### Backend
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Start backend server
python -m uvicorn backend.app.main:app --port 8000
```

### Run Tests
```bash
pytest backend/tests -v
```

## Folder Structure

See [`PROJECT_STRUCTURE.md`](file:///c:/Users/tusha/OneDrive/Desktop/REVORA/PROJECT_STRUCTURE.md).
