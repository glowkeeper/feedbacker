"""Rules-based anonymisation, moderator review, approval, and the model gate."""

from __future__ import annotations

import json
import stat

import pytest
from helpers import PACK, make_zip

from feedbacker_core import cli
from feedbacker_core.anonymise import (
    AnonymisationRules,
    Span,
    anonymise_workspace,
    apply,
    approve,
    detect,
    names_from_file_name,
    review_lines,
    update_rules,
)
from feedbacker_core.boundary import UnapprovedText, approved_text, require_approved
from feedbacker_core.originals import import_originals, load_submission
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.workspace import KeyEntry, PseudonymKey, Workspace

SUBS = PACK / "submissions"
SEEDED = json.loads((PACK / "seeded-identifiers.json").read_text())
# Turnitin-style bulk names (fictional), so students' names come from file names.
FILES = {
    "sub-a": ("100200301", "QUILL AVERY .", "docx"),
    "sub-b": ("100200302", "PIKE JORDAN", "pdf"),
    "sub-c": ("100200303", "MARSH RILEY", "docx"),
    "sub-d": ("100200304", "ROWAN CASEY", "pdf"),
}


@pytest.fixture
def ws(tmp_path):
    w = Workspace.create("mod-1", root=tmp_path / "workspaces")
    record_request(w, [SampleEntry(ext) for ext, _, _ in FILES.values()])
    z = make_zip(
        tmp_path / "originals_1.zip",
        {
            f"{ext} - {name} - report.{fmt}": (SUBS / f"{sid}.{fmt}").read_bytes()
            for sid, (ext, name, fmt) in FILES.items()
        },
    )
    import_originals(w, z)
    return w


def anonymised(ws, sub_id):
    return load_submission(ws, sub_id).anonymised.text


# --- Engine --------------------------------------------------------------------


def test_names_from_turnitin_file_names():
    assert names_from_file_name("100200301 - QUILL AVERY . - x.docx", "100200301") == [
        "QUILL AVERY"
    ]
    assert names_from_file_name("Quill_Avery_100200301.docx", "100200301") == []
    assert names_from_file_name("100200301 - SOLO - x.docx", "100200301") == ["SOLO"]


def key_with(name):
    return PseudonymKey(
        entries=[
            KeyEntry(
                submission_id="sub-001",
                pseudonym="[STUDENT_A]",
                external_id="100200301",
                names=[name],
            )
        ]
    )


def run(text, key, rules=None, extra=()):
    rules = rules or AnonymisationRules()
    return apply(text, detect(text, key, rules, list(extra)), key)[0]


def test_names_in_either_order_and_capitalised_parts_only():
    key = key_with("QUILL AVERY")
    text = "Avery Quill wrote this. Quill, Avery agreed. QUILL signed. A quill pen. Avery smiled."
    assert run(text, key) == (
        "[STUDENT_A] wrote this. [STUDENT_A] agreed. [STUDENT_A] signed. "
        "A quill pen. [STUDENT_A] smiled."
    )


def test_all_rule_kinds_and_stable_tokens():
    key = key_with("Avery Quill")
    rules = AnonymisationRules(
        names=["Sam"], organisations=["Northwind Widgets Ltd"], redact={"aquill99": "USERNAME"}
    )
    text = (
        "S0000101 avery.quill@example.com https://example.org/x. 07700 900123 "
        "+44 7700 900124 100200301 Sam Northwind Widgets Ltd aquill99 "
        "avery.quill@example.com"
    )
    out = run(text, key, rules)
    assert out == (
        "[ID_1] [EMAIL_1] [URL_1]. [PHONE_1] [PHONE_2] [ID_2] [PERSON_1] [ORG_1] "
        "[USERNAME_1] [EMAIL_1]"
    )
    assert {t.token: t.value for t in key.tokens}["[ORG_1]"] == "Northwind Widgets Ltd"


def test_ignore_keeps_false_positives():
    key = key_with("Avery Quill")
    rules = AnonymisationRules(ignore=["20260115"])
    assert run("Build 20260115 by Quill", key, rules) == "Build 20260115 by [STUDENT_A]"


def test_overlaps_prefer_the_longest_earliest_span():
    key = key_with("Avery Quill")
    rules = AnonymisationRules(organisations=["Quill Studios"])
    assert run("Avery Quill Studios", key, rules) == "[STUDENT_A] Studios"
    assert run("Quill Studios", key, rules) == "[ORG_1]"


def test_extra_detectors_plug_in():
    def fake_ner(text):
        i = text.find("Taylor")
        return [Span(i, i + 6, "PERSON", "Taylor")] if i >= 0 else []

    assert run("Thanks to Taylor.", key_with("Avery Quill"), extra=[fake_ner]) == (
        "Thanks to [PERSON_1]."
    )


# --- Workspace: every planted identifier is removed --------------------------------


def test_seeded_identifiers_are_all_redacted(ws):
    update_rules(ws, names=["Sam"], organisations=["Northwind Widgets Ltd", "Fabrikam Games"])
    anonymise_workspace(ws)
    for n, sid in enumerate(FILES, start=1):
        text = anonymised(ws, f"sub-{n:03d}")
        seeded = SEEDED[sid]
        values = (
            seeded["names"]
            + seeded["student_ids"]
            + seeded["emails"]
            + seeded["urls"]
            + seeded["organisations"]
        )
        for value in values:
            assert value not in text, (sid, value)
        for part in seeded["names"][0].split():
            assert part not in text, (sid, part)
    assert "[STUDENT_A]" in anonymised(ws, "sub-001")


def test_names_come_only_from_the_key_and_rules_stay_private(ws):
    anonymise_workspace(ws)
    key = ws.read_key()
    assert key.entries[0].names == ["QUILL AVERY"]
    update_rules(ws, names=["Sam"])
    assert stat.S_IMODE((ws.path / "anonymisation" / "rules.json").stat().st_mode) == 0o600


def test_nothing_happens_without_imports(tmp_path):
    w = Workspace.create("empty", root=tmp_path)
    record_request(w, [SampleEntry("100200301")])
    from feedbacker_core.workspace import WorkspaceError

    with pytest.raises(WorkspaceError, match="nothing to anonymise"):
        anonymise_workspace(w)


# --- Approval and the gate --------------------------------------------------------


def test_approval_records_who_when_and_hash(ws):
    anonymise_workspace(ws)
    appr = approve(ws, "sub-001")
    sub = load_submission(ws, "sub-001")
    assert appr.approved_by.kind == "moderator"
    assert appr.approved_text_sha256 == sub.anonymised.text_sha256
    text, approval = approved_text(ws, "sub-001")
    assert text == sub.anonymised.text and approval == appr


def test_unchanged_rerun_keeps_approval_but_changes_clear_it(ws):
    anonymise_workspace(ws)
    approve(ws, "sub-001")
    assert anonymise_workspace(ws).approval_kept["sub-001"] is True
    update_rules(ws, redact={"MoSCoW": "REDACTED"})
    result = anonymise_workspace(ws)
    assert result.approval_kept["sub-001"] is False
    with pytest.raises(UnapprovedText, match="not been approved"):
        approved_text(ws, "sub-001")


def test_gate_refuses_unanonymised_unapproved_and_modified_text(ws):
    with pytest.raises(UnapprovedText, match="not been anonymised"):
        approved_text(ws, "sub-001")
    anonymise_workspace(ws)
    with pytest.raises(UnapprovedText, match="not been approved"):
        approved_text(ws, "sub-002")
    approve(ws, "sub-002")
    text, approval = approved_text(ws, "sub-002")
    assert require_approved(ws, "sub-002", text) == approval  # exact text passes
    with pytest.raises(UnapprovedText, match="nothing was sent"):
        require_approved(ws, "sub-002", text + " ")
    with pytest.raises(UnapprovedText):
        require_approved(ws, "sub-002", text.replace("[STUDENT_B]", "Jordan Pike"))


def test_gate_is_bound_to_the_submission(ws):
    # Review fix: an approval cannot be borrowed from another submission.
    anonymise_workspace(ws)
    approve(ws, "sub-001")
    text_1, _ = approved_text(ws, "sub-001")
    with pytest.raises(UnapprovedText, match="not been approved"):
        require_approved(ws, "sub-002", text_1)  # sub-002 is unapproved
    approve(ws, "sub-002")
    with pytest.raises(UnapprovedText, match="does not match"):
        require_approved(ws, "sub-002", text_1)  # sub-001's approved text is not sub-002's


# --- Review fixes: token persistence and short names ------------------------------


def test_tokens_survive_request_replacement_and_reimport(ws, tmp_path):
    update_rules(ws, organisations=["Northwind Widgets Ltd"])
    anonymise_workspace(ws)
    before = [t.model_dump() for t in ws.read_key().tokens]
    assert before
    record_request(ws, [SampleEntry(ext) for ext, _, _ in FILES.values()], replace=True)
    assert [t.model_dump() for t in ws.read_key().tokens] == before
    z = make_zip(
        tmp_path / "again.zip",
        {
            f"{ext} - {name} - report.{fmt}": (SUBS / f"{sid}.{fmt}").read_bytes()
            for sid, (ext, name, fmt) in FILES.items()
        },
    )
    import_originals(ws, z, replace=True)
    assert [t.model_dump() for t in ws.read_key().tokens] == before
    anonymise_workspace(ws)
    assert [t.model_dump() for t in ws.read_key().tokens] == before  # nothing renumbered


def test_short_names_and_single_names_are_redacted():
    key = key_with("LI JO")
    text = "Jo presented. Li agreed. Jo Li and Li Jo. A jo-jo? No: 'li' stays lowercase."
    assert run(text, key) == (
        "[STUDENT_A] presented. [STUDENT_A] agreed. [STUDENT_A] and [STUDENT_A]. "
        "A jo-jo? No: 'li' stays lowercase."
    )
    assert run("Thanks, Ed.", key, AnonymisationRules(names=["Ed"])) == "Thanks, [PERSON_1]."
    assert run("Mononym Bo said.", key_with("BO")) == "Mononym [STUDENT_A] said."


# --- Command line -------------------------------------------------------------------


def test_cli_run_show_approve(ws, capsys):
    path = str(ws.path)
    assert (
        cli.main(
            [
                "anonymise",
                "run",
                path,
                "--name",
                "Sam",
                "--org",
                "Northwind Widgets Ltd",
                "--redact",
                "aquill99=USERNAME",
                "--ignore",
                "20260115",
            ]
        )
        == 0
    )
    out = capsys.readouterr().out
    assert "sub-001: redactions:" in out and "needs approval" in out
    assert "Quill" not in out and "Northwind" not in out

    assert cli.main(["anonymise", "show", path, "sub-001"]) == 0
    shown = capsys.readouterr().out
    assert "NOT APPROVED" in shown and "REAL VALUES" not in shown
    assert "Quill" not in shown and "[STUDENT_A]" in shown

    assert cli.main(["anonymise", "show", path, "sub-001", "--with-values"]) == 0
    assert "Do not share" in capsys.readouterr().out

    assert cli.main(["anonymise", "approve", path, "sub-001", "sub-002"]) == 0
    assert "approved sub-002" in capsys.readouterr().out
    assert "APPROVED" in "\n".join(review_lines(ws, "sub-001", False))


def test_cli_redact_without_a_valid_kind_uses_the_default(ws):
    assert cli.main(["anonymise", "run", str(ws.path), "--redact", "x=lowercase"]) == 0
    assert update_rules(ws).redact["x=lowercase"] == "REDACTED"
