"""Deterministic extraction of typed docx and pdf files."""

from __future__ import annotations

import pytest
from helpers import PACK, docx_with_table, pdf_pages, pdf_with_image_pages

from feedbacker_core.extract import ExtractionError, extract, sha256_file
from feedbacker_core.models import BlockKind

SUBS = PACK / "submissions"


def block_texts(e):
    return [(b.kind, e.text[b.start : b.end]) for b in e.blocks]


def test_docx_keeps_headings_and_paragraphs():
    e = extract(SUBS / "sub-a.docx")
    blocks = block_texts(e)
    assert blocks[0] == (BlockKind.HEADING, "Plant Swap: a community plant-sharing web app")
    assert (BlockKind.HEADING, "Implementation") in blocks
    assert any(k is BlockKind.PARAGRAPH and "MoSCoW" in t for k, t in blocks)
    assert e.source_sha256 == sha256_file(SUBS / "sub-a.docx")
    assert e.warnings == []


def test_docx_never_reads_metadata():
    # The fixture's author metadata is a fictional name that is not in the body text.
    e = extract(SUBS / "sub-c.docx")
    assert e.text.count("Riley Marsh") == 1  # only the cover line in the body


def test_pdf_keeps_pages_headings_and_paragraphs():
    e = extract(SUBS / "sub-d.pdf")
    assert all(b.page == 1 for b in e.blocks)
    kinds = [k for k, _ in block_texts(e)]
    assert BlockKind.HEADING in kinds and BlockKind.PARAGRAPH in kinds
    assert any("WebSockets" in t for _, t in block_texts(e))


def test_docx_tables_and_footers_are_warned(tmp_path):
    e = extract(docx_with_table(tmp_path / "t.docx"))
    assert (BlockKind.TABLE_ROW, "Latency | 120 ms") in block_texts(e)
    assert any("table(s) extracted row by row" in w for w in e.warnings)
    assert "headers and footers are not extracted" in e.warnings


def test_empty_pdf_page_is_warned(tmp_path):
    e = extract(pdf_pages(tmp_path / "p.pdf", ["First page text.", None, "Third page text."]))
    assert "page 2 is empty" in e.warnings
    assert [b.page for b in e.blocks] == [1, 3]


def test_single_image_page_is_warned_not_fatal(tmp_path):
    e = extract(pdf_with_image_pages(tmp_path / "p.pdf", text_pages=5, image_pages=1))
    assert "page 6 is an image; its content is not extracted" in e.warnings


def test_marked_view_replica_is_rejected():
    with pytest.raises(ExtractionError, match="unsuitable for text extraction.*no OCR"):
        extract(PACK / "marked-view-replica.pdf")


def test_mostly_image_pdf_is_rejected(tmp_path):
    with pytest.raises(ExtractionError, match="3 of 4 pages are images"):
        extract(pdf_with_image_pages(tmp_path / "p.pdf", text_pages=1, image_pages=3))


@pytest.mark.parametrize(
    "name,data,message",
    [
        ("x.odt", b"anything", "unsupported file type '.odt'"),
        ("x.docx", b"not a zip", "docx file could not be read"),
        ("x.pdf", b"not a pdf", "pdf file could not be read"),
    ],
)
def test_unreadable_or_unsupported_files_fail_clearly(tmp_path, name, data, message):
    path = tmp_path / name
    path.write_bytes(data)
    with pytest.raises(ExtractionError, match=message):
        extract(path)


def test_blank_pdf_fails_rather_than_returning_nothing(tmp_path):
    with pytest.raises(ExtractionError, match="no text could be extracted"):
        extract(pdf_pages(tmp_path / "p.pdf", [None, None]))
