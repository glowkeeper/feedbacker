"""Malformed records are rejected with clear errors."""

from __future__ import annotations

import copy

import pytest
from conftest import MODEL, MODERATOR, ai_suggestion, approved_submission, h, model_call, prov, t
from pydantic import ValidationError

from feedbacker_core.models import (
    AISuggestion,
    Approval,
    Level,
    ModerationRecord,
    ModeratorJudgement,
    OriginalAssessment,
    Rubric,
    Submission,
    SubmissionVerdict,
)


def rejects(model, data, message: str):
    with pytest.raises(ValidationError) as err:
        model.model_validate(data)
    assert message in str(err.value), str(err.value)


# --- The three judgement types cannot be confused ---------------------------


def test_ai_suggestion_cannot_parse_as_moderator_judgement():
    rejects(ModeratorJudgement, ai_suggestion(), "moderator_judgement")


def test_moderator_judgement_cannot_parse_as_ai_suggestion(example_record):
    rejects(AISuggestion, example_record["judgements"][0], "ai_suggestion")


def test_original_assessment_cannot_parse_as_moderator_judgement(example_record):
    rejects(ModeratorJudgement, example_record["original_assessments"][0], "moderator_judgement")


def test_ai_suggestion_must_come_from_a_model():
    data = ai_suggestion(provenance=prov(MODERATOR).model_dump(mode="json"))
    rejects(AISuggestion, data, "actor must be a model")


def test_judgement_must_come_from_the_moderator(example_record):
    data = copy.deepcopy(example_record["judgements"][0])
    data["provenance"]["actor"] = MODEL.model_dump(mode="json")
    rejects(ModeratorJudgement, data, "actor must be the moderator")


def test_original_assessment_cannot_come_from_a_model(example_record):
    data = copy.deepcopy(example_record["original_assessments"][0])
    data["provenance"]["actor"] = MODEL.model_dump(mode="json")
    rejects(OriginalAssessment, data, "original marker")


def test_unknown_fields_are_rejected(example_record):
    data = copy.deepcopy(example_record["judgements"][0])
    data["final_mark"] = 70
    rejects(ModeratorJudgement, data, "Extra inputs are not permitted")


# --- Judge first, then reveal -------------------------------------------------


def judgement(**overrides):
    data = dict(
        submission_id="sub-b",
        criterion_id="design",
        mode="blind",
        first={"level_id": "p48", "recorded_at": t(10)},
        provenance=prov().model_dump(mode="json"),
    )
    data.update(overrides)
    return data


def test_first_judgement_must_precede_reveal():
    rejects(ModeratorJudgement, judgement(revealed_at=t(5)), "before the reveal")


def test_revision_requires_reveal():
    data = judgement(revised={"level_id": "p35", "recorded_at": t(20)})
    rejects(ModeratorJudgement, data, "only possible after the reveal")


def test_revision_must_follow_reveal():
    data = judgement(revealed_at=t(15), revised={"level_id": "p35", "recorded_at": t(12)})
    rejects(ModeratorJudgement, data, "after the reveal")


def test_valid_first_and_revised_judgement_are_both_kept():
    j = ModeratorJudgement.model_validate(
        judgement(revealed_at=t(15), revised={"level_id": "p35", "recorded_at": t(16)})
    )
    assert (j.first.level_id, j.revised.level_id) == ("p48", "p35")


# --- Pipeline integrity ---------------------------------------------------------


def test_approval_must_match_anonymised_text(example_record):
    sub = approved_submission(example_record["submissions"][1])
    sub["approval"]["approved_text_sha256"] = h("something else")
    rejects(Submission, sub, "approval does not match")


def test_approval_requires_anonymised_text(example_record):
    sub = approved_submission(example_record["submissions"][1])
    del sub["anonymised"]
    rejects(Submission, sub, "approval requires anonymised text")


def test_approval_must_be_given_by_moderator():
    rejects(
        Approval,
        dict(
            id="a",
            approved_text_sha256=h("x"),
            approved_by=MODEL.model_dump(mode="json"),
            approved_at=t(1),
        ),
        "approval must be given by the moderator",
    )


def test_extract_must_match_submission_source(example_record):
    sub = approved_submission(example_record["submissions"][1])
    sub["extract"]["source_sha256"] = h("other file")
    rejects(Submission, sub, "extract source hash does not match")


def test_cached_result_must_link_to_origin():
    with pytest.raises(ValidationError, match="link to the originating request"):
        model_call(produced_by="cache")


@pytest.mark.parametrize(
    "field,value,message",
    [
        ("source_sha256", "not-a-hash", "should match pattern"),
        ("pseudonym", "Jordan Pike", "should match pattern"),
        ("source_format", "odt", "'docx' or 'pdf'"),
        ("source_kind", "email", "'marked_view' or 'original'"),
    ],
)
def test_submission_field_formats(example_record, field, value, message):
    sub = dict(example_record["submissions"][0], **{field: value})
    rejects(Submission, sub, message)


def test_level_mark_range():
    rejects(
        Level, dict(id="x", label="X", descriptor="d", min_mark=70, max_mark=40), "exceeds max_mark"
    )


def test_duplicate_criteria_rejected(rubric):
    data = rubric.model_dump(mode="json")
    data["criteria"].append(data["criteria"][0])
    rejects(Rubric, data, "duplicate rubric criterion 'design'")


# --- Moderation record cross-references ----------------------------------------


def record_with(example_record, **changes):
    data = copy.deepcopy(example_record)
    data.update(changes)
    return data


def test_valid_record_with_ai_suggestion(example_record):
    subs = copy.deepcopy(example_record["submissions"])
    subs[1] = approved_submission(subs[1])
    record = ModerationRecord.model_validate(
        record_with(example_record, submissions=subs, ai_suggestions=[ai_suggestion()])
    )
    assert record.ai_suggestions[0].call.approval_id == record.submissions[1].approval.id


def test_ai_suggestion_requires_approved_submission(example_record):
    rejects(
        ModerationRecord,
        record_with(example_record, ai_suggestions=[ai_suggestion()]),
        "submission 'sub-b' has no approval",
    )


def test_ai_suggestion_rubric_version_must_match(example_record):
    subs = copy.deepcopy(example_record["submissions"])
    subs[1] = approved_submission(subs[1])
    bad = ai_suggestion(call=model_call(rubric_version="2.0"))
    rejects(
        ModerationRecord,
        record_with(example_record, submissions=subs, ai_suggestions=[bad]),
        "rubric version '2.0' does not match '1.0'",
    )


def test_unknown_criterion_and_foreign_level_are_reported_together(example_record):
    data = copy.deepcopy(example_record)
    data["judgements"][0]["criterion_id"] = "security"
    data["judgements"][1]["first"]["level_id"] = "distinction"
    with pytest.raises(ValidationError) as err:
        ModerationRecord.model_validate(data)
    msg = str(err.value)
    assert "unknown criterion 'security'" in msg
    assert "level 'distinction' is not a level of criterion 'implementation'" in msg


def test_duplicate_judgement_rejected(example_record):
    data = copy.deepcopy(example_record)
    data["judgements"].append(data["judgements"][0])
    rejects(ModerationRecord, data, "duplicate moderator judgement 'sub-b/design'")


def test_record_approval_must_be_complete_and_by_moderator(example_record):
    rejects(
        ModerationRecord,
        record_with(example_record, approved_at=t(40).isoformat()),
        "needs both approved_by and approved_at",
    )
    rejects(
        ModerationRecord,
        record_with(
            example_record, approved_at=t(40).isoformat(), approved_by=MODEL.model_dump(mode="json")
        ),
        "must be approved by the moderator",
    )


def test_timestamps_must_be_timezone_aware(example_record):
    data = copy.deepcopy(example_record["judgements"][0])
    data["first"]["recorded_at"] = "2026-01-15T09:10:00"
    rejects(ModeratorJudgement, data, "timezone")


# --- Open and blind review ---------------------------------------------------


def test_open_review_is_the_default_and_has_no_reveal():
    j = ModeratorJudgement.model_validate(judgement(mode="open"))
    assert j.mode == "open"
    data = dict(judgement(mode="open"), revealed_at=t(15))
    rejects(ModeratorJudgement, data, "open review has no reveal or revision")


def test_example_record_has_both_review_modes(example_record):
    modes = {(j["submission_id"], j["mode"]) for j in example_record["judgements"]}
    assert modes == {("sub-b", "blind"), ("sub-a", "open")}


# --- Original marker's wording and routes --------------------------------------


def test_marker_wording_is_kept_exactly(example_record):
    record = ModerationRecord.model_validate(example_record)
    sub_b = next(a for a in record.original_assessments if a.submission_id == "sub-b")
    mark = sub_b.criterion_marks[0]
    assert (mark.raw_label, mark.raw_score, mark.mark) == ("2:1 (68)", "68 / 100", 68)
    assert sub_b.import_route == "turnitin_current_view"
    assert sub_b.annotations and sub_b.annotations[0].anchor_text


def test_mislabelled_rubric_level_is_preserved(rubric):
    testing = rubric.criterion("testing")
    level = next(lvl for lvl in testing.levels if lvl.points == 68)
    assert level.label == "2:2 (68)"


def test_unmapped_original_level_is_valid(example_record):
    data = copy.deepcopy(example_record["original_assessments"][0])
    data["criterion_marks"][0]["level_id"] = None
    data["criterion_marks"][0]["raw_label"] = "Merit+"
    assert OriginalAssessment.model_validate(data).criterion_marks[0].level_id is None


def test_several_labelled_markers_per_submission(example_record):
    data = copy.deepcopy(example_record)
    second = copy.deepcopy(data["original_assessments"][0])
    second["marker_label"] = "second marker"
    data["original_assessments"].append(second)
    ModerationRecord.model_validate(data)
    data["original_assessments"].append(copy.deepcopy(second))
    rejects(ModerationRecord, data, "duplicate original assessment 'sub-a/second marker'")


def test_import_route_is_required(example_record):
    data = copy.deepcopy(example_record["original_assessments"][0])
    del data["import_route"]
    rejects(OriginalAssessment, data, "import_route")


# --- Verdicts and context ------------------------------------------------------


def test_verdict_must_come_from_moderator(example_record):
    data = copy.deepcopy(example_record["verdicts"][0])
    data["provenance"]["actor"] = MODEL.model_dump(mode="json")
    rejects(SubmissionVerdict, data, "actor must be the moderator")


def test_verdict_for_unknown_submission_rejected(example_record):
    data = copy.deepcopy(example_record)
    data["verdicts"][0]["submission_id"] = "sub-z"
    rejects(ModerationRecord, data, "unknown submission 'sub-z'")


def test_context_is_recorded(example_record):
    record = ModerationRecord.model_validate(example_record)
    assert record.context.cohort_size == 4
    assert sum(b.count for b in record.context.band_distribution) == 4


# --- Review fixes: hash integrity, strict ordering, provenance -----------------


def test_anonymised_text_must_match_its_hash(example_record):
    sub = approved_submission(example_record["submissions"][1])
    sub["anonymised"]["text"] = "[STUDENT_B] wrote something else."
    rejects(Submission, sub, "anonymised text does not match text_sha256")


def test_tampered_text_cannot_keep_its_approval(example_record):
    # Swapping text while keeping the old hash and approval must fail.
    subs = copy.deepcopy(example_record["submissions"])
    subs[1] = approved_submission(subs[1])
    subs[1]["anonymised"]["text"] = "Jordan Pike wrote this."
    data = record_with(example_record, submissions=subs, ai_suggestions=[ai_suggestion()])
    rejects(ModerationRecord, data, "anonymised text does not match text_sha256")


def test_first_judgement_at_reveal_time_is_rejected():
    rejects(ModeratorJudgement, judgement(revealed_at=t(10)), "before the reveal")


def test_revision_at_reveal_time_is_rejected():
    data = judgement(revealed_at=t(15), revised={"level_id": "p35", "recorded_at": t(15)})
    rejects(ModeratorJudgement, data, "after the reveal")


def test_submission_requires_provenance(example_record):
    data = copy.deepcopy(example_record["submissions"][0])
    del data["provenance"]
    rejects(Submission, data, "provenance")


def test_context_requires_provenance(example_record):
    data = copy.deepcopy(example_record)
    del data["context"]["provenance"]
    rejects(ModerationRecord, data, "provenance")
