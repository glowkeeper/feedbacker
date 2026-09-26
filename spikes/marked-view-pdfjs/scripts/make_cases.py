"""Write the synthetic parity cases into a directory; prints their paths.

Everything is fictional. Run with the core's environment:
`uv run --project ../../core python scripts/make_cases.py <dir>`
"""

import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "core" / "scripts"))
import make_fixtures  # noqa: E402

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
replica = make_fixtures.PACK / "marked-view-replica.pdf"
cases = {}

# The committed replica itself.
cases["replica"] = replica

# A plain text PDF: every section is missing, so only warnings come back.
path = out / "text-only.pdf"
c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
c.setFont("Helvetica", 11)
c.drawString(60, 780, "Just some text.")
c.showPage()
c.save()
cases["text-only"] = path

# The replica with no level printed darker than the rest, so no selection can
# be identified; the parser must warn rather than guess.
path = out / "no-selected-level.pdf"
original = make_fixtures.REPLICA_CRITERIA
make_fixtures.REPLICA_CRITERIA = [(n, w, s, None) for n, w, s, _ in original]
try:
    make_fixtures.write_marked_view_replica(path)
finally:
    make_fixtures.REPLICA_CRITERIA = original
cases["no-selected-level"] = path

# The replica with every colour given as CMYK instead of RGB, as print-oriented
# PDF producers do. The same colours, so the same level must be selected.
path = out / "cmyk.pdf"


def rgb_as_cmyk(self, r, g, b):
    k = 1 - max(r, g, b)
    if k >= 1:
        return self.setFillColorCMYK(0, 0, 0, 1)
    return self.setFillColorCMYK(
        (1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k
    )


original_rgb = canvas.Canvas.setFillColorRGB
canvas.Canvas.setFillColorRGB = rgb_as_cmyk
try:
    make_fixtures.write_marked_view_replica(path)
finally:
    canvas.Canvas.setFillColorRGB = original_rgb
cases["cmyk"] = path

# Unreadable input must fail clearly.
path = out / "not-a-pdf.pdf"
path.write_bytes(b"This is not a PDF.\n")
cases["not-a-pdf"] = path

for name, p in cases.items():
    print(f"{name}\t{p}")
