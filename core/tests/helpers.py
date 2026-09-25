"""Builders for awkward test documents. Everything is fictional."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

PACK = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic" / "pack-01"


def make_zip(path: Path, members: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return path


def docx_with_table(path: Path) -> Path:
    doc = Document()
    doc.add_heading("Fictional report", level=1)
    doc.add_paragraph("An introduction paragraph.")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text, table.cell(0, 1).text = "Metric", "Value"
    table.cell(1, 0).text, table.cell(1, 1).text = "Latency", "120 ms"
    doc.sections[0].footer.paragraphs[0].text = "Fictional footer"
    doc.save(path)
    return path


def pdf_pages(path: Path, pages: list[str | None]) -> Path:
    """Text pages; None draws a full-page grey box image-free blank page."""
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    for text in pages:
        if text:
            c.setFont("Helvetica", 11)
            y = 780
            for line in text.split("\n"):
                c.drawString(60, y, line)
                y -= 16
        c.showPage()
    c.save()
    return path


def pdf_with_image_pages(path: Path, text_pages: int, image_pages: int) -> Path:
    from PIL import Image
    from reportlab.lib.utils import ImageReader

    width, height = A4
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    for i in range(text_pages):
        c.setFont("Helvetica", 11)
        c.drawString(60, 780, f"Fictional typed paragraph on page {i + 1}.")
        c.showPage()
    for _ in range(image_pages):
        buf = io.BytesIO()
        Image.new("RGB", (400, 560), "white").save(buf, format="PNG")
        buf.seek(0)
        c.drawImage(ImageReader(buf), 20, 20, width=width - 40, height=height - 40)
        c.showPage()
    c.save()
    return path
