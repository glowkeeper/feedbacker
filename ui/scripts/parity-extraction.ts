/**
 * Parity with the Python reference (#47): extraction, inspection and sample
 * selection run on the same files by `core/` and by the TypeScript core, and
 * their outputs compared in full. The files are the synthetic pack plus
 * awkward documents made by the Python tests' own helpers (python-docx and
 * reportlab), so the TypeScript side reads files it did not write.
 *
 *   node scripts/parity-extraction.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bytesSource, extract, inspectFile, selectMembers } from "../src/core/index.ts";

const dir = mkdtempSync(join(tmpdir(), "extraction-parity-"));
const NOW = "2026-01-15T09:00:00+00:00";

const python = execFileSync(
  "uv",
  [
    "run", "--quiet", "--project", "../core", "python", "-c",
    `
import json, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, "../core/tests")
from helpers import PACK, docx_with_table, make_zip, pdf_pages, pdf_with_image_pages
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from feedbacker_core.archive import select_members
from feedbacker_core.extract import extract
from feedbacker_core.structure import inspect_path

out = Path(${JSON.stringify(dir)})
files = {f"pack/{p.relative_to(PACK)}": p for p in sorted([*PACK.glob("submissions/*"), PACK / "marked-view-replica.pdf", PACK / "brief.docx", PACK / "rubric-grid.docx"])}
files["table.docx"] = docx_with_table(out / "table.docx")
files["pages.pdf"] = pdf_pages(out / "pages.pdf", ["First page text.", None, "Third page text.\\nA second line of it."])
files["blank.pdf"] = pdf_pages(out / "blank.pdf", [None, None])
files["one-image.pdf"] = pdf_with_image_pages(out / "one-image.pdf", text_pages=5, image_pages=1)
files["mostly-images.pdf"] = pdf_with_image_pages(out / "mostly-images.pdf", text_pages=1, image_pages=3)
doc = Document()
doc.styles.add_style("Quill Avery Notes", WD_STYLE_TYPE.PARAGRAPH)
doc.add_paragraph("x", style="Quill Avery Notes")
doc.add_heading("y", level=1)
doc.add_heading("Level two", level=2)
t = doc.add_table(rows=3, cols=3)
t.cell(0, 0).merge(t.cell(0, 1)).text = "Spans two"
t.cell(1, 2).merge(t.cell(2, 2)).text = "Spans down"
t.cell(1, 0).text = "Zoë 🙂\\tend"
doc.save(out / "styles.docx")
files["styles.docx"] = out / "styles.docx"
zips = {
  "tokens.zip": make_zip(out / "tokens.zip", {"Quill_Avery_100200301_attempt.docx": b"a", "Pike_Jordan_1002003011_attempt.docx": b"", "folder/Marsh_Riley_100200303.pdf": b"c", "__MACOSX/._Marsh_Riley_100200303.pdf": b""}),
  "ambiguous.zip": make_zip(out / "ambiguous.zip", {"a_100200301_v1.docx": b"", "a_100200301_v2.docx": b""}),
  "unicode.zip": make_zip(out / "unicode.zip", {"100200305 - GARCÍA ÉLODIE - informe.docx": b"u"}),
}
result = {"files": {}, "zips": {}}
for name, path in files.items():
    entry = {}
    try:
        entry["extract"] = extract(path, now=datetime.fromisoformat("${NOW}")).model_dump(mode="json")
    except Exception as err:
        entry["extract"] = {"error": str(err)}
    try:
        entry["inspect"] = inspect_path(path)
    except Exception as err:
        entry["inspect"] = {"error": str(err)}
    result["files"][name] = {"path": str(path), **entry}
ids = ["100200301", "100200303", "100200305", "100200309"]
for name, path in zips.items():
    sel = select_members(path, ids)
    result["zips"][name] = {"path": str(path), "matched": {i: m.name for i, m in sel.matched.items()}, "problems": sel.problems(label=lambda i: f"[{i}]", sources=[path]), "ignored": sel.ignored_count, "inspect": inspect_path(path)}
print(json.dumps(result))
`,
  ],
  { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname },
);
const reference = JSON.parse(python);

let failures = 0;
const report = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `\n    ${detail}` : ""}`);
};
const load = (path: string) => new Uint8Array(readFileSync(path));

try {
  for (const [name, expected] of Object.entries(reference.files) as [string, any][]) {
    const bytes = load(expected.path);
    const fileName = expected.path.split("/").at(-1);
    const actual = await extract(fileName, bytes, new Date(NOW)).catch((err) => ({ error: err.message }));
    const same = isDeepStrictEqual(actual, expected.extract);
    report(`extract ${name}`, same, same ? "" : `python: ${JSON.stringify(expected.extract).slice(0, 400)}\n    ts:     ${JSON.stringify(actual).slice(0, 400)}`);
    const lines = await inspectFile(fileName, bytes).catch((err) => ({ error: err.message }));
    const sameLines = isDeepStrictEqual(lines, expected.inspect);
    report(`inspect ${name}`, sameLines, sameLines ? "" : diffLines(expected.inspect, lines));
  }
  for (const [name, expected] of Object.entries(reference.zips) as [string, any][]) {
    const source = bytesSource(name, load(expected.path));
    const sel = await selectMembers(source, ["100200301", "100200303", "100200305", "100200309"]);
    const actual = {
      matched: Object.fromEntries([...sel.matched].map(([i, m]) => [i, m.name])),
      problems: sel.problems((i) => `[${i}]`, [source]),
      ignored: sel.ignoredCount,
    };
    const want = { matched: expected.matched, problems: expected.problems, ignored: expected.ignored };
    report(`select ${name}`, isDeepStrictEqual(actual, want), `python: ${JSON.stringify(want)}\n    ts:     ${JSON.stringify(actual)}`);
    const lines = await inspectFile(name, load(expected.path));
    report(`inspect ${name}`, isDeepStrictEqual(lines, expected.inspect), diffLines(expected.inspect, lines));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function diffLines(python: unknown, ts: unknown): string {
  if (!Array.isArray(python) || !Array.isArray(ts)) return `python: ${JSON.stringify(python)}\n    ts:     ${JSON.stringify(ts)}`;
  const out: string[] = [];
  for (let i = 0; i < Math.max(python.length, ts.length); i++) {
    if (python[i] !== ts[i]) out.push(`line ${i + 1}\n      python: ${python[i]}\n      ts:     ${ts[i]}`);
  }
  return out.join("\n    ");
}
process.exit(failures ? 1 : 0);
