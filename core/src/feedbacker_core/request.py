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


def check_sample(entries: list[SampleEntry]) -> tuple[list[SampleEntry], list[str]]:
    """Return trimmed valid entries and a list of every problem found."""
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
    return cleaned, problems


def check_counts(
    sample_size: int, cohort_size: int | None, band_distribution: list[BandCount]
) -> list[str]:
    problems: list[str] = []
    if cohort_size is not None and cohort_size < sample_size:
        problems.append(f"cohort size {cohort_size} is smaller than the sample of {sample_size}")
    if cohort_size is not None and band_distribution:
        total = sum(b.count for b in band_distribution)
        if total > cohort_size:
            problems.append(
                f"band distribution totals {total}, more than the cohort size {cohort_size}"
            )
    return problems


def record_request(
    workspace: Workspace,
    sample: list[SampleEntry],
    *,
    programme: str | None = None,
    module: str | None = None,
    staff_roles: list[str] | None = None,
    cohort_size: int | None = None,
    multiple_groups: bool | None = None,
    band_distribution: list[BandCount] | None = None,
    sample_note: str | None = None,
    replace: bool = False,
    now: datetime | None = None,
) -> ModerationRequest:
    """Validate and store the request; external IDs go only into the pseudonym key.

    Pseudonyms are stable. An identifier already in the key keeps its
    pseudonym, and new identifiers get the next unused one; pseudonyms are
    never reassigned or reused, even on replacement.

    Consistency on disk: the key is append-only and is written before the
    request. If writing stops between the two, the key holds at worst an unused
    entry, and the recorded request always resolves against it.
    """
    if workspace.exists(REQUEST) and not replace:
        raise WorkspaceError(
            "a moderation request is already recorded; use replace to record it again"
        )
    bands = band_distribution or []
    entries, problems = check_sample(sample)
    problems += check_counts(len(entries), cohort_size, bands)
    roles = [r.strip() for r in staff_roles or []]
    if any(not r for r in roles):
        problems.append("staff roles must not be empty")
    if problems:
        raise RequestError(problems)

    timestamp = now or datetime.now(UTC)
    provenance = Provenance(
        source="manual entry",
        transformation=Transformation.ENTERED,
        actor=MODERATOR,
        timestamp=timestamp,
    )

    key = workspace.read_key()
    new_entries = list(key.entries)
    next_index = len(new_entries)
    sampled: list[SampledSubmission] = []
    for entry in entries:
        mapped = key.by_external_id(entry.external_id)
        if mapped is None:
            mapped = KeyEntry(
                submission_id=f"sub-{next_index + 1:03d}",
                pseudonym=pseudonym_for(next_index),
                external_id=entry.external_id,
            )
            new_entries.append(mapped)
            next_index += 1
        sampled.append(
            SampledSubmission(
                submission_id=mapped.submission_id,
                pseudonym=mapped.pseudonym,
                listed_band=entry.band,
            )
        )

    request = ModerationRequest(
        context=ModerationContext(
            programme=_blank_to_none(programme),
            module=_blank_to_none(module),
            staff_roles=roles,
            cohort_size=cohort_size,
            multiple_groups=multiple_groups,
            band_distribution=bands,
            sample_note=_blank_to_none(sample_note),
            provenance=provenance,
        ),
        sample=sampled,
        provenance=provenance,
    )
    if len(new_entries) != len(key.entries):
        workspace.write_key(PseudonymKey(entries=new_entries))
    workspace.write_json(REQUEST, request.model_dump(mode="json"))
    return request


def load_request(workspace: Workspace) -> ModerationRequest:
    """Load the request and confirm every sampled pseudonym resolves in the key."""
    if not workspace.exists(REQUEST):
        raise WorkspaceError("no moderation request is recorded in this workspace")
    request = ModerationRequest.model_validate(workspace.read_json(REQUEST))
    key = workspace.read_key()
    for s in request.sample:
        entry = key.by_pseudonym(s.pseudonym)
        if entry is None or entry.submission_id != s.submission_id:
            raise WorkspaceError(
                f"request and pseudonym key are inconsistent for {s.pseudonym}; "
                "the workspace may be damaged"
            )
    return request


def _blank_to_none(value: str | None) -> str | None:
    return value.strip() or None if value else None
