"""Deterministic, local text extraction from typed docx and pdf files (#15).

Extraction never calls a model, never reads document metadata, and fails
clearly rather than returning partial text that looks complete. Structure is
kept as blocks (headings, paragraphs, table rows) with offsets into the text
and page numbers for PDFs.
"""

from __future__ import annotations

import hashlib
import statistics
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from feedbacker_core.models import (
    Actor,
    ActorKind,
    Block,
    BlockKind,
    Extract,
    Provenance,
    SourceFormat,
    Transformation,
)

EXTRACTOR = Actor(kind=ActorKind.SYSTEM, label="feedbacker extract")

# A page counts as an image page when it has (almost) no text and one image
# covers most of it, as in rendered "current view" report pages.
IMAGE_PAGE_MAX_CHARS = 40
IMAGE_PAGE_MIN_COVERAGE = 0.6
# Too many image pages means the text cannot be extracted reliably.
IMAGE_PAGES_FAIL_COUNT = 3
IMAGE_PAGES_FAIL_SHARE = 0.25


class ExtractionError(Exception):
    """The file cannot be extracted reliably. Nothing partial is returned."""


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_format(path: Path) -> SourceFormat:
    suffix = path.suffix.lower().lstrip(".")
    try:
        return SourceFormat(suffix)
    except ValueError:
        raise ExtractionError(
            f"unsupported file type '.{suffix}'; Stage 0 extracts typed docx and pdf only"
        ) from None


def extract(path: Path, now: datetime | None = None) -> Extract:
    fmt = source_format(path)
    digest = sha256_file(path)
    builder = _Builder()
    if fmt is SourceFormat.DOCX:
        _extract_docx(path, builder)
    else:
        _extract_pdf(path, builder)
    if not builder.text.strip():
        raise ExtractionError("no text could be extracted; the file may be empty or image-only")
    return Extract(
        text=builder.text,
        source_sha256=digest,
        blocks=builder.blocks,
        warnings=builder.warnings,
        provenance=Provenance(
            source=f"file:sha256:{digest}",
            transformation=Transformation.EXTRACTED,
            actor=EXTRACTOR,
            timestamp=now or datetime.now(UTC),
            input_hashes=[digest],
        ),
    )


class _Builder:
    def __init__(self) -> None:
        self.text = ""
        self.blocks: list[Block] = []
        self.warnings: list[str] = []

    def add(
        self, kind: BlockKind, content: str, level: int | None = None, page: int | None = None
    ) -> None:
        content = content.strip()
        if not content:
            return
        if self.text:
            self.text += "\n\n"
        start = len(self.text)
        self.text += content
        self.blocks.append(
            Block(kind=kind, start=start, end=len(self.text), level=level, page=page)
        )


# --- DOCX -------------------------------------------------------------------


def _extract_docx(path: Path, out: _Builder) -> None:
    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        doc = Document(str(path))
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError) as err:
        raise ExtractionError(f"the docx file could not be read: {err}") from None

    tables = 0
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, doc)
            level = _heading_level(para.style.name if para.style is not None else "")
            kind = BlockKind.HEADING if level is not None else BlockKind.PARAGRAPH
            out.add(kind, para.text, level=level)
        elif tag == "tbl":
            tables += 1
            for row in Table(child, doc).rows:
                cells = []
                for cell in row.cells:
                    text = " ".join(cell.text.split())
                    if not cells or cells[-1] != text:  # merged cells repeat
                        cells.append(text)
                out.add(BlockKind.TABLE_ROW, " | ".join(cells))

    if tables:
        out.warnings.append(
            f"{tables} table(s) extracted row by row; check layout-dependent content"
        )
    images = len(doc.inline_shapes)
    if images:
        out.warnings.append(f"{images} image(s) present; their content is not extracted")
    if any(
        p.text.strip()
        for section in doc.sections
        for part in (section.header, section.footer)
        for p in part.paragraphs
    ):
        out.warnings.append("headers and footers are not extracted")


def _heading_level(style_name: str) -> int | None:
    name = style_name.lower()
    if name == "title":
        return 0
    if name.startswith("heading"):
        digits = name.removeprefix("heading").strip()
        return int(digits) if digits.isdigit() else 1
    return None


# --- PDF --------------------------------------------------------------------


def _extract_pdf(path: Path, out: _Builder) -> None:
    import pdfplumber
    from pdfminer.pdfparser import PDFSyntaxError
    from pdfplumber.utils.exceptions import PdfminerException

    try:
        pdf = pdfplumber.open(path)
    except (PdfminerException, PDFSyntaxError, ValueError) as err:
        raise ExtractionError(f"the pdf file could not be read: {err}") from None

    with pdf:
        pages = pdf.pages
        image_pages = [i for i, p in enumerate(pages, 1) if _is_image_page(p)]
        if image_pages and (
            len(image_pages) >= IMAGE_PAGES_FAIL_COUNT
            or len(image_pages) / len(pages) >= IMAGE_PAGES_FAIL_SHARE
        ):
            raise ExtractionError(
                f"{len(image_pages)} of {len(pages)} pages are images without text "
                "(as in a marked 'current view'); this file is unsuitable for text extraction. "
                "Use the student's original file. Stage 0 has no OCR."
            )
        for number, page in enumerate(pages, 1):
            if number in image_pages:
                out.warnings.append(f"page {number} is an image; its content is not extracted")
                continue
            try:
                lines = page.extract_text_lines(return_chars=True)
            except Exception as err:  # pdfminer raises assorted errors on damaged pages
                raise ExtractionError(f"page {number} could not be read: {err}") from None
            if not lines:
                out.warnings.append(f"page {number} is empty")
                continue
            if page.images:
                out.warnings.append(
                    f"page {number} contains {len(page.images)} image(s); their content is not extracted"
                )
            _add_pdf_lines(lines, number, out)


def _is_image_page(page) -> bool:
    if len(page.chars) > IMAGE_PAGE_MAX_CHARS or not page.images:
        return False
    area = float(page.width * page.height) or 1.0
    largest = max((im["x1"] - im["x0"]) * (im["bottom"] - im["top"]) for im in page.images)
    return largest / area >= IMAGE_PAGE_MIN_COVERAGE


def _add_pdf_lines(lines: list[dict], page: int, out: _Builder) -> None:
    sizes = [c["size"] for line in lines for c in line["chars"] if c["text"].strip()]
    body = statistics.median(sizes) if sizes else 0
    heights = [line["bottom"] - line["top"] for line in lines]
    gap_limit = (statistics.median(heights) if heights else 0) * 0.8

    para: list[str] = []
    previous_bottom = None

    def flush() -> None:
        if para:
            out.add(BlockKind.PARAGRAPH, " ".join(para), page=page)
            para.clear()

    for line in lines:
        text = line["text"].strip()
        line_sizes = [c["size"] for c in line["chars"] if c["text"].strip()]
        size = statistics.mean(line_sizes) if line_sizes else body
        is_heading = body and size >= body * 1.15 and len(text) <= 120
        if is_heading:
            flush()
            out.add(BlockKind.HEADING, text, level=1, page=page)
            previous_bottom = line["bottom"]
            continue
        if previous_bottom is not None and line["top"] - previous_bottom > gap_limit:
            flush()
        para.append(text)
        previous_bottom = line["bottom"]
    flush()
