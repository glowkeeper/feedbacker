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


def chart_image(fmt: str = "PNG", size: tuple[int, int] = (240, 160), mode: str = "RGB") -> bytes:
    """A small fictional bar chart, as image bytes."""
    from PIL import Image, ImageDraw

    image = Image.new(mode, size, "white")
    draw = ImageDraw.Draw(image)
    for i, h in enumerate((60, 110, 85)):
        draw.rectangle([20 + i * 70, size[1] - 10 - h, 70 + i * 70, size[1] - 10], fill="steelblue")
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    return buf.getvalue()


def docx_with_figures(path: Path) -> Path:
    """Figures in a paragraph and a table row, a tiny icon left out, all in order."""
    from docx.shared import Pt

    doc = Document()
    doc.add_heading("Fictional dashboard report", level=1)
    doc.add_paragraph("The dashboard shows weekly sign-ups.")
    doc.add_paragraph().add_run().add_picture(io.BytesIO(chart_image("PNG")), width=Pt(240))
    doc.add_paragraph("Figure 1 shows the trend.")
    icon = doc.add_paragraph("A bullet icon: ")
    icon.add_run().add_picture(io.BytesIO(chart_image("PNG", (16, 16))), width=Pt(12))
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Chart"
    table.cell(0, 1).paragraphs[0].add_run().add_picture(
        io.BytesIO(chart_image("JPEG")), width=Pt(120)
    )
    doc.add_paragraph("The end of the report.")
    doc.save(path)
    return path


def pdf_with_figures(path: Path) -> Path:
    """Two figures between paragraphs on page 1 (RGB and grey), one alone on page 2, and a tiny icon."""
    from reportlab.lib.utils import ImageReader

    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    c.setFont("Helvetica", 11)
    c.drawString(60, 780, "The dashboard shows weekly sign-ups.")
    c.drawImage(ImageReader(io.BytesIO(chart_image("PNG"))), 60, 600, width=240, height=160)
    c.drawString(60, 580, "Figure 1 shows the trend.")
    c.drawImage(
        ImageReader(io.BytesIO(chart_image("PNG", mode="L"))), 60, 400, width=180, height=120
    )
    c.drawString(60, 380, "Figure 2 shows the same in grey.")
    c.drawImage(ImageReader(io.BytesIO(chart_image("PNG", (16, 16)))), 60, 350, width=12, height=12)
    c.drawString(80, 352, "A tiny icon, left out.")
    c.showPage()
    c.drawImage(ImageReader(io.BytesIO(chart_image("JPEG"))), 60, 500, width=300, height=200)
    c.showPage()
    c.drawString(60, 780, "The last page's text.")
    c.showPage()
    c.save()
    return path
