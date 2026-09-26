"""Parse a marked "current view" PDF (e.g. Turnitin Feedback Studio) (#17).

The layout was established by structure-only inspection of a real current
view (no content was read):

- a header page with "Submission ID: <id>", "File name: ...", "Word count: N";
- the report pages, rendered as full-page images; their only text is the
  numbers of the comment markers, placed inline beside the commented text;
- a feedback section: a "... GRADE ... GENERAL COMMENTS" header, the grade in
  a left column with "/<max>" beneath it, and the general comment to the
  right; then "PAGE <n>" groups of "Comment <N> | <criterion tag>" headings,
  each followed by its text;
- rubric pages: "RUBRIC: <name> <total> / <max>", then for each criterion a
  header "<NAME> (<weight>%) <score> / <max>", its description, and its levels
  "<label> (<points>) <descriptor>". The selected level is printed in a
  distinctly darker colour than the others.

Parsing relies on those text cues and on relative colour, never on absolute
positions or theme colours. Anything that cannot be read is reported as a
warning, never guessed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from feedbacker_core.extract import ExtractionError, _is_image_page

SUBMISSION_ID = re.compile(r"^Submission ID:\s*(\S+)")
WORD_COUNT = re.compile(r"^Word count:\s*([\d,]+)")
GENERAL_HEADER = re.compile(r"GENERAL COMMENTS", re.IGNORECASE)
PAGE_MARK = re.compile(r"^PAGE\s+(\d+)$")
COMMENT = re.compile(r"^Comment\s+(\d+)(?:\s*\|\s*(.+?))?\s*$")
RUBRIC_TOTAL = re.compile(r"^RUBRIC:.*?(?P<raw>(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?))\s*$")
CRITERION = re.compile(
    r"^(.+?)\s*\((\d+(?:\.\d+)?)%\)\s+(?P<raw>(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?))\s*$"
)
LEVEL = re.compile(r"^(?P<label>[^()]{1,24}?\s*\((?P<points>\d+(?:\.\d+)?)\))(?:\s|$)")
GRADE = re.compile(r"^\d+(?:\.\d+)?$")
GRADE_MAX = re.compile(r"^/\s*(\d+(?:\.\d+)?)$")


@dataclass
class ParsedComment:
    number: int
    criterion_label: str | None
    text: str
    page: int | None = None
    position: float | None = None


@dataclass
class ParsedCriterion:
    name: str
    weight: float
    score: float
    max_points: float
    raw_score: str = ""  # the score exactly as written, e.g. "68 / 100"
    selected_label: str | None = None
    selected_points: float | None = None
    levels: int = 0


@dataclass
class MarkedView:
    external_id: str | None = None
    word_count: int | None = None
    grade: float | None = None
    grade_max: float | None = None
    raw_grade: str | None = None  # the grade exactly as written, e.g. "62 /100"
    general_comment: str | None = None
    comments: list[ParsedComment] = field(default_factory=list)
    rubric_total: float | None = None
    rubric_max: float | None = None
    raw_rubric_total: str | None = None
    criteria: list[ParsedCriterion] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _darkness(chars) -> float:
    """Lower luminance = darker. Averaged over a line's visible characters.

    Grey, RGB and CMYK fills are all measured by luminance, so the selected
    level is found whatever colour space the marked view uses.
    """
    values = []
    for c in chars:
        if not c["text"].strip():
            continue
        colour = c.get("non_stroking_color")
        if isinstance(colour, (list, tuple)) and len(colour) == 4:
            cyan, magenta, yellow, black = (float(x) for x in colour)
            r, g, b = ((1 - x) * (1 - black) for x in (cyan, magenta, yellow))
            values.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
        elif isinstance(colour, (list, tuple)) and len(colour) == 3:
            r, g, b = (float(x) for x in colour)
            values.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
        elif isinstance(colour, (list, tuple)) and len(colour) == 1:
            values.append(float(colour[0]))
        elif isinstance(colour, (int, float)):
            values.append(float(colour))
    return sum(values) / len(values) if values else 0.0


def parse_marked_view(path: Path) -> MarkedView:
    import pdfplumber
    from pdfminer.pdfparser import PDFSyntaxError
    from pdfplumber.utils.exceptions import PdfminerException

    view = MarkedView()
    try:
        pdf = pdfplumber.open(path)
    except (PdfminerException, PDFSyntaxError, ValueError) as err:
        raise ExtractionError(f"the marked view could not be read ({type(err).__name__})") from None
    try:
        with pdf:
            report_page, markers, lines = _read_pages(pdf, view)
    except Exception as err:  # pdfminer raises assorted errors on damaged pages
        raise ExtractionError(f"the marked view could not be read ({type(err).__name__})") from None
    return _interpret(view, report_page, markers, lines)


def _read_pages(pdf, view: MarkedView):
    """Collect marker positions from image pages and text lines from the rest."""
    report_page = 0
    markers: dict[int, tuple[int, float]] = {}
    lines: list[dict] = []
    for page in pdf.pages:
        if _is_image_page(page):
            report_page += 1
            # Report pages carry no text except the comment-marker numbers.
            for w in page.extract_words():
                if w["text"].isdigit():
                    centre = (w["top"] + w["bottom"]) / 2 / float(page.height)
                    markers.setdefault(int(w["text"]), (report_page, round(centre, 3)))
            continue
        for line in page.extract_text_lines(return_chars=True):
            line["page_width"] = float(page.width)
            lines.append(line)
    return report_page, markers, lines


def _interpret(view: MarkedView, report_page: int, markers, lines) -> MarkedView:
    if report_page == 0:
        view.warnings.append("no image-rendered report pages found; is this a marked view?")

    _parse_header(lines, view)
    feedback_start = next(
        (i for i, ln in enumerate(lines) if GENERAL_HEADER.search(ln["text"])), None
    )
    rubric_start = next((i for i, ln in enumerate(lines) if RUBRIC_TOTAL.match(ln["text"])), None)
    if feedback_start is None:
        view.warnings.append("no grade and general comments section found")
    else:
        end = rubric_start if rubric_start is not None else len(lines)
        _parse_feedback(lines[feedback_start + 1 : end], view)
    if rubric_start is None:
        view.warnings.append("no rubric section found")
    else:
        _parse_rubric(lines[rubric_start:], view)

    for c in view.comments:
        if c.number not in markers:
            view.warnings.append(
                f"comment {c.number}: its marker was not found on the report pages, "
                "so its position is unknown"
            )
        else:
            page, position = markers[c.number]
            if c.page is not None and c.page != page:
                view.warnings.append(
                    f"comment {c.number}: listed under page {c.page} but its marker is on page {page}"
                )
            c.page = c.page or page
            c.position = position
    return view


def _parse_header(lines: list[dict], view: MarkedView) -> None:
    for ln in lines[:20]:
        text = ln["text"].strip()
        if (m := SUBMISSION_ID.match(text)) and view.external_id is None:
            view.external_id = m.group(1)
        elif (m := WORD_COUNT.match(text)) and view.word_count is None:
            view.word_count = int(m.group(1).replace(",", ""))
    if view.external_id is None:
        view.warnings.append("no Submission ID found in the header")


def _parse_feedback(lines: list[dict], view: MarkedView) -> None:
    general: list[str] = []
    grade_words: list[str] = []
    current: ParsedComment | None = None
    page: int | None = None
    in_comments = False
    for ln in lines:
        text = ln["text"].strip()
        if m := PAGE_MARK.match(text):
            in_comments, page = True, int(m.group(1))
            continue
        if m := COMMENT.match(text):
            in_comments = True
            current = ParsedComment(
                number=int(m.group(1)), criterion_label=m.group(2), text="", page=page
            )
            view.comments.append(current)
            continue
        if not in_comments:
            # Grade column on the left, general comment to the right.
            left = ln["page_width"] * 0.3
            words = _words(ln)
            for w in words:
                if w["x0"] < left and GRADE.match(w["text"]) and view.grade is None:
                    view.grade = float(w["text"])
                    grade_words.append(w["text"])
                elif w["x0"] < left and (g := GRADE_MAX.match(w["text"])):
                    view.grade_max = float(g.group(1))
                    grade_words.append(w["text"])
            rest = " ".join(w["text"] for w in words if w["x0"] >= left)
            if rest:
                general.append(rest)
            continue
        if current is not None and text and text != "-":
            current.text = f"{current.text} {text}".strip()
    view.general_comment = " ".join(general).strip() or None
    view.raw_grade = " ".join(grade_words) or None
    if view.grade is None:
        view.warnings.append("no overall grade found")
    for c in view.comments:
        if not c.text:
            view.warnings.append(f"comment {c.number} has no text")


def _words(line: dict) -> list[dict]:
    """Split a line into words by the gaps between characters.

    Some PDFs contain no space characters at all, so a gap wider than a quarter
    of the character size starts a new word. Words keep their left position.
    """
    words: list[dict] = []
    current: dict | None = None
    previous = None
    for ch in line["chars"]:
        if not ch["text"].strip():
            current, previous = None, None
            continue
        gap = ch["x0"] - previous["x1"] if previous else 0
        if current is None or gap > max(1.0, 0.25 * float(previous["size"])):
            current = {"text": ch["text"], "x0": ch["x0"]}
            words.append(current)
        else:
            current["text"] += ch["text"]
        previous = ch
    return words


def _parse_rubric(lines: list[dict], view: MarkedView) -> None:
    if m := RUBRIC_TOTAL.match(lines[0]["text"].strip()):
        view.rubric_total, view.rubric_max = float(m.group(2)), float(m.group(3))
        view.raw_rubric_total = m.group("raw")
    level_lines: list[list[tuple[dict, re.Match]]] = []
    for ln in lines[1:]:
        text = ln["text"].strip()
        if m := CRITERION.match(text):
            view.criteria.append(
                ParsedCriterion(
                    name=m.group(1).strip(),
                    weight=float(m.group(2)),
                    score=float(m.group(4)),
                    max_points=float(m.group(5)),
                    raw_score=m.group("raw"),
                )
            )
            level_lines.append([])
        elif view.criteria and (m := LEVEL.match(text)):
            level_lines[-1].append((ln, m))
    for criterion, levels in zip(view.criteria, level_lines, strict=True):
        criterion.levels = len(levels)
        if not levels:
            view.warnings.append(f"criterion '{criterion.name}': no levels found")
            continue
        darkness = [_darkness(ln["chars"]) for ln, _ in levels]
        darkest = min(darkness)
        typical = sorted(darkness)[len(darkness) // 2]
        chosen = [i for i, d in enumerate(darkness) if d == darkest]
        if len(chosen) != 1 or typical - darkest < 0.1:
            view.warnings.append(
                f"criterion '{criterion.name}': the selected level could not be identified"
            )
            continue
        _, m = levels[chosen[0]]
        criterion.selected_label = m.group("label").strip()
        criterion.selected_points = float(m.group("points"))
