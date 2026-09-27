/** The app's anonymisation step (#19): the rules form, and what is reviewed. */

import { expect, test } from "vitest";
import { parseRedactions, recordsToReview, reviewOf } from "../src/app/anonymisation.ts";
import { anonymiseWorkspace, approve, bytesSource, importBrief, importOriginals, recordRequest, updateRules } from "../src/core/index.ts";
import { makeZip, packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

test("extra values read as the command line reads them", () => {
  expect(parseRedactions("aquill99=USERNAME\nMoSCoW\nx=lowercase\na=b=CODE\nÉCOLE=ÉÉ")).toEqual({
    aquill99: "USERNAME",
    MoSCoW: "REDACTED",
    "x=lowercase": "REDACTED",
    "a=b": "CODE",
    ÉCOLE: "ÉÉ", // Python's isupper() and isalpha() accept it (the core then checks the kind)
  });
});

test("each record is listed with its status, and reviewed without real values unless asked", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200301" }]);
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx") })));
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  expect(await recordsToReview(ws)).toEqual([
    { id: "sub-001", label: "sub-001 [STUDENT_A]", anonymised: false, approved: false },
    { id: "brief", label: "The brief", anonymised: false, approved: false },
  ]);
  expect(await reviewOf(ws, "sub-001", false)).toBeNull();
  await updateRules(ws, { names: ["Morgan Ellis"] });
  await anonymiseWorkspace(ws);
  await approve(ws, "brief");
  const hidden = (await reviewOf(ws, "sub-001", false))!;
  expect(hidden.text).toContain("[STUDENT_A]");
  expect(hidden.text).not.toContain("Quill");
  expect(hidden.replacements.every((r) => r.original === null)).toBe(true);
  expect(JSON.stringify(hidden)).not.toContain("Quill");
  const shown = (await reviewOf(ws, "sub-001", true))!;
  expect(shown.replacements.some((r) => r.replacement === "[STUDENT_A]" && /quill|avery/i.test(r.original!))).toBe(true);
  expect((await reviewOf(ws, "brief", false))!.approvedAt).not.toBeNull();
  expect((await recordsToReview(ws)).map((r) => [r.id, r.anonymised, r.approved])).toEqual([["sub-001", true, false], ["brief", true, true]]);
});
