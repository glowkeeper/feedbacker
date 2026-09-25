"""Import, enter, confirm, and correct the original marker's marking (#17).

Marking comes from marked views (e.g. Turnitin current views) in one or more
bulk zips or single files, selected for the sample exactly as originals are
(#15). Each view is parsed (marked_view.py) and mapped onto the **source
rubric**, which governs the comparison (maintainer decision, 2026-09-25):

- A marker's criterion maps to a source criterion when the names match, or
  when the marker's name is a word-boundary prefix of exactly one source title,
  or through an explicit mapping from the moderator. Otherwise it is left
  unmapped and noted.
- The awarded score is the mark. A source ``level_id`` is set only when the
  score equals a source level's points exactly. The marker's selected level
  label and score are kept exactly as written.
- Disagreements are noted for the moderator, never reconciled: e.g. a
  selected level whose points differ from the awarded score, a rubric total
  that differs from the grade, or a Submission ID that differs from the file.

Comment text is anonymised with the same tokens as the submissions (#16).
Marking is never sent to a model. Each record is kept apart from the others
and stays unconfirmed until the moderator confirms it; manual entries and
corrections replace a record, keeping the previous version in a history.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from feedbacker_core.anonymise import apply, detect, load_rules, names_from_file_name
from feedbacker_core.archive import select_members
from feedbacker_core.extract import ExtractionError
from feedbacker_core.marked_view import MarkedView, parse_marked_view
from feedbacker_core.models import (
    Actor,
    ActorKind,
    Annotation,
    ImportRoute,
    OriginalAssessment,
    OriginalCriterionMark,
    Provenance,
    Rubric,
    Transformation,
)
from feedbacker_core.request import load_request
from feedbacker_core.rubric_import import RUBRIC
from feedbacker_core.workspace import PseudonymKey, Workspace, WorkspaceError

MARKING = "marking"
CRITERIA_MAP = "marking/criteria-map.json"
MARKED_SOURCES = "sources/marked"
MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")
MARKER = Actor(kind=ActorKind.ORIGINAL_MARKER, label="original marker")
REPORT_FAILED = re.compile(r"failed file count\s*:\s*(\d+)", re.IGNORECASE)


class MarkingProblem(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("cannot import marking:\n- " + "\n- ".join(problems))


class CriteriaMap(BaseModel):
    """Moderator-confirmed mappings from the marker's criterion names to source IDs."""

    model_config = ConfigDict(extra="forbid")

    mapping: dict[str, str] = Field(default_factory=dict)


@dataclass
class MarkingResult:
    imported: list[OriginalAssessment] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    ignored_count: int = 0
    download_warnings: list[str] = field(default_factory=list)
    unmapped: set[str] = field(default_factory=set)  # marker's criterion names
    source_ids: list[str] = field(default_factory=list)


def marker_slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "marker"


def marking_path(submission_id: str, marker_label: str = "marker") -> str:
    return f"{MARKING}/{submission_id}--{marker_slug(marker_label)}.json"


def load_rubric(workspace: Workspace) -> Rubric:
    if not workspace.exists(RUBRIC):
        raise WorkspaceError("import the source rubric first ('rubric import')")
    return Rubric.model_validate(workspace.read_json(RUBRIC))


def load_criteria_map(workspace: Workspace) -> CriteriaMap:
    if not workspace.exists(CRITERIA_MAP):
        return CriteriaMap()
    return CriteriaMap.model_validate(workspace.read_json(CRITERIA_MAP))


def update_criteria_map(workspace: Workspace, mapping: dict[str, str]) -> CriteriaMap:
    rubric = load_rubric(workspace)
    ids = {c.id for c in rubric.criteria}
    unknown = [f"'{v}'" for v in mapping.values() if v not in ids]
    if unknown:
        raise WorkspaceError(
            f"unknown source criterion ID(s) {', '.join(unknown)}; see 'rubric import' preview"
        )
    current = load_criteria_map(workspace)
    merged = CriteriaMap(
        mapping={**current.mapping, **{k.casefold(): v for k, v in mapping.items()}}
    )
    workspace.write_json(CRITERIA_MAP, merged.model_dump(mode="json"))
    return merged


def map_criterion(name: str, rubric: Rubric, explicit: CriteriaMap) -> str | None:
    """Exact (case-insensitive) title match, explicit mapping, or a unique prefix."""
    folded = name.casefold().strip()
    if folded in explicit.mapping:
        return explicit.mapping[folded]
    exact = [c.id for c in rubric.criteria if c.title.casefold().strip() == folded]
    if len(exact) == 1:
        return exact[0]
    prefix = [
        c.id
        for c in rubric.criteria
        if re.match(rf"{re.escape(folded)}(?!\w)", c.title.casefold().strip())
    ]
    return prefix[0] if len(prefix) == 1 else None


def describe_between(points: float, criterion) -> str:
    """'between Good (65) and Very good (75)', or the exact level's label."""
    levels = sorted(
        (lv for lv in criterion.levels if lv.points is not None), key=lambda lv: lv.points
    )
    exact = [lv for lv in levels if lv.points == points]
    if exact:
        return exact[0].label
    below = [lv for lv in levels if lv.points < points]
    above = [lv for lv in levels if lv.points > points]
    if below and above:
        return f"between {below[-1].label} and {above[0].label}"
    if above:
        return f"below {above[0].label}"
    return f"above {below[-1].label}" if below else "not comparable (no pointed levels)"


def _anonymise(text: str | None, key: PseudonymKey, rules) -> str | None:
    if not text:
        return text
    return apply(text, detect(text, key, rules), key)[0]


def build_assessment(
    view: MarkedView,
    *,
    submission_id: str,
    external_id: str,
    rubric: Rubric,
    criteria_map: CriteriaMap,
    key: PseudonymKey,
    rules,
    route: ImportRoute,
    source: str,
    input_hashes: list[str],
    now: datetime,
) -> OriginalAssessment:
    notes = list(view.warnings)
    if view.external_id and view.external_id != external_id:
        notes.append("the Submission ID inside the marked view differs from its file's identifier")
    marks: list[OriginalCriterionMark] = []
    used: set[str] = set()
    for pc in view.criteria:
        cid = map_criterion(pc.name, rubric, criteria_map)
        raw_score = f"{pc.score:g} / {pc.max_points:g}"
        if cid is None or cid in used:
            why = "already mapped" if cid in used else "could not be mapped to the source rubric"
            notes.append(
                f"criterion '{pc.name}' ({pc.weight:g}%, {raw_score}, selected "
                f"{pc.selected_label or 'none'}) {why}; map it with --criterion"
            )
            continue
        used.add(cid)
        source_criterion = rubric.criterion(cid)
        level = next((lv for lv in source_criterion.levels if lv.points == pc.score), None)
        if pc.selected_points is not None and pc.selected_points != pc.score:
            notes.append(
                f"criterion '{pc.name}': the selected level {pc.selected_label} disagrees with "
                f"the awarded score {raw_score}"
            )
        if level is None:
            notes.append(
                f"criterion '{pc.name}': awarded {pc.score:g} is "
                f"{describe_between(pc.score, source_criterion)} on the source rubric"
            )
        marks.append(
            OriginalCriterionMark(
                criterion_id=cid,
                level_id=level.id if level else None,
                mark=pc.score,
                raw_criterion=pc.name,
                raw_label=pc.selected_label,
                raw_score=raw_score,
            )
        )
    if view.grade is not None and view.rubric_total is not None:
        if (
            round(view.rubric_total) != round(view.grade)
            or abs(view.rubric_total - view.grade) >= 1
        ):
            notes.append(
                f"the rubric total {view.rubric_total:g} differs from the grade {view.grade:g}"
            )
    raw_overall = None
    if view.grade is not None:
        raw_overall = (
            f"{view.grade:g} / {view.grade_max:g}" if view.grade_max else f"{view.grade:g}"
        )
        if view.rubric_total is not None:
            raw_overall += f" (rubric total {view.rubric_total:g} / {view.rubric_max:g})"
    annotations = [
        Annotation(
            text=_anonymise(c.text, key, rules),
            number=c.number,
            criterion_label=c.criterion_label,
            page=c.page,
            position=c.position,
        )
        for c in view.comments
        if c.text
    ]
    return OriginalAssessment(
        submission_id=submission_id,
        marker_label="marker",
        import_route=route,
        criterion_marks=marks,
        overall_mark=view.grade,
        raw_overall=raw_overall,
        overall_comment=_anonymise(view.general_comment, key, rules),
        annotations=annotations,
        import_notes=notes,
        provenance=Provenance(
            source=source,
            transformation=Transformation.IMPORTED,
            actor=MARKER,
            timestamp=now,
            input_hashes=sorted(set(input_hashes)),
        ),
    )


def _download_report_warnings(sources: list[Path]) -> list[str]:
    warnings = []
    for n, src in enumerate(sources, 1):
        if src.suffix.lower() != ".zip":
            continue
        with zipfile.ZipFile(src) as z:
            for name in z.namelist():
                if not name.lower().endswith(".txt"):
                    continue
                text = z.read(name).decode("utf-8", "replace")
                if (m := REPORT_FAILED.search(text)) and int(m.group(1)) > 0:
                    warnings.append(
                        f"source {n}: its download report lists {m.group(1)} failed file(s)"
                    )
    return warnings


def import_marking(
    workspace: Workspace,
    sources: Path | list[Path],
    *,
    criteria: dict[str, str] | None = None,
    replace: bool = False,
    now: datetime | None = None,
) -> MarkingResult:
    if isinstance(sources, Path):
        sources = [sources]
    request = load_request(workspace)
    rubric = load_rubric(workspace)
    if criteria:
        update_criteria_map(workspace, criteria)
    criteria_map = load_criteria_map(workspace)
    key = workspace.read_key()
    rules = load_rules(workspace)
    sampled = [(s, key.by_pseudonym(s.pseudonym)) for s in request.sample]
    existing = [
        s.submission_id for s, _ in sampled if workspace.exists(marking_path(s.submission_id))
    ]
    if existing and not replace:
        raise WorkspaceError(
            f"marking already imported ({', '.join(existing)}); use replace to import again"
        )
    try:
        selection = select_members(sources, [e.external_id for _, e in sampled])
    except ValueError as err:
        raise MarkingProblem([str(err)]) from None
    labels = {e.external_id: f"{s.pseudonym} ({s.submission_id})" for s, e in sampled}
    problems = selection.problems(label=labels.__getitem__, sources=sources)
    problems += [
        f"file for {labels[i]} is not a pdf marked view"
        for i, m in selection.matched.items()
        if m.suffix != ".pdf"
    ]
    if problems:
        raise MarkingProblem(problems)

    timestamp = now or datetime.now(UTC)
    result = MarkingResult(
        ignored_count=selection.ignored_count,
        download_warnings=_download_report_warnings(sources),
        source_ids=[c.id for c in rubric.criteria],
    )
    source_hashes = {
        src: hashlib.sha256(src.read_bytes()).hexdigest()
        for src in {m.source for m in selection.matched.values()}
    }
    staging = workspace.path / "sources" / ".staging-marked"
    staging.mkdir(parents=True, exist_ok=True, mode=0o700)
    staged = []
    try:
        for s, entry in sampled:
            member = selection.matched[entry.external_id]
            try:
                data = member.read()
            except (zipfile.BadZipFile, OSError, KeyError, RuntimeError, zlib.error) as err:
                result.failed[s.submission_id] = (
                    f"the marked view could not be read ({type(err).__name__})"
                )
                continue
            tmp = staging / f"{s.submission_id}.pdf"
            tmp.write_bytes(data)
            tmp.chmod(0o600)
            try:
                view = parse_marked_view(tmp)
            except ExtractionError as err:
                result.failed[s.submission_id] = str(err)
                continue
            digest = hashlib.sha256(data).hexdigest()
            # The student's name from the marked view's file name, so comments
            # are anonymised even before the originals are imported.
            for name in names_from_file_name(member.file_name, entry.external_id):
                if name.casefold() not in {n.casefold() for n in entry.names}:
                    entry = entry.model_copy(update={"names": [*entry.names, name]})
            key.entries = [entry if e.pseudonym == entry.pseudonym else e for e in key.entries]
            assessment = build_assessment(
                view,
                submission_id=s.submission_id,
                external_id=entry.external_id,
                rubric=rubric,
                criteria_map=criteria_map,
                key=key,
                rules=rules,
                route=ImportRoute.TURNITIN_BULK_ZIP
                if member.is_archive
                else ImportRoute.TURNITIN_CURRENT_VIEW,
                source=f"{'archive' if member.is_archive else 'file'}:sha256:{source_hashes[member.source]}",
                input_hashes=[source_hashes[member.source], digest],
                now=timestamp,
            )
            mapped = {m.raw_criterion for m in assessment.criterion_marks}
            result.unmapped |= {c.name for c in view.criteria if c.name not in mapped}
            staged.append((s.submission_id, entry, member.file_name, tmp, assessment))
            result.imported.append(assessment)

        # Key first: it only gains tokens and file names.
        entries = {e.pseudonym: e for e in key.entries}
        for _, entry, file_name, _, _ in staged:
            current = entries[entry.pseudonym]
            entries[entry.pseudonym] = current.model_copy(
                update={"source_files": {**current.source_files, "marked": file_name}}
            )
        workspace.write_key(key.with_entries([entries[e.pseudonym] for e in key.entries]))
        final_dir = workspace.path / MARKED_SOURCES
        final_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        for submission_id, _, _, tmp, assessment in staged:
            _archive_previous(workspace, submission_id, "marker", timestamp)
            tmp.replace(final_dir / f"{submission_id}.pdf")
            workspace.write_json(
                marking_path(submission_id), assessment.model_dump(mode="json"), private=True
            )
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return result


def _archive_previous(
    workspace: Workspace, submission_id: str, marker_label: str, when: datetime
) -> None:
    """Keep the replaced record in the history, so corrections are recorded."""
    path = marking_path(submission_id, marker_label)
    if workspace.exists(path):
        stamp = when.strftime("%Y%m%dT%H%M%S%f")
        history = f"{MARKING}/history/{submission_id}--{marker_slug(marker_label)}--{stamp}.json"
        workspace.write_json(history, workspace.read_json(path), private=True)


def load_marking(
    workspace: Workspace, submission_id: str, marker_label: str = "marker"
) -> OriginalAssessment:
    path = marking_path(submission_id, marker_label)
    if not workspace.exists(path):
        raise WorkspaceError(f"no marking recorded for {submission_id} ({marker_label})")
    return OriginalAssessment.model_validate(workspace.read_json(path))


def confirm_marking(
    workspace: Workspace,
    submission_id: str,
    marker_label: str = "marker",
    now: datetime | None = None,
) -> OriginalAssessment:
    assessment = load_marking(workspace, submission_id, marker_label)
    confirmed = assessment.model_copy(
        update={"confirmed_by": MODERATOR, "confirmed_at": now or datetime.now(UTC)}
    )
    OriginalAssessment.model_validate(confirmed.model_dump())
    workspace.write_json(
        marking_path(submission_id, marker_label), confirmed.model_dump(mode="json"), private=True
    )
    return confirmed


def enter_marking(
    workspace: Workspace,
    submission_id: str,
    *,
    marker_label: str = "marker",
    overall: float | None = None,
    criteria: dict[str, float] | None = None,
    comment: str | None = None,
    now: datetime | None = None,
) -> OriginalAssessment:
    """Manual entry or correction. Replaces any existing record (kept in history).

    Manual records are entered by the moderator, so they need no separate confirmation.
    """
    request = load_request(workspace)
    if submission_id not in {s.submission_id for s in request.sample}:
        raise WorkspaceError(f"{submission_id} is not in the sample")
    rubric = load_rubric(workspace)
    problems = [
        f"unknown source criterion '{c}'" for c in (criteria or {}) if rubric.criterion(c) is None
    ]
    if problems:
        raise MarkingProblem(problems)
    key = workspace.read_key()
    rules = load_rules(workspace)
    timestamp = now or datetime.now(UTC)
    marks = []
    for cid, points in (criteria or {}).items():
        level = next((lv for lv in rubric.criterion(cid).levels if lv.points == points), None)
        marks.append(
            OriginalCriterionMark(
                criterion_id=cid,
                level_id=level.id if level else None,
                mark=points,
                raw_score=f"{points:g}",
            )
        )
    assessment = OriginalAssessment(
        submission_id=submission_id,
        marker_label=marker_label,
        import_route=ImportRoute.MANUAL,
        criterion_marks=marks,
        overall_mark=overall,
        overall_comment=_anonymise(comment, key, rules),
        confirmed_by=MODERATOR,
        confirmed_at=timestamp,
        provenance=Provenance(
            source="manual entry",
            transformation=Transformation.ENTERED,
            actor=MODERATOR,
            timestamp=timestamp,
        ),
    )
    workspace.write_key(key)
    _archive_previous(workspace, submission_id, marker_label, timestamp)
    workspace.write_json(
        marking_path(submission_id, marker_label), assessment.model_dump(mode="json"), private=True
    )
    return assessment


def marking_summary(
    workspace: Workspace, submission_id: str, marker_label: str = "marker"
) -> list[str]:
    """A pseudonymous summary for review: marks against the source rubric, and notes."""
    a = load_marking(workspace, submission_id, marker_label)
    rubric = load_rubric(workspace)
    status = "CONFIRMED" if a.confirmed_at else "NOT CONFIRMED"
    lines = [
        f"{submission_id} ({a.marker_label}, {a.import_route.value}): overall "
        f"{a.raw_overall or a.overall_mark}; {status}"
    ]
    for m in a.criterion_marks:
        c = rubric.criterion(m.criterion_id)
        where = describe_between(m.mark, c) if m.mark is not None else "no mark"
        lines.append(
            f"  {m.criterion_id}: {m.raw_score or m.mark} "
            f"(marker's level: {m.raw_label or '-'}; source rubric: {where})"
        )
    for note in a.import_notes:
        lines.append(f"  note: {note}")
    lines.append(
        f"  comments: {len(a.annotations)} inline; general comment: "
        f"{'yes' if a.overall_comment else 'no'}"
    )
    return lines
