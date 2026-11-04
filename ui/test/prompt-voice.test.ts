import { expect, test } from "vitest";
import { PROMPTS } from "../src/core/prompts.ts";
import { FEEDBACK_PROMPT_VERSION } from "../src/core/drafting.ts";
import { OVERALL_PROMPT_VERSION } from "../src/core/overallSuggestion.ts";
import { VERDICT_PROMPT_VERSION } from "../src/core/verdictSuggestion.ts";

// What the moderator and the educator are sent back is theirs to say: written in their own person, not about them.
test("the moderator's comments are asked for in the first person, not about 'the moderator'", () => {
  for (const version of [VERDICT_PROMPT_VERSION, OVERALL_PROMPT_VERSION]) {
    const text = PROMPTS[version];
    expect(text, version).toContain("in the first person, as the moderator");
    expect(text, version).toContain("never write 'the moderator' or 'this moderator'");
    expect(text, version).toContain("Say each point once");
  }
});

test("the overall summary of drafted feedback is addressed to the student, as each criterion's is", () => {
  expect(PROMPTS[FEEDBACK_PROMPT_VERSION]).toContain("addressed to the student directly");
});

test("earlier versions are kept, for batches sent with them", () => {
  for (const v of ["verdict-comment-v1", "overall-comment-v1", "feedback-v3"]) expect(PROMPTS[v]).toBeTruthy();
});
