/** Every pseudonymous export at once: from one approved record, all or nothing. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { approveRecord, exportApproved, extract, ModerationRecord, type Rubric, type Workspace } from "../src/core/index.ts";
import { at, reviewBoth, setUpModeration } from "./moderation.ts";

let ws: Workspace;
let path: string;
let rubric: Rubric;
const NAMES = ["mod-all-record.feedbacker-export.json", "mod-all-summary.feedbacker-export.md", "mod-all-summary.feedbacker-export.docx"];

beforeEach(async () => {
  ({ ws, path, rubric } = await setUpModeration("mod-all"));
  await reviewBoth(ws, rubric);
  await approveRecord(ws, { overallComment: "One snapshot.", now: at(20) });
});

test("the three exports describe the same approved record", async () => {
  const { paths, record } = await exportApproved(ws);
  expect(paths).toEqual(NAMES.map((n) => `exports/${n}`));
  expect(ModerationRecord.parse(JSON.parse(readFileSync(join(path, paths[0]), "utf8")))).toEqual(record);
  expect(readFileSync(join(path, paths[1]), "utf8")).toContain(`Approved by the moderator on 2026-09-27 10:20 UTC.`);
  expect((await extract("s.docx", new Uint8Array(readFileSync(join(path, paths[2]))))).text).toContain("One snapshot.");
});

test.each([
  ["the Word write fails", "docx", "the disk is full"],
  ["the summary write fails", "md", "the disk is full"],
  ["the files can't be made private", "secure", "permissions can't be confirmed"],
])("if %s, none of the three is left behind", async (_, where, message) => {
  const write = ws.writeExport.bind(ws);
  const secure = ws.secure.bind(ws);
  if (where === "secure") ws.secure = () => Promise.reject(new Error(message));
  else ws.writeExport = async (n, e, c) => (e === where ? Promise.reject(new Error(message)) : write(n, e, c));
  await expect(exportApproved(ws)).rejects.toThrow(message);
  for (const n of NAMES) expect(await ws.exists(`exports/${n}`)).toBe(false);
  ws.writeExport = write;
  ws.secure = secure;
});
