"""Import sampled original files from bulk downloads and extract their text (#15).

A sample may be spread across several sources (e.g. a main zip and a zip from
a late-submission point, or single files). Only the sampled submissions are
taken; other students' files are never opened. Each source used is copied into
the workspace so it is deleted with it. Real file names go only into the pseudonym key. Each submission is
imported completely or not at all, and failures are listed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from feedbacker_core.archive import SUPPORTED, select_members
from feedbacker_core.extract import ExtractionError, extract, source_format
from feedbacker_core.models import (
    Actor,
    ActorKind,
    Provenance,
    SourceKind,
    Submission,
    Transformation,
)
from feedbacker_core.request import load_request
from feedbacker_core.workspace import PseudonymKey, Workspace, WorkspaceError

MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")
SOURCES = "sources"
SUBMISSIONS = "submissions"


class ImportProblem(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("cannot import originals:\n- " + "\n- ".join(problems))


@dataclass
class ImportResult:
    imported: list[Submission] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)  # submission_id -> reason
    ignored_count: int = 0


def submission_path(submission_id: str) -> str:
    return f"{SUBMISSIONS}/{submission_id}.json"


def import_originals(
    workspace: Workspace,
    sources: Path | list[Path],
    *,
    replace: bool = False,
    now: datetime | None = None,
) -> ImportResult:
    """Import the sampled originals found across ``sources`` (zips or single files)."""
    if isinstance(sources, Path):
        sources = [sources]
    request = load_request(workspace)
    key = workspace.read_key()
    sampled = []
    for s in request.sample:
        entry = key.by_pseudonym(s.pseudonym)
        assert entry is not None  # load_request guarantees the key resolves
        sampled.append((s, entry))

    existing = [
        s.submission_id for s, _ in sampled if workspace.exists(submission_path(s.submission_id))
    ]
    if existing and not replace:
        raise WorkspaceError(
            f"submissions already imported ({', '.join(existing)}); use replace to import again"
        )

    try:
        selection = select_members(sources, [e.external_id for _, e in sampled])
    except ValueError as err:
        raise ImportProblem([str(err)]) from None
    problems = list(selection.problems)
    for external_id, member in selection.matched.items():
        if member.suffix not in SUPPORTED:
            problems.append(
                f"file for identifier '{external_id}' is '{member.suffix or 'no type'}'; "
                "Stage 0 imports typed docx and pdf only"
            )
    if problems:
        raise ImportProblem(problems)

    timestamp = now or datetime.now(UTC)
    source_hashes = {
        src: hashlib.sha256(src.read_bytes()).hexdigest()
        for src in {m.source for m in selection.matched.values()}
    }

    result = ImportResult(ignored_count=selection.ignored_count)
    new_entries = []
    for s, entry in sampled:
        member = selection.matched[entry.external_id]
        data = member.read()
        # Only the selected file is stored, never the whole bulk download.
        stored = workspace.path / SOURCES / "originals" / f"{s.submission_id}{member.suffix}"
        stored.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        stored.write_bytes(data)
        stored.chmod(0o600)
        digest = hashlib.sha256(data).hexdigest()
        source_hash = source_hashes[member.source]
        try:
            extracted = extract(stored, now=timestamp)
        except ExtractionError as err:
            result.failed[s.submission_id] = str(err)
            stored.unlink(missing_ok=True)
            new_entries.append(entry)
            continue
        kind = "archive" if member.is_archive else "file"
        submission = Submission(
            id=s.submission_id,
            pseudonym=s.pseudonym,
            source_kind=SourceKind.ORIGINAL,
            source_format=source_format(stored),
            source_sha256=digest,
            extract=extracted,
            provenance=Provenance(
                source=f"{kind}:sha256:{source_hash}",
                transformation=Transformation.IMPORTED,
                actor=MODERATOR,
                timestamp=timestamp,
                input_hashes=sorted({source_hash, digest}),
            ),
        )
        new_entries.append(
            entry.model_copy(
                update={"source_files": {**entry.source_files, "original": member.file_name}}
            )
        )
        result.imported.append(submission)

    # Key first (it only gains information), then the submission records.
    untouched = [e for e in key.entries if e.pseudonym not in {s.pseudonym for s, _ in sampled}]
    workspace.write_key(PseudonymKey(entries=_in_key_order(key, untouched + new_entries)))
    for submission in result.imported:
        workspace.write_json(
            submission_path(submission.id), submission.model_dump(mode="json"), private=True
        )
    return result


def _in_key_order(key: PseudonymKey, entries: list) -> list:
    order = {e.pseudonym: i for i, e in enumerate(key.entries)}
    return sorted(entries, key=lambda e: order[e.pseudonym])


def load_submission(workspace: Workspace, submission_id: str) -> Submission:
    path = submission_path(submission_id)
    if not workspace.exists(path):
        raise WorkspaceError(f"submission {submission_id} has not been imported")
    return Submission.model_validate(workspace.read_json(path))
