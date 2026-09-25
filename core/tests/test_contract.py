"""The generated contract is current and keeps judgement types distinct."""

from __future__ import annotations

from feedbacker_core import contract
from feedbacker_core.models import CONTRACT_TYPES


def test_schema_is_up_to_date():
    assert contract.main(["--check"]) == 0


def test_contract_types_have_distinct_kinds():
    kinds = [m.model_fields["kind"].default for m in CONTRACT_TYPES]
    assert len(set(kinds)) == len(kinds)
    assert {"ai_suggestion", "moderator_judgement", "original_assessment"} <= set(kinds)
