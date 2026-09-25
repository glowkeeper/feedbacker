"""Local, rules-based anonymisation behind a moderator approval gate (#16).

Redaction runs on the extracted text of each imported submission. It replaces:

- sampled students' names (taken from the pseudonym key, including names
  derived from Turnitin-style file names "<ID> - <NAME> - ...") with that
  student's pseudonym, e.g. [STUDENT_A];
- other people's names and organisations the moderator adds, with [PERSON_n]
  and [ORG_n];
- external IDs and student-number patterns, emails, URLs, and phone numbers,
  with [ID_n], [EMAIL_n], [URL_n], and [PHONE_n];
- any extra values the moderator marks for redaction.

Tokens are stable across the workspace, and the values behind them are kept
only in the private pseudonym key. Automated redaction can miss indirect
identifiers, so the moderator reviews every submission and approves it
explicitly; only approved text may ever be sent to a model (see boundary.py).

Additional detectors, such as optional local name recognition, can be passed
in; they only ever add candidate redactions, which the moderator reviews.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field

from feedbacker_core.brief import BRIEF, BRIEF_ID, load_brief, save_brief
from feedbacker_core.models import (
    Actor,
    ActorKind,
    AnonymisedText,
    Approval,
    Provenance,
    Redaction,
    Submission,
    Transformation,
    sha256_text,
)
from feedbacker_core.originals import load_submission, submission_path
from feedbacker_core.request import load_request
from feedbacker_core.workspace import PseudonymKey, Workspace, WorkspaceError

RULES = "anonymisation/rules.json"
MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")
ANONYMISER = Actor(kind=ActorKind.SYSTEM, label="feedbacker anonymise")
KIND = re.compile(r"^[A-Z]{2,12}$")


class AnonymisationRules(BaseModel):
    """The moderator's additions and exceptions. Contains real values: private."""

    model_config = ConfigDict(extra="forbid")

    names: list[str] = Field(default_factory=list, description="Other people's names.")
    organisations: list[str] = Field(default_factory=list)
    redact: dict[str, str] = Field(
        default_factory=dict, description="Extra values to redact, mapped to a token kind."
    )
    ignore: list[str] = Field(
        default_factory=list, description="Values never to redact (false positives)."
    )


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    kind: str  # e.g. STUDENT, PERSON, ORG, ID, EMAIL, URL, PHONE
    value: str
    token: str | None = None  # fixed token (e.g. a student's pseudonym)


Detector = Callable[[str], list[Span]]

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"(?:https?://|www\.)[^\s<>()\"']+", re.IGNORECASE)
PHONE = re.compile(r"(?<![\w+])(?:\+44\s?\(?0?\)?|0)\d(?:[\s-]?\d){8,9}(?!\w)")
STUDENT_NUMBER = re.compile(r"(?<![\w-])[A-Za-z]{0,2}\d{7,}(?![\w-])")


# --- Names from file names ----------------------------------------------------


def names_from_file_name(file_name: str, external_id: str) -> list[str]:
    """'<ID> - QUILL AVERY . - report.docx' -> ['QUILL AVERY'] (Turnitin-style)."""
    prefix = f"{external_id} - "
    if not file_name.startswith(prefix):
        return []
    segment = file_name[len(prefix) :].split(" - ", 1)[0]
    words = [w for w in segment.split() if any(ch.isalpha() for ch in w)]
    return [" ".join(words)] if words else []


# --- Detection ----------------------------------------------------------------


def _name_patterns(name: str) -> tuple[list[re.Pattern[str]], list[re.Pattern[str]]]:
    """Whole-name patterns (any case, either order) and single-part patterns."""
    # Initials (one letter) are not matched alone; every longer part is,
    # including short names such as "Jo" or "Li".
    parts = [p for p in re.split(r"\s+", name.strip()) if len(p) >= 2]
    if not parts:
        return [], []
    orders = {tuple(parts), tuple(reversed(parts))}
    whole = [
        re.compile(r"(?<!\w)" + r"[\s,]+".join(map(re.escape, o)) + r"(?!\w)", re.IGNORECASE)
        for o in orders
        if len(o) > 1
    ]
    # Single parts are matched case-insensitively; detect() keeps only matches
    # that start with a capital, so ordinary words matching a surname survive.
    single = [re.compile(rf"(?<!\w){re.escape(p)}(?!\w)", re.IGNORECASE) for p in parts]
    return whole, single


def detect(
    text: str,
    key: PseudonymKey,
    rules: AnonymisationRules,
    extra: list[Detector] = (),
) -> list[Span]:
    spans: list[Span] = []

    def names(name: str, kind: str, token: str | None) -> None:
        whole, single = _name_patterns(name)
        for pattern in whole:
            spans.extend(
                Span(m.start(), m.end(), kind, m.group(), token) for m in pattern.finditer(text)
            )
        for pattern in single:
            spans.extend(
                Span(m.start(), m.end(), kind, m.group(), token)
                for m in pattern.finditer(text)
                if m.group()[0].isupper()
            )

    for entry in key.entries:
        for name in entry.names:
            names(name, "STUDENT", entry.pseudonym)
        if entry.external_id:
            for m in re.finditer(rf"(?<![\w-]){re.escape(entry.external_id)}(?![\w-])", text):
                spans.append(Span(m.start(), m.end(), "ID", m.group()))
    for name in rules.names:
        names(name, "PERSON", None)
    for org in rules.organisations:
        for m in re.finditer(rf"(?<!\w){re.escape(org)}(?!\w)", text, re.IGNORECASE):
            spans.append(Span(m.start(), m.end(), "ORG", m.group()))
    for value, kind in rules.redact.items():
        for m in re.finditer(re.escape(value), text, re.IGNORECASE):
            spans.append(Span(m.start(), m.end(), kind, m.group()))
    for kind, pattern in (("EMAIL", EMAIL), ("URL", URL), ("PHONE", PHONE)):
        for m in pattern.finditer(text):
            value = m.group().rstrip(".,;:!?")
            spans.append(Span(m.start(), m.start() + len(value), kind, value))
    for m in STUDENT_NUMBER.finditer(text):
        spans.append(Span(m.start(), m.end(), "ID", m.group()))
    for detector in extra:
        spans.extend(detector(text))

    ignored = {v.casefold() for v in rules.ignore}
    return _resolve([s for s in spans if s.value.casefold() not in ignored])


def _resolve(spans: list[Span]) -> list[Span]:
    """Keep non-overlapping spans, preferring earlier then longer ones."""
    chosen: list[Span] = []
    end = -1
    for s in sorted(spans, key=lambda s: (s.start, -(s.end - s.start))):
        if s.start >= end:
            chosen.append(s)
            end = s.end
    return chosen


def apply(text: str, spans: list[Span], key: PseudonymKey) -> tuple[str, list[Redaction]]:
    out: list[str] = []
    redactions: list[Redaction] = []
    cursor = 0
    for s in spans:
        token = s.token or key.token_for(s.kind, _canonical(s))
        out.append(text[cursor : s.start])
        out.append(token)
        redactions.append(
            Redaction(start=s.start, end=s.end, replacement=token, reason=s.kind.lower())
        )
        cursor = s.end
    out.append(text[cursor:])
    return "".join(out), redactions


def _canonical(span: Span) -> str:
    # Emails and IDs are case-insensitive identities; keep the value as written otherwise.
    return " ".join(span.value.split())


# --- Workspace operations -------------------------------------------------------


def load_rules(workspace: Workspace) -> AnonymisationRules:
    if not workspace.exists(RULES):
        return AnonymisationRules()
    return AnonymisationRules.model_validate(workspace.read_json(RULES))


def update_rules(
    workspace: Workspace,
    *,
    names: list[str] = (),
    organisations: list[str] = (),
    redact: dict[str, str] | None = None,
    ignore: list[str] = (),
) -> AnonymisationRules:
    rules = load_rules(workspace)
    for kind in (redact or {}).values():
        if not KIND.match(kind):
            raise WorkspaceError(f"redaction kind '{kind}' must be 2–12 capital letters")

    def merged(existing: list[str], new: list[str]) -> list[str]:
        seen = {v.casefold() for v in existing}
        return existing + [v.strip() for v in new if v.strip() and v.strip().casefold() not in seen]

    rules = AnonymisationRules(
        names=merged(rules.names, list(names)),
        organisations=merged(rules.organisations, list(organisations)),
        redact={**rules.redact, **{k.strip(): v for k, v in (redact or {}).items() if k.strip()}},
        ignore=merged(rules.ignore, list(ignore)),
    )
    workspace.write_json(RULES, rules.model_dump(mode="json"), private=True)
    return rules


@dataclass
class AnonymiseResult:
    counts: dict[str, Counter]  # submission_id -> redactions by kind
    approval_kept: dict[str, bool]


def _redact(
    text: str,
    source_sha256: str,
    key: PseudonymKey,
    rules: AnonymisationRules,
    extra: list[Detector],
    timestamp: datetime,
) -> AnonymisedText:
    spans = detect(text, key, rules, list(extra))
    redacted, redactions = apply(text, spans, key)
    return AnonymisedText(
        text=redacted,
        text_sha256=sha256_text(redacted),
        redactions=redactions,
        provenance=Provenance(
            source=f"extract:sha256:{source_sha256}",
            transformation=Transformation.ANONYMISED,
            actor=ANONYMISER,
            timestamp=timestamp,
            input_hashes=[source_sha256],
        ),
    )


def anonymise_workspace(
    workspace: Workspace, extra: list[Detector] = (), now: datetime | None = None
) -> AnonymiseResult:
    """Redact every imported submission and the brief. Approvals survive only if
    the text is unchanged."""
    request = load_request(workspace)
    key = workspace.read_key()
    # Derive students' names from their original file names (append-only).
    for i, entry in enumerate(key.entries):
        derived = names_from_file_name(entry.source_files.get("original", ""), entry.external_id)
        new = [n for n in derived if n.casefold() not in {x.casefold() for x in entry.names}]
        if new:
            key.entries[i] = entry.model_copy(update={"names": entry.names + new})
    rules = load_rules(workspace)
    timestamp = now or datetime.now(UTC)

    updated: list[Submission] = []
    result = AnonymiseResult(counts={}, approval_kept={})
    for s in request.sample:
        if not workspace.exists(submission_path(s.submission_id)):
            continue
        sub = load_submission(workspace, s.submission_id)
        assert sub.extract is not None
        anonymised = _redact(sub.extract.text, sub.source_sha256, key, rules, extra, timestamp)
        keep = sub.approval is not None and (
            sub.approval.approved_text_sha256 == anonymised.text_sha256
        )
        updated.append(
            sub.model_copy(
                update={"anonymised": anonymised, "approval": sub.approval if keep else None}
            )
        )
        result.counts[s.submission_id] = Counter(r.reason for r in anonymised.redactions)
        result.approval_kept[s.submission_id] = keep

    brief = load_brief(workspace) if workspace.exists(BRIEF) else None
    if brief is not None:
        anonymised = _redact(brief.extract.text, brief.source_sha256, key, rules, extra, timestamp)
        keep = brief.approval is not None and (
            brief.approval.approved_text_sha256 == anonymised.text_sha256
        )
        brief = brief.model_copy(
            update={"anonymised": anonymised, "approval": brief.approval if keep else None}
        )
        result.counts[BRIEF_ID] = Counter(r.reason for r in anonymised.redactions)
        result.approval_kept[BRIEF_ID] = keep

    if not updated and brief is None:
        raise WorkspaceError("nothing to anonymise; import originals (or the brief) first")

    # Key first (append-only), then the records, which reference its tokens.
    workspace.write_key(key)
    for sub in updated:
        Submission.model_validate(sub.model_dump())  # re-check pipeline invariants
        workspace.write_json(submission_path(sub.id), sub.model_dump(mode="json"), private=True)
    if brief is not None:
        save_brief(workspace, brief)
    return result


def _load(workspace: Workspace, record_id: str):
    """A submission, or the brief when ``record_id`` is 'brief'."""
    return load_brief(workspace) if record_id == BRIEF_ID else load_submission(workspace, record_id)


def _save(workspace: Workspace, record_id: str, record) -> None:
    if record_id == BRIEF_ID:
        save_brief(workspace, record)
    else:
        Submission.model_validate(record.model_dump())
        workspace.write_json(
            submission_path(record_id), record.model_dump(mode="json"), private=True
        )


def approve(workspace: Workspace, record_id: str, now: datetime | None = None) -> Approval:
    """Record the moderator's explicit approval of a submission's (or the brief's)
    current anonymised text."""
    record = _load(workspace, record_id)
    if record.anonymised is None:
        raise WorkspaceError(f"{record_id} has not been anonymised; run anonymise first")
    approval = Approval(
        id=f"appr-{record_id}-{record.anonymised.text_sha256[:12]}",
        approved_text_sha256=record.anonymised.text_sha256,
        approved_by=MODERATOR,
        approved_at=now or datetime.now(UTC),
    )
    _save(workspace, record_id, record.model_copy(update={"approval": approval}))
    return approval


def review_lines(workspace: Workspace, record_id: str, with_values: bool) -> list[str]:
    """Anonymised text, and optionally each redaction's original value (local review only)."""
    record = _load(workspace, record_id)
    if record.anonymised is None or record.extract is None:
        raise WorkspaceError(f"{record_id} has not been anonymised; run anonymise first")
    status = "APPROVED" if record.approval else "NOT APPROVED"
    label = "brief" if record_id == BRIEF_ID else f"{record.id} {record.pseudonym}"
    lines = [f"{label}: {len(record.anonymised.redactions)} redactions; {status}"]
    if with_values:
        lines.append(
            "!! The list below shows REAL VALUES for your review. Do not share or paste it anywhere."
        )
        for r in record.anonymised.redactions:
            original = record.extract.text[r.start : r.end]
            lines.append(f"  {r.replacement:<14} <- {original!r} ({r.reason})")
    lines += ["", record.anonymised.text]
    return lines
