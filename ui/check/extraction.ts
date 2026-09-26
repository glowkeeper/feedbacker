/**
 * The extraction scenario for the browser check (#47), shared by the page (run
 * in Chrome) and the runner (run in Node), so both compute exactly the same
 * things: extraction and inspection of each synthetic file, and sample
 * selection from a bulk zip, reading only the selected member.
 */

import { extract, inspectFile, selectMembers, sha256Bytes, type ByteSource } from "../src/core/index.ts";

export const PACK_FILES = [
  "submissions/sub-a.docx",
  "submissions/sub-b.pdf",
  "submissions/sub-c.docx",
  "submissions/sub-d.pdf",
  "marked-view-replica.pdf",
  "brief.docx",
  "rubric-grid.docx",
];
export const ZIP = "sample.zip";
export const SAMPLED = ["100200301", "100200303", "100200309"];
const NOW = new Date("2026-01-15T09:00:00Z");

export interface Loaded {
  bytes: Uint8Array;
  source: ByteSource;
}

const attempt = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (err) {
    return { error: (err as Error).message };
  }
};

export async function runExtraction(load: (name: string) => Promise<Loaded>): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const name of PACK_FILES) {
    const { bytes } = await load(name);
    const fileName = name.split("/").at(-1)!;
    results[name] = {
      extract: await attempt(() => extract(fileName, bytes, NOW)),
      inspect: await attempt(() => inspectFile(fileName, bytes)),
    };
  }
  const { source } = await load(ZIP);
  const selection = await selectMembers(source, SAMPLED);
  const read: Record<string, string> = {};
  for (const [id, member] of selection.matched) read[id] = sha256Bytes(await member.read());
  results[ZIP] = {
    matched: Object.fromEntries([...selection.matched].map(([id, m]) => [id, m.name])),
    problems: selection.problems((id) => `[${id}]`, [source]),
    ignored: selection.ignoredCount,
    read,
  };
  return results;
}
