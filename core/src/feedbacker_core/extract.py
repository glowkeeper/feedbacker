"""Deterministic, local text extraction from typed docx and pdf files.

Extraction never calls a model, never reads document metadata, and fails
clearly rather than returning partial text that looks complete. Structure is
kept as blocks (headings, paragraphs, table rows) with offsets into the text
and page numbers for PDFs.

Figures (embedded images) are marked in the text where they were, each by its
placeholder (``[FIGURE_1]``...) as a block of its own. A docx image's bytes are
returned beside the extract for the workspace to keep. A PDF's figures are
placed and measured, but their bytes are not extracted here: the app keeps
their pixels as PNG, which this reference doesn't (an intended difference).
Images smaller than 32 points either way (bullets, icons, rules) are left out.
"""

from __future__ import annotations

import hashlib
import re
import statistics
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from feedbacker_core.image_metadata import cleanable, without_metadata
from feedbacker_core.models import (
    Actor,
    ActorKind,
    Block,
    BlockKind,
    Extract,
    Figure,
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
# An image smaller than this, in points, either way is decoration, not a figure.
MIN_FIGURE_PT = 32
EMU_PER_POINT = 12700

MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "tif": "image/tiff",
    "tiff": "image/tiff",
    "emf": "image/x-emf",
    "wmf": "image/x-wmf",
    "svg": "image/svg+xml",
}


def media_type_of(name: str, content_type: str | None = None) -> str:
    """A docx image's media type: its declared content type, if an image's; else from its name."""
    declared = (content_type or "").strip().lower()
    if re.fullmatch(r"image/[a-z0-9.+-]+", declared):
        return declared
    ext = name.rsplit(".", 1)[-1].lower()
    return MEDIA_TYPES.get(ext) or "image/x-" + ("".join(re.findall(r"[a-z0-9]", ext)) or "unknown")


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
            f"unsupported file type '.{suffix}'; Feedbacker extracts typed docx and pdf only"
        ) from None


def extract(path: Path, now: datetime | None = None) -> Extract:
    return extract_with_figures(path, now)[0]


def extract_with_figures(
    path: Path, now: datetime | None = None
) -> tuple[Extract, dict[str, bytes]]:
    """The extract, and each figure's bytes by its placeholder (a docx's only)."""
    fmt = source_format(path)
    digest = sha256_file(path)
    builder = _Builder()
    if fmt is SourceFormat.DOCX:
        _extract_docx(path, builder)
    else:
        _extract_pdf(path, builder)
    if not builder.has_text:
        raise ExtractionError("no text could be extracted; the file may be empty or image-only")
    extracted = Extract(
        text=builder.text,
        source_sha256=digest,
        blocks=builder.blocks,
        warnings=builder.warnings,
        figures=builder.figures,
        provenance=Provenance(
            source=f"file:sha256:{digest}",
            transformation=Transformation.EXTRACTED,
            actor=EXTRACTOR,
            timestamp=now or datetime.now(UTC),
            input_hashes=[digest],
        ),
    )
    return extracted, builder.figure_bytes


class _Builder:
    def __init__(self) -> None:
        self.text = ""
        self.blocks: list[Block] = []
        self.warnings: list[str] = []
        self.figures: list[Figure] = []
        self.figure_bytes: dict[str, bytes] = {}
        self.has_text = False
        self.left_out = 0  # images too small to be figures

    def figure(
        self,
        width_pt: float,
        height_pt: float,
        page: int | None,
        image: tuple[bytes, str] | None,
    ) -> None:
        placeholder = f"[FIGURE_{len(self.figures) + 1}]"
        self.add(BlockKind.FIGURE, placeholder, page=page)
        data, media_type = image if image else (None, None)
        self.figures.append(
            Figure(
                placeholder=placeholder,
                page=page,
                width_pt=round(width_pt, 1),
                height_pt=round(height_pt, 1),
                media_type=media_type,
                sha256=hashlib.sha256(data).hexdigest() if data is not None else None,
                bytes=len(data) if data is not None else None,
            )
        )
        if data is not None:
            self.figure_bytes[placeholder] = data

    def figure_warnings(self) -> None:
        if self.figures:
            self.warnings.append(
                f"{len(self.figures)} figure(s) marked in the text where they were, "
                "as [FIGURE_1] and so on"
            )
        if self.left_out:
            self.warnings.append(
                f"{self.left_out} small image(s) (under {MIN_FIGURE_PT} points) left out"
            )

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
        if kind is not BlockKind.FIGURE:
            self.has_text = True


# --- DOCX -------------------------------------------------------------------


def _extract_docx(path: Path, out: _Builder) -> None:
    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        doc = Document(str(path))
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError) as err:
        raise ExtractionError(f"the docx file could not be read: {err}") from None

    missing = 0
    unreadable = 0

    def figures_in(element) -> None:
        """Each picture (a:blip) of each w:drawing in the element, with the drawing's size."""
        nonlocal missing, unreadable
        for drawing in element.xpath(".//w:drawing"):
            for shape in drawing.xpath("./wp:inline | ./wp:anchor"):
                extent = shape.find(qn("wp:extent"))
                width = int(extent.get("cx", 0)) / EMU_PER_POINT if extent is not None else 0
                height = int(extent.get("cy", 0)) / EMU_PER_POINT if extent is not None else 0
                for blip in shape.xpath(".//a:blip"):
                    if width < MIN_FIGURE_PT or height < MIN_FIGURE_PT:
                        out.left_out += 1
                        continue
                    rel = doc.part.rels.get(blip.get(qn("r:embed")) or "")
                    if rel is None or rel.is_external:
                        missing += 1
                        continue
                    part = rel.target_part
                    # Kept only without its hidden metadata; one that can't be cleaned (its
                    # format) or read is marked where it was, but not kept.
                    media_type = media_type_of(str(part.partname), part.content_type)
                    data = (
                        without_metadata(part.blob, media_type) if cleanable(media_type) else None
                    )
                    if data is None:
                        unreadable += 1
                    out.figure(width, height, None, (data, media_type) if data else None)

    tables = 0
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, doc)
            level = _heading_level(para.style.name if para.style is not None else "")
            kind = BlockKind.HEADING if level is not None else BlockKind.PARAGRAPH
            out.add(kind, para.text, level=level)
            figures_in(child)
        elif tag == "tbl":
            tables += 1
            for row in Table(child, doc).rows:
                cells = []
                for cell in row.cells:
                    text = " ".join(cell.text.split())
                    if not cells or cells[-1] != text:  # merged cells repeat
                        cells.append(text)
                out.add(BlockKind.TABLE_ROW, " | ".join(cells))
                figures_in(row._tr)

    if tables:
        out.warnings.append(
            f"{tables} table(s) extracted row by row; check layout-dependent content"
        )
    out.figure_warnings()
    if missing:
        out.warnings.append(
            f"{missing} image(s) linked from outside the document, or missing from it, left out"
        )
    if unreadable:
        out.warnings.append(
            f"{unreadable} figure(s) in a format that can't be sent (such as EMF or TIFF), "
            "or that couldn't be read, marked where they were but not kept"
        )
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
                "Use the student's original file. Feedbacker has no OCR."
            )
        for number, page in enumerate(pages, 1):
            if number in image_pages:
                out.warnings.append(f"page {number} is an image; its content is not extracted")
                continue
            try:
                lines = page.extract_text_lines(return_chars=True)
            except Exception as err:  # pdfminer raises assorted errors on damaged pages
                raise ExtractionError(f"page {number} could not be read: {err}") from None
            figures = _figures_of(page, out)
            if not lines and not figures:
                out.warnings.append(f"page {number} is empty")
                continue
            _add_pdf_lines(lines, figures, number, out)
        out.figure_warnings()


def _is_image_page(page) -> bool:
    if len(page.chars) > IMAGE_PAGE_MAX_CHARS or not page.images:
        return False
    area = float(page.width * page.height) or 1.0
    largest = max((im["x1"] - im["x0"]) * (im["bottom"] - im["top"]) for im in page.images)
    return largest / area >= IMAGE_PAGE_MIN_COVERAGE


def _figures_of(page, out: _Builder) -> list[dict]:
    """A page's pictures (not stencil masks) big enough to be figures, top to bottom.

    Smaller pictures are counted as left out.
    """
    pictures = [im for im in page.images if not im.get("imagemask")]
    figures = [
        im
        for im in pictures
        if im["x1"] - im["x0"] >= MIN_FIGURE_PT and im["bottom"] - im["top"] >= MIN_FIGURE_PT
    ]
    out.left_out += len(pictures) - len(figures)
    return sorted(figures, key=lambda im: (im["top"], im["x0"]))


def _add_pdf_figure(im: dict, page: int, out: _Builder) -> None:
    # The app keeps the pixels as PNG; this reference doesn't extract them.
    out.figure(float(im["x1"] - im["x0"]), float(im["bottom"] - im["top"]), page, None)


def _add_pdf_lines(lines: list[dict], figures: list[dict], page: int, out: _Builder) -> None:
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

    following = iter(figures)
    upcoming = next(following, None)  # the next figure: placed before the first line below its top
    for line in lines:
        if upcoming is not None and upcoming["top"] < line["top"]:
            flush()
            while upcoming is not None and upcoming["top"] < line["top"]:
                _add_pdf_figure(upcoming, page, out)
                upcoming = next(following, None)
            previous_bottom = None
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
    while upcoming is not None:
        _add_pdf_figure(upcoming, page, out)
        upcoming = next(following, None)
