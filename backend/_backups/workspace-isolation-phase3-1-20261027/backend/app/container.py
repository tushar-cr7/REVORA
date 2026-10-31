"""
Composition root: builds the repository the configuration names, and the services on top of it.

Importing this module connects to PostgreSQL when REVORA_STORAGE=postgres, so a misconfigured
database fails the process at startup with a `ConfigurationError` that says what to fix — it never
falls back to in-memory storage.
"""
import logging
from datetime import timedelta
from typing import Optional

import psycopg2

from backend.app.config import (
    STORAGE_MEMORY,
    ConfigurationError,
    StorageConfig,
    load_storage_config,
)
from backend.app.repositories.base import BaseRepository
from backend.app.repositories.errors import SchemaNotReady
from backend.app.services.audit_service import AuditService
from backend.app.services.detection_service import DetectionService
from backend.app.services.ingestion_service import IngestionService
from backend.app.services.recovery_service import RecoveryService

logger = logging.getLogger("revora.container")


def build_repository(config: Optional[StorageConfig] = None) -> BaseRepository:
    config = config or load_storage_config()
    if config.backend == STORAGE_MEMORY:
        from backend.app.repositories.in_memory import InMemoryRepository

        logger.warning(
            "REVORA_STORAGE=memory: state is NOT durable and is lost when this process exits. "
            "Use REVORA_STORAGE=postgres for anything you want to keep."
        )
        return InMemoryRepository()

    from backend.app.repositories.postgres import PostgresRepository

    try:
        return PostgresRepository.connect(
            config.database_url,
            schema=config.schema,
            pool_size=config.pool_size,
            auto_migrate=config.auto_migrate,
        )
    except SchemaNotReady as exc:
        raise ConfigurationError(str(exc)) from None
    except psycopg2.OperationalError as exc:
        # libpq's message names the host and the reason, never the password.
        first_line = str(exc).strip().splitlines()[0] if str(exc).strip() else "connection failed"
        raise ConfigurationError(
            f"Cannot connect to PostgreSQL ({first_line}). Check DATABASE_URL and that the server is running. "
            "REVORA will not fall back to in-memory storage."
        ) from None


class Container:
    """The wired application objects, built from one repository."""

    def __init__(self, repo: BaseRepository, config: Optional[StorageConfig] = None):
        self.config = config
        self.repo = repo
        self.audit_service = AuditService(repo=repo)
        timeout = timedelta(seconds=config.reservation_timeout_seconds) if config else None
        self.recovery_service = RecoveryService(
            repo=repo, audit_service=self.audit_service, reservation_timeout=timeout
        )
        self.detection_service = DetectionService(repo=repo, audit_service=self.audit_service)
        self.ingestion_service = IngestionService(repo=repo, detection=self.detection_service)


def build_container() -> Container:
    config = load_storage_config()
    return Container(build_repository(config), config)
