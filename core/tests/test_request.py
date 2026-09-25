"""Recording the moderation request keeps external IDs out of every record but the key."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from feedbacker_core import cli
from feedbacker_core.models import BandCount, ModerationRequest
from feedbacker_core.request import (
    RequestError,
    SampleEntry,
    load_request,
    pseudonym_for,
    record_request,
)
from feedbacker_core.workspace import Workspace, WorkspaceError

# Fictional identifiers only.
SAMPLE = [
    SampleEntry("100200301", "60-69"),
    SampleEntry("100200302", "60-69"),
    SampleEntry("100200303", "50-59"),
]


@pytest.fixture
def ws(tmp_path):
    return Workspace.create("mod-1", root=tmp_path)


def test_pseudonyms_are_sequential_letters():
    assert [pseudonym_for(i) for i in (0, 1, 25, 26, 27, 701, 702)] == [
        "[STUDENT_A]",
        "[STUDENT_B]",
        "[STUDENT_Z]",
        "[STUDENT_AA]",
        "[STUDENT_AB]",
        "[STUDENT_ZZ]",
        "[STUDENT_AAA]",
    ]


def test_records_pseudonymous_request_and_private_key(ws):
    request = record_request(
        ws,
        SAMPLE,
        cohort_size=3,
        multiple_groups=False,
        band_distribution=[BandCount(label="60-69", count=2), BandCount(label="50-59", count=1)],
        sample_note="Whole cohort sampled.",
        now=datetime(2026, 1, 15, tzinfo=UTC),
    )
    assert [(s.submission_id, s.pseudonym, s.listed_band) for s in request.sample] == [
        ("sub-001", "[STUDENT_A]", "60-69"),
        ("sub-002", "[STUDENT_B]", "60-69"),
        ("sub-003", "[STUDENT_C]", "50-59"),
    ]
    request_text = (ws.path / "request.json").read_text()
    for entry in SAMPLE:
        assert entry.external_id not in request_text
    key = {e.pseudonym: e.external_id for e in ws.read_key().entries}
    assert key == {
        "[STUDENT_A]": "100200301",
        "[STUDENT_B]": "100200302",
        "[STUDENT_C]": "100200303",
    }
    assert load_request(ws) == request
    assert request.context.provenance.transformation == "entered"


def test_request_is_a_valid_contract_record(ws):
    request = record_request(ws, SAMPLE)
    assert ModerationRequest.model_validate(ws.read_json("request.json")) == request


def test_whitespace_is_trimmed_and_band_optional(ws):
    request = record_request(ws, [SampleEntry("  100200301 "), SampleEntry("100200302", " ")])
    assert [s.listed_band for s in request.sample] == [None, None]
    assert ws.read_key().entries[0].external_id == "100200301"


def test_all_problems_are_reported_together(ws):
    entries = [
        SampleEntry("100200301"),
        SampleEntry("100200301"),  # duplicate
        SampleEntry("100200302-"),  # trailing punctuation
        SampleEntry("1002 00303"),  # internal space
        SampleEntry(""),  # empty
    ]
    with pytest.raises(RequestError) as err:
        record_request(ws, entries)
    problems = err.value.problems
    assert len(problems) == 4
    assert "entry 2: identifier '100200301' duplicates entry 1" in problems
    assert any("'100200302-' is malformed" in p for p in problems)
    assert any("'1002 00303' is malformed" in p for p in problems)
    assert "entry 5: identifier is empty" in problems
    assert not ws.exists("request.json") and not ws.key_path.exists()


def test_empty_sample_rejected(ws):
    with pytest.raises(RequestError, match="the sample is empty"):
        record_request(ws, [])


def test_inconsistent_counts_rejected(ws):
    with pytest.raises(RequestError, match="smaller than the sample"):
        record_request(ws, SAMPLE, cohort_size=2)
    with pytest.raises(RequestError, match="totals 5, more than the cohort size 3"):
        record_request(
            ws, SAMPLE, cohort_size=3, band_distribution=[BandCount(label="60-69", count=5)]
        )


def test_existing_request_is_not_overwritten_without_replace(ws):
    record_request(ws, SAMPLE)
    with pytest.raises(WorkspaceError, match="already recorded"):
        record_request(ws, SAMPLE[:1])
    request = record_request(ws, SAMPLE[:1], replace=True)
    assert len(request.sample) == 1 and len(ws.read_key().entries) == 1


# --- Command line ---------------------------------------------------------------


def test_cli_end_to_end(tmp_path, capsys):
    assert cli.main(["workspace", "create", "mod-1", "--root", str(tmp_path)]) == 0
    path = str(tmp_path / "mod-1")
    assert (
        cli.main(
            [
                "request",
                "record",
                path,
                "--sample",
                "60-69:100200301,100200302",
                "--sample",
                "50-59:100200303",
                "--cohort-size",
                "3",
                "--single-group",
                "--band",
                "60-69=2",
                "--band",
                "50-59=1",
            ]
        )
        == 0
    )
    out = capsys.readouterr().out
    assert "sub-003 [STUDENT_C] (listed under 50-59)" in out
    assert "100200301" not in out

    assert cli.main(["request", "show", path]) == 0
    shown = capsys.readouterr().out
    assert "[STUDENT_A]" in shown and "100200301" not in shown


def test_cli_band_label_may_contain_colon(tmp_path):
    ws = Workspace.create("mod-1", root=tmp_path)
    assert cli.main(["request", "record", str(ws.path), "--sample", "2:1:100200301"]) == 0
    assert load_request(ws).sample[0].listed_band == "2:1"


def test_cli_reports_errors(tmp_path, capsys):
    ws = Workspace.create("mod-1", root=tmp_path)
    assert cli.main(["request", "record", str(ws.path), "--sample", "100200301,100200301"]) == 1
    assert "duplicates entry 1" in capsys.readouterr().err
    assert cli.main(["request", "record", str(ws.path), "--sample", "1", "--band", "oops"]) == 1
    assert "LABEL=COUNT" in capsys.readouterr().err
