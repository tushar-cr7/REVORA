"""The workspace rules themselves (domain/workspaces.py), without any storage."""
from dataclasses import replace

import pytest

from backend.app.domain.workspaces import (
    DEMO_WORKSPACE_ID,
    InvalidWorkspace,
    SyntheticDataNotAllowed,
    UnknownWorkspace,
    Workspace,
    demo_seed_workspace,
    new_workspace,
    require_demo_workspace,
    validate_new_workspace,
)


def test_the_execution_mode_follows_the_kind_unless_given():
    assert new_workspace("d", "demo", "Demo").execution_mode == "simulation"
    assert new_workspace("m", "merchant", "Merchant").execution_mode == "recommend_only"
    assert new_workspace("d2", "demo", "Demo", execution_mode="recommend_only").execution_mode == "recommend_only"


def test_a_merchant_workspace_asking_for_simulation_is_refused_not_corrected():
    with pytest.raises(InvalidWorkspace, match="cannot use simulated execution"):
        new_workspace("m", "merchant", "Merchant", execution_mode="simulation")


@pytest.mark.parametrize("field, value", [
    ("workspace_id", ""), ("workspace_id", "x" * 129), ("workspace_id", "bad\nid"),
    ("kind", "sandbox"), ("execution_mode", "live"), ("origin", "imported"),
    ("display_name", ""), ("display_name", "   "), ("display_name", "x" * 201),
    ("base_currency", "inr"), ("base_currency", "RUPEE"), ("timezone", ""), ("timezone", "x" * 65),
])
def test_invalid_fields_are_refused(field, value):
    with pytest.raises(InvalidWorkspace):
        replace(new_workspace("w", "demo", "Demo"), **{field: value}).validate()


def test_only_explicit_workspaces_can_be_created_through_the_repository():
    validate_new_workspace(new_workspace("w", "demo", "Demo"))
    for origin in ("pre_phase3_backfill", "demo_seed"):
        with pytest.raises(InvalidWorkspace, match="explicit"):
            validate_new_workspace(replace(new_workspace("w", "demo", "Demo"), origin=origin))


def test_synthetic_data_needs_an_existing_demo_workspace():
    seed = demo_seed_workspace()
    assert (seed.workspace_id, seed.kind, seed.execution_mode, seed.origin) == (
        DEMO_WORKSPACE_ID, "demo", "simulation", "demo_seed"
    )
    assert require_demo_workspace(seed, seed.workspace_id) is seed
    with pytest.raises(UnknownWorkspace) as unknown:
        require_demo_workspace(None, "ghost")
    assert unknown.value.status_code == 422 and unknown.value.to_body()["code"] == "unknown_workspace"
    merchant = new_workspace("acme", "merchant", "Acme")
    with pytest.raises(SyntheticDataNotAllowed) as refused:
        require_demo_workspace(merchant, "acme")
    assert refused.value.status_code == 409 and refused.value.to_body() == {
        "detail": refused.value.message, "code": "synthetic_data_not_allowed", "workspace_id": "acme",
    }
    assert isinstance(Workspace, type)
