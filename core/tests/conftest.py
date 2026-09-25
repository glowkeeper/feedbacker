from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from feedbacker_core.models import (
    Actor,
    ActorKind,
    AnonymisedText,
    Approval,
    Extract,
    ModelCall,
    ProducedBy,
    Provenance,
    Rubric,
    Transformation,
)

PACK = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic" / "pack-01"
T0 = datetime(2026, 1, 15, 9, 0, tzinfo=UTC)
MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")
MODEL = Actor(kind=ActorKind.MODEL, label="test-model")


def t(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


def h(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def prov(actor: Actor = MODERATOR, transformation=Transformation.RECORDED, minutes=0):
    return Provenance(
        source="test", transformation=transformation, actor=actor, timestamp=t(minutes)
    )


def load(name: str):
    return json.loads((PACK / name).read_text())


@pytest.fixture
def rubric() -> Rubric:
    return Rubric.model_validate(load("rubric.json"))


@pytest.fixture
def example_record() -> dict:
    return load("moderation-record.example.json")


def approved_submission(submission: dict) -> dict:
    """Extend a hash-only submission with extract, anonymised text, and approval."""
    extract_text = "Jordan Pike wrote this."
    anon_text = "[STUDENT_B] wrote this."
    sub = dict(submission)
    sub["extract"] = Extract(
        text=extract_text,
        source_sha256=sub["source_sha256"],
        provenance=prov(transformation=Transformation.EXTRACTED),
    ).model_dump(mode="json")
    sub["anonymised"] = AnonymisedText(
        text=anon_text,
        text_sha256=h(anon_text),
        redactions=[{"start": 0, "end": 11, "replacement": "[STUDENT_B]", "reason": "name"}],
        provenance=prov(transformation=Transformation.ANONYMISED),
    ).model_dump(mode="json")
    sub["approval"] = Approval(
        id="appr-b", approved_text_sha256=h(anon_text), approved_by=MODERATOR, approved_at=t(1)
    ).model_dump(mode="json")
    return sub


def model_call(**overrides) -> dict:
    call = dict(
        provider="test",
        model_requested="test-model",
        prompt_version="p1",
        rubric_version="1.0",
        approval_id="appr-b",
        approved_text_sha256=h("[STUDENT_B] wrote this."),
        request_sha256=h("request"),
        produced_by=ProducedBy.LIVE,
        timestamp=t(2),
    )
    call.update(overrides)
    return ModelCall(**call).model_dump(mode="json")


def ai_suggestion(**overrides) -> dict:
    s = dict(
        kind="ai_suggestion",
        id="ai-1",
        submission_id="sub-b",
        criterion_id="design",
        suggested_level_id="p48",
        rationale="Design is not justified.",
        evidence=[{"text": "wrote this", "verified": True}],
        call=model_call(),
        provenance=prov(MODEL, Transformation.GENERATED, 2).model_dump(mode="json"),
    )
    s.update(overrides)
    return s
