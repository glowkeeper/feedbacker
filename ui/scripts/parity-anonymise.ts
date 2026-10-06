/**
 * Parity with the Python reference: anonymisation must redact the same
 * spans with the same tokens as `core/`. Three checks:
 *
 * 1. Python's case and character rules (pyre.ts, pycase.ts) for every code
 *    point: simple lowercase, "is cased", casefold, `\w`, `\d`, `isalpha()`
 *    and `isupper()`; and that the generated table is up to date.
 * 2. IGNORECASE: for every cased character, the characters a pattern of it
 *    matches, as Python's `re` finds them.
 * 3. Redaction: random texts, keys and rules (names in any case and order,
 *    Unicode letters and digits, emails, URLs, phones, IDs, emoji), run
 *    through Python's `detect` and `apply` and through this core's, and the
 *    redacted text, redactions (code-point offsets) and tokens compared.
 *
 *   node scripts/parity-anonymise.ts      (needs uv and the core environment)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { AnonymisationRules, apply, detect, PseudonymKey } from "../src/core/index.ts";
import { D, pyCasefold, pyIgnoreCase, pyIsAlpha, pyIsCased, pyIsUpper, pyLower, W } from "../src/core/pyre.ts";
import { pythonCaseData, render } from "./generate-pycase.ts";

const python = (code: string, input = "") =>
  execFileSync("uv", ["run", "--quiet", "--project", "../core", "python", "-c", code], { input, encoding: "utf8", maxBuffer: 1 << 30 });

let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${!ok && detail ? `\n    ${detail}` : ""}`);
};

// --- 1. Every code point ------------------------------------------------------------------

const data = pythonCaseData();
// The table records where Python's rules differ from the JavaScript engine's, so it is regenerated exactly only by a
// Node with the Unicode version it was made against. On another, the checks below still compare behaviour, every code
// point, which is what matters (and check:browser compares Chrome's).
const pycase = readFileSync(new URL("../src/core/pycase.ts", import.meta.url), "utf8");
const madeWith = /against Node's Unicode (\S+)/.exec(pycase)?.[1];
if (madeWith === process.versions.unicode) check("pycase.ts is up to date with Python", pycase === render(data));
else console.log(`NOTE pycase.ts was made against Node's Unicode ${madeWith ?? "(unknown)"}; this Node has ${process.versions.unicode}, so its text isn't compared here: its behaviour is, below`);
const classes = JSON.parse(
  python(`
import json
cps = [c for c in range(0x110000) if not 0xD800 <= c <= 0xDFFF]
print(json.dumps({k: "".join("1" if f(chr(c)) else "0" for c in cps) for k, f in
    {"word": lambda ch: ch.isalnum() or ch == "_", "decimal": str.isdecimal, "alpha": str.isalpha, "upper": str.isupper}.items()}))
`),
);
const bad: Record<string, string[]> = { lower: [], cased: [], fold: [], word: [], decimal: [], alpha: [], upper: [] };
const WORD = new RegExp(`^[${W}]$`, "u");
const DIGIT = new RegExp(`^[${D}]$`, "u");
let i = 0;
for (let c = 0; c < 0x110000; c++) {
  if (c >= 0xd800 && c <= 0xdfff) continue;
  const ch = String.fromCodePoint(c);
  const note = (k: string) => bad[k].length < 5 && bad[k].push(`U+${c.toString(16).toUpperCase()}`);
  if (pyLower(c) !== data.lower[i]) note("lower");
  if (pyIsCased(c) !== (data.cased[i] === 1)) note("cased");
  if (pyCasefold(ch) !== data.fold[i]) note("fold");
  if (WORD.test(ch) !== (classes.word[i] === "1")) note("word");
  if (DIGIT.test(ch) !== (classes.decimal[i] === "1")) note("decimal");
  if (pyIsAlpha(c) !== (classes.alpha[i] === "1")) note("alpha");
  if (pyIsUpper(c) !== (classes.upper[i] === "1")) note("upper");
  if (c >= 0x20000 && data.lower[i] !== c) note("lower");
  i++;
}
for (const [k, what] of [
  ["lower", "simple lowercase (_sre.unicode_tolower)"],
  ["cased", "is cased (_sre.unicode_iscased)"],
  ["fold", "str.casefold()"],
  ["word", "\\w (str.isalnum() or _)"],
  ["decimal", "\\d (str.isdecimal())"],
  ["alpha", "str.isalpha()"],
  ["upper", "str.isupper() for one character"],
] as const) {
  check(`${what} matches Python for all ${i} code points`, bad[k].length === 0, bad[k].join(" "));
}

// --- 2. IGNORECASE, character by character ------------------------------------------------

const candidates: number[] = [];
for (let c = 0; c < 0x20000; c++) if (!(c >= 0xd800 && c <= 0xdfff) && (pyIsCased(c) || pyLower(c) !== c)) candidates.push(c);
for (const extra of data.extra) candidates.push(extra[0], ...extra[1]);
const unique = [...new Set(candidates)].sort((a, b) => a - b);
const pyMatches: number[][] = JSON.parse(
  python(
    `
import json, re, sys
cands = json.loads(sys.stdin.read())
text = "".join(chr(c) for c in cands)
print(json.dumps([[cands[m.start()] for m in re.finditer(re.escape(chr(c)), text, re.IGNORECASE)] for c in cands]))
`,
    JSON.stringify(unique),
  ),
);
const all = unique.map((c) => String.fromCodePoint(c)).join("");
const ciBad: string[] = [];
unique.forEach((c, k) => {
  const ours = [...all.matchAll(new RegExp(pyIgnoreCase(String.fromCodePoint(c)), "gu"))].map((m) => m[0].codePointAt(0)!);
  if (!isDeepStrictEqual(ours, pyMatches[k]) && ciBad.length < 5) ciBad.push(`U+${c.toString(16)}: ${ours.map((x) => x.toString(16))} != ${pyMatches[k].map((x) => x.toString(16))}`);
});
check(`IGNORECASE matches the same characters as Python's re for ${unique.length} cased characters`, ciBad.length === 0, ciBad.join("\n    "));

// --- 3. Redaction ---------------------------------------------------------------------------

let seed = 50;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
const names = ["Avery Quill", "QUILL AVERY", "Jo Li", "İlkay Şahin", "ılkay", "Straße", "Zoë O'Neil", "Bo", "Ωmega Øst", "ǅemal", "Sam", "Li"];
const orgs = ["Northwind Widgets Ltd", "Fabrikam Games", "Quill Studios", "STRASSE GMBH", "Contoso"];
const pieces = [
  ...names, ...names.map((n) => n.toUpperCase()), ...names.map((n) => n.toLowerCase()), ...orgs, "Straße GmbH",
  "avery.quill@example.com", "Zoë@exämple.co.uk.", "https://example.org/x.", "WWW.Example.org/p?q=1", "httpſ://x.org",
  "07700 900123", "+44 7700 900124", "+44 (0)20 7946 0123", "020-7946-0123", "٠٧٧٠٠٩٠٠١٢٣", "S0000101", "ab1234567", "100200301", "100200301-x",
  "the", "a", ",", ".", " ", "  ", "\n", "\t", "🙂", "𝐀𝐯𝐞𝐫𝐲", "Quill,", "Avery,", "quill", "ſam", "SAM", "Jo-Jo", "jo", "20260115", "MoSCoW",
];
interface Case { text: string; names: string[][]; external: string[]; rules: Record<string, unknown> }
const cases: Case[] = [];
for (let k = 0; k < 1500; k++) {
  const entries = Array.from({ length: 1 + Math.floor(random() * 3) }, () => Array.from({ length: Math.floor(random() * 2) + 1 }, () => pick(names)));
  cases.push({
    text: Array.from({ length: 4 + Math.floor(random() * 20) }, () => pick(pieces)).join(pick([" ", " ", "", ", ", "\n"])),
    names: entries,
    external: entries.map((_, j) => pick(["100200301", "100200302", "S0000101", `x${j}`])),
    rules: {
      names: random() < 0.5 ? [pick(names)] : [],
      organisations: random() < 0.6 ? [pick(orgs), pick(orgs)] : [],
      redact: random() < 0.4 ? { [pick(["MoSCoW", "aquill99", "20260115", "ß"])]: pick(["REDACTED", "USERNAME"]) } : {},
      ignore: random() < 0.3 ? [pick(["20260115", "Sam", "S0000101", "straße"])] : [],
    },
  });
}
const keyFor = (c: Case) => ({
  entries: c.names.map((n, j) => ({ submission_id: `sub-${String(j + 1).padStart(3, "0")}`, pseudonym: `[STUDENT_${"ABC"[j]}]`, external_id: c.external[j], names: n })),
  tokens: [],
});
const fromPython = JSON.parse(
  python(
    `
import json, sys
from feedbacker_core.anonymise import AnonymisationRules, apply, detect
from feedbacker_core.workspace import PseudonymKey
out = []
for c in json.loads(sys.stdin.read()):
    key = PseudonymKey.model_validate(c["key"])
    text, redactions = apply(c["text"], detect(c["text"], key, AnonymisationRules.model_validate(c["rules"])), key)
    out.append({"text": text, "redactions": [r.model_dump() for r in redactions], "tokens": [t.model_dump() for t in key.tokens]})
print(json.dumps(out))
`,
    JSON.stringify(cases.map((c) => ({ text: c.text, key: keyFor(c), rules: c.rules }))),
  ),
);
const redactionBad: string[] = [];
cases.forEach((c, k) => {
  const key = PseudonymKey.parse(keyFor(c));
  const [text, redactions] = apply(c.text, detect(c.text, key, AnonymisationRules.parse(c.rules)), key);
  const ours = { text, redactions, tokens: key.tokens };
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(ours)), fromPython[k]) && redactionBad.length < 3) {
    redactionBad.push(`${JSON.stringify(c.text)}\n      ours:   ${JSON.stringify(ours).slice(0, 400)}\n      python: ${JSON.stringify(fromPython[k]).slice(0, 400)}`);
  }
});
const redacted = fromPython.reduce((n: number, r: { redactions: unknown[] }) => n + r.redactions.length, 0);
check(`redaction matches Python on ${cases.length} random texts (${redacted} redactions): text, offsets and tokens`, redactionBad.length === 0, redactionBad.join("\n    "));

console.log(`${failures ? "FAIL" : "PASS"}: anonymisation compared with Python`);
process.exit(failures ? 1 : 0);
