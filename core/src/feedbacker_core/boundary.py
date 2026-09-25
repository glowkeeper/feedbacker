"""The approval gate every model call must pass (#16, ADR 0003).

Nothing may be sent to a model provider unless it is exactly the anonymised
text the moderator approved. ``approved_text`` is the only way the provider
interface (#18) obtains submission text, and ``require_approved`` re-checks the
exact string immediately before sending.
"""

from __future__ import annotations

from feedbacker_core.models import Approval, sha256_text
from feedbacker_core.originals import load_submission
from feedbacker_core.workspace import Workspace


class UnapprovedText(Exception):
    """Text is not the moderator-approved anonymised text. Nothing is sent."""


def approved_text(workspace: Workspace, submission_id: str) -> tuple[str, Approval]:
    sub = load_submission(workspace, submission_id)
    if sub.anonymised is None:
        raise UnapprovedText(f"{submission_id} has not been anonymised")
    if sub.approval is None:
        raise UnapprovedText(f"{submission_id} has not been approved by the moderator")
    require_approved(sub.anonymised.text, sub.approval)
    return sub.anonymised.text, sub.approval


def require_approved(text: str, approval: Approval) -> None:
    """Refuse unless ``text`` hashes to exactly what the moderator approved."""
    if sha256_text(text) != approval.approved_text_sha256:
        raise UnapprovedText("text does not match the moderator's approval; nothing was sent")
