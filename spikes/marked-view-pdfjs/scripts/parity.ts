/**
 * Parity check (#41): run the Python parser (the reference) and the TypeScript
 * port on the same synthetic PDFs and compare their full outputs, plus each
 * page's image classification and text lines. Exits non-zero on any difference.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseMarkedView, readLayout } from "../src/markedView.ts";

const python = (script: string, ...args: string[]) =>
  execFileSync("uv", ["run", "--quiet", "--project", "../../core", "python", `scripts/${script}`, ...args], {
    encoding: "utf8",
  });

const dir = mkdtempSync(join(tmpdir(), "marked-view-parity-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const cases = python("make_cases.py", dir)
  .trim()
  .split("\n")
  .map((row) => row.split("\t") as [string, string]);
// A harder case: the same layout printed to PDF by Chrome (see make_browser_case.ts).
const printed = join(dir, "chrome-printed.pdf");
execFileSync("node", ["scripts/make_browser_case.ts", printed]);
cases.push(["chrome-printed", printed]);
const reference = JSON.parse(python("dump_marked_view.py", ...cases.map(([, p]) => p)));

type Page = { image: boolean; chars: number; lines: [string, number][] };

/**
 * The one explained difference: where pdfminer cannot map a glyph to Unicode
 * it writes "(cid:N)", and pdf.js decodes it (e.g. the replica's bullets).
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
 * Python with the plain formula, so line darkness differs in value (never in
 * which level is selected, which the view comparison checks).
 */
const CMYK_CASES = new Set(["cmyk"]);

function layoutDiff(expected: Page[], actual: Page[], cmyk = false): string {
  let out = expected.length === actual.length ? "" : `\n  page count ${expected.length} vs ${actual.length}`;
  expected.forEach((p, i) => {
    const q = actual[i];
    if (!q) return;
    if (p.image !== q.image || p.chars !== q.chars) {
      out += `\n  page ${i + 1}: image ${p.image}/${q.image}, chars ${p.chars}/${q.chars}`;
    }
    const n = Math.max(p.lines.length, q.lines.length);
    for (let j = 0; j < n; j++) {
      const [pl, ql] = [p.lines[j], q.lines[j]];
      if (cmyk && pl && ql && pl[1] !== ql[1]) {
        cmykLines++;
        if (pl[0] === ql[0] || explained([pl[0], 0], [ql[0], 0])) continue;
      }
      if (explained(p.lines[j], q.lines[j])) {
        explainedLines.push(`${JSON.stringify(p.lines[j][0])} -> ${JSON.stringify(q.lines[j][0])}`);
      } else if (!isDeepStrictEqual(p.lines[j], q.lines[j])) {
        out += `\n  page ${i + 1} line ${j + 1}\n    python: ${JSON.stringify(p.lines[j])}\n    ts:     ${JSON.stringify(q.lines[j])}`;
      }
    }
  });
  return out;
}

let explainedLines: string[] = [];
let cmykLines = 0;
let failures = 0;
for (const [name, path] of cases) {
  const expected = reference[path];
  const data = new Uint8Array(readFileSync(path));
  let actual: unknown;
  try {
    actual = { view: await parseMarkedView(data), layout: await readLayout(data) };
  } catch (err) {
    actual = { error: (err as Error).message };
  }
  let ok: boolean;
  let note = "";
  if ("error" in expected) {
    // Both must fail clearly; the exception names differ between libraries.
    ok = typeof (actual as { error?: string }).error === "string";
    note = ok ? `both fail: python "${expected.error}" / ts "${(actual as { error: string }).error}"` : "";
  } else {
    const a = actual as typeof expected;
    explainedLines = [];
    cmykLines = 0;
    const diff = "error" in a ? "\n  ts failed: " + a.error : layoutDiff(expected.layout, a.layout, CMYK_CASES.has(name));
    ok = !("error" in a) && isDeepStrictEqual(a.view, expected.view) && diff === "";
    if (!ok) {
      if (!isDeepStrictEqual(a.view, expected.view)) {
        note += `\n  view differs\n  python: ${JSON.stringify(expected.view)}\n  ts:     ${JSON.stringify(a.view)}`;
      }
      note += diff;
    } else {
      const lines = expected.layout.reduce((n: number, p: { lines: unknown[] }) => n + p.lines.length, 0);
      note = `match (${expected.layout.length} pages, ${lines} text lines, ${expected.view.warnings.length} warnings)`;
      if (cmykLines) note += `; ${cmykLines} CMYK lines differ only in darkness value (pdf.js's conversion curve)`;
      if (explainedLines.length) {
        const unique = [...new Set(explainedLines)];
        note += `, except ${explainedLines.length} lines where pdfminer could not decode a glyph and pdf.js could: ${unique.join("; ")}`;
      }
    }
  }
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${note}`);
}
process.exit(failures ? 1 : 0);
