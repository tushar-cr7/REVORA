import itertools

import pytest

from backend.app.domain.models import (
    CASE_TRANSITIONS,
    TERMINAL_CASE_STATES,
    CaseState,
    InvalidCaseTransition,
    RecoveryCase,
)


def _case(state: CaseState = CaseState.OPEN) -> RecoveryCase:
    return RecoveryCase(
        case_id="case_x", run_id="run_x", merchant_id="m", transaction_id="tx_x", leak_id="x",
        customer_id="c", leak_type="failed_payment", amount=100.0, state=state,
    )


def test_every_state_has_a_transition_entry():
    assert set(CASE_TRANSITIONS) == set(CaseState)


@pytest.mark.parametrize(
    "path",
    [
        [CaseState.AUTHORIZED, CaseState.EXECUTING, CaseState.RECOVERED],
        [CaseState.AUTHORIZED, CaseState.EXECUTING, CaseState.ATTEMPTED_NO_RECOVERY, CaseState.EXECUTING, CaseState.RECOVERED],
        [CaseState.BLOCKED, CaseState.EXECUTING, CaseState.ESCALATED],
        [CaseState.BLOCKED, CaseState.EXECUTING, CaseState.SUPPRESSED],
        [CaseState.AUTHORIZED, CaseState.BLOCKED, CaseState.AUTHORIZED, CaseState.EXECUTING, CaseState.ATTEMPTED_NO_RECOVERY,
         CaseState.BLOCKED],
    ],
)
def test_valid_lifecycle_paths(path):
    case = _case()
    for step in path:
        case.transition(step, "test")
    assert case.state == path[-1]
    assert [h["to"] for h in case.history] == [s.value for s in path]


@pytest.mark.parametrize(
    "src,dst",
    [(s, d) for s, d in itertools.product(CaseState, CaseState) if d not in CASE_TRANSITIONS[s]],
)
def test_every_move_outside_the_table_is_rejected_and_leaves_the_case_untouched(src, dst):
    case = _case(src)
    before = (case.state, list(case.history))
    with pytest.raises(InvalidCaseTransition):
        case.transition(dst, "should fail")
    assert (case.state, case.history) == before


def test_terminal_states_have_no_exit():
    for state in TERMINAL_CASE_STATES:
        assert CASE_TRANSITIONS[state] == frozenset()
    assert TERMINAL_CASE_STATES == {CaseState.RECOVERED, CaseState.SUPPRESSED, CaseState.ESCALATED}


def test_escalation_and_suppression_are_not_recoveries():
    # The only route to RECOVERED is an executing attempt that actually recovered.
    reachable_into_recovered = [s for s, targets in CASE_TRANSITIONS.items() if CaseState.RECOVERED in targets]
    assert reachable_into_recovered == [CaseState.EXECUTING]


def test_execution_cannot_start_from_open_or_while_already_executing():
    assert CaseState.EXECUTING not in CASE_TRANSITIONS[CaseState.OPEN]
    assert CaseState.EXECUTING not in CASE_TRANSITIONS[CaseState.EXECUTING]
