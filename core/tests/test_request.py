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
    assert len(request.sample) == 1


# --- Stable pseudonyms (review: replacement must never reassign) ----------------


def mapping(ws):
    return {e.external_id: (e.submission_id, e.pseudonym) for e in ws.read_key().entries}


def test_replacement_keeps_pseudonyms_when_reordered_or_reduced(ws):
    record_request(ws, SAMPLE)
    before = mapping(ws)
    # Reorder and drop the first entry.
    request = record_request(ws, [SAMPLE[2], SAMPLE[1]], replace=True)
    assert [(s.submission_id, s.pseudonym) for s in request.sample] == [
        before["100200303"],
        before["100200302"],
    ]
    # The dropped identifier keeps its entry, so its pseudonym is never reused.
    assert mapping(ws) == before


def test_new_identifiers_get_fresh_pseudonyms_never_reused(ws):
    record_request(ws, SAMPLE)
    record_request(ws, [SAMPLE[0]], replace=True)
    request = record_request(ws, [SAMPLE[0], SampleEntry("100200304")], replace=True)
    assert [s.pseudonym for s in request.sample] == ["[STUDENT_A]", "[STUDENT_D]"]
    assert mapping(ws)["100200304"] == ("sub-004", "[STUDENT_D]")


# --- Consistency on disk (review: key and request written separately) ----------


def test_interrupted_replacement_leaves_a_consistent_workspace(ws, monkeypatch):
    original = record_request(ws, SAMPLE[:2])
    real_write = ws.write_json

    def fail_on_request(relative, data, private=False):
        if relative == "request.json":
            raise OSError("disk full")
        return real_write(relative, data, private)

    monkeypatch.setattr(ws, "write_json", fail_on_request)
    with pytest.raises(OSError):
        record_request(ws, [SAMPLE[2], SAMPLE[0]], replace=True)
    monkeypatch.undo()
    # The old request still loads and resolves; the key only gained an entry.
    assert load_request(ws) == original
    assert "100200303" in mapping(ws)


def test_load_detects_a_damaged_key(ws):
    record_request(ws, SAMPLE)
    ws.key_path.write_text('{"entries": []}')
    with pytest.raises(WorkspaceError, match="inconsistent"):
        load_request(ws)


# --- All problems together (review: counts were hidden by sample errors) --------


def test_sample_and_count_problems_reported_together(ws):
    with pytest.raises(RequestError) as err:
        record_request(
            ws,
            [SampleEntry("100200301"), SampleEntry("100200301"), SampleEntry("x-")],
            cohort_size=0,
            band_distribution=[BandCount(label="60-69", count=4)],
            staff_roles=["module convener", " "],
        )
    joined = "\n".join(err.value.problems)
    for expected in (
        "duplicates entry 1",
        "'x-' is malformed",
        "smaller than the sample",
        "totals 4, more than the cohort size 0",
        "staff roles must not be empty",
    ):
        assert expected in joined
    assert not ws.exists("request.json") and not ws.key_path.exists()


# --- Context (review: programme, module, and staff roles) -----------------------


def test_programme_module_and_roles_are_recorded(ws):
    request = record_request(
        ws,
        SAMPLE,
        programme="MSc Fictional Computing",
        module="FIC101 Imaginary Systems",
        staff_roles=["module convener", "marker"],
    )
    assert request.context.programme == "MSc Fictional Computing"
    assert request.context.module == "FIC101 Imaginary Systems"
    assert request.context.staff_roles == ["module convener", "marker"]


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


def test_cli_invalid_retention_is_reported_without_partial_workspace(tmp_path, capsys):
    code = cli.main(
        ["workspace", "create", "mod-1", "--root", str(tmp_path), "--retention-days", "0"]
    )
    assert code == 1
    assert "invalid workspace settings" in capsys.readouterr().err
    assert not (tmp_path / "mod-1").exists()
    assert cli.main(["workspace", "create", "mod-1", "--root", str(tmp_path)]) == 0
