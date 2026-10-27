# PROJECT_STRUCTURE.md

This describes REVORA's actual architecture, with explicit boundaries between layers.

```
revora/
├── AGENTS.md
├── UI_DESIGN.md
├── README.md
├── PROJECT_STRUCTURE.md
├── .gitignore
├── .env.example
│
├── backend/                        # EXISTING — P0 Backend Foundation
│   ├── requirements.txt            # Python dependencies
│   ├── recovery_model.joblib       # Trained XGBoost model artifact
│   │
│   ├── app/
│   │   ├── main.py                 # FastAPI application entry point (+ startup sweep of interrupted executions)
│   │   ├── config.py               # Environment configuration; REVORA_STORAGE / DATABASE_URL validation
│   │   ├── container.py            # Composition root: builds the repository the config names + the services
│   │   ├── api/
│   │   │   ├── runtime.py          # Process-wide container + safe 500 helper (no driver text in responses)
│   │   │   ├── routes.py           # API endpoints (/api/scan, /api/analyze, /api/transactions,
│   │   │   │                       #  /api/opportunities, /api/decisions, /api/interventions/execute,
│   │   │   │                       #  /api/recover, /api/audit, /api/policies, /api/simulate, /api/demo,
│   │   │   │                       #  /api/health/ready)
│   │   │   ├── ingestion_routes.py # /api/ingest/events, /events/{id}, /obligations
│   │   │   └── schemas.py          # Pydantic request/response schemas
│   │   ├── domain/
│   │   │   ├── models.py           # Domain entities (Transaction, Decision, Intervention, AuditEvent, cases, attempts)
│   │   │   ├── events.py           # SourceEvent, RevenueObligation, event vocabulary and stable ids (Phase 2)
│   │   │   └── policy.py           # Deterministic PolicyLimits & evaluate_policy()
│   │   ├── ingestion/              # Phase 2: provider-agnostic event ingestion
│   │   │   ├── schemas.py          # Normalized event contract (validated at the API boundary)
│   │   │   ├── projection.py       # Order-insensitive fold of events -> obligation state
│   │   │   └── adapters.py         # Provider adapter boundary (interface + identity adapter only)
│   │   ├── db/                     # Phase 2: PostgreSQL plumbing
│   │   │   ├── pool.py             # Bounded connection pool
│   │   │   ├── migrate.py          # Versioned SQL migration runner (python -m backend.app.db.migrate)
│   │   │   └── migrations/         # 0001 core recovery schema, 0002 event ingestion
│   │   ├── intelligence/
│   │   │   ├── data_gen.py         # Synthetic data generator
│   │   │   ├── model.py            # Predictive ML (RecoveryModel)
│   │   │   └── decision_engine.py  # Expected-value decision scoring engine
│   │   ├── integrations/
│   │   │   ├── base.py             # PaymentExecutionProvider interface
│   │   │   └── simulation.py       # SimulationProvider (honest probability-based outcomes)
│   │   ├── repositories/
│   │   │   ├── base.py             # Abstract BaseRepository (atomic() = unit of work; see its docstring)
│   │   │   ├── errors.py           # Repository errors (DuplicateIdempotencyKey, StaleWrite, ...)
│   │   │   ├── postgres.py         # PostgresRepository — the durable implementation
│   │   │   └── in_memory.py        # InMemoryRepository — explicit, NOT durable (tests / demos)
│   │   └── services/
│   │       ├── recovery_service.py # Scan, analyze, bulk execution, simulation
│   │       ├── execution_service.py# The one safe execution pathway (reserve / provider / complete / recover)
│   │       ├── ingestion_service.py# Validate -> store once -> detect; replay
│   │       ├── detection_service.py# Detection boundary: obligation -> open / refresh / close a case
│   │       └── audit_service.py    # Structured audit logging & retrieval
│   │
│   └── tests/                      # AUTOMATED TEST SUITE (462 passing on 2026-10-23; see README)
│       ├── conftest.py             # Forces REVORA_STORAGE=memory for the legacy app; PostgreSQL fixtures
│       ├── pg_support.py           # Disposable PostgreSQL for database tests
│       ├── support.py              # Deterministic fixtures: fake clock, scripted provider, hand-built transactions
│       ├── events_support.py       # Deterministic event fixtures + an ingestion/detection pipeline
│       ├── tools/mutation_check.py # Removes one safeguard at a time; the tests must notice
│       ├── unit/                   # decision/policy engines, case state machine, config, event contract/projection
│       └── integration/            # API, lifecycle, Postgres schema/repository/execution/ingestion, real-process restart
│
└── frontend/                       # EXISTING — Next.js UI Application
```

## Layer Boundaries

| Layer | Owns | Does NOT own |
|---|---|---|
| **Frontend** | Presentation, interaction, motion | Any business logic, recovery math, or policy rules |
| **Backend API** (`backend/app/api/`) | Request orchestration, validation, HTTP response shaping | Policy/recovery logic |
| **Intelligence** (`backend/app/intelligence/`) | P(recovery) prediction, expected value scoring | Final execution authorization |
| **Domain Policy** (`backend/app/domain/policy.py`) | Deterministic guardrails (retries, cooldown, limits) | Model predictions |
| **Integrations** (`backend/app/integrations/`) | Execution against payment provider interfaces | Action selection |
| **Repositories** (`backend/app/repositories/`) | Data storage & query encapsulation | Business decisions |
| **Audit Ledger** (`backend/app/services/audit_service.py`) | Recording verifiable events across pipeline | Direct state mutation |

## API Endpoints

- `GET /api/health`, `GET /api/health/ready` (store reachable, schema version, whether it is durable)
- `POST /api/ingest/events`, `GET /api/ingest/events`, `GET /api/ingest/events/{id}`, `GET /api/ingest/obligations`
- `POST /api/scan`
- `POST /api/analyze`
- `GET /api/transactions`
- `GET /api/transactions/{id}`
- `GET /api/opportunities`
- `GET /api/decisions/{id}`
- `POST /api/interventions/{id}/execute` (`Idempotency-Key` header support; optional `expected_action` body)
- `POST /api/recover`
- `GET /api/audit`
- `GET /api/policies`
- `POST /api/simulate`
- `GET /api/runs`, `GET /api/cases`, `GET /api/cases/{id}` (scan runs and the recovery-case / attempt ledger)
- `POST /api/demo/force-retry-block`
