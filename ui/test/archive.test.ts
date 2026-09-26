/**
 * Sampled members are selected by identifier tokens; nothing else is opened.
 * A port of `core/tests/test_archive.py`. Its "missing single file source"
 * test has no counterpart: in the browser a source is a file the moderator has
 * already chosen, so it can't be missing.
 */

import { expect, test } from "vitest";
import { ArchiveError, bytesSource, listZip, selectMembers, type ByteSource } from "../src/core/index.ts";
import { makeZip } from "./builders.ts";

const zip = (name: string, members: Record<string, string>) => bytesSource(name, makeZip(members));

test("matches whole tokens only", async () => {
  const z = zip("a.zip", {
    "Quill_Avery_100200301_attempt.docx": "",
    "Pike_Jordan_1002003011_attempt.docx": "", // longer number: not a match
    "folder/Marsh_Riley_100200303.pdf": "",
    "__MACOSX/._Marsh_Riley_100200303.pdf": "", // macOS noise: ignored
  });
  const sel = await selectMembers(z, ["100200301", "100200303"]);
  expect(Object.fromEntries([...sel.matched].map(([id, m]) => [id, m.name]))).toEqual({
    "100200301": "Quill_Avery_100200301_attempt.docx",
    "100200303": "folder/Marsh_Riley_100200303.pdf",
  });
  expect(sel.problems()).toEqual([]);
  expect(sel.ignoredCount).toBe(1);
});

test("unmatched and ambiguous identifiers are problems", async () => {
  const z = zip("a.zip", { "a_100200301_v1.docx": "", "a_100200301_v2.docx": "" });
  const sel = await selectMembers(z, ["100200301", "100200309"]);
  const problems = sel.problems(() => "[STUDENT_X]", [z]);
  expect(problems).toContain("no file found for [STUDENT_X]");
  expect(problems).toContain(
    "[STUDENT_X] matches 2 files: source 1 (a_999999999_a9.docx), source 1 (a_999999999_a9.docx); resolve before importing",
  );
});

test("not a zip", async () => {
  await expect(selectMembers(bytesSource("a.zip", new TextEncoder().encode("nope")), ["1"])).rejects.toThrow(
    new ArchiveError("not a readable zip archive (a.zip): ZipError"),
  );
});

test("the Turnitin bulk naming pattern", async () => {
  // The naming pattern observed in real Turnitin bulk zips, with fictional values.
  const z = zip("123_1.zip", {
    "100200301 - QUILL AVERY . - Indv_Report_Plant_Swap_1234567_100200301.docx.pdf": "",
    "100200302 - PIKE JORDAN - Assessment_1_2345678_1002003020.docx.pdf": "",
    "download_report.txt": "",
  });
  const sel = await selectMembers(z, ["100200301", "100200302"]);
  expect(sel.problems()).toEqual([]);
  expect(sel.matched.get("100200301")!.name.startsWith("100200301 - QUILL")).toBe(true);
  expect(sel.matched.get("100200302")!.name.startsWith("100200302 - PIKE")).toBe(true);
  expect(sel.ignoredCount).toBe(1);
});

test("a sample spread across zips and single files", async () => {
  const main = zip("main_1.zip", { "100200301 - QUILL AVERY - report.docx": "a", "100200399 - OTHER STUDENT - report.docx": "x" });
  const late = zip("late.zip", { "100200302 - PIKE JORDAN - report.pdf": "b" });
  const single = bytesSource("100200303 - MARSH RILEY - report.docx", new TextEncoder().encode("c"));
  const sel = await selectMembers([main, late, single], ["100200301", "100200302", "100200303"]);
  expect(sel.problems()).toEqual([]);
  expect(sel.matched.get("100200302")!.source).toBe(late);
  const lone = sel.matched.get("100200303")!;
  expect(lone.source).toBe(single);
  expect(lone.isArchive).toBe(false);
  expect(new TextDecoder().decode(await lone.read())).toBe("c");
  expect(new TextDecoder().decode(await sel.matched.get("100200301")!.read())).toBe("a");
  expect(sel.ignoredCount).toBe(1);
});

test("the same identifier in two sources is ambiguous", async () => {
  const a = zip("a.zip", { "100200301 - X - v1.docx": "" });
  const b = zip("b.zip", { "100200301 - X - resubmitted.docx": "" });
  const [problem] = (await selectMembers([a, b], ["100200301"])).problems(undefined, [a, b]);
  expect(problem).toContain("source 1 (999999999 - A - a9.docx), source 2 (999999999 - A - aaaaaaaaaaa.docx)");
  expect(problem).not.toContain("resubmitted");
  expect(problem).not.toContain("a.zip");
});

test("problem messages never contain real names", async () => {
  const a = zip("Quill Avery.zip", { "100200301 - QUILL AVERY - v1.docx": "" });
  const b = zip("late.zip", { "100200301 - QUILL AVERY - v2.docx": "" });
  const text = (await selectMembers([a, b], ["100200301"])).problems(() => "[STUDENT_A]", [a, b]).join(" ");
  for (const secret of ["QUILL", "Quill", "100200301"]) expect(text).not.toContain(secret);
});

// --- Beyond the Python tests: what "never opened" means here ---------------------------

test("listing and selecting read only the archive's directory; only the selected member is read", async () => {
  const bytes = makeZip({ "100200301 - A - x.docx": "x".repeat(50_000), "100200399 - OTHER - y.docx": "y".repeat(50_000) });
  const reads: [number, number][] = [];
  const source: ByteSource = {
    name: "big.zip",
    size: bytes.length,
    read: async (offset, length) => (reads.push([offset, length]), bytes.subarray(offset, offset + length)),
  };
  const sel = await selectMembers(source, ["100200301"]);
  const listed = reads.reduce((n, [, l]) => n + l, 0);
  expect(listed).toBeLessThan(1_000); // the tail and central directory, nothing of either member
  const member = sel.matched.get("100200301")!;
  const entries = await listZip(bytesSource("big.zip", bytes));
  const other = entries.find((e) => e.name.includes("100200399"))!;
  reads.length = 0;
  await member.read();
  // Nothing from the other member's bytes was read.
  const otherEnd = other.localHeaderOffset + 30 + other.name.length + other.compressedSize;
  expect(reads.every(([offset, length]) => offset + length <= other.localHeaderOffset || offset >= otherEnd)).toBe(true);
});

test("a corrupted member fails its integrity check", async () => {
  const bytes = makeZip({ "100200301.docx": "the original content, long enough to compress" });
  const entry = (await listZip(bytesSource("a.zip", bytes)))[0];
  const damaged = bytes.slice();
  damaged[entry.localHeaderOffset + 30 + entry.name.length + 2] ^= 0xff;
  const sel = await selectMembers(bytesSource("a.zip", damaged), ["100200301"]);
  await expect(sel.matched.get("100200301")!.read()).rejects.toThrow(/integrity check|could not be decompressed/);
});
