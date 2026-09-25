"""The synthetic pack is valid and internally consistent."""

from __future__ import annotations

import hashlib

from conftest import PACK, load

from feedbacker_core.models import ModerationRecord, OriginalAssessment, Rubric


def test_rubric_is_valid():
    rubric = Rubric.model_validate(load("rubric.json"))
    assert [c.id for c in rubric.criteria] == ["design", "implementation", "testing", "reflection"]


def test_original_assessments_are_valid():
    originals = [OriginalAssessment.model_validate(o) for o in load("original-assessments.json")]
    assert {o.submission_id for o in originals} == {"sub-a", "sub-b", "sub-c", "sub-d"}


def test_example_record_is_valid(example_record):
    record = ModerationRecord.model_validate(example_record)
    revised = [j for j in record.judgements if j.revised]
    assert len(revised) == 1 and revised[0].first.level_id != revised[0].revised.level_id


def test_submission_hashes_match_files(example_record):
    for sub in example_record["submissions"]:
        path = PACK / "submissions" / f"{sub['id']}.{sub['source_format']}"
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sub["source_sha256"]


def test_pack_covers_both_formats(example_record):
    assert {s["source_format"] for s in example_record["submissions"]} == {"docx", "pdf"}
    assert 3 <= len(example_record["submissions"]) <= 5


def test_seeded_identifiers_use_reserved_domains():
    for ids in load("seeded-identifiers.json").values():
        for value in ids["emails"] + ids["urls"]:
            assert any(d in value for d in ("example.com", "example.org", "example.net")), value


def test_pack_declares_it_is_synthetic():
    assert "It contains no real data" in (PACK / "README.md").read_text()
