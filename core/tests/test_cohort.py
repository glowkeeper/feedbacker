"""A marking workspace's cohort, imported from a synthetic bulk download."""

from __future__ import annotations

import pytest
from helpers import PACK, make_zip

from feedbacker_core import cli
from feedbacker_core.anonymise import anonymise_workspace, approve
from feedbacker_core.boundary import approved_text
from feedbacker_core.cohort import (
    CohortProblem,
    id_from_file_name,
    import_cohort,
    list_submissions,
    load_cohort,
)
from feedbacker_core.originals import load_submission
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.workspace import Workspace, WorkspaceError

SUBS = PACK / "submissions"


@pytest.fixture
def ws(tmp_path):
    return Workspace.create("mark-1", root=tmp_path / "workspaces", workspace_type="marking")


def download(tmp_path, name="cohort_1.zip", extra=None):
    """A synthetic Turnitin-style bulk download: three students, the platform's report, one stray file."""
    members = {
        "100200301 - QUILL AVERY . - report.docx": (SUBS / "sub-a.docx").read_bytes(),
        "100200302 - PIKE JORDAN - report.pdf": (SUBS / "sub-b.pdf").read_bytes(),
        "100200303 - MARSH RILEY - report.docx": (SUBS / "sub-c.docx").read_bytes(),
        "manifest.txt": b"The requested files are now available",
        "notes from the marker.docx": b"never opened",
        **(extra or {}),
    }
    return make_zip(tmp_path / name, members)


def test_ids_are_read_from_platform_names_and_nothing_is_guessed():
    assert id_from_file_name("100200301 - QUILL AVERY . - report.docx.pdf") == "100200301"
    assert id_from_file_name("pikejordan_late_4021_77031_report.docx") == "4021"
    assert id_from_file_name("pikejordan_4021_77031_report-1.pdf") == "4021"
    for name in ["Quill_Avery_100200301_report.docx", "report 2024.docx", "manifest.txt", ""]:
        assert id_from_file_name(name) is None


def test_every_submission_is_imported_with_a_pseudonym(ws, tmp_path):
    result = import_cohort(ws, download(tmp_path))
    assert [s.id for s in result.imported] == ["sub-001", "sub-002", "sub-003"]
    assert result.ignored_count == 1 and result.kept == 0 and result.failed == {}
    assert len(result.not_imported) == 1 and "doesn't carry an ID" in result.not_imported[0]
    assert "notes" not in result.not_imported[0]  # described by its shape, never its name
    cohort = load_cohort(ws)
    assert [(s.submission_id, s.pseudonym) for s in cohort.submissions] == [
        ("sub-001", "[STUDENT_A]"),
        ("sub-002", "[STUDENT_B]"),
        ("sub-003", "[STUDENT_C]"),
    ]
    assert cohort.provenance.actor.kind == "educator"
    assert load_submission(ws, "sub-002").provenance.actor.kind == "educator"
    # Real IDs and file names are only in the key.
    key = {e.pseudonym: (e.external_id, e.source_files) for e in ws.read_key().entries}
    assert key["[STUDENT_A]"] == (
        "100200301",
        {"original": "100200301 - QUILL AVERY . - report.docx"},
    )
    for path in [ws.path / "cohort.json", *(ws.path / "submissions").iterdir()]:
        assert "100200301" not in path.read_text() and "QUILL" not in path.read_text()


def test_importing_again_adds_new_ones_and_keeps_pseudonyms(ws, tmp_path):
    import_cohort(ws, download(tmp_path))
    late = tmp_path / "rowancasey_late_4024_77034_report.pdf"
    late.write_bytes((SUBS / "sub-d.pdf").read_bytes())
    result = import_cohort(ws, [download(tmp_path, "cohort_2.zip"), late])
    assert [s.id for s in result.imported] == ["sub-004"] and result.kept == 3
    assert [s.pseudonym for s in list_submissions(ws)] == [
        "[STUDENT_A]",
        "[STUDENT_B]",
        "[STUDENT_C]",
        "[STUDENT_D]",
    ]
    # Replacing is explicit, and keeps the pseudonym.
    replaced = import_cohort(ws, download(tmp_path, "cohort_3.zip"), replace=True)
    assert [s.id for s in replaced.imported] == ["sub-001", "sub-002", "sub-003"]
    assert len(load_cohort(ws).submissions) == 4


def test_an_id_in_two_files_and_unsupported_files_are_listed_not_imported(ws, tmp_path):
    z = download(
        tmp_path,
        extra={
            "100200303 - MARSH RILEY - report v2.docx": (SUBS / "sub-c.docx").read_bytes(),
            "100200305 - ROWAN CASEY - slides.pptx": b"never opened",
        },
    )
    result = import_cohort(ws, z)
    assert [s.id for s in result.imported] == ["sub-001", "sub-002"]
    assert any("2 files carry the same ID" in p for p in result.not_imported)
    assert any("not docx or pdf" in p for p in result.not_imported)


def test_a_file_that_fails_keeps_its_pseudonym_for_a_later_try(ws, tmp_path):
    z = download(tmp_path, extra={"100200304 - ROWAN CASEY - report.pdf": b"not a pdf"})
    result = import_cohort(ws, z)
    assert list(result.failed) == ["sub-004"]
    assert [s.submission_id for s in load_cohort(ws).submissions] == [
        "sub-001",
        "sub-002",
        "sub-003",
    ]
    retry = tmp_path / "100200304 - ROWAN CASEY - report.pdf"
    retry.write_bytes((SUBS / "sub-d.pdf").read_bytes())
    assert [(s.id, s.pseudonym) for s in import_cohort(ws, retry).imported] == [
        ("sub-004", "[STUDENT_D]")
    ]


def test_a_download_with_nothing_to_import_is_refused(ws, tmp_path):
    stray = make_zip(tmp_path / "stray.zip", {"notes.docx": b"x", "manifest.txt": b"x"})
    with pytest.raises(CohortProblem, match="doesn't carry an ID"):
        import_cohort(ws, stray)
    assert not (ws.path / "cohort.json").exists()


def test_only_a_marking_workspace_has_a_cohort(tmp_path):
    moderation = Workspace.create("mod-1", root=tmp_path)
    with pytest.raises(WorkspaceError, match="only a marking workspace"):
        import_cohort(moderation, download(tmp_path))
    record_request(moderation, [SampleEntry("100200301")])
    assert [s.listed_band for s in list_submissions(moderation)] == [None]


def test_anonymisation_and_approval_work_from_the_cohort(ws, tmp_path):
    import_cohort(ws, download(tmp_path))
    result = anonymise_workspace(ws)
    assert sorted(result.counts) == ["sub-001", "sub-002", "sub-003"]
    sub = load_submission(ws, "sub-001")
    assert "QUILL" not in sub.anonymised.text.upper()  # the name from the file name is redacted
    approval = approve(ws, "sub-001")
    assert approval.approved_by.kind == "educator"
    text, _ = approved_text(ws, "sub-001")
    assert text == sub.anonymised.text


def test_cli_import(ws, tmp_path, capsys):
    assert cli.main(["cohort", "import", str(ws.path), str(download(tmp_path))]) == 1
    captured = capsys.readouterr()
    assert "imported 3 submission(s); 0 already imported were kept" in captured.out
    assert "not imported" in captured.err
    assert "QUILL" not in captured.out + captured.err
    assert "100200301" not in captured.out + captured.err


def _failing_record_writes(ws, monkeypatch):
    """Make writing a submission's record fail, as a full disk would."""
    write_json = ws.write_json

    def fail(relative, data, private=False):
        if relative.startswith("submissions/"):
            raise OSError("no space left on device")
        return write_json(relative, data, private=private)

    monkeypatch.setattr(ws, "write_json", fail)


@pytest.mark.parametrize("new_name", ["report v2.pdf", "report v2.docx"])
def test_a_replacement_whose_record_fails_keeps_the_previous_pair(
    ws, tmp_path, monkeypatch, new_name
):
    import_cohort(ws, download(tmp_path))
    before = load_submission(ws, "sub-002")  # a pdf
    replacement = tmp_path / f"100200302 - PIKE JORDAN - {new_name}"
    replacement.write_bytes(
        (SUBS / ("sub-d.pdf" if new_name.endswith("pdf") else "sub-c.docx")).read_bytes()
    )
    _failing_record_writes(ws, monkeypatch)
    with pytest.raises(OSError):
        import_cohort(ws, replacement, replace=True)
    assert load_submission(ws, "sub-002") == before  # still loads and still matches
    files = sorted(p.name for p in (ws.path / "sources" / "originals").iterdir())
    assert files == ["sub-001.docx", "sub-002.pdf", "sub-003.docx"]


def test_the_brief_is_anonymised_before_any_submissions(ws):
    from feedbacker_core.brief import import_brief

    import_brief(ws, PACK / "brief.docx")
    assert list(anonymise_workspace(ws).counts) == ["brief"]
    assert approve(ws, "brief").approved_by.kind == "educator"


def test_a_docx_figures_are_kept_in_the_private_area(ws, tmp_path):
    import hashlib

    from feedbacker_core.figures import figure_path

    report = (PACK / "figures" / "report-with-figures.docx").read_bytes()
    import_cohort(ws, make_zip(tmp_path / "c.zip", {"100200301 - QUILL AVERY . - r.docx": report}))
    figures = load_submission(ws, "sub-001").extract.figures
    paths = [figure_path("sub-001", f) for f in figures]
    assert paths == ["private/figures/sub-001/FIGURE_1.png", "private/figures/sub-001/FIGURE_2.jpg"]
    for f, path in zip(figures, paths, strict=True):
        stored = ws.path / path
        assert hashlib.sha256(stored.read_bytes()).hexdigest() == f.sha256
        assert stored.stat().st_mode & 0o077 == 0


def test_a_reimport_whose_record_fails_puts_the_previous_figures_back(ws, tmp_path, monkeypatch):
    import hashlib

    from feedbacker_core.figures import figure_path

    report = PACK / "figures" / "report-with-figures"
    first = tmp_path / "100200301 - QUILL AVERY . - report.docx"
    first.write_bytes(report.with_suffix(".docx").read_bytes())
    import_cohort(ws, first)
    before = load_submission(ws, "sub-001").extract.figures
    again = tmp_path / "100200301 - QUILL AVERY . - report.pdf"
    again.write_bytes(report.with_suffix(".pdf").read_bytes())
    _failing_record_writes(ws, monkeypatch)
    with pytest.raises(OSError):
        import_cohort(ws, again, replace=True)
    assert load_submission(ws, "sub-001").extract.figures == before
    for f in before:
        stored = (ws.path / figure_path("sub-001", f)).read_bytes()
        assert hashlib.sha256(stored).hexdigest() == f.sha256
    names = sorted(p.name for p in (ws.path / "private" / "figures").iterdir())
    assert names == ["sub-001"]  # nothing staged or set aside is left behind


def test_approving_a_text_approves_its_included_figures(ws, tmp_path):
    report = tmp_path / "100200301 - QUILL AVERY . - report.docx"
    report.write_bytes((PACK / "figures" / "report-with-figures.docx").read_bytes())
    import_cohort(ws, report)
    anonymise_workspace(ws)
    figures = load_submission(ws, "sub-001").extract.figures
    approval = approve(ws, "sub-001")
    assert [(f.placeholder, f.sha256) for f in approval.figures] == [
        (f.placeholder, f.sha256) for f in figures
    ]


def test_an_approval_does_not_stand_over_a_changed_figure(ws, tmp_path):
    from feedbacker_core.figures import figure_path

    report = tmp_path / "100200301 - QUILL AVERY . - report.docx"
    report.write_bytes((PACK / "figures" / "report-with-figures.docx").read_bytes())
    import_cohort(ws, report)
    anonymise_workspace(ws)
    approve(ws, "sub-001")
    second = load_submission(ws, "sub-001").extract.figures[1]
    (ws.path / figure_path("sub-001", second)).write_bytes(b"changed")
    with pytest.raises(WorkspaceError, match="isn't the image that was extracted"):
        approve(ws, "sub-001")
    assert anonymise_workspace(ws).approval_kept["sub-001"] is False
    assert load_submission(ws, "sub-001").approval is None
