"""The approval gate everything sent to the AI must pass (ADR 0003).

Nothing may be sent to a model provider unless it is exactly the anonymised
text the moderator approved. ``approved_text`` is the only way the provider
interface obtains submission text, and ``require_approved`` re-checks the
exact string against the persisted approval of that submission, immediately
before sending. Neither accepts an approval from the caller.
"""

from __future__ import annotations

from feedbacker_core.anonymise import detect, load_rules
from feedbacker_core.brief import load_brief
from feedbacker_core.models import Approval, sha256_text
from feedbacker_core.originals import load_submission
from feedbacker_core.workspace import Workspace


class UnapprovedText(Exception):
    """Text is not the moderator-approved anonymised text. Nothing is sent."""


def approved_text(workspace: Workspace, submission_id: str) -> tuple[str, Approval]:
    """The approved anonymised text for a submission, and its persisted approval."""
    sub = load_submission(workspace, submission_id)
    if sub.anonymised is None:
        raise UnapprovedText(f"{submission_id} has not been anonymised")
    if sub.approval is None:
        raise UnapprovedText(f"{submission_id} has not been approved by the moderator")
    if sha256_text(sub.anonymised.text) != sub.approval.approved_text_sha256:
        raise UnapprovedText(f"{submission_id}: approval does not match its anonymised text")
    return sub.anonymised.text, sub.approval


def require_approved(workspace: Workspace, submission_id: str, text: str) -> Approval:
    """Final check before sending: ``text`` must be exactly the approved text of this
    submission in this workspace. The approval is reloaded from the workspace, never
    taken from the caller, so it cannot be borrowed from another submission or made up.
    Returns the persisted approval for the call record.
    """
    approved, approval = approved_text(workspace, submission_id)
    if text != approved or sha256_text(text) != approval.approved_text_sha256:
        raise UnapprovedText(
            f"{submission_id}: text does not match the moderator's approval; nothing was sent"
        )
    require_complete(workspace, submission_id, text)
    return approval


def approved_brief_text(workspace: Workspace) -> tuple[str, Approval]:
    """The approved anonymised brief, and its persisted approval."""
    brief = load_brief(workspace)
    if brief.anonymised is None:
        raise UnapprovedText("the brief has not been anonymised")
    if brief.approval is None:
        raise UnapprovedText("the brief has not been approved by the moderator")
    if sha256_text(brief.anonymised.text) != brief.approval.approved_text_sha256:
        raise UnapprovedText("the brief's approval does not match its anonymised text")
    return brief.anonymised.text, brief.approval


def require_approved_brief(workspace: Workspace, text: str) -> Approval:
    """Final check before sending the brief: it must be exactly the approved text,
    checked against the persisted approval, never one supplied by the caller."""
    approved, approval = approved_brief_text(workspace)
    if text != approved or sha256_text(text) != approval.approved_text_sha256:
        raise UnapprovedText("the brief does not match the moderator's approval; nothing was sent")
    require_complete(workspace, "the brief", text)
    return approval


def require_complete(workspace: Workspace, what: str, text: str) -> None:
    """Refuse approved text that the current key and rules would still redact.

    The pseudonym key and the rules can grow after a text was anonymised (a later
    marking import can add a name; the moderator can add a rule), so the approval
    alone doesn't show the text is still fully anonymised. It must be anonymised and
    approved again before any of it is sent. The message names the text, never what
    was found.
    """
    if detect(text, workspace.read_key(), load_rules(workspace)):
        raise UnapprovedText(
            f"{what}: its approved text contains something the anonymisation rules or "
            "pseudonym key now redact; anonymise it again and approve it (nothing of it "
            "is sent until then)"
        )
