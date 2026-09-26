/** The core stays free of UI, DOM and Node dependencies (ADR 0004), so it runs in the browser. */

import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const CORE = new URL("../src/core/", import.meta.url);
const ALLOWED = [/^\.\.?\//, /^zod$/, /^@noble\/hashes\//];
// Every way a module can reach another: static and side-effect imports,
// re-exports, dynamic import(), and require().
const SPECIFIERS = /\b(?:from|import)\s*["']([^"']+)["']|\bimport\s*\(\s*["'`]([^"'`]+)["'`]|\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g;

const sources = () =>
  (readdirSync(CORE, { recursive: true }) as string[])
    .filter((f) => /\.[cm]?[jt]s$/.test(f))
    .map((f) => [f, readFileSync(new URL(f, CORE), "utf8")] as const);

test("core modules import only each other, zod and @noble/hashes", () => {
  const seen: string[] = [];
  for (const [file, source] of sources()) {
    for (const m of source.matchAll(SPECIFIERS)) {
      const spec = m[1] ?? m[2] ?? m[3];
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
    'const fs = require("node:fs");',
  ];
  for (const form of forms) expect([...form.matchAll(SPECIFIERS)].length, form).toBe(1);
});
