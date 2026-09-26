"""Print the Python parser's result for each PDF as JSON (the parity reference).

Run with the core's environment: `uv run --project ../../core python scripts/dump_marked_view.py <pdf>...`
"""

import json
import sys
from dataclasses import asdict
from pathlib import Path

import pdfplumber
from feedbacker_core.extract import ExtractionError, _is_image_page
from feedbacker_core.marked_view import _darkness, parse_marked_view


def layout(path: Path) -> list[dict]:
    """Each page's classification and text lines, to compare the text layer."""
    with pdfplumber.open(path) as pdf:
        return [
            {
                "image": _is_image_page(page),
                "chars": len(page.chars),
                "lines": [
                    [ln["text"], round(_darkness(ln["chars"]), 2)]
                    for ln in page.extract_text_lines(return_chars=True)
                ],
            }
            for page in pdf.pages
        ]


out = {}
for arg in sys.argv[1:]:
    try:
        out[arg] = {"view": asdict(parse_marked_view(Path(arg))), "layout": layout(Path(arg))}
    except ExtractionError as err:
        out[arg] = {"error": str(err)}
print(json.dumps(out, indent=2))
