/** A re-identified copy of the summary (#20): Turnitin IDs only, on explicit request, labelled, both formats. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { approveRecord, exportReidentifiedSummary, extract, recordVerdict, RecordNotReady, REIDENTIFIED_NOTICE, type Rubric, type Workspace } from "../src/core/index.ts";
import { at, reviewBoth, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let path: string;
let rubric: Rubric;

beforeEach(async () => {
  ({ ws, path, rubric } = await setUpModeration("mod-reid"));
  await reviewBoth(ws, rubric);
  await approveRecord(ws, { overallComment: "Consistent marking.", now: at(20) });
});

test("it is made only when the moderator confirms it", async () => {
  await expect(exportReidentifiedSummary(ws, { confirmed: false })).rejects.toThrow("only when you confirm it");
  expect(await ws.exists("exports")).toBe(false); // nothing was written
});

test("it restores the students' Turnitin IDs, and nothing else: no names, no other redacted value", async () => {
  const { paths } = await exportReidentifiedSummary(ws, { confirmed: true, now: at(25) });
  expect(paths).toEqual(["exports/mod-reid-summary-reidentified.feedbacker-export.md", "exports/mod-reid-summary-reidentified.feedbacker-export.docx"]);
  const md = readFileSync(join(path, paths[0]), "utf8");
  expect(md.startsWith("# Moderation summary: Fictional 101 (re-identified)\n\n" + REIDENTIFIED_NOTICE + "\n\n")).toBe(true);
  expect(md).toContain("### sub-001 100200301");
  expect(md).toContain("- 100200301 (sub-001): Generous; suggested mark 58");
  expect(md).toContain("- 100200302 (sub-002): Agree");
  expect(md).toContain("Students appear by their external identifier (e.g. Turnitin submission ID), restored from the pseudonym key; nothing else is re-identified.");
  expect(md).not.toMatch(/\[STUDENT_[AB]\]/); // every student pseudonym, including in the marker's comments
  expect(md).not.toMatch(/\b(QUILL|AVERY|PIKE|JORDAN|Morgan Ellis)\b/i); // no names
  expect(md).toContain("[EMAIL_2]"); // other redacted values stay as their tokens
  // The Word copy says the same.
  const docx = await extract("summary.docx", new Uint8Array(readFileSync(join(path, paths[1]))));
  expect(docx.text).toContain(REIDENTIFIED_NOTICE);
  expect(docx.text).toContain("sub-001 100200301");
  expect(docx.text).not.toMatch(/\[STUDENT_[AB]\]|\b(QUILL|AVERY|PIKE|JORDAN)\b/i);
});

test("the pseudonymous exports are unaffected, and the re-identified copy needs a current approval", async () => {
  await exportReidentifiedSummary(ws, { confirmed: true });
  expect(readdirSync(join(path, "exports")).sort()).toEqual(["mod-reid-summary-reidentified.feedbacker-export.docx", "mod-reid-summary-reidentified.feedbacker-export.md"]);
  await recordVerdict(ws, "sub-002", { verdict: "harsh" });
  await expect(exportReidentifiedSummary(ws, { confirmed: true })).rejects.toThrow(RecordNotReady);
});

test("a failure part-way leaves no copy behind", async () => {
  const write = ws.writeExport.bind(ws);
  ws.writeExport = async (n, e, c) => (e === "docx" ? Promise.reject(new Error("the disk is full")) : write(n, e, c));
  await expect(exportReidentifiedSummary(ws, { confirmed: true })).rejects.toThrow("the disk is full");
  expect(await ws.exists("exports/mod-reid-summary-reidentified.feedbacker-export.md")).toBe(false);
  ws.writeExport = write;
  const secure = ws.secure.bind(ws);
  ws.secure = () => Promise.reject(new Error("permissions can't be confirmed"));
  await expect(exportReidentifiedSummary(ws, { confirmed: true })).rejects.toThrow("permissions can't be confirmed");
  expect(await ws.exists("exports/mod-reid-summary-reidentified.feedbacker-export.md")).toBe(false);
  expect(await ws.exists("exports/mod-reid-summary-reidentified.feedbacker-export.docx")).toBe(false);
  ws.secure = secure;
});

test("a missing or empty identifier in the key is an error, never an empty replacement", async () => {
  const key = await ws.readKey();
  await ws.writeKey({ ...key, entries: key.entries.map((e) => (e.submission_id === "sub-002" ? { ...e, external_id: "  " } : e)) });
  await expect(exportReidentifiedSummary(ws, { confirmed: true })).rejects.toThrow("the pseudonym key has no identifier for sub-002 [STUDENT_B]");
  expect(await ws.exists("exports")).toBe(false);
});
