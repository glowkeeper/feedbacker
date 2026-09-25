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


SAFE_PUNCTUATION = set(" ._-()[]+,&'")


class InspectionError(Exception):
    """A file could not be inspected. The message never includes its content."""


def _shape_char(ch: str) -> str:
    if ch.isdigit():
        return "9"
    if ch.isalpha():
        return "A" if ch.isupper() else "a"
    return ch if ch in SAFE_PUNCTUATION else "?"


def name_shape(name: str) -> str:
    """'García_Élodie_12345_report.docx' -> 'Aaaaaa_Aaaaaa_99999_aaaaaa.docx'.

    Every letter (in any script) and digit is replaced, and anything other than
    common punctuation becomes '?', so no part of a real name survives. Only a
    short, purely ASCII-alphanumeric extension is kept, so it cannot carry a name.
    """
    stem, dot, suffix = name.rpartition(".")
    if not dot or not (suffix.isascii() and suffix.isalnum() and len(suffix) <= 5):
        stem, suffix = name, ""
    shaped = "".join(_shape_char(ch) for ch in stem)
    return f"{shaped}.{suffix.lower()}" if suffix else shaped


def inspect_path(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    inspectors = {".pdf": inspect_pdf, ".docx": inspect_docx, ".zip": inspect_zip}
    if suffix not in inspectors:
        raise InspectionError(f"unsupported file type '{name_shape(suffix) or 'none'}'")
    if not path.is_file():
        raise InspectionError("file not found")
    try:
        return inspectors[suffix](path)
    except Exception as err:  # parser errors can quote content, so report the type only
        raise InspectionError(
            f"could not inspect this {suffix} file ({type(err).__name__}); it may be damaged"
        ) from None


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
    # Style names are user-defined and could contain a name, so report buckets only.
    styles = Counter(
        _style_bucket(p.style.name if p.style is not None else "") for p in doc.paragraphs
    )
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
        f"paragraph style kinds: {dict(styles.most_common())}",
        f"non-empty header/footer paragraphs: {header_footer}",
        f"metadata fields filled: {filled}",
    ]


def _safe_suffix(name: str) -> str:
    suffix = Path(name).suffix.lower().lstrip(".")
    ok = suffix and suffix.isascii() and suffix.isalnum() and len(suffix) <= 5
    return f".{suffix}" if ok else "(other)"


def _style_bucket(name: str) -> str:
    n = name.lower()
    if n == "title":
        return "title"
    if n.startswith("heading"):
        return "heading"
    if "list" in n:
        return "list"
    if n in {"normal", "body text", "first paragraph", "compact", "default paragraph style"}:
        return "body"
    return "other"


def inspect_zip(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        members = [i for i in z.infolist() if not i.is_dir()]
    kinds = Counter(_safe_suffix(i.filename) for i in members)
    shapes = Counter(name_shape(Path(i.filename).name) for i in members)
    folders = {str(Path(i.filename).parent) != "." for i in members}
    out = [
        f"type: zip, files: {len(members)}, in subfolders: {True in folders}",
        f"file types: {dict(kinds)}",
        "file name shapes (letters -> a/A, digits -> 9):",
    ]
    out += [f"  {count} x {shape}" for shape, count in shapes.most_common(10)]
    return out
