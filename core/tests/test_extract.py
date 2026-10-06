"""Deterministic extraction of typed docx and pdf files."""

from __future__ import annotations

import hashlib

import pytest
from helpers import PACK, docx_with_table, pdf_pages, pdf_with_image_pages

from feedbacker_core.extract import ExtractionError, extract, extract_with_figures, sha256_file
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


# --- Figures ----------------------------------------------------------------

FIGURES = PACK / "figures"


def test_docx_figures_are_marked_where_they_were_and_kept():
    e, figures = extract_with_figures(FIGURES / "report-with-figures.docx")
    assert e.text == (
        "Fictional dashboard report\n\nThe dashboard shows weekly sign-ups.\n\n[FIGURE_1]\n\n"
        "Figure 1 shows the trend.\n\nA bullet icon:\n\nChart |\n\n[FIGURE_2]\n\n"
        "The end of the report."
    )
    assert [(f.placeholder, f.width_pt, f.height_pt, f.media_type) for f in e.figures] == [
        ("[FIGURE_1]", 240.0, 160.0, "image/png"),
        ("[FIGURE_2]", 120.0, 80.0, "image/jpeg"),
    ]
    for f in e.figures:
        assert hashlib.sha256(figures[f.placeholder]).hexdigest() == f.sha256
    assert "1 small image(s) (under 32 points) left out" in e.warnings


def test_pdf_figures_are_placed_but_their_bytes_are_left_to_the_app():
    e, figures = extract_with_figures(FIGURES / "report-with-figures.pdf")
    assert [t for k, t in block_texts(e) if k is BlockKind.FIGURE] == [
        "[FIGURE_1]",
        "[FIGURE_2]",
        "[FIGURE_3]",
    ]
    assert e.text.index("[FIGURE_1]") < e.text.index("Figure 1 shows") < e.text.index("[FIGURE_2]")
    assert [(f.page, f.media_type, f.sha256) for f in e.figures] == [
        (1, None, None),
        (1, None, None),
        (2, None, None),
    ]
    assert figures == {}


def test_a_stencil_mask_is_neither_a_figure_nor_a_small_image(tmp_path):
    from helpers import pdf_with_stencil_mask

    e = extract(pdf_with_stencil_mask(tmp_path / "mask.pdf"))
    assert (e.text, e.figures, e.warnings) == (
        "Text above a large stencil mask.\n\nText below it.",
        [],
        [],
    )


def test_a_docx_images_media_type_is_the_one_its_package_declares(tmp_path):
    from helpers import docx_with_declared_image_type

    e = extract(docx_with_declared_image_type(tmp_path / "declared.docx"))
    assert [f.media_type for f in e.figures] == ["image/png", "image/jpeg"]


def test_a_figures_alternative_text_follows_it_as_text(tmp_path):
    from helpers import docx_with_alt_text

    e = extract(docx_with_alt_text(tmp_path / "alt.docx"))
    assert e.text == (
        "The dashboard shows weekly sign-ups.\n\n[FIGURE_1]\n\n"
        "Alt text for [FIGURE_1]: A bar chart of weekly sign-ups, drawn by Morgan Ellis\n\n"
        "A second chart, with no description.\n\n[FIGURE_2]"
    )
    assert [b.kind for b in e.blocks] == [
        BlockKind.PARAGRAPH,
        BlockKind.FIGURE,
        BlockKind.PARAGRAPH,
        BlockKind.PARAGRAPH,
        BlockKind.FIGURE,
    ]
