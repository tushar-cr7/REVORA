"""
Workspaces (Phase 3.0): the tenant boundary that demo data and merchant data are kept apart by.

A workspace is either
    demo      synthetic data may be generated in it; execution is simulated (SimulationProvider)
    merchant  a real merchant's data. Synthetic data is NEVER generated in it, and it cannot use
              simulated execution: a simulated outcome on real records would be a fabricated result.

The existing `merchant_id` columns hold the workspace id (renaming them would be churn with no
safety gain). The rules below are enforced twice: here, by both repositories, and by the database
(migrations/0003_workspaces.sql), so a caller that skips the service still cannot break them.

What this is NOT: authentication or tenant isolation. Nothing proves who is asking for a workspace,
and reads are not yet scoped by workspace (the next increment). See docs/PHASE_3_CHECKPOINT.md.
"""
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional

from backend.app.domain.models import utc_now_iso

# The documented demo workspace: the default of POST /api/scan and of the synthetic generator. A
# fresh database and a fresh in-memory repository both start with it, so the demo works out of the box.
DEMO_WORKSPACE_ID = "merch_001"
DEMO_WORKSPACE_NAME = "REVORA demo workspace"

# Same shape as the merchant claim the ingestion contract already accepts (1-128 chars, no control characters).
_WORKSPACE_ID = re.compile(r"^[^\x00-\x1f\x7f]{1,128}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_NO_CONTROL = re.compile(r"^[^\x00-\x1f\x7f]+$")
MAX_DISPLAY_NAME = 200
MAX_TIMEZONE = 64


class WorkspaceKind(str, Enum):
    DEMO = "demo"
    MERCHANT = "merchant"


class ExecutionMode(str, Enum):
    SIMULATION = "simulation"          # SimulationProvider draws outcomes; demo only
    RECOMMEND_ONLY = "recommend_only"  # decide and explain, never execute


class WorkspaceOrigin(str, Enum):
    PRE_PHASE3_BACKFILL = "pre_phase3_backfill"  # an id found in data that existed before workspaces did
    DEMO_SEED = "demo_seed"                      # the documented demo workspace, created by migration 0003
    EXPLICIT = "explicit"                        # created on purpose through `create_workspace`


# ── errors ───────────────────────────────────────────────────────────────
class WorkspaceError(ValueError):
    """A request the workspace rules refuse. Maps 1:1 to an HTTP error with a typed body."""

    status_code = 422
    code = "workspace_error"

    def __init__(self, message: str, workspace_id: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.workspace_id = workspace_id

    def to_body(self) -> Dict[str, Any]:
        # `detail` stays a plain string, like every other typed error body in this API.
        return {"detail": self.message, "code": self.code, "workspace_id": self.workspace_id}


class InvalidWorkspace(WorkspaceError):
    status_code = 422
    code = "invalid_workspace"


class UnknownWorkspace(WorkspaceError):
    """The workspace does not exist. It is never created implicitly."""

    status_code = 422
    code = "unknown_workspace"


class WorkspaceAlreadyExists(WorkspaceError):
    status_code = 409
    code = "workspace_exists"


class SyntheticDataNotAllowed(WorkspaceError):
    """Synthetic demo data was requested for a workspace that is not a demo workspace."""

    status_code = 409
    code = "synthetic_data_not_allowed"


@dataclass
class Workspace:
    workspace_id: str
    kind: str
    display_name: str
    base_currency: str
    timezone: str
    execution_mode: str
    origin: str = WorkspaceOrigin.EXPLICIT.value
    created_at: str = field(default_factory=utc_now_iso)

    @property
    def is_demo(self) -> bool:
        return self.kind == WorkspaceKind.DEMO.value

    def validate(self) -> "Workspace":
        """Raise InvalidWorkspace unless every field is acceptable. The database checks the same rules."""
        if not isinstance(self.workspace_id, str) or not _WORKSPACE_ID.match(self.workspace_id):
            raise InvalidWorkspace("workspace_id must be 1-128 characters without control characters.", None)
        if self.kind not in {k.value for k in WorkspaceKind}:
            raise InvalidWorkspace(f"kind must be 'demo' or 'merchant', got {self.kind!r}.", self.workspace_id)
        if self.execution_mode not in {m.value for m in ExecutionMode}:
            raise InvalidWorkspace(
                f"execution_mode must be 'simulation' or 'recommend_only', got {self.execution_mode!r}.",
                self.workspace_id,
            )
        if self.kind == WorkspaceKind.MERCHANT.value and self.execution_mode != ExecutionMode.RECOMMEND_ONLY.value:
            raise InvalidWorkspace(
                "A merchant workspace cannot use simulated execution: a simulated outcome on real records "
                "would be a fabricated result. Use execution_mode 'recommend_only'.",
                self.workspace_id,
            )
        if self.origin not in {o.value for o in WorkspaceOrigin}:
            raise InvalidWorkspace(f"Unknown workspace origin {self.origin!r}.", self.workspace_id)
        name = self.display_name
        if not isinstance(name, str) or not name.strip() or len(name) > MAX_DISPLAY_NAME or not _NO_CONTROL.match(name):
            raise InvalidWorkspace(
                f"display_name must be 1-{MAX_DISPLAY_NAME} characters without control characters.", self.workspace_id
            )
        if not isinstance(self.base_currency, str) or not _CURRENCY.match(self.base_currency):
            raise InvalidWorkspace("base_currency must be an ISO 4217 code such as 'INR'.", self.workspace_id)
        tz = self.timezone
        # Only the shape is checked: the tz database is not reliably installed on every host (Windows), and a
        # check that passes on one machine and fails on another is worse than none. Imports will need more.
        if not isinstance(tz, str) or not tz.strip() or len(tz) > MAX_TIMEZONE or not _NO_CONTROL.match(tz):
            raise InvalidWorkspace(
                f"timezone must be 1-{MAX_TIMEZONE} characters without control characters.", self.workspace_id
            )
        return self

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "kind": self.kind,
            "display_name": self.display_name,
            "base_currency": self.base_currency,
            "timezone": self.timezone,
            "execution_mode": self.execution_mode,
            "origin": self.origin,
            "created_at": self.created_at,
        }


def new_workspace(
    workspace_id: str,
    kind: str,
    display_name: str,
    base_currency: str = "INR",
    timezone: str = "UTC",
    execution_mode: Optional[str] = None,
) -> Workspace:
    """
    A validated workspace for `create_workspace`. The execution mode follows from the kind unless given
    (demo -> simulation, merchant -> recommend_only); a merchant workspace asking for simulation is refused,
    never quietly corrected.
    """
    if execution_mode is None:
        execution_mode = (
            ExecutionMode.SIMULATION.value if kind == WorkspaceKind.DEMO.value else ExecutionMode.RECOMMEND_ONLY.value
        )
    return Workspace(
        workspace_id=workspace_id,
        kind=kind,
        display_name=display_name,
        base_currency=base_currency,
        timezone=timezone,
        execution_mode=execution_mode,
        origin=WorkspaceOrigin.EXPLICIT.value,
    ).validate()


def validate_new_workspace(workspace: Workspace) -> Workspace:
    """What both repositories check before registering a workspace: valid, and created on purpose."""
    workspace.validate()
    if workspace.origin != WorkspaceOrigin.EXPLICIT.value:
        raise InvalidWorkspace(
            f"A workspace can only be created with origin 'explicit' (got {workspace.origin!r}); "
            "backfilled and seeded workspaces come from migration 0003 alone.",
            workspace.workspace_id,
        )
    return workspace


def demo_seed_workspace(created_at: Optional[str] = None) -> Workspace:
    """The workspace migration 0003 seeds; the in-memory repository starts with the same one."""
    return Workspace(
        workspace_id=DEMO_WORKSPACE_ID,
        kind=WorkspaceKind.DEMO.value,
        display_name=DEMO_WORKSPACE_NAME,
        base_currency="INR",
        timezone="UTC",
        execution_mode=ExecutionMode.SIMULATION.value,
        origin=WorkspaceOrigin.DEMO_SEED.value,
        created_at=created_at or utc_now_iso(),
    )


def require_demo_workspace(workspace: Optional[Workspace], workspace_id: str) -> Workspace:
    """The single rule for synthetic data: the workspace must exist and be a demo workspace."""
    if workspace is None:
        raise UnknownWorkspace(
            f"Workspace {workspace_id!r} does not exist. Workspaces are never created implicitly.", workspace_id
        )
    if not workspace.is_demo:
        raise SyntheticDataNotAllowed(
            f"Workspace {workspace_id!r} is a {workspace.kind} workspace; synthetic demo data is only ever "
            "generated in a demo workspace.",
            workspace_id,
        )
    return workspace
