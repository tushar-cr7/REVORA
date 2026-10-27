import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.ingestion_routes import router as ingestion_router
from backend.app.api.routes import router, recovery_service
from backend.app.config import settings

logger = logging.getLogger("revora.main")

app = FastAPI(
    title="REVORA — Intelligent Revenue Recovery API",
    description="Backend API powering REVORA's Revenue Autopilot, Decision Engine, and Policy Guardrails.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(ingestion_router)


@app.on_event("startup")
def startup_event():
    recovery_service._ensure_model()
    # A process that died between reserving an execution and completing it leaves a reservation open.
    # Close any that have outlived the timeout so their cases and idempotency keys are usable again.
    try:
        closed = recovery_service.executor.recover_interrupted()
        if closed:
            logger.warning("closed %d interrupted execution reservation(s): %s", len(closed), ", ".join(closed))
    except Exception:  # noqa: BLE001 - recovery is best-effort; the next request reclaims lazily too
        logger.exception("could not sweep interrupted execution reservations at startup")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=settings.PORT, reload=True)
