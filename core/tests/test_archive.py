"""Sampled members are selected by identifier tokens; nothing else is opened."""

from __future__ import annotations

import pytest
from helpers import make_zip

from feedbacker_core.archive import select_members


def test_matches_whole_tokens_only(tmp_path):
    z = make_zip(
        tmp_path / "a.zip",
        {
            "Quill_Avery_100200301_attempt.docx": b"",
            "Pike_Jordan_1002003011_attempt.docx": b"",  # longer number: not a match
            "folder/Marsh_Riley_100200303.pdf": b"",
            "__MACOSX/._Marsh_Riley_100200303.pdf": b"",  # macOS noise: ignored
        },
    )
    sel = select_members(z, ["100200301", "100200303"])
    assert {i: m.name for i, m in sel.matched.items()} == {
        "100200301": "Quill_Avery_100200301_attempt.docx",
        "100200303": "folder/Marsh_Riley_100200303.pdf",
    }
    assert sel.problems == []
    assert sel.ignored_count == 1


def test_unmatched_and_ambiguous_are_problems(tmp_path):
    z = make_zip(
        tmp_path / "a.zip",
        {
            "a_100200301_v1.docx": b"",
            "a_100200301_v2.docx": b"",
        },
    )
    sel = select_members(z, ["100200301", "100200309"])
    assert "no file found for sampled identifier '100200309'" in sel.problems
    assert any(
        p.startswith("sampled identifier '100200301' matches 2 files (a.zip:a_100200301_v1.docx")
        and p.endswith("resolve before importing")
        for p in sel.problems
    )


def test_not_a_zip(tmp_path):
    bad = tmp_path / "a.zip"
    bad.write_bytes(b"nope")
    with pytest.raises(ValueError, match="not a readable zip"):
        select_members(bad, ["1"])


def test_turnitin_bulk_naming_pattern(tmp_path):
    # The naming pattern observed in real Turnitin bulk zips, with fictional values:
    # "<9-digit ID> - <NAME IN CAPS> - <original name>.<ext>.pdf", plus a report .txt.
    z = make_zip(
        tmp_path / "123_1.zip",
        {
            "100200301 - QUILL AVERY . - Indv_Report_Plant_Swap_1234567_100200301.docx.pdf": b"",
            "100200302 - PIKE JORDAN - Assessment_1_2345678_1002003020.docx.pdf": b"",
            "download_report.txt": b"",
        },
    )
    sel = select_members(z, ["100200301", "100200302"])
    assert sel.problems == []
    assert sel.matched["100200301"].name.startswith("100200301 - QUILL")
    assert sel.matched["100200302"].name.startswith("100200302 - PIKE")
    assert sel.ignored_count == 1


def test_sample_spread_across_zips_and_single_files(tmp_path):
    main = make_zip(
        tmp_path / "main_1.zip",
        {
            "100200301 - QUILL AVERY - report.docx": b"a",
            "100200399 - OTHER STUDENT - report.docx": b"x",
        },
    )
    late = make_zip(tmp_path / "late.zip", {"100200302 - PIKE JORDAN - report.pdf": b"b"})
    single = tmp_path / "100200303 - MARSH RILEY - report.docx"
    single.write_bytes(b"c")
    sel = select_members([main, late, single], ["100200301", "100200302", "100200303"])
    assert sel.problems == []
    assert sel.matched["100200302"].source == late
    assert sel.matched["100200303"].source == single and not sel.matched["100200303"].is_archive
    assert sel.matched["100200303"].read() == b"c"
    assert sel.ignored_count == 1


def test_same_identifier_in_two_sources_is_ambiguous(tmp_path):
    a = make_zip(tmp_path / "a.zip", {"100200301 - X - v1.docx": b""})
    b = make_zip(tmp_path / "b.zip", {"100200301 - X - resubmitted.docx": b""})
    sel = select_members([a, b], ["100200301"])
    assert "matches 2 files (a.zip:100200301 - X - v1.docx, b.zip:" in sel.problems[0]


def test_missing_single_file_source(tmp_path):
    with pytest.raises(ValueError, match="source not found"):
        select_members([tmp_path / "gone.docx"], ["1"])
