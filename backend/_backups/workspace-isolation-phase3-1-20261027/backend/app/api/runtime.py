"""
The process-wide application objects, shared by every router.

Built once at import from the environment (see backend/app/config.py). With
REVORA_STORAGE=postgres this connects to the database and verifies its schema, so a bad setting
stops the process here with a ConfigurationError rather than limping on with the wrong store.
"""
import logging

import psycopg2
from fastapi import HTTPException

from backend.app.container import build_container

container = build_container()

logger = logging.getLogger("revora.api")


def server_error(prefix: str, exc: Exception, status_code: int = 500) -> HTTPException:
    """
    A 500 whose body is safe to show. Database driver messages can contain SQL text and row values,
    so they are logged in full and replaced by a generic sentence in the response.
    """
    logger.exception("%s", prefix)
    if isinstance(exc, psycopg2.Error):
        return HTTPException(status_code=status_code, detail=f"{prefix}: storage error (see server log).")
    return HTTPException(status_code=status_code, detail=f"{prefix}: {exc}")
