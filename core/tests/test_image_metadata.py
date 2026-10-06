"""Removing figures' hidden metadata, keeping their pixels. Synthetic images only."""

from __future__ import annotations

import hashlib
import io

import pytest
from helpers import SECRET, docx_with_metadata_figures, images_with_metadata
from PIL import Image

from feedbacker_core.extract import extract_with_figures
from feedbacker_core.image_metadata import cleanable, without_metadata


@pytest.mark.parametrize("media_type", ["image/jpeg", "image/png", "image/gif", "image/webp"])
def test_metadata_is_removed_and_the_pixels_kept(media_type):
    original = images_with_metadata()[media_type]
    cleaned = without_metadata(original, media_type)
    assert cleaned is not None and SECRET.encode() not in cleaned
    before, after = Image.open(io.BytesIO(original)), Image.open(io.BytesIO(cleaned))
    after.load()
    assert after.getexif() == {} and not any(
        k in after.info
        for k in ("exif", "xmp", "comment", "Author", "Description", "XML:com.adobe.xmp")
    )
    assert before.convert("RGB").tobytes() == after.convert("RGB").tobytes()
    assert without_metadata(cleaned, media_type) == cleaned  # nothing more to remove


@pytest.mark.parametrize("media_type", ["image/jpeg", "image/png", "image/gif", "image/webp"])
def test_an_unreadable_image_is_refused_not_passed_on(media_type):
    assert without_metadata(images_with_metadata()[media_type][:20], media_type) is None
    assert without_metadata(b"not an image", media_type) is None


def test_only_the_types_the_ai_accepts_are_cleaned():
    assert [
        t
        for t in ("image/png", "image/jpeg", "image/gif", "image/webp", "image/x-emf")
        if cleanable(t)
    ] == [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
    ]


def test_a_docx_figures_are_kept_without_their_metadata(tmp_path):
    e, figures = extract_with_figures(docx_with_metadata_figures(tmp_path / "photo.docx"))
    assert [f.media_type for f in e.figures] == ["image/jpeg", "image/png"]
    for f in e.figures:
        data = figures[f.placeholder]
        assert SECRET.encode() not in data
        assert hashlib.sha256(data).hexdigest() == f.sha256 and len(data) == f.bytes


def test_jpeg_metadata_between_scans_and_after_the_end_is_removed():
    from helpers import jpeg_with_late_metadata

    original = jpeg_with_late_metadata()
    cleaned = without_metadata(original, "image/jpeg")
    assert cleaned is not None and SECRET.encode() not in cleaned and cleaned.endswith(b"\xff\xd9")
    before, after = Image.open(io.BytesIO(original)), Image.open(io.BytesIO(cleaned))
    assert before.convert("RGB").tobytes() == after.convert("RGB").tobytes()


@pytest.mark.parametrize(
    ("data", "media_type"),
    [
        (b"\xff\xd8\xff\xd9", "image/jpeg"),  # no frame, no scan
        (
            b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00IEND\xaeB`\x82",
            "image/png",
        ),  # no header, no data
        (b"GIF89a\x01\x00\x01\x00\x00\x00\x00;", "image/gif"),  # no image
        (b"RIFF\x04\x00\x00\x00WEBP", "image/webp"),  # no image data
    ],
)
def test_an_image_with_nothing_to_draw_is_refused(data, media_type):
    assert without_metadata(data, media_type) is None


def test_a_figure_with_no_way_to_remove_its_metadata_is_marked_but_not_kept(tmp_path):
    import zipfile

    from helpers import docx_with_figures, make_zip

    source = docx_with_figures(tmp_path / "f.docx")
    with zipfile.ZipFile(source) as z:
        members = {i.filename: z.read(i) for i in z.infolist()}
    png = next(n for n in members if n.startswith("word/media/") and n.endswith(".png"))
    members["[Content_Types].xml"] = members["[Content_Types].xml"].replace(
        b"</Types>", f'<Override PartName="/{png}" ContentType="image/tiff"/></Types>'.encode()
    )
    e, figures = extract_with_figures(make_zip(tmp_path / "tiff.docx", members))
    assert [(f.placeholder, f.media_type, f.sha256) for f in e.figures][0] == (
        "[FIGURE_1]",
        None,
        None,
    )
    assert "[FIGURE_1]" not in figures and "[FIGURE_1]" in e.text
    assert any("can't be sent (such as EMF or TIFF)" in w for w in e.warnings)
