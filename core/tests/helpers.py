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


def pdf_with_stencil_mask(path: Path) -> Path:
    """A page with a large stencil mask (an image painted as a shape in a colour), not a picture."""
    content = (
        b"BT /F1 11 Tf 60 780 Td (Text above a large stencil mask.) Tj ET\n"
        b"q 0 0 1 rg 200 0 0 100 60 600 cm /M1 Do Q\n"
        b"BT /F1 11 Tf 60 560 Td (Text below it.) Tj ET\n"
    )
    mask = bytes([0xFF, 0x00, 0xFF, 0x00])
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >>"
        b" /XObject << /M1 6 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /XObject /Subtype /Image /Width 8 /Height 4 /ImageMask true"
        b" /BitsPerComponent 1 /Length %d >>\nstream\n" % len(mask) + mask + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    path.write_bytes(bytes(out))
    return path


def docx_with_declared_image_type(path: Path) -> Path:
    """A docx whose picture's part has an unusual name, declared as image/png in its content types."""
    source = docx_with_figures(path.with_suffix(".tmp.docx"))
    with zipfile.ZipFile(source) as z:
        members = {i.filename: z.read(i) for i in z.infolist()}
    png = next(n for n in members if n.startswith("word/media/") and n.endswith(".png"))
    renamed = png[: -len(".png")] + ".pic"
    members[renamed] = members.pop(png)
    rels = "word/_rels/document.xml.rels"
    members[rels] = members[rels].replace(
        png.removeprefix("word/").encode(), renamed.removeprefix("word/").encode()
    )
    override = f'<Override PartName="/{renamed}" ContentType="image/png"/>'.encode()
    members["[Content_Types].xml"] = members["[Content_Types].xml"].replace(
        b"</Types>", override + b"</Types>"
    )
    source.unlink()
    return make_zip(path, members)


def results_table_image() -> bytes:
    """A fictional test-results table, as an image: the only place the report gives its results."""
    from PIL import Image, ImageDraw, ImageFont

    rows = [
        ("Test", "Result"),
        ("Unit tests", "48 passed, 2 failed"),
        ("Statement coverage", "86%"),
        ("Usability sessions", "5 users"),
        ("Tasks completed", "4 of 5 users"),
        ("Median task time", "3 min 10 s"),
    ]
    font = ImageFont.load_default(size=22)
    image = Image.new("RGB", (640, 40 * len(rows) + 20), "white")
    draw = ImageDraw.Draw(image)
    for i, (name, value) in enumerate(rows):
        y = 10 + 40 * i
        draw.rectangle([10, y, 630, y + 40], outline="black")
        draw.line([330, y, 330, y + 40], fill="black")
        draw.text((20, y + 8), name, fill="black", font=font)
        draw.text((340, y + 8), value, fill="black", font=font)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def pdf_with_evidence_figure(path: Path) -> Path:
    """A short fictional report whose testing results are given only in a figure (a results table)."""
    from reportlab.lib.utils import ImageReader

    sections = [
        (
            "Requirements and design",
            [
                "We gathered requirements for a study planner from three fictional students and",
                "ranked them with MoSCoW. The design uses a weekly view and a task list.",
            ],
        ),
        (
            "Implementation",
            [
                "The planner is a small web app with a task store and a weekly view. Tasks can be",
                "added, edited and marked as done.",
            ],
        ),
        (
            "Testing and evaluation",
            [
                "We ran unit tests and a usability session with fictional users. The results are",
                "in the table below; we did not write them out in the text.",
            ],
        ),
    ]
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    y = 790
    for heading, lines in sections:
        c.setFont("Helvetica-Bold", 14)
        c.drawString(60, y, heading)
        y -= 22
        c.setFont("Helvetica", 11)
        for line in lines:
            c.drawString(60, y, line)
            y -= 16
        y -= 12
    c.drawImage(
        ImageReader(io.BytesIO(results_table_image())), 60, y - 165, width=400, height=162.5
    )
    y -= 195
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, y, "Reflection")
    c.setFont("Helvetica", 11)
    c.drawString(60, y - 22, "Next time we would test earlier, and with more users.")
    c.showPage()
    c.save()
    return path
