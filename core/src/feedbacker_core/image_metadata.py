"""Remove an image's hidden metadata, keeping its pixels.

A figure is reviewed by its picture, but its file may carry what the picture
doesn't show: a photo's camera details, date or location (EXIF), an author or
software name (XMP, IPTC, text chunks), comments. This rewrites the file's
structure without decoding it, keeping only what draws the image, so the app
(``ui/src/core/imageMetadata.ts``) and this reference give the same bytes. A
file that can't be read is refused (None), never passed on as it is.
"""

from __future__ import annotations

import struct
from collections.abc import Callable

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# The PNG chunks that draw the image (and its animation); every other chunk is left out.
PNG_KEEP = {
    b"IHDR",
    b"PLTE",
    b"IDAT",
    b"IEND",
    b"tRNS",
    b"gAMA",
    b"cHRM",
    b"sRGB",
    b"sBIT",
    b"bKGD",
    b"pHYs",
    b"acTL",
    b"fcTL",
    b"fdAT",
}
# JPEG application segments kept: JFIF (APP0) and Adobe's colour transform (APP14).
JPEG_KEEP_APP = {0xE0, 0xEE}
# GIF application extensions kept: animation looping.
GIF_KEEP_APP = {b"NETSCAPE2.0", b"ANIMEXTS1.0"}


class _Unreadable(Exception):
    pass


def _need(data: bytes, end: int) -> None:
    if end > len(data):
        raise _Unreadable


def _png(data: bytes) -> bytes:
    if not data.startswith(PNG_SIGNATURE):
        raise _Unreadable
    parts = [data[:8]]
    at = 8
    while True:
        _need(data, at + 12)
        (length,) = struct.unpack(">I", data[at : at + 4])
        kind = data[at + 4 : at + 8]
        _need(data, at + 12 + length)
        if kind in PNG_KEEP:
            parts.append(data[at : at + 12 + length])
        at += 12 + length
        if kind == b"IEND":
            return b"".join(parts)


def _jpeg(data: bytes) -> bytes:
    if data[:2] != b"\xff\xd8":
        raise _Unreadable
    parts = [data[:2]]
    at = 2
    while True:
        _need(data, at + 2)
        if data[at] != 0xFF:
            raise _Unreadable
        marker = data[at + 1]
        if marker == 0xFF:
            at += 1  # a fill byte
            continue
        if marker == 0xD9:
            return b"".join([*parts, data[at : at + 2]])
        _need(data, at + 4)
        (length,) = struct.unpack(">H", data[at + 2 : at + 4])
        _need(data, at + 2 + length)
        if marker == 0xDA:  # the scan: the image data, and everything after it, as it is
            return b"".join([*parts, data[at:]])
        app = 0xE0 <= marker <= 0xEF
        if (app and marker in JPEG_KEEP_APP) or (not app and marker != 0xFE):
            parts.append(data[at : at + 2 + length])
        at += 2 + length


def _gif_sub_blocks(data: bytes, at: int) -> int:
    """Where a GIF's data sub-blocks from ``at`` end (after the terminator)."""
    while True:
        _need(data, at + 1)
        size = data[at]
        at += 1 + size
        if size == 0:
            return at


def _gif(data: bytes) -> bytes:
    if data[:4] != b"GIF8":
        raise _Unreadable
    _need(data, 13)
    global_table = 3 * 2 ** ((data[10] & 0x07) + 1) if data[10] & 0x80 else 0
    at = 13 + global_table
    _need(data, at)
    parts = [data[:at]]
    while True:
        _need(data, at + 1)
        block = data[at]
        if block == 0x3B:
            return b"".join([*parts, data[at : at + 1]])
        if block == 0x2C:
            _need(data, at + 10)
            local_table = 3 * 2 ** ((data[at + 9] & 0x07) + 1) if data[at + 9] & 0x80 else 0
            end = _gif_sub_blocks(data, at + 10 + local_table + 1)
            parts.append(data[at:end])
            at = end
        elif block == 0x21:
            _need(data, at + 2)
            label = data[at + 1]
            end = _gif_sub_blocks(data, at + 2)
            app_id = data[at + 3 : at + 14] if label == 0xFF and data[at + 2] == 11 else b""
            if label in (0xF9, 0x01) or (label == 0xFF and app_id in GIF_KEEP_APP):
                parts.append(data[at:end])
            at = end
        else:
            raise _Unreadable


def _webp(data: bytes) -> bytes:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise _Unreadable
    _need(data, 8)
    end = min(len(data), 8 + struct.unpack("<I", data[4:8])[0])
    chunks = []
    at = 12
    while at + 8 <= end:
        kind = data[at : at + 4]
        (size,) = struct.unpack("<I", data[at + 4 : at + 8])
        following = at + 8 + size + (size % 2)
        _need(data, min(following, at + 8 + size))
        if kind not in (b"EXIF", b"XMP "):
            chunk = bytearray(data[at : min(following, len(data))])
            if kind == b"VP8X":
                chunk[8] &= ~(0x08 | 0x04) & 0xFF  # the extended header's flags: no EXIF, no XMP
            chunks.append(bytes(chunk))
        at = following
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


CLEANERS: dict[str, Callable[[bytes], bytes]] = {
    "image/png": _png,
    "image/jpeg": _jpeg,
    "image/gif": _gif,
    "image/webp": _webp,
}


def cleanable(media_type: str) -> bool:
    """The types whose metadata can be removed: those the AI may be sent."""
    return media_type in CLEANERS


def without_metadata(data: bytes, media_type: str) -> bytes | None:
    """The image without its hidden metadata; None if it can't be read."""
    try:
        return CLEANERS[media_type](data)
    except (_Unreadable, struct.error, IndexError):
        return None
