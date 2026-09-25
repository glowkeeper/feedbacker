"""Inspection reports structure only: never text, metadata values, or names."""

from __future__ import annotations

import json

from helpers import PACK, make_zip

from feedbacker_core import cli
from feedbacker_core.structure import inspect_path, name_shape

SEEDED = json.loads((PACK / "seeded-identifiers.json").read_text())


def all_identifiers():
    for ids in SEEDED.values():
        yield ids["metadata_author"]
        for key in ("names", "student_ids", "emails", "urls", "organisations"):
            yield from ids[key]


def assert_no_content(lines):
    joined = "\n".join(lines)
    for value in all_identifiers():
        assert value not in joined, value
    for word in ("Plant Swap", "MoSCoW", "WebSockets", "Good choice of framework", "Grade: 62"):
        assert word not in joined


def test_name_shape_hides_letters_and_digits():
    assert name_shape("Pike_Jordan_100200302_final Report.DOCX") == (
        "Aaaa_Aaaaaa_999999999_aaaaa Aaaaaa.docx"
    )


def test_inspect_docx_and_pdf_show_no_content():
    for f in ("sub-a.docx", "sub-c.docx", "sub-b.pdf", "sub-d.pdf"):
        lines = inspect_path(PACK / "submissions" / f)
        assert lines[0].startswith("type:")
        assert_no_content(lines)


def test_inspect_marked_view_reveals_its_structure_only():
    lines = inspect_path(PACK / "marked-view-replica.pdf")
    assert "pages: 6" in lines[0]
    assert "largest-image=89%" in lines[3]
    assert "comment-headings=3" in lines[6]
    assert "band-labels=9" in lines[7]
    assert_no_content(lines)


def test_inspect_zip_shows_name_shapes_only(tmp_path):
    z = make_zip(
        tmp_path / "o.zip",
        {
            "Pike_Jordan_100200302_report.pdf": b"x",
            "Quill_Avery_100200301_report.docx": b"x",
        },
    )
    lines = inspect_path(z)
    assert "files: 2" in lines[0]
    assert any("Aaaa_Aaaaaa_999999999_aaaaaa.pdf" in ln for ln in lines)
    assert_no_content(lines)
    assert not any("100200302" in ln for ln in lines)


def test_cli_inspect(capsys):
    assert cli.main(["inspect", str(PACK / "submissions" / "sub-b.pdf")]) == 0
    out = capsys.readouterr().out
    assert "type: pdf" in out
    assert_no_content(out.splitlines())
