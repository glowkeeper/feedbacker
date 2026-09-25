"""Import the assessment brief (#31).

The brief is extracted locally with the same extractor as submissions (#15);
document metadata is never read. It is then redacted by ``anonymise run`` and
must be approved by the moderator (``anonymise approve WORKSPACE brief``)
before the AI reading may use it (boundary.py).
"""

from __future__ import annotations

import hashlib
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

from feedbacker_core.extract import extract, source_format
from feedbacker_core.models import Actor, ActorKind, Brief, Provenance, Transformation
from feedbacker_core.workspace import Workspace, WorkspaceError

BRIEF = "brief.json"
BRIEF_ID = "brief"
MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")


def brief_source(workspace: Workspace, brief: Brief) -> Path:
    return workspace.path / "sources" / f"brief.{brief.source_format.value}"


def import_brief(
    workspace: Workspace, path: Path, *, replace: bool = False, now: datetime | None = None
) -> Brief:
    if workspace.exists(BRIEF) and not replace:
        raise WorkspaceError("a brief is already imported; use replace to import again")
    fmt = source_format(path)  # raises ExtractionError for unsupported types
    if not path.is_file():
        raise WorkspaceError("brief file not found")
    staging = workspace.path / "sources" / ".staging-brief"
    staging.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        tmp = staging / f"brief.{fmt.value}"
        shutil.copyfile(path, tmp)
        tmp.chmod(0o600)
        extracted = extract(tmp, now=now)  # fails clearly; nothing is kept
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        brief = Brief(
            source_format=fmt,
            source_sha256=digest,
            extract=extracted,
            provenance=Provenance(
                source=f"file:sha256:{digest}",
                transformation=Transformation.IMPORTED,
                actor=MODERATOR,
                timestamp=now or datetime.now(UTC),
                input_hashes=[digest],
            ),
        )
        for old in (workspace.path / "sources").glob("brief.*"):
            old.unlink()
        os.replace(tmp, workspace.path / "sources" / tmp.name)
        workspace.write_json(BRIEF, brief.model_dump(mode="json"), private=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return brief


def load_brief(workspace: Workspace) -> Brief:
    """Load the brief and confirm its stored source file still matches the record."""
    if not workspace.exists(BRIEF):
        raise WorkspaceError("no brief has been imported")
    brief = Brief.model_validate(workspace.read_json(BRIEF))
    stored = brief_source(workspace, brief)
    if (
        not stored.is_file()
        or hashlib.sha256(stored.read_bytes()).hexdigest() != brief.source_sha256
    ):
        raise WorkspaceError(
            "the brief's stored source file is missing or does not match the record; import it again"
        )
    return brief


def save_brief(workspace: Workspace, brief: Brief) -> None:
    Brief.model_validate(brief.model_dump())
    workspace.write_json(BRIEF, brief.model_dump(mode="json"), private=True)
