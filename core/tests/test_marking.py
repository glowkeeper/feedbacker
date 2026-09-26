"""Importing the original marker's marking from marked views (#17)."""

from __future__ import annotations

import json

import pytest
from helpers import PACK, make_zip

from feedbacker_core import cli
from feedbacker_core.marked_view import parse_marked_view
from feedbacker_core.marking import (
    MarkingProblem,
    confirm_marking,
    describe_between,
    enter_marking,
    import_marking,
    load_marking,
)
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.rubric_import import import_rubric
from feedbacker_core.workspace import Workspace, WorkspaceError

REPLICA = PACK / "marked-view-replica.pdf"


@pytest.fixture
def ws(tmp_path):
    w = Workspace.create("mod-1", root=tmp_path / "workspaces")
    record_request(w, [SampleEntry("100200302")])
    import_rubric(w, PACK / "rubric.csv", title="Synthetic")
    return w


def views_zip(
    tmp_path,
    report=b"Number of files requested: 2\nFailed file count: 0\n",
    name="100200302 - PIKE JORDAN - Study_Buddy.docx.pdf",
):
    return make_zip(
        tmp_path / "grademark_1.zip",
        {
            name: REPLICA.read_bytes(),
            "100200399 - OTHER STUDENT - x.docx.pdf": b"never opened",
            "download_report.txt": report,
        },
    )


# --- Parsing the observed layout ---------------------------------------------------


def test_parse_replica():
    v = parse_marked_view(REPLICA)
    assert (v.external_id, v.word_count, v.grade, v.grade_max) == ("100200302", 1805, 60, 100)
    assert v.rubric_total == 59.75 and v.warnings == []
    assert [(c.number, c.criterion_label, c.page) for c in v.comments] == [
        (1, "Requirements", 1),
        (2, "Testing", 2),
        (3, None, 3),
    ]
    assert [c.position for c in v.comments] == [0.301, 0.621, 0.451]
    assert [(c.name, c.weight, c.score, c.selected_label) for c in v.criteria] == [
        ("REQUIREMENTS", 25, 68, "2:1 (68)"),
        ("IMPLEMENTATION", 25, 58, "2:2 (55)"),
        ("TESTING", 25, 58, "2:2 (58)"),
        ("PROFESSIONALISM", 25, 55, "2:2 (55)"),
    ]


def test_parse_reports_what_it_cannot_find(tmp_path):
    from helpers import pdf_pages

    v = parse_marked_view(pdf_pages(tmp_path / "x.pdf", ["Just some text."]))
    assert "no Submission ID found in the header" in v.warnings
    assert "no grade and general comments section found" in v.warnings
    assert "no rubric section found" in v.warnings


def rubric_page(path, set_fill, selected, other):
    """One rubric criterion whose levels are filled with `set_fill(canvas, colour)`."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    c.setFont("Helvetica", 10)
    c.drawString(60, 800, "RUBRIC: X-1 58 / 100")
    c.drawString(60, 780, "ANALYTICAL (100%) 58 / 100")
    for i, points in enumerate((70, 58, 45)):
        set_fill(c, selected if points == 58 else other)
        c.drawString(60, 760 - i * 20, f"Band {i} ({points}) A fictional descriptor.")
    c.showPage()
    c.save()
    return path


@pytest.mark.parametrize(
    ("space", "set_fill", "black", "grey"),
    [
        ("rgb", lambda c, v: c.setFillColorRGB(*v), (0, 0, 0), (0.6, 0.6, 0.6)),
        ("grey", lambda c, v: c.setFillGray(v), 0, 0.6),
        ("cmyk", lambda c, v: c.setFillColorCMYK(*v), (0, 0, 0, 1), (0, 0, 0, 0.4)),
    ],
)
def test_selected_level_is_found_in_any_colour_space(tmp_path, space, set_fill, black, grey):
    v = parse_marked_view(rubric_page(tmp_path / f"{space}.pdf", set_fill, black, grey))
    assert [(c.selected_label, c.selected_points) for c in v.criteria] == [("Band 1 (58)", 58)]
    assert not any("selected level" in w for w in v.warnings)


def test_cmyk_near_tie_is_warned_not_guessed(tmp_path):
    set_fill = lambda c, v: c.setFillColorCMYK(*v)  # noqa: E731
    v = parse_marked_view(
        rubric_page(tmp_path / "x.pdf", set_fill, (0, 0, 0, 0.45), (0, 0, 0, 0.4))
    )
    assert v.criteria[0].selected_label is None
    assert "criterion 'ANALYTICAL': the selected level could not be identified" in v.warnings


# --- Import ------------------------------------------------------------------------


def test_import_maps_to_source_rubric_and_notes_disagreements(ws, tmp_path):
    result = import_marking(ws, views_zip(tmp_path))
    assert result.ignored_count == 2 and result.failed == {}
    a = load_marking(ws, "sub-001")
    marks = {m.criterion_id: m for m in a.criterion_marks}
    # REQUIREMENTS and TESTING map by unique prefix; IMPLEMENTATION exactly.
    assert set(marks) == {"requirements-and-design", "implementation", "testing-and-evaluation"}
    assert marks["requirements-and-design"].level_id == "p68"  # exact points match
    assert marks["implementation"].level_id is None  # 58 is between source levels
    assert marks["implementation"].raw_label == "2:2 (55)"
    assert marks["implementation"].raw_score == "58 / 100"
    assert marks["implementation"].raw_criterion == "IMPLEMENTATION"
    notes = "\n".join(a.import_notes)
    assert "selected level 2:2 (55) disagrees with the awarded score 58 / 100" in notes
    assert "awarded 58 is between" in notes
    assert "criterion 'PROFESSIONALISM'" in notes and "could not be mapped" in notes
    assert a.overall_mark == 60 and a.raw_overall == "60 /100"  # exactly as written
    assert a.raw_rubric_total == "59.75 / 100"
    assert a.import_route == "turnitin_bulk_zip" and a.confirmed_at is None


def test_comments_are_anonymised_with_workspace_tokens(ws, tmp_path):
    import_marking(ws, views_zip(tmp_path))
    a = load_marking(ws, "sub-001")
    assert a.annotations[0].text == "Good choice of framework, [STUDENT_A]."
    assert "Jordan" not in a.overall_comment and "j.pike@example.com" not in a.overall_comment
    assert "[STUDENT_A]" in a.overall_comment and "[EMAIL_1]" in a.overall_comment
    raw = (ws.path / "marking" / "sub-001--marker.json").read_text()
    assert "Jordan" not in raw and "PIKE" not in raw and "100200302" not in raw
    key = ws.read_key().entries[0]
    assert key.names == ["PIKE JORDAN"]
    assert key.source_files["marked"] == "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf"


def test_explicit_mapping_and_correction_history(ws, tmp_path):
    z = views_zip(tmp_path)
    import_marking(ws, z)
    import_marking(
        ws, z, criteria={"PROFESSIONALISM": "reflection-and-professional-practice"}, replace=True
    )
    a = load_marking(ws, "sub-001")
    assert "reflection-and-professional-practice" in {m.criterion_id for m in a.criterion_marks}
    assert not any("could not be mapped" in n for n in a.import_notes)
    assert len(list((ws.path / "marking" / "history").iterdir())) == 1
    with pytest.raises(WorkspaceError, match="unknown source criterion"):
        import_marking(ws, z, criteria={"X": "nope"}, replace=True)


def test_download_report_failures_and_id_mismatch_are_reported(ws, tmp_path):
    z = views_zip(tmp_path, report=b"Failed file count: 1\n")
    assert import_marking(ws, z).download_warnings == [
        "source 1: its download report lists 1 failed file(s)"
    ]
    record_request(ws, [SampleEntry("100200303")], replace=True)
    other = views_zip(tmp_path, name="100200303 - MARSH RILEY - x.docx.pdf")
    import_marking(ws, other)
    notes = load_marking(ws, "sub-002").import_notes
    assert any("Submission ID inside the marked view differs" in n for n in notes)


def test_missing_view_and_missing_rubric(ws, tmp_path):
    z = make_zip(tmp_path / "empty.zip", {"100200399 - X - y.pdf": b""})
    with pytest.raises(MarkingProblem, match=r"no file found for \[STUDENT_A\]"):
        import_marking(ws, z)
    bare = Workspace.create("bare", root=tmp_path / "workspaces")
    record_request(bare, [SampleEntry("100200302")])
    with pytest.raises(WorkspaceError, match="import the source rubric first"):
        import_marking(bare, views_zip(tmp_path))


def test_unmapped_names_are_listed_with_source_ids(ws, tmp_path):
    result = import_marking(ws, views_zip(tmp_path))
    assert result.unmapped == {"PROFESSIONALISM"}
    assert "reflection-and-professional-practice" in result.source_ids


def test_reimport_requires_replace(ws, tmp_path):
    import_marking(ws, views_zip(tmp_path))
    with pytest.raises(WorkspaceError, match="already imported"):
        import_marking(ws, views_zip(tmp_path))


# --- Confirmation, manual entry, and review -------------------------------------------


def test_confirm_and_manual_entry_with_history(ws, tmp_path):
    import_marking(ws, views_zip(tmp_path))
    confirmed = confirm_marking(ws, "sub-001")
    assert confirmed.confirmed_by.kind == "moderator"
    manual = enter_marking(
        ws, "sub-001", overall=61, criteria={"implementation": 55}, comment="Jordan's app works."
    )
    assert manual.import_route == "manual" and manual.confirmed_at is not None
    assert manual.criterion_marks[0].level_id == "p55"
    assert manual.overall_comment == "[STUDENT_A]'s app works."
    assert len(list((ws.path / "marking" / "history").iterdir())) == 1
    second = enter_marking(ws, "sub-001", marker_label="second marker", overall=58)
    assert second.marker_label == "second marker"
    with pytest.raises(MarkingProblem, match="unknown source criterion 'nope'"):
        enter_marking(ws, "sub-001", criteria={"nope": 1})
    with pytest.raises(WorkspaceError, match="not in the sample"):
        enter_marking(ws, "sub-009", overall=1)


def test_describe_between_uses_the_source_rubric(ws):
    rubric = json.loads((ws.path / "rubric.json").read_text())
    from feedbacker_core.models import Rubric

    c = Rubric.model_validate(rubric).criterion("implementation")
    assert describe_between(68, c) == "2:1 (68)"
    assert describe_between(58, c) == "between 2:2 (55) and 2:1 (62)"
    assert describe_between(10, c) == "below FAIL (20)"
    assert describe_between(99, c) == "above 1ST (85)"


def test_cli_import_show_confirm_enter(ws, tmp_path, capsys):
    path = str(ws.path)
    assert (
        cli.main(
            [
                "marking",
                "import",
                path,
                str(views_zip(tmp_path)),
                "--criterion",
                "PROFESSIONALISM=reflection-and-professional-practice",
            ]
        )
        == 0
    )
    out = capsys.readouterr().out
    assert "imported marking for 1 sampled submission(s); 2 other file(s) were not opened" in out
    assert "PIKE" not in out and "100200302" not in out
    assert "unmapped marker criteria" not in out  # all mapped via --criterion
    assert cli.main(["marking", "import", path, str(views_zip(tmp_path)), "--replace"]) == 0
    capsys.readouterr()
    assert cli.main(["marking", "show", path, "sub-001"]) == 0
    shown = capsys.readouterr().out
    assert "NOT CONFIRMED" in shown and "between 2:2 (55) and 2:1 (62)" in shown
    assert "Jordan" not in shown
    assert cli.main(["marking", "confirm", path, "sub-001"]) == 0
    assert (
        cli.main(
            [
                "marking",
                "enter",
                path,
                "sub-001",
                "--marker",
                "agreed",
                "--overall",
                "59",
                "--criterion",
                "implementation=58",
            ]
        )
        == 0
    )
    assert cli.main(["marking", "enter", path, "sub-001", "--criterion", "bad"]) == 1


# --- Review fixes -------------------------------------------------------------------


def test_only_the_download_report_is_read_never_student_text_files(ws, tmp_path, monkeypatch):
    import zipfile as zf

    opened = []
    real_read = zf.ZipFile.read

    def tracking_read(self, name, *args, **kwargs):
        opened.append(name.filename if hasattr(name, "filename") else name)
        return real_read(self, name, *args, **kwargs)

    monkeypatch.setattr(zf.ZipFile, "read", tracking_read)
    z = make_zip(
        tmp_path / "g.zip",
        {
            "100200302 - PIKE JORDAN - Study_Buddy.docx.pdf": REPLICA.read_bytes(),
            "100200399 - OTHER STUDENT - essay.txt": b"Failed file count: 9 (a student's text)",
            "nested/notes.txt": b"Failed file count: 7",
            "download_report.txt": b"Failed file count: 0",
        },
    )
    result = import_marking(ws, z)
    assert result.download_warnings == []
    assert "100200399 - OTHER STUDENT - essay.txt" not in opened
    assert "nested/notes.txt" not in opened
    assert "download_report.txt" in opened


def test_incomplete_marked_view_fails_instead_of_importing(ws, tmp_path):
    from helpers import pdf_pages

    partial = pdf_pages(tmp_path / "p.pdf", ["Submission ID: 100200302", "Some text"])
    z = make_zip(tmp_path / "g.zip", {"100200302 - PIKE JORDAN - x.pdf": partial.read_bytes()})
    result = import_marking(ws, z)
    assert result.imported == []
    assert result.failed["sub-001"].startswith("not a complete marked view:")
    assert "the overall grade" in result.failed["sub-001"]
    assert not (ws.path / "marking" / "sub-001--marker.json").exists()


def test_page_level_errors_become_extraction_errors(monkeypatch):
    from feedbacker_core import marked_view
    from feedbacker_core.extract import ExtractionError

    def broken(pdf, view):
        raise RuntimeError("damaged content stream")

    monkeypatch.setattr(marked_view, "_read_pages", broken)
    with pytest.raises(ExtractionError, match="could not be read \\(RuntimeError\\)"):
        parse_marked_view(REPLICA)


def test_comment_without_marker_is_warned(monkeypatch):
    from feedbacker_core import marked_view

    real = marked_view._read_pages

    def no_markers(pdf, view):
        report_page, _, lines = real(pdf, view)
        return report_page, {}, lines

    monkeypatch.setattr(marked_view, "_read_pages", no_markers)
    v = parse_marked_view(REPLICA)
    assert (
        "comment 2: its marker was not found on the report pages, so its position is unknown"
        in v.warnings
    )
    assert all(c.position is None for c in v.comments)


def test_raw_scores_keep_their_written_form():
    from feedbacker_core.marked_view import CRITERION, RUBRIC_TOTAL

    assert CRITERION.match("ANALYTICAL (20%) 58/100").group("raw") == "58/100"
    assert CRITERION.match("ANALYTICAL (20%) 58.0 /  100").group("raw") == "58.0 /  100"
    assert RUBRIC_TOTAL.match("RUBRIC: X-1 61.55/100").group("raw") == "61.55/100"


def test_cli_rejects_non_numeric_points(ws, capsys):
    assert (
        cli.main(["marking", "enter", str(ws.path), "sub-001", "--criterion", "implementation=abc"])
        == 1
    )
    assert "must be a number, not 'abc'" in capsys.readouterr().err
