/** What the preparation steps show: the marking check, by criterion title, and each submission's AI reading. */

import { expect, test } from "vitest";
import { markingCheck } from "../src/app/markingRecords.ts";
import { loadOverview } from "../src/app/overview.ts";
import { readingsRecorded } from "../src/app/recorded.ts";
import { anonymiseWorkspace, approve, chooseReviewMode, confirmMarking, updateRules } from "../src/core/index.ts";
import { setUpModeration } from "./moderation.ts";

test("the marking check is by criterion title, with nothing left out of what it used to show", async () => {
  const { ws, rubric } = await setUpModeration("prep-check");
  const check = await markingCheck(ws, "sub-001", "marker");
  expect([check.id, check.marker, check.route, check.confirmed]).toEqual(["sub-001", "marker", "imported from a bulk download of marked views", false]);
  expect(check.overall).toBe("60 /100");
  // A row per criterion mark, by the source rubric's title, never its identifier.
  expect(check.rows.map((r) => r.title)).toEqual(rubric.criteria.map((c) => c.title).filter((t) => check.rows.some((r) => r.title === t)));
  expect(check.rows.every((r) => !/^[a-z0-9-]+$/.test(r.title))).toBe(true);
  const first = check.rows[0];
  expect([first.mark, first.markerLevel]).toEqual(["68 / 100", "2:1 (68)"]);
  expect(check.rows.every((r) => r.onRubric !== "" && r.onRubric !== "not in the source rubric")).toBe(true); // each placed on the source rubric
  // The import's notes are kept, and so are the comment counts.
  expect(check.notes.length).toBeGreaterThan(0);
  expect([check.inline, check.overallComment]).toEqual([3, true]);
  await confirmMarking(ws, "sub-001");
  expect((await markingCheck(ws, "sub-001", "marker")).confirmed).toBe(true);
});

test("the marking check refuses while its submission is reviewed blind and not revealed", async () => {
  const { ws } = await setUpModeration("prep-blind");
  await chooseReviewMode(ws, "sub-002", "blind");
  await expect(markingCheck(ws, "sub-002", "marker")).rejects.toThrow();
});

test("each submission's reading says by which model and instructions, when, how, what it cost, and whether it is current", async () => {
  const { ws } = await setUpModeration("prep-readings");
  let [a, b] = await readingsRecorded(ws);
  expect([a.read, a.current, a.model, a.promptVersion, a.at, a.producedBy, a.costUsd]).toEqual([true, true, "claude-sonnet-5", "reading-v2", "2026-09-27T10:00:00Z", "live", null]);
  expect([b.read, b.current, b.why]).toEqual([false, false, null]);
  // Its cost is the run log's, matched by the call's request ID.
  const readings = (await ws.readJson("readings/sub-001.json")) as { call: { request_id: string | null } }[];
  for (const r of readings) r.call.request_id = "req_1";
  await ws.writeJson("readings/sub-001.json", readings);
  await ws.writeJson("readings/runs/2026-09-27T10-00-00Z.json", { calls: [{ submission_id: "sub-001", request_id: "req_1", cost_usd: 0.0123 }] });
  [a] = await readingsRecorded(ws);
  expect(a.costUsd).toBe(0.0123);
  // A rule that changes the text clears its approval; once the changed text is approved, the reading is no longer of the
  // text as approved now, and says why (as the steps and the overview judge it).
  const text = ((await ws.readJson("submissions/sub-001.json")) as { anonymised: { text: string } }).anonymised.text;
  const word = text.match(/\b[A-Za-z]{7,}\b/)![0]; // a word of its approved text
  await updateRules(ws, { redact: { [word]: "PROJECT" } }); // an extra value to redact is matched as written
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  [a] = await readingsRecorded(ws);
  expect([a.read, a.current]).toEqual([true, false]);
  expect(a.why).toBeTruthy();
});

test("a reading that completed with nothing recognised is read, as the overview counts it, with its call's details", async () => {
  const { ws } = await setUpModeration("prep-empty");
  // As runReadings stores it: an empty reading, and the call that produced it in readings/calls/.
  const call = ((await ws.readJson("readings/sub-001.json")) as { call: Record<string, unknown> }[])[0].call;
  await ws.writeJson("readings/sub-002.json", []);
  await ws.writeJson("readings/calls/sub-002--2026-09-27T11-00-00Z--claude-sonnet-5.json", { outcome: "complete", call: { ...call, timestamp: "2026-09-27T11:00:00Z" } });
  const [, b] = await readingsRecorded(ws);
  expect([b.read, b.current, b.nothing, b.model, b.at, b.why]).toEqual([true, true, true, "claude-sonnet-5", "2026-09-27T11:00:00Z", null]);
  // The overview, and so the steps' status, count it the same way.
  const row = (await loadOverview(ws)).submissions.find((r) => r.id === "sub-002")!;
  expect(row.reading).toBe("done");
});
