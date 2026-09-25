"""Record a moderation request: module context and the sampled submissions (#27).

External identifiers (e.g. Turnitin submission IDs) are validated, assigned
pseudonymous submission IDs and pseudonyms, and stored only in the pseudonym
key. The request record itself is pseudonymous.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass
from datetime import UTC, datetime

from feedbacker_core.models import (
    Actor,
    ActorKind,
    BandCount,
    ModerationContext,
    ModerationRequest,
    Provenance,
    SampledSubmission,
    Transformation,
)
from feedbacker_core.workspace import REQUEST, KeyEntry, PseudonymKey, Workspace, WorkspaceError

EXTERNAL_ID = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$")
MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")


class RequestError(ValueError):
    """The moderation request is invalid. ``problems`` lists every issue found."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("invalid moderation request:\n- " + "\n- ".join(problems))


@dataclass(frozen=True)
class SampleEntry:
    external_id: str
    band: str | None = None


def pseudonym_for(index: int) -> str:
    """0 -> [STUDENT_A], 25 -> [STUDENT_Z], 26 -> [STUDENT_AA], ..."""
    letters = ""
    n = index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        letters = string.ascii_uppercase[rem] + letters
    return f"[STUDENT_{letters}]"


def validate_sample(entries: list[SampleEntry]) -> list[SampleEntry]:
    """Return entries with surrounding whitespace removed, or raise listing every problem."""
    problems: list[str] = []
    cleaned: list[SampleEntry] = []
    seen: dict[str, int] = {}
    if not entries:
        problems.append("the sample is empty")
    for position, entry in enumerate(entries, start=1):
        external_id = entry.external_id.strip()
        band = entry.band.strip() if entry.band else None
        if not external_id:
            problems.append(f"entry {position}: identifier is empty")
            continue
        if not EXTERNAL_ID.match(external_id):
            problems.append(
                f"entry {position}: identifier '{external_id}' is malformed; use letters, "
                "digits, '.', '_' or '-', starting and ending with a letter or digit"
            )
            continue
        if external_id in seen:
            problems.append(
                f"entry {position}: identifier '{external_id}' duplicates entry {seen[external_id]}"
            )
            continue
        seen[external_id] = position
        cleaned.append(SampleEntry(external_id=external_id, band=band or None))
    if problems:
        raise RequestError(problems)
    return cleaned


def record_request(
    workspace: Workspace,
    sample: list[SampleEntry],
    *,
    cohort_size: int | None = None,
    multiple_groups: bool | None = None,
    band_distribution: list[BandCount] | None = None,
    sample_note: str | None = None,
    replace: bool = False,
    now: datetime | None = None,
) -> ModerationRequest:
    """Validate and store the request; external IDs go only into the pseudonym key."""
    if workspace.exists(REQUEST) and not replace:
        raise WorkspaceError(
            "a moderation request is already recorded; use replace to record it again"
        )
    entries = validate_sample(sample)
    problems: list[str] = []
    if cohort_size is not None and cohort_size < len(entries):
        problems.append(f"cohort size {cohort_size} is smaller than the sample of {len(entries)}")
    if cohort_size is not None and band_distribution:
        total = sum(b.count for b in band_distribution)
        if total > cohort_size:
            problems.append(
                f"band distribution totals {total}, more than the cohort size {cohort_size}"
            )
    if problems:
        raise RequestError(problems)

    timestamp = now or datetime.now(UTC)
    provenance = Provenance(
        source="manual entry",
        transformation=Transformation.ENTERED,
        actor=MODERATOR,
        timestamp=timestamp,
    )
    key_entries: list[KeyEntry] = []
    sampled: list[SampledSubmission] = []
    for index, entry in enumerate(entries):
        submission_id = f"sub-{index + 1:03d}"
        pseudonym = pseudonym_for(index)
        key_entries.append(
            KeyEntry(
                submission_id=submission_id, pseudonym=pseudonym, external_id=entry.external_id
            )
        )
        sampled.append(
            SampledSubmission(
                submission_id=submission_id, pseudonym=pseudonym, listed_band=entry.band
            )
        )

    request = ModerationRequest(
        context=ModerationContext(
            cohort_size=cohort_size,
            multiple_groups=multiple_groups,
            band_distribution=band_distribution or [],
            sample_note=sample_note,
            provenance=provenance,
        ),
        sample=sampled,
        provenance=provenance,
    )
    # Write the key first: a request must never exist without its key.
    workspace.write_key(PseudonymKey(entries=key_entries))
    workspace.write_json(REQUEST, request.model_dump(mode="json"))
    return request


def load_request(workspace: Workspace) -> ModerationRequest:
    if not workspace.exists(REQUEST):
        raise WorkspaceError("no moderation request is recorded in this workspace")
    return ModerationRequest.model_validate(workspace.read_json(REQUEST))
