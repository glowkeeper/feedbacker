/** The core stays free of UI, DOM and Node dependencies (ADR 0004), so it runs in the browser. */

import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const CORE = new URL("../src/core/", import.meta.url);
const ALLOWED = [/^\.\//, /^zod$/, /^@noble\/hashes\//];

test("core modules import only each other, zod and @noble/hashes", () => {
  for (const file of readdirSync(CORE).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(new URL(file, CORE), "utf8");
    for (const [, spec] of source.matchAll(/^import[^"']*["']([^"']+)["']/gm)) {
      expect(ALLOWED.some((a) => a.test(spec)), `${file} imports ${spec}`).toBe(true);
    }
    expect(source, `${file} uses the DOM`).not.toMatch(/\b(document|window)\./);
  }
});
