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
