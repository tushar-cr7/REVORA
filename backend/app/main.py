import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.app.api.ingestion_routes import router as ingestion_router
from backend.app.api.routes import router, recovery_service
from backend.app.config import settings
from backend.app.domain.workspaces import WorkspaceError

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


@app.exception_handler(WorkspaceError)
async def workspace_error_handler(request: Request, exc: WorkspaceError) -> JSONResponse:
    """
    Any refusal by the workspace rules (unknown workspace, ownership mismatch, execution not available...) in the
    house format: a plain-string `detail`, a machine-readable `code`, and the workspace it was about.
    """
    return JSONResponse(status_code=exc.status_code, content=exc.to_body())


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
