"""Structure-only inspection of documents and archives (#15).

Reports counts and layout facts so unfamiliar formats can be understood
without exposing content. It never outputs document text, metadata values,
annotation or comment contents, or real file names: archive entry names are
shown only as shapes, with letters replaced by 'a' and digits by '9'.
"""

from __future__ import annotations

import re
import zipfile
from collections import Counter
from pathlib import Path

COMMENT_HEADING = re.compile(r"^Comment \d+\b")
BAND_LABEL = re.compile(r"\b(1ST|2:1|2:2|3RD|FAIL)\s*\(\d{1,3}\)")


def name_shape(name: str) -> str:
    """'Smith_John_12345_report.docx' -> 'Aaaaa_Aaaa_99999_aaaaaa.docx'."""
    stem, dot, suffix = name.rpartition(".")
    if not dot:
        stem, suffix = name, ""
    shaped = re.sub(r"[A-Z]", "A", re.sub(r"[a-z]", "a", re.sub(r"\d", "9", stem)))
    return f"{shaped}.{suffix.lower()}" if suffix else shaped


def inspect_path(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return inspect_pdf(path)
    if suffix == ".docx":
        return inspect_docx(path)
    if suffix == ".zip":
        return inspect_zip(path)
    return [f"unsupported file type '{suffix}'"]


def inspect_pdf(path: Path) -> list[str]:
    import pdfplumber

    out: list[str] = []
    with pdfplumber.open(path) as pdf:
        out.append(f"type: pdf, pages: {len(pdf.pages)}")
        out.append(f"metadata keys present: {sorted(pdf.metadata)}")
        for i, page in enumerate(pdf.pages, 1):
            area = float(page.width * page.height) or 1.0
            coverage = max(
                ((im["x1"] - im["x0"]) * (im["bottom"] - im["top"]) / area for im in page.images),
                default=0.0,
            )
            words = page.extract_words()
            lines = [ln for ln in (page.extract_text() or "").splitlines() if ln.strip()]
            fonts = Counter(c["fontname"].split("+")[-1] for c in page.chars)
            annots = Counter(str(a.get("data", {}).get("Subtype", "?")) for a in page.annots or [])
            out.append(
                f"p{i}: chars={len(page.chars)} words={len(words)} "
                f"digit-words={sum(w['text'].isdigit() for w in words)} lines={len(lines)} "
                f"images={len(page.images)} largest-image={coverage:.0%} rects={len(page.rects)} "
                f"annotations={dict(annots)} "
                f"comment-headings={sum(bool(COMMENT_HEADING.match(ln)) for ln in lines)} "
                f"band-labels={sum(len(BAND_LABEL.findall(ln)) for ln in lines)} "
                f"fonts={dict(fonts.most_common(4))}"
            )
    return out


def inspect_docx(path: Path) -> list[str]:
    from docx import Document

    doc = Document(str(path))
    styles = Counter(p.style.name if p.style is not None else "?" for p in doc.paragraphs)
    words = sum(len(p.text.split()) for p in doc.paragraphs)
    header_footer = sum(
        1
        for s in doc.sections
        for part in (s.header, s.footer)
        for p in part.paragraphs
        if p.text.strip()
    )
    props = doc.core_properties
    filled = [
        name
        for name in ("author", "last_modified_by", "title", "subject", "keywords", "comments")
        if getattr(props, name)
    ]
    return [
        "type: docx",
        f"paragraphs: {len(doc.paragraphs)}, words: {words}, tables: {len(doc.tables)}, "
        f"images: {len(doc.inline_shapes)}, sections: {len(doc.sections)}",
        f"paragraph styles: {dict(styles.most_common(8))}",
        f"non-empty header/footer paragraphs: {header_footer}",
        f"metadata fields filled: {filled}",
    ]


def inspect_zip(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        members = [i for i in z.infolist() if not i.is_dir()]
    kinds = Counter(Path(i.filename).suffix.lower() or "(none)" for i in members)
    shapes = Counter(name_shape(Path(i.filename).name) for i in members)
    folders = {str(Path(i.filename).parent) != "." for i in members}
    out = [
        f"type: zip, files: {len(members)}, in subfolders: {True in folders}",
        f"file types: {dict(kinds)}",
        "file name shapes (letters -> a/A, digits -> 9):",
    ]
    out += [f"  {count} x {shape}" for shape, count in shapes.most_common(10)]
    return out
