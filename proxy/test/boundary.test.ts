/** Only what the rules on what the AI may be sent permit leaves the machine, and apparent identifiers never do. */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { findLeaks, sha256Text } from "../src/boundary.ts";
import { FakeProvider, makeProxy, readRequest, submission } from "./helpers.ts";

async function read(body: unknown) {
  const proxy = makeProxy();
  const run = await proxy.openRun();
  const res = await proxy.call(`/api/runs/${run}/read`, { body });
  return { res, json: await res.json(), proxy };
}

test("a request within the boundary is sent as the Python reading renders it", async () => {
  const { res, json, proxy } = await read(readRequest());
  expect(res.status).toBe(200);
  expect(json).toMatchObject({ outcome: "complete", provider: "fake", run: { spent_usd: json.cost_usd } });
  const [sent] = (proxy.provider as FakeProvider).calls;
  expect(sent.instructions).toBe("Read the submission against the rubric.");
  expect(sent.blocks).toEqual([
    "RUBRIC\n\nCriterion id: design\n- Level id: p68 | 2:1 (68)",
    "ASSESSMENT BRIEF\n\nBuild a study planner for [ORG_1] students.",
    "SUBMISSION [STUDENT_A]\n\n[STUDENT_A] built a planner with clear screens and informal testing.",
  ]);
});

test("a run without a brief is allowed", async () => {
  const { blocks } = readRequest();
  const { res } = await read(readRequest({ blocks: [blocks[0], blocks[2]] }));
  expect(res.status).toBe(200);
});

describe("the boundary refuses", () => {
  const { blocks } = readRequest();
  const [rubric, brief, sub] = blocks as any[];

  test.each([
    ["an extra field, e.g. original marks", readRequest({ original_marks: { design: 68 } }), "Unrecognized key"],
    ["an extra field on a block", readRequest({ blocks: [rubric, brief, { ...sub, marker_comment: "x" }] }), "Unrecognized key"],
    ["an unknown block kind", readRequest({ blocks: [rubric, { ...brief, kind: "pseudonym_key" }, sub] }), "blocks.1.kind"],
    ["a second submission", readRequest({ blocks: [rubric, sub, sub] }), "then one submission"],
    ["blocks out of order", readRequest({ blocks: [sub, rubric] }), "then one submission"],
    ["no rubric", readRequest({ blocks: [brief, sub] }), "then one submission"],
    ["a submission without an approval hash", readRequest({ blocks: [rubric, { ...sub, approved_sha256: null }] }), "no approval hash"],
    ["submission text that isn't the approved text", readRequest({ blocks: [rubric, { ...sub, text: `${sub.text} Jordan` }] }), "does not match its approval hash"],
    ["a brief that isn't the approved brief", readRequest({ blocks: [rubric, { ...brief, text: "changed" }, sub] }), "brief text does not match"],
    ["an approval hash on the rubric", readRequest({ blocks: [{ ...rubric, approved_sha256: sha256Text(rubric.text) }, sub] }), "needs no approval hash"],
    ["a multi-line heading", readRequest({ blocks: [rubric, { ...sub, heading: "SUBMISSION\nJordan Pike" }] }), "single line"],
    ["a model without a known price", readRequest({ model: "some-other-model" }), "no price is known"],
    ["an oversized output limit", readRequest({ max_output_tokens: 1_000_000 }), "max_output_tokens"],
  ])("%s", async (_, body, message) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(message);
    expect((proxy.provider as FakeProvider).calls).toHaveLength(0);
  });

  test("text that can't be encoded as UTF-8", async () => {
    const bad = { kind: "submission", heading: "SUBMISSION [STUDENT_A]", text: "bad \uD800", approved_sha256: "0".repeat(64) };
    const { res, json } = await read(readRequest({ blocks: [rubric, bad] }));
    expect(res.status).toBe(422);
    expect(json.error.message).toContain("lone surrogate");
  });
});

describe("leak checks", () => {
  test.each([
    ["an email address", "Contact j.pike@example.com for access."],
    ["a web address", "Code at https://github.com/jpike/planner."],
    ["a web address", "See www.jpike.example.net/portfolio."],
    ["a phone number", "Call 07700 900123 after six."],
    ["a phone number", "Call +44 20 7946 0958."],
    ["a long number (7 or more digits)", "Student 1234567 submitted this."],
    ["a long number (7 or more digits)", "Turnitin ID 100200302."],
  ])("refuse %s", async (what, text) => {
    const { blocks } = readRequest();
    const { res, json, proxy } = await read(readRequest({ blocks: [blocks[0], submission(text)] }));
    expect(res.status).toBe(422);
    expect(json.error).toMatchObject({ type: "leak" });
    expect(json.error.message).toContain(`the submission block contains ${what}`);
    // The reason names the kind of problem, never the value.
    for (const word of text.split(/\s+/).filter((w) => /[@\d]/.test(w))) expect(json.error.message).not.toContain(word);
    expect((proxy.provider as FakeProvider).calls).toHaveLength(0);
  });

  test("check the instructions, the brief, the rubric and the output schema too", async () => {
    const { blocks } = readRequest();
    const [rubric, brief, sub] = blocks as any[];
    const email = "a.b@example.org";
    for (const body of [
      readRequest({ prompt: { version: "p1", instructions: `Write to ${email}` } }),
      readRequest({ blocks: [{ ...rubric, text: `Ask ${email}` }, brief, sub] }),
      readRequest({ blocks: [rubric, { ...brief, text: email, approved_sha256: sha256Text(email) }, sub] }),
      readRequest({ output_schema: { description: email } }),
    ]) {
      expect((await read(body)).json.error.type).toBe("leak");
    }
  });

  test("pass pseudonym tokens, marks, percentages, years and decimals", () => {
    const text =
      "[STUDENT_A] and [PERSON_1] ([EMAIL_1], [URL_2], [PHONE_1], [ID_3]) scored 68/100 (25%) in 2026; " +
      "the weighted total was 59.75, a ratio of 0.1234567, across 12 000 words.";
    expect(findLeaks(text)).toEqual([]);
  });

  test("pass the real versioned prompt", () => {
    const prompt = readFileSync(new URL("../../core/src/feedbacker_core/prompts/reading-v2.md", import.meta.url), "utf8");
    expect(findLeaks(prompt)).toEqual([]);
  });

  test("pass the synthetic rubric, rendered as the reading renders it", () => {
    const rubric = JSON.parse(readFileSync(new URL("../../fixtures/synthetic/pack-01/rubric.json", import.meta.url), "utf8"));
    const lines = [`Rubric: ${rubric.title} (version ${rubric.version})`];
    for (const c of rubric.criteria) {
      lines.push(`\nCriterion id: ${c.id}\nTitle: ${c.title}${c.weight ? `, weight ${c.weight}%` : ""}`);
      for (const l of c.levels) lines.push(`- Level id: ${l.id} | ${l.label}, ${l.points} points: ${l.descriptor}`);
    }
    expect(findLeaks(lines.join("\n"))).toEqual([]);
  });
});

describe("a drafting request (ADR 0006): the educator's marking is sent only there, approved as sent", () => {
  const MARKING = "Criterion id: design\nLevel: 2:1 (68)\nMark: 66\nComment: Clear screens; testing was informal.";
  const marking = (text = MARKING, approved: string | null = sha256Text(text)) => ({ kind: "marking", heading: "THE EDUCATOR'S MARKING", text, approved_sha256: approved });
  const { blocks } = readRequest();
  const drafting = (overrides: Record<string, unknown> = {}) =>
    readRequest({ prompt: { version: "feedback-v1", instructions: "Draft feedback from the educator's marks." }, blocks: [...blocks, marking()], ...overrides });

  test("is sent with the marking last, and the cache ends before the submission", async () => {
    const { res, proxy } = await read(drafting());
    expect(res.status).toBe(200);
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.blocks.at(-1)).toBe(`THE EDUCATOR'S MARKING\n\n${MARKING}`);
    expect(sent.shared_blocks).toBe(2); // the rubric and the brief
  });

  test.each([
    ["the marking in a reading", readRequest({ blocks: [...blocks, marking()] }), "the educator's marking may be sent only in a drafting request"],
    ["a drafting request without the marking", drafting({ blocks }), "a drafting request's blocks must be"],
    ["the marking before the submission", drafting({ blocks: [blocks[0], blocks[1], marking(), blocks[2]] }), "a drafting request's blocks must be"],
    ["marking without an approval", drafting({ blocks: [...blocks, marking(MARKING, null)] }), "the marking block has no approval hash"],
    ["marking that isn't what was approved", drafting({ blocks: [...blocks, marking(MARKING, sha256Text("something else"))] }), "the marking text does not match its approval hash"],
    ["an identifier in the marking", drafting({ blocks: [...blocks, marking("Comment: see 100200301")] }), "may identify someone"],
  ])("refuses %s", async (_, body, why) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(why);
    expect((proxy.provider as FakeProvider).calls).toEqual([]);
  });
});
