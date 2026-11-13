/** Which submissions still need the educator on Feedback, and what for. */

import { expect, test } from "vitest";
import { needsAttention, type CohortChecks } from "../src/app/feedbackWork.ts";

const check = (id: string, fields: Partial<CohortChecks> = {}): CohortChecks => ({
  id,
  label: `${id} [STUDENT]`,
  recorded: 0,
  open: 0,
  warnings: 0,
  accepted: 0,
  problem: null,
  held: [],
  pieces: 5,
  ...fields,
});
const held = (title: string) => ({ target: title.toLowerCase(), title, why: ["praise that is for a higher band"] });

test("a submission with a draft held back, a flag to check, or feedback begun and not finished is listed, with why", () => {
  const list = needsAttention([
    check("sub-001", { recorded: 5 }), // done
    check("sub-002", { held: [held("Implementation")] }),
    check("sub-003", { recorded: 4, open: 2 }),
    check("sub-004", { recorded: 3 }),
    check("sub-005", { held: [held("Testing"), held("Design")], recorded: 3, open: 1 }),
  ]);
  expect(list.map((a) => a.id)).toEqual(["sub-002", "sub-003", "sub-004", "sub-005"]);
  expect(list[0].why).toEqual(["an AI draft is held back because a check flags it: Implementation"]);
  expect(list[1].why).toEqual(["2 flags to check or accept", "4 of 5 pieces of feedback recorded"]);
  expect(list[2].why).toEqual(["3 of 5 pieces of feedback recorded"]);
  expect(list[3].why).toEqual(["2 AI drafts are held back because a check flags them: Testing, Design", "a flag to check or accept", "3 of 5 pieces of feedback recorded"]);
});

test("a submission not started, not marked, or finished with nothing flagged is not listed", () => {
  expect(
    needsAttention([
      check("sub-001"), // nothing recorded: said by what to do now, not listed
      check("sub-002", { problem: "it isn't marked yet" }),
      check("sub-003", { recorded: 5, accepted: 1, warnings: 2 }), // warnings hold nothing up
    ]),
  ).toEqual([]);
});
