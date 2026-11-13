"""Import a rubric from CSV or JSON.

Points-based rubrics in the Turnitin/Canvas style are supported: many levels
per criterion, each with one points value and a label. Labels are kept exactly
as written, even when inconsistent with their points. Literal ``\\n``
sequences, a common export artefact, are converted to line breaks in
descriptions and recorded as warnings.

Grid (xlsx, or a docx table): the common layout of criteria down the first
column and levels across the first row. Each level header must follow one of the
named layouts (see ``LAYOUTS``), and all of them the same one: ``Label (points)``, e.g.
``Excellent (85)``, or marks then an optional band in brackets, e.g. ``78, 75, 72 (1st)``
(the middle mark stands for the level). The header is kept exactly as written as the level
label. A criterion cell's first line is its title, which may end in its weight as a
percentage (``Method (25%)``); any further lines are its description. Grid imports are
best-effort, so they are previewed, with notes on how they were read, and written only when
the moderator confirms. A header that follows no layout is not guessed at.

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
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from feedbacker_core.actors import owner_of
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


_NUMBER = r"\d+(?:\.\d+)?"
GRID_HEADER = re.compile(r"^\s*(?P<label>.+?\(\s*(?P<points>" + _NUMBER + r")\s*\))\s*$", re.S)
MARKS_HEADER = re.compile(
    r"^\s*(?P<marks>" + _NUMBER + r"(?:\s*[,/;]\s*" + _NUMBER + r")*)\s*(?:\(.+\))?\s*$", re.S
)
_MARK = re.compile(_NUMBER)
# A weight written at the end of a criterion's name, as a percentage: ``Analysis (12.5%)``.
WEIGHT_IN_NAME = re.compile(
    r"^(?P<title>.*?)\s*\(\s*(?P<weight>" + _NUMBER + r")\s*%\s*\)\s*$", re.S
)
GRID_FORMATS = {".xlsx", ".docx"}


@dataclass(frozen=True)
class LevelHeader:
    """What a level header says: the label it is kept under (as written), the points that
    stand for the level, and the marks it was written with."""

    label: str
    points: str
    worth: float
    marks: list[str]


@dataclass(frozen=True)
class GridLayout:
    """A layout a grid's level headers can follow. A table is read when every header follows
    one layout, and says which; a header that follows none is not guessed at. A new layout is
    a new entry in LAYOUTS (and in the TypeScript core), with its examples in the tests."""

    name: str  # as the preview says it
    reads: str  # what a header must read, as a problem says it
    example: str
    read: Callable[[str, str], LevelHeader | None]  # the header as written, and collapsed


def _read_label_points(cell: str, text: str) -> LevelHeader | None:
    m = GRID_HEADER.match(text)
    # Validate a normalised copy, but keep the label exactly as written.
    return LevelHeader(cell.strip(), m.group("points"), float(m.group("points")), []) if m else None


def _read_marks_band(cell: str, text: str) -> LevelHeader | None:
    m = MARKS_HEADER.match(text)
    if not m:
        return None
    marks = _MARK.findall(m.group("marks"))
    values = sorted(float(x) for x in marks)
    n = len(values)
    # The middle one, or between the two middle ones.
    worth = values[(n - 1) // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2
    return LevelHeader(cell.strip(), repr(worth), worth, marks)


LAYOUTS = [
    GridLayout("Label (points)", "'Label (points)'", "'Excellent (85)'", _read_label_points),
    GridLayout(
        "marks, then an optional band in brackets",
        "marks, then an optional band in brackets",
        "'78, 75, 72 (1st)' or '0'",
        _read_marks_band,
    ),
]


def shape_of(text: str) -> str:
    """What a header looks like, without what it says: letters as ``a`` or ``A``, digits as ``9``,
    anything else outside ASCII as ``?``, each run as one."""
    shaped = []
    for ch in text:
        if "A" <= ch <= "Z":
            shaped.append("A")
        elif "a" <= ch <= "z":
            shaped.append("a")
        elif "0" <= ch <= "9":
            shaped.append("9")
        else:
            shaped.append(ch if ord(ch) < 128 else "?")
    return "".join(ch for i, ch in enumerate(shaped) if i == 0 or ch != shaped[i - 1])


def _cell_text(cell: str) -> str:
    return " ".join(cell.split())


def _layouts_said() -> str:
    options = "; or ".join(f"{layout.reads}, for example {layout.example}" for layout in LAYOUTS)
    return f"a table is read when every level header follows one layout: {options}"


def layout_of(headers: list[str]) -> GridLayout | None:
    """The first layout every (non-empty) level header of a table follows, or None."""
    texts = [t for t in (_cell_text(h) for h in headers) if t]
    if not texts:
        return None
    return next((lo for lo in LAYOUTS if all(lo.read(t, t) for t in texts)), None)


def _tables_found(tables: list[list[list[str]]]) -> str:
    """What was found when a docx has no table that can be read: how many tables, their sizes,
    and the shapes of the first row's headers."""
    if not tables:
        return "the document has no tables"
    shown = []
    for i, rows in enumerate(tables[:3], start=1):
        header = [t for t in (_cell_text(c) for c in (rows[0][1:] if rows else [])) if t]
        columns = len(rows[0]) if rows else 0
        shapes = ", ".join(f"'{shape_of(h)}'" for h in header[:6]) if header else "none"
        shown.append(
            f"table {i} is {len(rows)} row{'' if len(rows) == 1 else 's'} by {columns} "
            f"column{'' if columns == 1 else 's'}, its level headers (after the first column), "
            f"by shape: {shapes}"
        )
    more = "; and more" if len(tables) > 3 else ""
    return (
        f"the document has {len(tables)} table{'' if len(tables) == 1 else 's'}: "
        f"{'; '.join(shown)}{more}"
    )


def parse_grid(rows: list[list[str | None]], where: str) -> tuple[dict, list[str], list[str]]:
    """Criteria down the first column, level headers across the first row, each following one
    named layout (see LAYOUTS). A criterion's name may end in its weight, as a percentage
    (``Analysis (12.5%)``), which is read as its weight and taken out of the title.

    Returns the parsed rubric, any layout problems, and notes on how it was read when that is
    more than the plain ``Label (points)`` (which layout, what stands for each level, where
    each weight came from), so they can be reported together with the rubric's own problems."""
    rows = [[("" if c is None else str(c)) for c in r] for r in rows]
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2 or len(rows[0]) < 2:
        raise RubricError([f"{where}: expected a grid with criteria rows and level columns"])
    problems: list[str] = []
    notes: list[str] = []
    cells = rows[0][1:]
    texts = [_cell_text(c) for c in cells]
    # The layout every header follows; failing that, the one most of them follow, and the
    # others are the problems.
    layout = layout_of(cells)
    if layout is None:
        best = -1
        for lo in LAYOUTS:
            matched = sum(1 for t in texts if t and lo.read(t, t))
            if matched > best:
                layout, best = lo, matched
    assert layout is not None
    headers: list[LevelHeader | None] = []
    for col, (cell, text) in enumerate(zip(cells, texts, strict=True), start=2):
        if not text:
            headers.append(None)
            continue
        header = layout.read(cell, text)
        if header is None:
            problems.append(f"{where}: column {col} header '{text}' does not read {layout.reads}")
        headers.append(header)
    if problems:
        shapes = ", ".join(f"'{shape_of(t)}'" for t in texts if t)
        problems.append(f"{where}: {_layouts_said()}. The level headers here, by shape: {shapes}")
    elif layout is not LAYOUTS[0]:
        notes.append(
            f"{where}: read with the layout '{layout.name}': a level with several marks is "
            "worth the middle one"
        )
        for col, (header, text) in enumerate(zip(headers, texts, strict=True), start=2):
            if header is None:
                continue
            middle = (
                f", the middle of its marks {', '.join(header.marks)}"
                if len(header.marks) > 1
                else ""
            )
            notes.append(f"{where}: column {col} '{text}' is worth {header.worth:g}{middle}")
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
            levels.append(
                {"label": header.label, "points": header.points, "descriptor": descriptor}
            )
        criterion: dict = {"title": lines[0], "description": "\n".join(lines[1:]), "levels": levels}
        named = WEIGHT_IN_NAME.match(lines[0])
        if named and named.group("title").strip():
            criterion["title"] = named.group("title").strip()
            criterion["weight"] = named.group("weight")
            notes.append(
                f"{where}: row {r} '{criterion['title']}' is weighted "
                f"{float(named.group('weight')):g}, read from '({named.group('weight')}%)' in "
                "its name"
            )
        criteria.append(criterion)
    return {"criteria": criteria}, problems, notes


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
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError) as err:
        raise RubricError([f"docx could not be read ({type(err).__name__})"]) from None
    tables = [[[c.text for c in row.cells] for row in table.rows] for table in doc.tables]
    for rows in tables:
        if rows and layout_of(rows[0][1:]):
            return rows
    raise RubricError(
        [
            "no rubric grid table found (criteria down the first column, level headers across "
            f"the first row; {_layouts_said()}); {_tables_found(tables)}; "
            "export the rubric as xlsx or csv instead"
        ]
    )


def raise_for_json_shape(raw: object) -> None:
    """Reject JSON that is not the documented shape before it is used."""
    problems: list[str] = []
    if not isinstance(raw, dict):
        raise RubricError(["JSON rubric must be an object with a 'criteria' list"])
    criteria = raw.get("criteria")
    if not isinstance(criteria, list):
        problems.append("JSON rubric must have a 'criteria' list")
    else:
        for ci, c in enumerate(criteria, 1):
            if not isinstance(c, dict):
                problems.append(f"criterion {ci} must be an object")
            elif not isinstance(c.get("levels"), list) or not all(
                isinstance(lv, dict) for lv in c["levels"]
            ):
                problems.append(f"criterion {ci} must have a 'levels' list of objects")
    if problems:
        raise RubricError(problems)


def build_rubric(
    raw: dict,
    *,
    title: str,
    version: str,
    source_hash: str,
    weights: dict[str, float] | None = None,
    now: datetime | None = None,
    actor: Actor = MODERATOR,
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
                    # An explicit override wins even when it is 0, so it is validated.
                    weight=weights.pop(cid)
                    if cid in weights
                    else _number(c.get("weight"), f"{where} weight", problems),
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
            actor=actor,
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
    notes: list[str] = []
    data = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".csv":
        raw = parse_csv(data.decode("utf-8-sig"))
    elif suffix == ".json":
        try:
            raw = json.loads(data.decode("utf-8-sig"))
        except json.JSONDecodeError as err:
            raise RubricError([f"JSON could not be parsed: {err}"]) from None
        raise_for_json_shape(raw)
    elif suffix == ".xlsx":
        raw, layout_problems, notes = parse_grid(read_xlsx_rows(path, sheet), "xlsx")
    elif suffix == ".docx":
        raw, layout_problems, notes = parse_grid(read_docx_grid(path), "docx table")
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
            actor=owner_of(workspace),
        )
    except RubricError as err:
        raise RubricError(layout_problems + err.problems) from None
    if layout_problems:
        raise RubricError(layout_problems)
    warnings = notes + warnings
    if suffix in GRID_FORMATS and not confirm:
        return rubric, warnings, False
    workspace.write_json(RUBRIC_WARNINGS, warnings)
    workspace.write_json(RUBRIC, rubric.model_dump(mode="json"))
    return rubric, warnings, True
