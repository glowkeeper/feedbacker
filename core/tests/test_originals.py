"""Importing sampled originals from a bulk zip."""

from __future__ import annotations

import json
import stat
import zipfile

import pytest
from helpers import PACK, make_zip

from feedbacker_core import cli
from feedbacker_core.originals import ImportProblem, import_originals, load_submission
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.workspace import Workspace, WorkspaceError

SUBS = PACK / "submissions"


@pytest.fixture
def ws(tmp_path):
    w = Workspace.create("mod-1", root=tmp_path / "workspaces")
    record_request(w, [SampleEntry("100200301"), SampleEntry("100200302")])
    return w


def bulk_zip(tmp_path, sampled_b=SUBS / "sub-b.pdf"):
    return make_zip(
        tmp_path / "originals.zip",
        {
            "Quill_Avery_100200301_report.docx": (SUBS / "sub-a.docx").read_bytes(),
            "Pike_Jordan_100200302_report.pdf": sampled_b.read_bytes(),
            # Not sampled, and deliberately corrupt: importing must never open it.
            "Marsh_Riley_100200399_report.docx": b"corrupt and never opened",
        },
    )


def test_imports_only_sampled_files(ws, tmp_path):
    result = import_originals(ws, bulk_zip(tmp_path))
    assert [s.id for s in result.imported] == ["sub-001", "sub-002"]
    assert result.failed == {} and result.ignored_count == 1
    sub = load_submission(ws, "sub-001")
    assert sub.source_kind == "original" and sub.source_format == "docx"
    assert "Plant Swap" in sub.extract.text
    assert sub.provenance.transformation == "imported"


def test_real_file_names_only_in_the_key(ws, tmp_path):
    import_originals(ws, bulk_zip(tmp_path))
    key = {e.pseudonym: e.source_files for e in ws.read_key().entries}
    assert key["[STUDENT_A]"] == {"original": "Quill_Avery_100200301_report.docx"}
    for path in (ws.path / "submissions").iterdir():
        text = path.read_text()
        assert "Quill_Avery" not in text and "100200301" not in text


def test_only_selected_files_are_stored_privately(ws, tmp_path):
    import_originals(ws, bulk_zip(tmp_path))
    stored = ws.path / "sources" / "originals" / "sub-001.docx"
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600
    assert stat.S_IMODE((ws.path / "submissions" / "sub-001.json").stat().st_mode) == 0o600
    # The bulk download is never copied: other students' work stays out of the workspace.
    assert sorted(p.name for p in (ws.path / "sources").rglob("*") if p.is_file()) == [
        "sub-001.docx",
        "sub-002.pdf",
    ]


def test_sample_across_main_zip_and_late_single_file(ws, tmp_path):
    main = make_zip(
        tmp_path / "main_1.zip",
        {
            "100200301 - QUILL AVERY - report.docx": (SUBS / "sub-a.docx").read_bytes(),
            "100200399 - OTHER STUDENT - report.docx": b"never opened",
        },
    )
    late = tmp_path / "100200302 - PIKE JORDAN - late report.pdf"
    late.write_bytes((SUBS / "sub-b.pdf").read_bytes())
    result = import_originals(ws, [main, late])
    assert [s.id for s in result.imported] == ["sub-001", "sub-002"]
    assert load_submission(ws, "sub-002").provenance.source.startswith("file:sha256:")
    assert load_submission(ws, "sub-001").provenance.source.startswith("archive:sha256:")
    key = {e.pseudonym: e.source_files["original"] for e in ws.read_key().entries}
    assert key["[STUDENT_B]"] == "100200302 - PIKE JORDAN - late report.pdf"


def test_unsuitable_file_fails_alone_and_clearly(ws, tmp_path):
    z = bulk_zip(tmp_path, sampled_b=PACK / "marked-view-replica.pdf")
    result = import_originals(ws, z)
    assert [s.id for s in result.imported] == ["sub-001"]
    assert "unsuitable for text extraction" in result.failed["sub-002"]
    assert not (ws.path / "submissions" / "sub-002.json").exists()
    assert not (ws.path / "sources" / "originals" / "sub-002.pdf").exists()


def test_missing_sampled_file_writes_nothing(ws, tmp_path):
    z = make_zip(tmp_path / "o.zip", {"Quill_Avery_100200301.docx": b"x"})
    with pytest.raises(ImportProblem, match=r"no file found for \[STUDENT_B\] \(sub-002\)"):
        import_originals(ws, z)
    assert not (ws.path / "submissions").exists()
    assert not (ws.path / "sources").exists()


def test_unsupported_type_is_a_problem(ws, tmp_path):
    z = make_zip(tmp_path / "o.zip", {"a_100200301.docx": b"x", "b_100200302.odt": b"x"})
    with pytest.raises(ImportProblem, match="Stage 0 imports typed docx and pdf only"):
        import_originals(ws, z)


def test_reimport_requires_replace(ws, tmp_path):
    z = bulk_zip(tmp_path)
    import_originals(ws, z)
    with pytest.raises(WorkspaceError, match="already imported"):
        import_originals(ws, z)
    assert len(import_originals(ws, z, replace=True).imported) == 2


def test_cli_import(ws, tmp_path, capsys):
    assert cli.main(["originals", "import", str(ws.path), str(bulk_zip(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert "imported 2 sampled submission(s); 1 other file(s) were not opened" in out
    assert "Quill" not in out and "100200301" not in out
    json.loads((ws.path / "submissions" / "sub-002.json").read_text())


# --- Review fixes: unreadable members, failed replacement, damaged workspace ------


def test_unreadable_member_is_a_per_submission_failure(ws, tmp_path, monkeypatch):
    from feedbacker_core import archive

    real_read = archive.Member.read

    def flaky(self):
        if "100200302" in self.name:
            raise zipfile.BadZipFile("Bad CRC-32")
        return real_read(self)

    monkeypatch.setattr(archive.Member, "read", flaky)
    result = import_originals(ws, bulk_zip(tmp_path))
    assert [s.id for s in result.imported] == ["sub-001"]
    assert result.failed["sub-002"] == "the selected file could not be read (BadZipFile)"


def test_failed_replacement_keeps_previous_pair_intact(ws, tmp_path):
    import_originals(ws, bulk_zip(tmp_path))
    before = load_submission(ws, "sub-002")
    bad = bulk_zip(tmp_path, sampled_b=PACK / "marked-view-replica.pdf")
    result = import_originals(ws, bad, replace=True)
    assert "sub-002" in result.failed
    assert load_submission(ws, "sub-002") == before  # still loads and still matches
    assert not (ws.path / "sources" / ".staging").exists()


def test_replacement_with_new_format_removes_old_file(ws, tmp_path):
    import_originals(ws, bulk_zip(tmp_path))
    z = make_zip(
        tmp_path / "v2.zip",
        {
            "Quill_Avery_100200301_report.docx": (SUBS / "sub-a.docx").read_bytes(),
            "Pike_Jordan_100200302_report.docx": (SUBS / "sub-c.docx").read_bytes(),
        },
    )
    import_originals(ws, z, replace=True)
    files = sorted(p.name for p in (ws.path / "sources" / "originals").iterdir())
    assert files == ["sub-001.docx", "sub-002.docx"]
    assert load_submission(ws, "sub-002").source_format == "docx"


def test_load_detects_a_mismatched_source(ws, tmp_path):
    import_originals(ws, bulk_zip(tmp_path))
    (ws.path / "sources" / "originals" / "sub-001.docx").write_bytes(b"tampered")
    with pytest.raises(WorkspaceError, match="does not match the record"):
        load_submission(ws, "sub-001")
