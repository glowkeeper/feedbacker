"""Import a rubric from CSV or JSON (#15).

Points-based rubrics in the Turnitin/Canvas style are supported: many levels
per criterion, each with one points value and a label. Labels are kept exactly
as written, even when inconsistent with their points. Literal ``\\n``
sequences, a common export artefact, are converted to line breaks in
descriptions and recorded as warnings.

Grid (xlsx, or a docx table): the common layout of criteria down the first
column and levels across the first row. Each level header must read
``Label (points)``, e.g. ``Excellent (85)``, and is kept exactly as written as
the level label. A criterion cell's first line is its title; any further lines
are its description. Grid imports are best-effort, so they are previewed and
written only when the moderator confirms.

CSV: one row per level, with columns
    criterion, level_label, points, descriptor
and optionally
    criterion_description, weight, max_points
(criterion-level values may be given on any row of that criterion).

JSON:
    {"title": ..., "criteria": [{"title": ..., "description": ..., "weight": ...,
      "max_points": ..., "levels": [{"label": ..., "points": ..., "descriptor": ...}]}]}
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from feedbacker_core.models import (
    Actor,
    ActorKind,
    Criterion,
    Level,
    Provenance,
    Rubric,
    Transformation,
)
from feedbacker_core.workspace import Workspace, WorkspaceError

RUBRIC = "rubric.json"
RUBRIC_WARNINGS = "rubric-warnings.json"
MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")
REQUIRED_CSV = {"criterion", "level_label", "points", "descriptor"}


class RubricError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("invalid rubric:\n- " + "\n- ".join(problems))


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s or "criterion")[:60]


def _clean(text: str, where: str, warnings: list[str]) -> str:
    if "\\n" in text:
        warnings.append(f"{where}: literal '\\n' sequences converted to line breaks")
        text = text.replace("\\n", "\n")
    return text.strip()


def _number(value, where: str, problems: list[str]) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip().rstrip("%"))
    except ValueError:
        problems.append(f"{where}: '{value}' is not a number")
        return None


def parse_csv(text: str) -> dict:
    reader = csv.DictReader(io.StringIO(text))
    headers = {h.strip().lower() for h in reader.fieldnames or []}
    missing = REQUIRED_CSV - headers
    if missing:
        raise RubricError([f"CSV is missing column(s): {', '.join(sorted(missing))}"])
    criteria: dict[str, dict] = {}
    for row in reader:
        row = {k.strip().lower(): (v or "") for k, v in row.items() if k}
        name = row["criterion"].strip()
        if not name:
            continue
        c = criteria.setdefault(name, {"title": name, "levels": []})
        for field_name, target in (
            ("criterion_description", "description"),
            ("weight", "weight"),
            ("max_points", "max_points"),
        ):
            if row.get(field_name, "").strip():
                c[target] = row[field_name]
        c["levels"].append(
            {"label": row["level_label"], "points": row["points"], "descriptor": row["descriptor"]}
        )
    return {"criteria": list(criteria.values())}


GRID_HEADER = re.compile(r"^\s*(?P<label>.+?\(\s*(?P<points>\d+(?:\.\d+)?)\s*\))\s*$", re.S)
GRID_FORMATS = {".xlsx", ".docx"}


def parse_grid(rows: list[list[str | None]], where: str) -> tuple[dict, list[str]]:
    """Criteria down the first column, 'Label (points)' levels across the first row.

    Returns the parsed rubric and any layout problems, so they can be reported
    together with the rubric's own problems."""
    rows = [[("" if c is None else str(c)) for c in r] for r in rows]
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2 or len(rows[0]) < 2:
        raise RubricError([f"{where}: expected a grid with criteria rows and level columns"])
    problems: list[str] = []
    headers = []
    for col, cell in enumerate(rows[0][1:], start=2):
        text = " ".join(cell.split())
        if not text:
            headers.append(None)
            continue
        m = GRID_HEADER.match(text)
        if not m:
            problems.append(f"{where}: column {col} header '{text}' does not read 'Label (points)'")
            headers.append(None)
            continue
        headers.append((m.group("label").strip(), m.group("points")))
    criteria = []
    for r, row in enumerate(rows[1:], start=2):
        lines = [ln.strip() for ln in row[0].splitlines() if ln.strip()]
        if not lines:
            problems.append(f"{where}: row {r} has no criterion title")
            continue
        levels = []
        for col, header in enumerate(headers, start=2):
            descriptor = row[col - 1] if col - 1 < len(row) else ""
            if header is None:
                if descriptor.strip():
                    problems.append(f"{where}: row {r} column {col} has text under no valid header")
                continue
            levels.append({"label": header[0], "points": header[1], "descriptor": descriptor})
        criteria.append({"title": lines[0], "description": "\n".join(lines[1:]), "levels": levels})
    return {"criteria": criteria}, problems


def read_xlsx_rows(path: Path, sheet: str | None = None) -> list[list[str | None]]:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as err:  # openpyxl raises assorted errors on bad files
        raise RubricError([f"xlsx could not be read: {err}"]) from None
    if sheet is not None and sheet not in wb.sheetnames:
        raise RubricError([f"xlsx has no sheet '{sheet}'"])
    ws = wb[sheet] if sheet else wb.worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def read_docx_grid(path: Path) -> list[list[str | None]]:
    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError

    try:
        doc = Document(str(path))
    except PackageNotFoundError as err:
        raise RubricError([f"docx could not be read: {err}"]) from None
    for table in doc.tables:
        rows = [[c.text for c in row.cells] for row in table.rows]
        header = [" ".join(c.split()) for c in rows[0][1:]] if rows else []
        if header and all(GRID_HEADER.match(h) for h in header if h):
            return rows
    raise RubricError(
        [
            "no rubric grid table found (criteria down the first column, 'Label (points)' "
            "levels across the first row); export the rubric as xlsx or csv instead"
        ]
    )


def build_rubric(
    raw: dict,
    *,
    title: str,
    version: str,
    source_hash: str,
    weights: dict[str, float] | None = None,
    now: datetime | None = None,
) -> tuple[Rubric, list[str]]:
    weights = dict(weights or {})
    problems: list[str] = []
    warnings: list[str] = []
    criteria: list[Criterion] = []
    seen_ids: set[str] = set()
    for ci, c in enumerate(raw.get("criteria") or [], 1):
        c_title = str(c.get("title", "")).strip()
        where = f"criterion {ci} ('{c_title or '?'}')"
        if not c_title:
            problems.append(f"criterion {ci}: title is empty")
            continue
        cid = slug(c_title)
        base, n = cid, 2
        while cid in seen_ids:
            cid, n = f"{base}-{n}", n + 1
        seen_ids.add(cid)
        levels: list[Level] = []
        level_ids: set[str] = set()
        for li, lv in enumerate(c.get("levels") or [], 1):
            lwhere = f"{where} level {li}"
            label = str(lv.get("label", ""))  # kept exactly as written
            points = _number(lv.get("points"), lwhere, problems)
            descriptor = _clean(str(lv.get("descriptor", "")), lwhere, warnings)
            if not label.strip():
                problems.append(f"{lwhere}: label is empty")
            if not descriptor:
                problems.append(f"{lwhere}: descriptor is empty")
            lid = f"p{points:g}".replace(".", "-") if points is not None else f"l{li}"
            base_l, m = lid, 2
            while lid in level_ids:
                lid, m = f"{base_l}-{m}", m + 1
            level_ids.add(lid)
            if label.strip() and descriptor:
                levels.append(Level(id=lid, label=label, descriptor=descriptor, points=points))
        if not levels:
            problems.append(f"{where}: no valid levels")
            continue
        try:
            criteria.append(
                Criterion(
                    id=cid,
                    title=c_title,
                    description=_clean(str(c.get("description", "")), where, warnings),
                    weight=weights.pop(cid, None)
                    or _number(c.get("weight"), f"{where} weight", problems),
                    max_points=_number(c.get("max_points"), f"{where} max_points", problems),
                    levels=levels,
                )
            )
        except ValidationError as err:
            problems += [f"{where}: {e['msg']}" for e in err.errors()]
    if not criteria and not problems:
        problems.append("the rubric has no criteria")
    for unknown in weights:
        problems.append(f"weight given for unknown criterion '{unknown}'")
    if problems:
        raise RubricError(problems)
    rubric = Rubric(
        id=slug(title),
        version=version,
        title=title,
        criteria=criteria,
        provenance=Provenance(
            source=f"file:sha256:{source_hash}",
            transformation=Transformation.IMPORTED,
            actor=MODERATOR,
            timestamp=now or datetime.now(UTC),
            input_hashes=[source_hash],
        ),
    )
    return rubric, warnings


def import_rubric(
    workspace: Workspace,
    path: Path,
    *,
    title: str | None = None,
    version: str = "1",
    weights: dict[str, float] | None = None,
    sheet: str | None = None,
    confirm: bool = False,
    replace: bool = False,
    now: datetime | None = None,
) -> tuple[Rubric, list[str], bool]:
    """Parse and store a rubric. Returns (rubric, warnings, written).

    CSV and JSON are written directly. Grid formats (xlsx, docx) are
    best-effort, so they are written only when ``confirm`` is true; otherwise
    the parsed rubric is returned for the moderator to check.
    """
    if workspace.exists(RUBRIC) and not replace:
        raise WorkspaceError("a rubric is already imported; use replace to import again")
    layout_problems: list[str] = []
    data = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".csv":
        raw = parse_csv(data.decode("utf-8-sig"))
    elif suffix == ".json":
        try:
            raw = json.loads(data.decode("utf-8-sig"))
        except json.JSONDecodeError as err:
            raise RubricError([f"JSON could not be parsed: {err}"]) from None
    elif suffix == ".xlsx":
        raw, layout_problems = parse_grid(read_xlsx_rows(path, sheet), "xlsx")
    elif suffix == ".docx":
        raw, layout_problems = parse_grid(read_docx_grid(path), "docx table")
    else:
        raise RubricError(
            [f"unsupported rubric file type '{suffix}'; use .csv, .json, .xlsx, or .docx"]
        )
    try:
        rubric, warnings = build_rubric(
            raw,
            title=title or str(raw.get("title") or path.stem),
            version=version,
            source_hash=hashlib.sha256(data).hexdigest(),
            weights=weights,
            now=now,
        )
    except RubricError as err:
        raise RubricError(layout_problems + err.problems) from None
    if layout_problems:
        raise RubricError(layout_problems)
    if suffix in GRID_FORMATS and not confirm:
        return rubric, warnings, False
    workspace.write_json(RUBRIC_WARNINGS, warnings)
    workspace.write_json(RUBRIC, rubric.model_dump(mode="json"))
    return rubric, warnings, True
