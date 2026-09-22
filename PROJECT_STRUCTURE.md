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
│   │   ├── main.py                 # FastAPI application entry point
│   │   ├── config.py               # Environment configuration
│   │   ├── api/
│   │   │   ├── routes.py           # API endpoints (/api/scan, /api/analyze, /api/transactions,
│   │   │   │                       #  /api/opportunities, /api/decisions, /api/interventions/execute,
│   │   │   │                       #  /api/recover, /api/audit, /api/policies, /api/simulate, /api/demo)
│   │   │   └── schemas.py          # Pydantic request/response schemas
│   │   ├── domain/
│   │   │   ├── models.py           # Domain entities (Transaction, Decision, Intervention, AuditEvent)
│   │   │   └── policy.py           # Deterministic PolicyLimits & evaluate_policy()
│   │   ├── intelligence/
│   │   │   ├── data_gen.py         # Synthetic data generator
│   │   │   ├── model.py            # Predictive ML (RecoveryModel)
│   │   │   └── decision_engine.py  # Expected-value decision scoring engine
│   │   ├── integrations/
│   │   │   ├── base.py             # PaymentExecutionProvider interface
│   │   │   └── simulation.py       # SimulationProvider (honest probability-based outcomes)
│   │   ├── repositories/
│   │   │   ├── base.py             # Abstract BaseRepository
│   │   │   └── in_memory.py        # InMemoryRepository implementation
│   │   └── services/
│   │       ├── recovery_service.py # Scan, analyze, individual/batch execution, simulation
│   │       └── audit_service.py    # Structured audit logging & retrieval
│   │
│   └── tests/                      # AUTOMATED TEST SUITE (21/21 passing)
│       ├── conftest.py
│       ├── unit/
│       │   ├── test_decision_engine.py
│       │   ├── test_policy_engine.py
│       │   └── test_executor.py
│       └── integration/
│           ├── test_pipeline.py
│           └── test_api.py
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

- `GET /api/health`
- `POST /api/scan`
- `POST /api/analyze`
- `GET /api/transactions`
- `GET /api/transactions/{id}`
- `GET /api/opportunities`
- `GET /api/decisions/{id}`
- `POST /api/interventions/{id}/execute` (`Idempotency-Key` header support)
- `POST /api/recover`
- `GET /api/audit`
- `GET /api/policies`
- `POST /api/simulate`
- `POST /api/demo/force-retry-block`
