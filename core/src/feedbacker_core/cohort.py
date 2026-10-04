"""A marking workspace's cohort, and the one way to list a workspace's submissions.

Every submission in the marking platform's bulk download is imported, not a
sample. Each file is named by the platform with the student's ID (and name),
so the ID is read from the name: Turnitin's "<ID> - <NAME> - <file>" or
Canvas's "<name>_[late_]<user ID>_<attachment ID>_<file>". A file whose name
doesn't follow either is listed, never guessed at. Each submission gets a
stable submission ID and pseudonym; its real ID and file name go only into the
pseudonym key. Files are stored and extracted as originals are, so everything
that reads a submission reads a cohort's as it reads a sample's.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from feedbacker_core.actors import EDUCATOR
from feedbacker_core.archive import SUPPORTED, Member, list_members
from feedbacker_core.extract import ExtractionError, extract, source_format
from feedbacker_core.models import (
    Cohort,
    CohortSubmission,
    Provenance,
    SourceKind,
    Submission,
    Transformation,
)
from feedbacker_core.originals import SOURCES, submission_path
from feedbacker_core.request import EXTERNAL_ID, load_request, pseudonym_for
from feedbacker_core.structure import name_shape
from feedbacker_core.workspace import REQUEST, KeyEntry, Workspace, WorkspaceError

COHORT = "cohort.json"

# The same patterns as the TypeScript core's, with nothing that differs between
# the two languages' regular expressions.
_TURNITIN = re.compile(r"^([0-9]{4,}) - [^ ].* - .")  # "<ID> - <NAME> - <file>"
_CANVAS = re.compile(r"^[A-Za-z][A-Za-z-]*_(?:late_)?([0-9]{3,})_[0-9]{3,}_.")


@dataclass(frozen=True)
class WorkspaceSubmission:
    """One of a workspace's submissions: sampled (with its listed band), or in a cohort."""

    submission_id: str
    pseudonym: str
    listed_band: str | None = None


def _is_marking(workspace: Workspace) -> bool:
    return workspace.manifest.workspace_type == "marking"


def submissions_known(workspace: Workspace) -> bool:
    """Whether a moderation's request is recorded, or a marking cohort imported."""
    return workspace.exists(COHORT if _is_marking(workspace) else REQUEST)


def list_submissions(workspace: Workspace) -> list[WorkspaceSubmission]:
    """The workspace's submissions, in order: a moderation's sample, or a marking cohort."""
    if not _is_marking(workspace):
        return [
            WorkspaceSubmission(s.submission_id, s.pseudonym, s.listed_band)
            for s in load_request(workspace).sample
        ]
    return [
        WorkspaceSubmission(s.submission_id, s.pseudonym)
        for s in load_cohort(workspace).submissions
    ]


def submissions_name(workspace: Workspace) -> str:
    """What a workspace's set of submissions is called, for messages."""
    return "the cohort" if _is_marking(workspace) else "the sample"


def load_cohort(workspace: Workspace) -> Cohort:
    """Load the cohort and confirm every pseudonym in it resolves in the key."""
    if not workspace.exists(COHORT):
        raise WorkspaceError("no cohort is imported in this workspace")
    try:
        cohort = Cohort.model_validate(workspace.read_json(COHORT))
    except ValueError:
        raise WorkspaceError(f"{COHORT} is not a valid record of the cohort") from None
    key = workspace.read_key()
    for s in cohort.submissions:
        entry = key.by_pseudonym(s.pseudonym)
        if entry is None or entry.submission_id != s.submission_id:
            raise WorkspaceError(
                f"cohort and pseudonym key are inconsistent for {s.pseudonym}; "
                "the workspace may be damaged"
            )
    return cohort


def id_from_file_name(file_name: str) -> str | None:
    """The student's ID in a platform's file name, or None if the name isn't a known form."""
    match = _TURNITIN.match(file_name) or _CANVAS.match(file_name)
    if match is None or not EXTERNAL_ID.match(match.group(1)):
        return None
    return match.group(1)


class CohortProblem(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("cannot import the cohort:\n- " + "\n- ".join(problems))


@dataclass
class CohortImportResult:
    imported: list[Submission] = field(default_factory=list)
    kept: int = 0  # already imported, and left as they were
    failed: dict[str, str] = field(default_factory=dict)  # submission_id -> reason
    not_imported: list[str] = field(default_factory=list)  # by source and name shape only
    ignored_count: int = 0  # the platform's download reports (.txt), never opened


def import_cohort(
    workspace: Workspace,
    sources: Path | list[Path],
    *,
    replace: bool = False,
    now: datetime | None = None,
) -> CohortImportResult:
    """Import every submission in the bulk download into a marking workspace's cohort.

    Importing again adds the new submissions and keeps every pseudonym; one
    already imported is replaced only with ``replace``. A file whose name
    carries no readable ID, an ID in more than one file, and a file that isn't
    docx or pdf are listed, not imported.
    """
    if not _is_marking(workspace):
        raise WorkspaceError(
            "only a marking workspace has a cohort; a moderation imports its sample's original files"
        )
    if isinstance(sources, Path):
        sources = [sources]
    try:
        members = [m for s in sources for m in list_members(s)]
    except ValueError as err:
        raise CohortProblem([str(err)]) from None
    index = {src: n for n, src in enumerate(sources, 1)}

    def where(m: Member) -> str:
        return f"source {index.get(m.source, '?')} ({name_shape(m.file_name)})"

    result = CohortImportResult()
    by_id: dict[str, list[Member]] = {}
    for m in members:
        external_id = id_from_file_name(m.file_name)
        if external_id is None:
            if m.suffix == ".txt":
                result.ignored_count += 1  # the platform's report on the download
            else:
                result.not_imported.append(
                    f"{where(m)}: its name doesn't carry an ID Feedbacker can read"
                )
            continue
        by_id.setdefault(external_id, []).append(m)
    chosen: list[tuple[str, Member]] = []
    for external_id, found in by_id.items():
        if len(found) > 1:
            result.not_imported.append(
                f"{len(found)} files carry the same ID: {', '.join(map(where, found))}; "
                "keep one and import again"
            )
        elif found[0].suffix not in SUPPORTED:
            result.not_imported.append(
                f"{where(found[0])}: not docx or pdf; Feedbacker imports typed docx and pdf only"
            )
        else:
            chosen.append((external_id, found[0]))

    key = workspace.read_key()
    cohort = load_cohort(workspace) if workspace.exists(COHORT) else None
    in_cohort = {s.submission_id for s in cohort.submissions} if cohort else set()
    entries: list[KeyEntry] = list(key.entries)
    timestamp = now or datetime.now(UTC)
    source_hashes: dict[Path, str] = {}
    staged: list[tuple[Submission, Path, Path]] = []  # (record, staging file, final file)
    originals_dir = workspace.path / SOURCES / "originals"
    staging_dir = workspace.path / SOURCES / ".staging"
    staging_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        for external_id, member in chosen:
            entry = key.by_external_id(external_id)
            if (
                entry is not None
                and entry.submission_id in in_cohort
                and workspace.exists(submission_path(entry.submission_id))
                and not replace
            ):
                result.kept += 1
                continue
            if entry is None:
                n = len(entries)
                entry = KeyEntry(
                    submission_id=f"sub-{n + 1:03d}",
                    pseudonym=pseudonym_for(n),
                    external_id=external_id,
                )
                entries.append(entry)
            final = originals_dir / f"{entry.submission_id}{member.suffix}"
            staging = staging_dir / final.name
            try:
                data = member.read()
            except (zipfile.BadZipFile, OSError, KeyError, RuntimeError, zlib.error) as err:
                result.failed[entry.submission_id] = (
                    f"the file could not be read ({type(err).__name__})"
                )
                continue
            staging.write_bytes(data)
            staging.chmod(0o600)
            try:
                extracted = extract(staging, now=timestamp)
            except ExtractionError as err:
                result.failed[entry.submission_id] = str(err)
                staging.unlink(missing_ok=True)
                continue
            if member.source not in source_hashes:
                source_hashes[member.source] = hashlib.sha256(
                    member.source.read_bytes()
                ).hexdigest()
            source_hash = source_hashes[member.source]
            digest = hashlib.sha256(data).hexdigest()
            kind = "archive" if member.is_archive else "file"
            submission = Submission(
                id=entry.submission_id,
                pseudonym=entry.pseudonym,
                source_kind=SourceKind.ORIGINAL,
                source_format=source_format(staging),
                source_sha256=digest,
                extract=extracted,
                provenance=Provenance(
                    source=f"{kind}:sha256:{source_hash}",
                    transformation=Transformation.IMPORTED,
                    actor=EDUCATOR,
                    timestamp=timestamp,
                    input_hashes=sorted({source_hash, digest}),
                ),
            )
            position = next(i for i, e in enumerate(entries) if e.pseudonym == entry.pseudonym)
            entries[position] = entry.model_copy(
                update={"source_files": {**entry.source_files, "original": member.file_name}}
            )
            staged.append((submission, staging, final))
            result.imported.append(submission)

        if not staged:
            if len(entries) != len(key.entries):
                workspace.write_key(key.with_entries(entries))  # reserved for a later try
            if not result.kept and not result.failed and cohort is None:
                raise CohortProblem(result.not_imported or ["the download holds no submissions"])
            return result

        # Key first (it only gains information); then each submission's file and
        # record, as originals are written; then the cohort.
        workspace.write_key(key.with_entries(entries))
        originals_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        added: list[CohortSubmission] = []
        try:
            for submission, staging, final in staged:
                for old in originals_dir.glob(f"{submission.id}.*"):
                    if old != final:
                        old.unlink()
                os.replace(staging, final)
                workspace.write_json(
                    submission_path(submission.id), submission.model_dump(mode="json"), private=True
                )
                if submission.id not in in_cohort:
                    added.append(
                        CohortSubmission(
                            submission_id=submission.id, pseudonym=submission.pseudonym
                        )
                    )
        finally:
            # The cohort lists every submission whose record is written.
            if added:
                order = {e.submission_id: i for i, e in enumerate(entries)}
                submissions = sorted(
                    [*(cohort.submissions if cohort else []), *added],
                    key=lambda s: order[s.submission_id],
                )
                record = Cohort(
                    submissions=submissions,
                    provenance=Provenance(
                        source="bulk download",
                        transformation=Transformation.IMPORTED,
                        actor=EDUCATOR,
                        timestamp=timestamp,
                    ),
                )
                workspace.write_json(COHORT, record.model_dump(mode="json"))
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)
    return result
