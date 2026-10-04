/** The app's anonymisation step: the rules form, and what is reviewed. */

import { expect, test } from "vitest";
import { recordsToReview, redactionsFrom, REDACTION_KINDS, reviewOf } from "../src/app/anonymisation.ts";
import { anonymiseWorkspace, approve, bytesSource, importBrief, importOriginals, recordRequest, updateRules } from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

test("extra values are a row each, with a kind from the list; a row with no value is ignored", () => {
  expect(
    redactionsFrom([
      { text: " aquill99 ", kind: "USERNAME" },
      { text: "MoSCoW", kind: "REDACTED" },
      { text: "a=b", kind: "" },
      { text: "  ", kind: "PLACE" },
    ]),
  ).toEqual({ aquill99: "USERNAME", MoSCoW: "REDACTED", "a=b": "REDACTED" });
  // Every kind offered is one the core accepts.
  for (const { value } of REDACTION_KINDS) expect(value).toMatch(/^[A-Z]{2,12}$/);
});

test("each record is listed with its status, and reviewed without real values unless asked", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx") })));
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  expect(await recordsToReview(ws)).toEqual([
    { id: "sub-001", label: "sub-001 [STUDENT_A]", anonymised: false, approved: false, problem: null },
    { id: "brief", label: "The brief", anonymised: false, approved: false, problem: null },
  ]);
  await expect(reviewOf(ws, "sub-001", false)).rejects.toThrow("sub-001 has not been anonymised; anonymise it first");
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "brief");
  const hidden = await reviewOf(ws, "sub-001", false);
  expect(hidden.text).toContain("[STUDENT_A]");
  expect(hidden.text).not.toContain("Quill");
  expect(hidden.replacements.every((r) => r.original === null)).toBe(true);
  expect(JSON.stringify(hidden)).not.toContain("Quill");
  const shown = await reviewOf(ws, "sub-001", true);
  expect(shown.replacements.some((r) => r.replacement === "[STUDENT_A]" && /quill|avery/i.test(r.original!))).toBe(true);
  expect((await reviewOf(ws, "brief", false)).approvedAt).not.toBeNull();
  expect((await recordsToReview(ws)).map((r) => [r.id, r.anonymised, r.approved])).toEqual([["sub-001", true, false], ["brief", true, true]]);
});

test("damage is reported, never hidden: a bad request, and a record that doesn't load", async () => {
  const { ws, path } = await newWorkspace();
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx") })));
  writeFileSync(join(path, "sources", "originals", "sub-001.docx"), "tampered");
  const [row] = await recordsToReview(ws);
  expect([row.id, row.anonymised]).toEqual(["sub-001", false]);
  expect(row.problem).toContain("does not match the record");
  await expect(reviewOf(ws, "sub-001", false)).rejects.toThrow("does not match the record");
  writeFileSync(join(path, "request.json"), '{"not": "a request"}');
  await expect(recordsToReview(ws)).rejects.toThrow("request.json is not a valid moderation request");
});
