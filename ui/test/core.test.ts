/** The core stays free of UI, DOM and Node dependencies (ADR 0004), so it runs in the browser. */

import { readdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { init, parse } from "es-module-lexer";
import { expect, test } from "vitest";

const CORE = new URL("../src/core/", import.meta.url);
// pdf.js (through the #pdfjs import map), fflate for zips and saxes for XML
// run in browsers and in Node alike.
const ALLOWED = [/^\.\.?\//, /^zod$/, /^@noble\/hashes\//, /^#pdfjs$/, /^fflate$/, /^saxes$/];
/**
 * Every module a source reaches: static and side-effect imports, re-exports
 * and dynamic import(), found by a spec-compliant module lexer (so comments,
 * strings and templates can't hide or fake one), after Node strips the
 * TypeScript syntax; and any use of require(). A dynamic import of a
 * computed name is reported as "<computed>", which is never allowed.
 */
await init;
function specifiers(source: string): string[] {
  const js = stripTypeScriptTypes(source);
  const [imports] = parse(js);
  const found = imports.filter((i) => i.d !== -2).map((i) => i.n ?? "<computed>"); // -2 is import.meta
  if (/\brequire\s*\(/.test(js)) found.push("<require>");
  return found;
}

const sources = () =>
  (readdirSync(CORE, { recursive: true }) as string[])
    .filter((f) => /\.[cm]?[jt]s$/.test(f))
    .map((f) => [f, readFileSync(new URL(f, CORE), "utf8")] as const);

test("core modules import only each other and their browser-safe libraries", () => {
  const seen: string[] = [];
  for (const [file, source] of sources()) {
    for (const spec of specifiers(source)) {
      seen.push(spec);
      expect(ALLOWED.some((a) => a.test(spec)), `${file} imports ${spec}`).toBe(true);
    }
    expect(source, `${file} uses the DOM`).not.toMatch(/\b(document|window|navigator)\./);
    expect(source, `${file} uses Node globals`).not.toMatch(/\b(process|Buffer|__dirname)\b/);
  }
  // The guard really sees the core's imports, including index.ts's re-exports.
  expect(seen).toEqual(expect.arrayContaining(["zod", "./models.ts", "./contract.ts"]));
});

test("the guard catches every form of import", () => {
  const forms = [
    'import x from "node:fs";',
    'import "node:fs";',
    'export * from "node:fs";',
    'export { readFile } from "node:fs";',
    'const fs = await import("node:fs");',
    'import {\n  readFile,\n  writeFile,\n} from "node:fs";',
    '/* a comment */ import fs from "node:fs";',
    'import type { Stats } from "node:fs"; import { readFile } from "node:fs";',
  ];
  for (const form of forms) expect(specifiers(form).filter((s) => s === "node:fs").length, form).toBeGreaterThan(0);
  expect(specifiers('const fs = require("node:fs");')).toEqual(["<require>"]);
  expect(specifiers("const name = 'node:fs'; await import(name);")).toEqual(["<computed>"]);
  // Words in messages, comments and templates are not imports.
  for (const text of [
    `throw new Error("import the source rubric first ('rubric import')");`,
    '// import fs from "node:fs"',
    "const t = `import fs from \"node:fs\"`;",
  ]) {
    expect(specifiers(text), text).toEqual([]);
  }
});
