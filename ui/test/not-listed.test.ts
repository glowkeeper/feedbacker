/** What the lists for many at once say about the submissions they leave out: grouped by why, quietly where nothing is asked of the educator. */

import { expect, test } from "vitest";
import { draftGroups, proposalGroups } from "../src/app/notListed.ts";
import type { NotListed, NotTaken } from "../src/core/index.ts";

const drafted = (id: string, kind: NotListed["kind"]): NotListed => ({ id, label: `${id} [S]`, kind, why: "x" });
const proposed = (id: string, kind: NotTaken["kind"], why = "x"): NotTaken => ({ id, label: `${id} [S]`, kind, why });

test("submissions with nothing to record are grouped by why, with what that means and what to do, and only the ones that need the educator are set apart", () => {
  const groups = draftGroups([drafted("sub-001", "recorded"), drafted("sub-002", "recorded"), drafted("sub-003", "held"), drafted("sub-004", "no-draft"), drafted("sub-005", "stale"), drafted("sub-006", "not-marked")]);
  expect(groups.map((g) => [g.kind, g.needsYou, g.labels.length])).toEqual([["recorded", false, 2], ["no-draft", false, 1], ["not-marked", false, 1], ["stale", true, 1], ["held", true, 1]]);
  expect(groups.map((g) => g.text)).toEqual([
    "2 already have their feedback recorded.",
    "1 has no draft yet. Plan the drafts above to get one, or write the feedback yourself.",
    "1 is not fully marked yet, so there is nothing to draft or record.",
    "1 has drafts made from marking you have since changed. Plan the drafts again for it.",
    "1 has every draft held back because a check flags it. Open each, read it, and record it yourself; the reasons are under Checks across the cohort.",
  ]);
});

test("a reason nobody has is not said, and nothing is said when nothing is left out", () => {
  expect(draftGroups([])).toEqual([]);
  expect(draftGroups([drafted("sub-001", "recorded")]).map((g) => g.kind)).toEqual(["recorded"]);
});

test("proposals that can't be taken are grouped by why: done or not ready is said quietly, and what the educator must do is named", () => {
  const groups = proposalGroups([
    proposed("sub-001", "marked"),
    proposed("sub-002", "blind"),
    proposed("sub-003", "blind"),
    proposed("sub-004", "no-proposal"),
    proposed("sub-005", "little-evidence"),
    proposed("sub-006", "out-of-date"),
    proposed("sub-007", "unreadable", "its AI proposal can't be read: damaged"),
  ]);
  expect(groups.map((g) => [g.kind, g.needsYou])).toEqual([["marked", false], ["blind", false], ["no-proposal", false], ["little-evidence", true], ["out-of-date", true], ["unreadable", true]]);
  expect(groups[0].text).toBe("1 is marked already, so there is nothing to take.");
  expect(groups[1].text).toBe("2 are being marked blind, so their proposals are not shown until you have marked them.");
  expect(groups[3].text).toBe("1 submission gave the AI too little evidence to propose any level (this can happen when a submission is mostly figures that were left out). Mark it yourself.");
  expect(groups[5].details).toEqual({ "sub-007 [S]": "its AI proposal can't be read: damaged" }); // a reason that is its own is kept with its submission
});
