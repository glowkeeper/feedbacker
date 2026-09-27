/**
 * Parity with the Python reference for marked views (#41, #52): the Python
 * parser and this core's parse the same synthetic PDFs, and their full
 * results are compared, with each page's image classification and text lines
 * (and each line's darkness). Moved in from the #41 spike.
 *
 * The six cases: the committed replica; a plain text PDF; the replica with
 * no level printed darker; the replica in CMYK; a file that isn't a PDF; and
 * the same layout printed to PDF by Chrome (scaled transforms, positioned
 * glyph runs, embedded subset fonts), which is closer to real current views.
 *
 *   node scripts/parity-marking.ts      (needs uv and the core environment, and Chrome)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isImagePage, parseMarkedView } from "../src/core/index.ts";
import { darkness } from "../src/core/markedView.ts";
import { PdfDocument } from "../src/core/pdf/pdfDocument.ts";
import { extractTextLines } from "../src/core/pdf/text.ts";

const python = (script: string, ...args: string[]) =>
  execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", `scripts/marked-views/${script}`, ...args], { encoding: "utf8" });

/** Each page's classification and text lines, with darkness, as the Python side dumps them. */
async function readLayout(bytes: Uint8Array) {
  const pdf = await PdfDocument.open(bytes);
  try {
    const pages = [];
    for (let n = 1; n <= pdf.pageCount; n++) {
      const page = await pdf.page(n);
      pages.push({
        image: isImagePage(page),
        chars: page.chars.length,
        lines: extractTextLines(page.chars).map((ln): [string, number] => [ln.text, Number((darkness(ln.chars) ?? NaN).toFixed(2))]),
      });
    }
    return pages;
  } finally {
    await pdf.close();
  }
}

const dir = mkdtempSync(join(tmpdir(), "marked-view-parity-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const cases = python("make_cases.py", dir)
  .trim()
  .split("\n")
  .map((row) => row.split("\t") as [string, string]);
const printed = join(dir, "chrome-printed.pdf");
execFileSync("node", ["scripts/marked-views/make_browser_case.ts", printed]);
cases.push(["chrome-printed", printed]);
const reference = JSON.parse(python("dump_marked_view.py", ...cases.map(([, p]) => p)));

type Page = { image: boolean; chars: number; lines: [string, number][] };

/**
 * An explained difference: where pdfminer can't map a glyph to Unicode it
 * writes "(cid:N)", and pdf.js decodes it (e.g. the replica's bullets). The
 * parser never reads those lines.
 */
function explained(python: [string, number] | undefined, ts: [string, number] | undefined): boolean {
  if (!python || !ts || python[1] !== ts[1] || !/\(cid:\d+\)/.test(python[0])) return false;
  const pattern = python[0]
    .split(/\(cid:\d+\)/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".");
  return new RegExp(`^${pattern}$`, "u").test(ts[0]);
}

/**
 * CMYK fills: pdf.js converts CMYK to RGB with its own display curve, and
 * Python with the plain formula, so line darkness differs in value, never in
 * which level is selected (which the parse comparison checks).
 */
const CMYK_CASES = new Set(["cmyk"]);
let explainedLines: string[] = [];
let cmykLines = 0;

function layoutDiff(expected: Page[], actual: Page[], cmyk = false): string {
  let out = expected.length === actual.length ? "" : `\n  page count ${expected.length} vs ${actual.length}`;
  expected.forEach((p, i) => {
    const q = actual[i];
    if (!q) return;
    if (p.image !== q.image || p.chars !== q.chars) out += `\n  page ${i + 1}: image ${p.image}/${q.image}, chars ${p.chars}/${q.chars}`;
    for (let j = 0; j < Math.max(p.lines.length, q.lines.length); j++) {
      const [pl, ql] = [p.lines[j], q.lines[j]];
      if (cmyk && pl && ql && pl[1] !== ql[1]) {
        cmykLines++;
        if (pl[0] === ql[0] || explained([pl[0], 0], [ql[0], 0])) continue;
      }
      if (explained(pl, ql)) explainedLines.push(`${JSON.stringify(pl[0])} -> ${JSON.stringify(ql[0])}`);
      else if (!isDeepStrictEqual(pl, ql)) out += `\n  page ${i + 1} line ${j + 1}\n    python: ${JSON.stringify(pl)}\n    ts:     ${JSON.stringify(ql)}`;
    }
  });
  return out;
}

let failures = 0;
for (const [name, path] of cases) {
  const expected = reference[path];
  const bytes = new Uint8Array(readFileSync(path));
  let actual: { view?: unknown; layout?: Page[]; error?: string };
  try {
    actual = { view: await parseMarkedView(bytes), layout: await readLayout(bytes) };
  } catch (err) {
    actual = { error: (err as Error).message };
  }
  let ok: boolean;
  let note = "";
  if ("error" in expected) {
    // Both must fail clearly; the exception's name comes from each library.
    ok = typeof actual.error === "string" && actual.error.startsWith("the marked view could not be read (");
    note = ok ? `both fail: python "${expected.error}" / ts "${actual.error}"` : `ts: ${JSON.stringify(actual).slice(0, 200)}`;
  } else {
    explainedLines = [];
    cmykLines = 0;
    const diff = actual.error ? `\n  ts failed: ${actual.error}` : layoutDiff(expected.layout, actual.layout!, CMYK_CASES.has(name));
    ok = !actual.error && isDeepStrictEqual(actual.view, expected.view) && diff === "";
    if (!ok) {
      if (!isDeepStrictEqual(actual.view, expected.view)) note += `\n  view differs\n  python: ${JSON.stringify(expected.view)}\n  ts:     ${JSON.stringify(actual.view)}`;
      note += diff;
    } else {
      const lines = expected.layout.reduce((n: number, p: Page) => n + p.lines.length, 0);
      note = `match (${expected.layout.length} pages, ${lines} text lines, ${expected.view.warnings.length} warnings)`;
      if (cmykLines) note += `; ${cmykLines} CMYK lines differ only in darkness value (pdf.js's conversion curve)`;
      if (explainedLines.length) note += `, except ${explainedLines.length} lines where pdfminer couldn't decode a glyph and pdf.js could: ${[...new Set(explainedLines)].join("; ")}`;
    }
  }
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${note}`);
}
process.exit(failures ? 1 : 0);
