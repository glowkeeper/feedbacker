/**
 * The rubric scenario for the browser check (#49), shared by the page (run
 * in Chrome) and the runner (run in Node), so both compute exactly the same
 * things: each synthetic rubric imported (grids previewed), and its result or
 * problems.
 */

import { importRubric, RubricError, type ByteSource, type Workspace } from "../src/core/index.ts";

export const RUBRIC_FILES = ["rubric.csv", "rubric.json", "rubric-grid.xlsx", "rubric-grid.docx"];
const NOW = new Date("2026-01-15T09:00:00Z");

/** A workspace with no rubric yet that discards writes: only parsing is compared. */
const scratch = {
  exists: async () => false,
  writeJson: async () => {},
  fs: { readText: async () => null, writeText: async () => {}, remove: async () => {} },
} as unknown as Workspace;

export async function runRubricImports(load: (name: string) => Promise<ByteSource>): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const name of RUBRIC_FILES) {
    try {
      results[name] = JSON.parse(JSON.stringify(await importRubric(scratch, await load(name), { now: NOW })));
    } catch (err) {
      results[name] = { error: err instanceof RubricError ? err.problems : String(err) };
    }
  }
  return results;
}
