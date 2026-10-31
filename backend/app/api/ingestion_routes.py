"""
Event ingestion endpoints.

`POST /api/ingest/events` accepts one NORMALIZED event (see backend/app/ingestion/schemas.py).
It stores the event once, derives the obligation it concerns, and opens / updates / closes the
recovery case for it. It never executes anything.

Status codes
  201  stored (first delivery). The body says whether detection ran: `event.processing_status`.
  200  duplicate delivery of an event already stored with identical content (acknowledged, no effect).
  409  `event_identity_conflict`: the same (source, source_event_id) arrived with different content.
  422  malformed (field errors from validation) or semantically unacceptable (`code` says why).

  422  `unknown_workspace`: the event names a workspace that is not registered. Nothing is stored and no
       workspace is created from the claim.

There is NO authentication in this build. `claimed_merchant_id` is recorded as an unauthenticated
claim and nothing authorizes on it: for a REGISTERED workspace anyone who can reach this endpoint can add events to
it (they only ever open inert cases in its never-active ingestion run). Do not expose this endpoint outside a trusted
network.

The GET endpoints read ONE workspace, chosen with `?workspace_id=` (default: the demo workspace). That is a
selection, not authentication; another workspace's events and obligations are reported as not found.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from backend.app.api.routes import workspace_scope
from backend.app.api.runtime import container, server_error
from backend.app.ingestion.schemas import NormalizedEventIn
from backend.app.repositories.errors import EventIdentityConflict
from backend.app.services.ingestion_service import EventValidationError

router = APIRouter(prefix="/api/ingest", tags=["ingestion"])

ingestion_service = container.ingestion_service
repo = container.repo


@router.post("/events", status_code=201)
def ingest_event(event: NormalizedEventIn, response: Response):
    try:
        result = ingestion_service.ingest(event)
    except EventValidationError as e:
        return JSONResponse(status_code=422, content={"detail": e.message, "code": e.code})
    except EventIdentityConflict as e:
        return JSONResponse(
            status_code=409,
            content={"detail": str(e), "code": "event_identity_conflict", "event_id": e.event_id},
        )
    except Exception as e:
        raise server_error("Event ingestion failed", e)
    if result.duplicate:
        response.status_code = 200
    return result.to_dict()


@router.get("/events")
def list_events(
    limit: int = Query(default=100, ge=1, le=1000),
    processing_status: Optional[str] = Query(default=None, pattern="^(received|processed|ignored|failed)$"),
    source: Optional[str] = Query(default=None),
    workspace_id: str = Depends(workspace_scope),
):
    events = repo.list_source_events(
        processing_status=processing_status, source=source, limit=limit, workspace_id=workspace_id
    )
    return {"total": len(events), "events": [e.to_dict() for e in events]}


@router.get("/events/{event_id}")
def get_event(event_id: str, workspace_id: str = Depends(workspace_scope)):
    event = repo.get_source_event(event_id, workspace_id=workspace_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Source event {event_id} not found.")
    return event.to_dict()


@router.get("/obligations")
def list_obligations(
    limit: int = Query(default=100, ge=1, le=1000),
    status: Optional[str] = Query(default=None, pattern="^(observed|at_risk|settled|void)$"),
    workspace_id: str = Depends(workspace_scope),
):
    obligations = repo.list_obligations(status=status, limit=limit, workspace_id=workspace_id)
    return {"total": len(obligations), "obligations": [o.to_dict() for o in obligations]}
