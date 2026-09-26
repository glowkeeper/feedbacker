/**
 * Importing sampled originals from bulk downloads. A port of
 * `core/tests/test_originals.py`. Its command-line test checks the Python
 * command line's summary line; the counts behind it (imported, not opened)
 * are checked here instead.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  bytesSource,
  importOriginals,
  ImportProblem,
  loadSubmission,
  recordRequest,
  type ByteSource,
  type Workspace,
} from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const sub = (name: string) => packFile(`submissions/${name}`);
let ws: Workspace;
let path: string;

beforeEach(async () => {
  ({ ws, path } = await newWorkspace());
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
});

const bulkZip = (sampledB: Uint8Array = sub("sub-b.pdf")) =>
  bytesSource(
    "originals.zip",
    makeZip({
      "Quill_Avery_100200301_report.docx": sub("sub-a.docx"),
      "Pike_Jordan_100200302_report.pdf": sampledB,
      // Not sampled, and deliberately corrupt: importing must never open it.
      "Marsh_Riley_100200399_report.docx": "corrupt and never opened",
    }),
  );

const mode = (p: string) => statSync(p).mode & 0o777;

test("imports only the sampled files", async () => {
  const result = await importOriginals(ws, bulkZip());
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001", "sub-002"]);
  expect(result.failed.size).toBe(0);
  expect(result.ignoredCount).toBe(1);
  const s = await loadSubmission(ws, "sub-001");
  expect([s.source_kind, s.source_format]).toEqual(["original", "docx"]);
  expect(s.extract?.text).toContain("Plant Swap");
  expect(s.provenance.transformation).toBe("imported");
});

test("real file names go only into the key", async () => {
  await importOriginals(ws, bulkZip());
  const key = Object.fromEntries((await ws.readKey()).entries.map((e) => [e.pseudonym, e.source_files]));
  expect(key["[STUDENT_A]"]).toEqual({ original: "Quill_Avery_100200301_report.docx" });
  for (const f of readdirSync(join(path, "submissions"))) {
    const text = readFileSync(join(path, "submissions", f), "utf8");
    expect(text).not.toContain("Quill_Avery");
    expect(text).not.toContain("100200301");
  }
});

test("only the selected files are stored, privately", async () => {
  await importOriginals(ws, bulkZip());
  expect(mode(join(path, "sources", "originals", "sub-001.docx"))).toBe(0o600);
  expect(mode(join(path, "submissions", "sub-001.json"))).toBe(0o600);
  // The bulk download is never copied: other students' work stays out of the workspace.
  expect(readdirSync(join(path, "sources"), { recursive: true }).filter((f) => String(f).includes(".")).sort()).toEqual([
    "originals/sub-001.docx",
    "originals/sub-002.pdf",
  ]);
});

test("a sample across a main zip and a late single file", async () => {
  const main = bytesSource(
    "main_1.zip",
    makeZip({ "100200301 - QUILL AVERY - report.docx": sub("sub-a.docx"), "100200399 - OTHER STUDENT - report.docx": "never opened" }),
  );
  const late = bytesSource("100200302 - PIKE JORDAN - late report.pdf", sub("sub-b.pdf"));
  const result = await importOriginals(ws, [main, late]);
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001", "sub-002"]);
  expect((await loadSubmission(ws, "sub-002")).provenance.source.startsWith("file:sha256:")).toBe(true);
  expect((await loadSubmission(ws, "sub-001")).provenance.source.startsWith("archive:sha256:")).toBe(true);
  const key = Object.fromEntries((await ws.readKey()).entries.map((e) => [e.pseudonym, e.source_files.original]));
  expect(key["[STUDENT_B]"]).toBe("100200302 - PIKE JORDAN - late report.pdf");
});

test("an unsuitable file fails alone, and clearly", async () => {
  const result = await importOriginals(ws, bulkZip(packFile("marked-view-replica.pdf")));
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001"]);
  expect(result.failed.get("sub-002")).toContain("unsuitable for text extraction");
  expect(existsSync(join(path, "submissions", "sub-002.json"))).toBe(false);
  expect(existsSync(join(path, "sources", "originals", "sub-002.pdf"))).toBe(false);
});

test("a missing sampled file writes nothing", async () => {
  const z = bytesSource("o.zip", makeZip({ "Quill_Avery_100200301.docx": "x" }));
  const err = await importOriginals(ws, z).catch((e) => e);
  expect(err).toBeInstanceOf(ImportProblem);
  expect(err.message).toContain("no file found for [STUDENT_B] (sub-002)");
  expect(existsSync(join(path, "submissions"))).toBe(false);
  expect(existsSync(join(path, "sources"))).toBe(false);
});

test("an unsupported type is a problem", async () => {
  const z = bytesSource("o.zip", makeZip({ "a_100200301.docx": "x", "b_100200302.odt": "x" }));
  await expect(importOriginals(ws, z)).rejects.toThrow("Stage 0 imports typed docx and pdf only");
});

test("reimporting requires replace", async () => {
  await importOriginals(ws, bulkZip());
  await expect(importOriginals(ws, bulkZip())).rejects.toThrow("already imported");
  expect((await importOriginals(ws, bulkZip(), { replace: true })).imported).toHaveLength(2);
});

test("the result counts what was imported and what was never opened (as the command line reports)", async () => {
  const result = await importOriginals(ws, bulkZip());
  expect([result.imported.length, result.ignoredCount]).toEqual([2, 1]);
  JSON.parse(readFileSync(join(path, "submissions", "sub-002.json"), "utf8"));
});

// --- Unreadable members, failed replacement, damaged workspace ------------------------

test("an unreadable member is a failure of that submission only", async () => {
  const bytes = makeZip({ "Quill_Avery_100200301_report.docx": sub("sub-a.docx"), "Pike_Jordan_100200302_report.pdf": sub("sub-b.pdf") });
  // Corrupt the second member's data so its integrity check fails.
  const { listZip } = await import("../src/core/index.ts");
  const entry = (await listZip(bytesSource("o.zip", bytes))).find((e) => e.name.includes("100200302"))!;
  bytes[entry.localHeaderOffset + 30 + entry.name.length + 10] ^= 0xff;
  const result = await importOriginals(ws, bytesSource("o.zip", bytes));
  expect(result.imported.map((s) => s.id)).toEqual(["sub-001"]);
  expect(result.failed.get("sub-002")).toBe("the selected file could not be read (ZipError)");
});

test("a failed replacement keeps the previous pair intact", async () => {
  await importOriginals(ws, bulkZip());
  const before = await loadSubmission(ws, "sub-002");
  const result = await importOriginals(ws, bulkZip(packFile("marked-view-replica.pdf")), { replace: true });
  expect(result.failed.has("sub-002")).toBe(true);
  expect(await loadSubmission(ws, "sub-002")).toEqual(before); // still loads and still matches
  expect(existsSync(join(path, "sources", ".staging"))).toBe(false);
});

test("a replacement in a new format removes the old file", async () => {
  await importOriginals(ws, bulkZip());
  const z = bytesSource(
    "v2.zip",
    makeZip({ "Quill_Avery_100200301_report.docx": sub("sub-a.docx"), "Pike_Jordan_100200302_report.docx": sub("sub-c.docx") }),
  );
  await importOriginals(ws, z, { replace: true });
  expect(readdirSync(join(path, "sources", "originals")).sort()).toEqual(["sub-001.docx", "sub-002.docx"]);
  expect((await loadSubmission(ws, "sub-002")).source_format).toBe("docx");
});

test("loading detects a mismatched source", async () => {
  await importOriginals(ws, bulkZip());
  writeFileSync(join(path, "sources", "originals", "sub-001.docx"), "tampered");
  await expect(loadSubmission(ws, "sub-001")).rejects.toThrow("does not match the record");
});

// --- Beyond the Python tests ------------------------------------------------------

test("a large download is hashed in chunks, never read whole", async () => {
  const bytes = makeZip({ "Quill_Avery_100200301_report.docx": sub("sub-a.docx"), "Pike_Jordan_100200302_report.pdf": sub("sub-b.pdf") });
  let largest = 0;
  const source: ByteSource = {
    name: "big.zip",
    size: bytes.length,
    read: async (offset, length) => ((largest = Math.max(largest, length)), bytes.subarray(offset, offset + length)),
  };
  const { hashSource, sha256Bytes } = await import("../src/core/index.ts");
  expect(await hashSource(source, 1024)).toBe(sha256Bytes(bytes));
  expect(largest).toBeLessThanOrEqual(Math.max(1024, 70_000)); // chunks, and single members
});
