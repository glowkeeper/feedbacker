"""The assessment brief: import, redaction, approval, and the model gate (#31)."""

from __future__ import annotations

import stat

import pytest
from helpers import PACK

from feedbacker_core import cli
from feedbacker_core.anonymise import anonymise_workspace, approve, review_lines, update_rules
from feedbacker_core.boundary import (
    UnapprovedText,
    approved_brief_text,
    approved_text,
    require_approved_brief,
)
from feedbacker_core.brief import import_brief, load_brief
from feedbacker_core.extract import ExtractionError
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.workspace import Workspace, WorkspaceError

BRIEF = PACK / "brief.docx"


@pytest.fixture
def ws(tmp_path):
    w = Workspace.create("mod-1", root=tmp_path / "workspaces")
    record_request(w, [SampleEntry("100200301")])
    return w


def test_import_extracts_locally_without_metadata(ws):
    brief = import_brief(ws, BRIEF)
    assert "Design, build, and evaluate" in brief.extract.text
    # The docx author metadata is a staff name that must never be read.
    assert brief.extract.text.count("Morgan Ellis") == 1  # only the body's contact line
    assert brief.provenance.transformation == "imported"
    assert stat.S_IMODE((ws.path / "brief.json").stat().st_mode) == 0o600
    assert load_brief(ws) == brief


def test_staff_contact_details_are_redacted(ws):
    import_brief(ws, BRIEF)
    update_rules(ws, names=["Morgan Ellis"])
    result = anonymise_workspace(ws)
    text = load_brief(ws).anonymised.text
    for value in ("Morgan Ellis", "Ellis", "m.ellis@example.com", "020 7946 0123"):
        assert value not in text, value
    assert "[PERSON_1]" in text and "[EMAIL_1]" in text and "[PHONE_1]" in text
    assert "brief" in result.counts and result.approval_kept["brief"] is False


def test_brief_can_be_anonymised_before_any_submission(ws):
    import_brief(ws, BRIEF)
    assert set(anonymise_workspace(ws).counts) == {"brief"}


def test_approval_and_the_gate(ws):
    import_brief(ws, BRIEF)
    with pytest.raises(UnapprovedText, match="not been anonymised"):
        approved_brief_text(ws)
    anonymise_workspace(ws)
    with pytest.raises(UnapprovedText, match="not been approved"):
        approved_brief_text(ws)
    appr = approve(ws, "brief")
    text, approval = approved_brief_text(ws)
    assert approval == appr and appr.approved_by.kind == "moderator"
    assert require_approved_brief(ws, text) == appr
    with pytest.raises(UnapprovedText, match="nothing was sent"):
        require_approved_brief(ws, text + " ")


def test_changes_clear_the_brief_approval(ws):
    import_brief(ws, BRIEF)
    anonymise_workspace(ws)
    approve(ws, "brief")
    assert anonymise_workspace(ws).approval_kept["brief"] is True
    update_rules(ws, names=["Morgan Ellis"])
    assert anonymise_workspace(ws).approval_kept["brief"] is False
    with pytest.raises(UnapprovedText, match="not been approved"):
        approved_brief_text(ws)


def test_brief_approval_is_not_a_submission_approval(ws):
    import_brief(ws, BRIEF)
    anonymise_workspace(ws)
    approve(ws, "brief")
    with pytest.raises(WorkspaceError, match="has not been imported"):
        approved_text(ws, "sub-001")


def test_replace_guard_bad_files_and_tampering(ws, tmp_path):
    import_brief(ws, BRIEF)
    with pytest.raises(WorkspaceError, match="already imported"):
        import_brief(ws, BRIEF)
    bad = tmp_path / "brief.pdf"
    bad.write_bytes(b"not a pdf")
    with pytest.raises(ExtractionError):
        import_brief(ws, bad, replace=True)
    assert load_brief(ws).source_format == "docx"  # the previous brief is intact
    (ws.path / "sources" / "brief.docx").write_bytes(b"tampered")
    with pytest.raises(WorkspaceError, match="does not match the record"):
        load_brief(ws)


def test_cli_brief_import_show_approve(ws, capsys):
    path = str(ws.path)
    assert cli.main(["brief", "import", path, str(BRIEF)]) == 0
    assert "imported the brief" in capsys.readouterr().out
    assert cli.main(["anonymise", "run", path, "--name", "Morgan Ellis"]) == 0
    assert "brief: redactions:" in capsys.readouterr().out
    assert cli.main(["anonymise", "show", path, "brief"]) == 0
    shown = capsys.readouterr().out
    assert shown.startswith("brief:") and "Ellis" not in shown
    assert cli.main(["anonymise", "approve", path, "brief"]) == 0
    assert "APPROVED" in review_lines(ws, "brief", False)[0]
