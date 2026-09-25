"""The approval gate every model call must pass (#16, ADR 0003).

Nothing may be sent to a model provider unless it is exactly the anonymised
text the moderator approved. ``approved_text`` is the only way the provider
interface (#18) obtains submission text, and ``require_approved`` re-checks the
exact string against the persisted approval of that submission, immediately
before sending. Neither accepts an approval from the caller.
"""

from __future__ import annotations

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
    return approval
