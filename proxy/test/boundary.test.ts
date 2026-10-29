/** Only what the rules on what the AI may be sent permit leaves the machine, and apparent identifiers never do. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { findLeaks, LEAK_PATTERNS, sha256Text } from "../src/boundary.ts";
import { FakeProvider, makeProxy, readRequest, submission } from "./helpers.ts";
import { NOT_PHONE_NUMBER_FRAGMENTS, NOT_PHONE_NUMBERS, PHONE_NUMBERS, PHONE_NUMBERS_IN_BRACKETS, PHONE_NUMBERS_IN_CONTEXT } from "./phoneNumbers.ts";

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

describe("what a phone number looks like", () => {
  const phone = LEAK_PATTERNS.find(([what]) => what === "a phone number")![1];
  const found = (text: string) => [...text.matchAll(phone)].map((m) => m[0]);

  test.each(PHONE_NUMBERS.map((n) => [n]))("takes %s whole for a phone number, where it is in a sentence too", (number) => {
    expect(found(number)).toEqual([number]);
    expect(found(`Please ring ${number}. Thank you.`)).toEqual([number]);
    expect(findLeaks(`Please ring ${number}. Thank you.`)).toContain("a phone number");
  });

  test.each(PHONE_NUMBERS_IN_BRACKETS.map((n) => [n]))("takes %s for a phone number, without its opening bracket", (number) => {
    expect(found(number)).toEqual([number.replace(/^\(/, "")]);
  });

  test.each(PHONE_NUMBERS_IN_CONTEXT.map((c) => [...c]))("finds the phone number in %s", (text, number) => {
    expect(found(text)).toEqual([number]);
    expect(found(`${text} and more text`)).toEqual([number]);
  });

  test.each(NOT_PHONE_NUMBER_FRAGMENTS.map((n) => [n]))("takes no fragment of the run %s for a phone number", (text) => {
    expect(found(text)).toEqual([]);
    expect(found(`The results were ${text} for the first run.`)).toEqual([]);
  });

  test.each(NOT_PHONE_NUMBERS.map((n) => [n]))("does not take %s for a phone number", (text) => {
    expect(found(text)).toEqual([]);
    expect(found(`The results were ${text} for the first run.`)).toEqual([]);
    expect(findLeaks(`The results were ${text} for the first run.`)).not.toContain("a phone number");
  });

  test("a table of results is not refused, but a phone number beside it still is", async () => {
    const table = `${NOT_PHONE_NUMBERS.join("\n")}\nCall 07700 900123.`;
    expect(findLeaks(table)).toEqual(["a phone number"]);
  });

  test("a long run of digits and separators is never slow to check", () => {
    for (const unit of ["0 ", "12 34 ", "0.1", "0123456789 ", "(0) ", " 0-1.2(3)4 ", "0 12 "]) {
      const t = Date.now();
      found(unit.repeat(20_000));
      expect(Date.now() - t).toBeLessThan(1000);
    }
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
    const prompt = readFileSync(new URL("../../core/src/feedbacker_core/prompts/reading-v4.md", import.meta.url), "utf8");
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
    ["the marking in a reading", readRequest({ blocks: [...blocks, marking()] }), "the educator's marking and feedback guide may be sent only in a drafting request"],
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

describe("the feedback guide (ADR 0006): only in a drafting request, before the submission, approved as sent", () => {
  const GUIDE = "Requirements: a 2:2 needs to hear that priorities are missing. Next time, rank them.";
  const MARKING = "Criterion id: design\nMark: 55";
  const block = (kind: string, heading: string, text: string, approved: string | null = sha256Text(text)) => ({ kind, heading, text, approved_sha256: approved });
  const guide = (approved?: string | null) => block("guide", "THE EDUCATOR'S FEEDBACK GUIDE", GUIDE, approved === undefined ? sha256Text(GUIDE) : approved);
  const marking = block("marking", "THE EDUCATOR'S MARKING", MARKING);
  const [rubric, brief, sub] = readRequest().blocks as any[];
  const drafting = (blocks: unknown[]) => readRequest({ prompt: { version: "feedback-v2", instructions: "Draft feedback." }, blocks });

  test("is sent before the submission, inside the cached prefix", async () => {
    const { res, proxy } = await read(drafting([rubric, brief, guide(), sub, marking]));
    expect(res.status).toBe(200);
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.blocks[2]).toBe(`THE EDUCATOR'S FEEDBACK GUIDE\n\n${GUIDE}`);
    expect(sent.shared_blocks).toBe(3); // the rubric, the brief and the guide
  });

  test.each([
    ["the guide in a reading", readRequest({ blocks: [rubric, guide(), sub] }), "may be sent only in a drafting request"],
    ["the guide after the submission", drafting([rubric, sub, guide(), marking]), "a drafting request's blocks must be"],
    ["a guide without an approval", drafting([rubric, guide(null), sub, marking]), "the guide block has no approval hash"],
    ["a guide that isn't what was approved", drafting([rubric, guide(sha256Text("other")), sub, marking]), "the guide text does not match its approval hash"],
  ])("refuses %s", async (_, body, why) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(why);
    expect((proxy.provider as FakeProvider).calls).toEqual([]);
  });
});

describe("a suggestion request (ADR 0006, amended): the educator's feedback is sent only there, with its marking, and no submission", () => {
  const MARKING = "The feedback is on criterion: Design (id design)\nLevel: 2:1 (62)\nMark: 62 out of 100";
  const FEEDBACK = "Your design is excellent. Next time, test it.\n\nWhat Feedbacker's checks flagged in it:\n- \"excellent\" is praise for first-class work.";
  const block = (kind: string, heading: string, text: string, approved: string | null = sha256Text(text)) => ({ kind, heading, text, approved_sha256: approved });
  const marking = block("marking", "THE EDUCATOR'S MARKING", MARKING);
  const feedback = (approved?: string | null) => block("feedback", "THE EDUCATOR'S FEEDBACK", FEEDBACK, approved === undefined ? sha256Text(FEEDBACK) : approved);
  const [rubric, brief, sub] = readRequest().blocks as any[];
  const editing = (blocks: unknown[], version = "feedback-edit-v1") => readRequest({ prompt: { version, instructions: "Suggest an edit." }, blocks });

  test("is sent the rubric, the marking and the feedback, the rubric alone cached", async () => {
    const { res, proxy } = await read(editing([rubric, marking, feedback()]));
    expect(res.status).toBe(200);
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.blocks.at(-1)).toBe(`THE EDUCATOR'S FEEDBACK\n\n${FEEDBACK}`);
    expect(sent.shared_blocks).toBe(1);
  });

  test.each([
    ["the feedback in a reading", readRequest({ blocks: [rubric, sub, feedback()] }), "the educator's feedback may be sent only in a suggestion request"],
    ["the feedback in a drafting request", editing([rubric, sub, marking, feedback()], "feedback-v3"), "a drafting request's blocks must be"],
    ["a submission in a suggestion request", editing([rubric, sub, marking, feedback()]), "a suggestion request's blocks must be"],
    ["a brief in a suggestion request", editing([rubric, brief, marking, feedback()]), "a suggestion request's blocks must be"],
    ["feedback without an approval", editing([rubric, marking, feedback(null)]), "the feedback block has no approval hash"],
    ["feedback that isn't what was approved", editing([rubric, marking, feedback(sha256Text("other"))]), "the feedback text does not match its approval hash"],
  ])("refuses %s", async (_, body, why) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(why);
    expect((proxy.provider as FakeProvider).calls).toEqual([]);
  });
});

describe("a verdict suggestion request (ADR 0011): the moderation of one submission is sent only there, with the rubric, and no submission", () => {
  const MODERATION = "The original marker's overall mark: 82 out of 100\nThe moderator's overall mark, implied by their criterion marks: 67 out of 100\n\nCriterion: Design (id design)\nThe moderator's level: 2:1 (62)\nThe AI reading's suggested level: 2:1 (62)\nThe AI reading's rationale: The design is clear but untested.";
  const block = (kind: string, heading: string, text: string, approved: string | null = sha256Text(text)) => ({ kind, heading, text, approved_sha256: approved });
  const moderation = (approved?: string | null) => block("marking", "THE MODERATION OF THIS SUBMISSION", MODERATION, approved === undefined ? sha256Text(MODERATION) : approved);
  const [rubric, brief, sub] = readRequest().blocks as any[];
  const verdict = (blocks: unknown[], version = "verdict-comment-v1") => readRequest({ prompt: { version, instructions: "Suggest a verdict." }, blocks });

  test("is sent the rubric and the moderation, the rubric alone cached", async () => {
    const { res, proxy } = await read(verdict([rubric, moderation()]));
    expect(res.status).toBe(200);
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.blocks.at(-1)).toBe(`THE MODERATION OF THIS SUBMISSION\n\n${MODERATION}`);
    expect(sent.shared_blocks).toBe(1);
  });

  test.each([
    ["a submission in it", verdict([rubric, sub, moderation()]), "a verdict suggestion request's blocks must be"],
    ["a brief in it", verdict([rubric, brief, moderation()]), "a verdict suggestion request's blocks must be"],
    ["the moderation without the rubric", verdict([moderation()]), "a verdict suggestion request's blocks must be"],
    ["the moderation in a reading", readRequest({ blocks: [rubric, moderation()] }), "the educator's marking and feedback guide may be sent only in a drafting request"],
    ["the moderation without an approval", verdict([rubric, moderation(null)]), "the marking block has no approval hash"],
    ["a moderation that isn't what was approved", verdict([rubric, moderation(sha256Text("other"))]), "the marking text does not match its approval hash"],
  ])("refuses %s", async (_, body, why) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(why);
    expect((proxy.provider as FakeProvider).calls).toEqual([]);
  });

  test("refuses a direct identifier in what is sent", async () => {
    const leaking = block("marking", "THE MODERATION OF THIS SUBMISSION", `${MODERATION}\nWrite to j.pike@example.com.`);
    const { res, json } = await read(verdict([rubric, leaking]));
    expect(res.status).toBe(422);
    expect(JSON.stringify(json.error)).toContain("email");
  });
});

describe("an overall-comment suggestion request (ADR 0011): the sample's verdicts are sent alone", () => {
  const VERDICTS = "How the sample was chosen: Target 25% of the 6 who submitted (2), rounded up\n\nSubmission sub-001 [STUDENT_A]:\nThe original marker's overall mark: 82 out of 100\nVerdict: generous\nThe moderator's comment: Marked too high.";
  const block = (kind: string, heading: string, text: string, approved: string | null = sha256Text(text)) => ({ kind, heading, text, approved_sha256: approved });
  const verdicts = (approved?: string | null) => block("marking", "THE MODERATION OF THE SAMPLE", VERDICTS, approved === undefined ? sha256Text(VERDICTS) : approved);
  const [rubric, brief, sub] = readRequest().blocks as any[];
  const overall = (blocks: unknown[], version = "overall-comment-v1") => readRequest({ prompt: { version, instructions: "Suggest an overall comment." }, blocks });

  test("is sent the verdicts block alone, nothing cached", async () => {
    const { res, proxy } = await read(overall([verdicts()]));
    expect(res.status).toBe(200);
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.blocks).toEqual([`THE MODERATION OF THE SAMPLE\n\n${VERDICTS}`]);
    expect(sent.shared_blocks).toBe(0);
  });

  test.each([
    ["a rubric with it", overall([rubric, verdicts()]), "an overall-comment suggestion request's block must be"],
    ["a submission with it", overall([sub, verdicts()]), "an overall-comment suggestion request's block must be"],
    ["a brief with it", overall([brief, verdicts()]), "an overall-comment suggestion request's block must be"],
    ["the verdicts without an approval", overall([verdicts(null)]), "the marking block has no approval hash"],
    ["verdicts that aren't what was approved", overall([verdicts(sha256Text("other"))]), "the marking text does not match its approval hash"],
    ["the verdicts under another request's instructions", readRequest({ blocks: [verdicts()] }), "the educator's marking and feedback guide may be sent only in a drafting request"],
  ])("refuses %s", async (_, body, why) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(why);
    expect((proxy.provider as FakeProvider).calls).toEqual([]);
  });
});

describe("figures (ADR 0007): only with a submission, in a reading or a proposal, each image as approved, after its placeholder", () => {
  const TEXT = "[STUDENT_A] built a dashboard.\n\n[FIGURE_1]\n\nIt shows sign-ups.\n\n[FIGURE_2]\n\nThe end.";
  const IMAGE = Buffer.from("\x89PNG fictional image bytes"); // never decoded here: only hashed and sent
  const figure = (placeholder = "[FIGURE_1]", data = IMAGE) => ({ placeholder, media_type: "image/png", data: data.toString("base64"), approved_sha256: createHash("sha256").update(IMAGE).digest("hex") });
  const withFigures = (extra: Record<string, unknown>, text = TEXT) => {
    const { blocks } = readRequest();
    return readRequest({ blocks: [blocks[0], blocks[1], { ...submission(text), ...extra }] });
  };

  test("are sent as images after their placeholders, a figure not sent marked so, the worst case counting each image, and the log holding only hashes", async () => {
    const { res, proxy } = await read(withFigures({ figures: [figure()], figures_not_sent: ["[FIGURE_2]"] }));
    expect(res.status).toBe(200);
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.blocks[2]).toEqual([
      { type: "text", text: "SUBMISSION [STUDENT_A]\n\n[STUDENT_A] built a dashboard.\n\n[FIGURE_1]" },
      { type: "image", media_type: "image/png", data: IMAGE.toString("base64") },
      { type: "text", text: "\n\nIt shows sign-ups.\n\n[FIGURE_2] (figure not sent)\n\nThe end." },
    ]);
    const [entry] = proxy.egress.entries();
    expect(entry.figures).toEqual([figure().approved_sha256]);
    expect(proxy.egressText()).not.toContain(IMAGE.toString("base64"));
  });

  test.each([
    ["an image that isn't what was approved", withFigures({ figures: [figure("[FIGURE_1]", Buffer.from("changed"))] }), "the image of [FIGURE_1] does not match its approval hash"],
    ["a figure whose placeholder isn't in the text", withFigures({ figures: [figure("[FIGURE_3]")] }), "[FIGURE_3] is not in the submission's text exactly once"],
    ["a figure given twice", withFigures({ figures: [figure()], figures_not_sent: ["[FIGURE_1]"] }), "a figure is given twice"],
    ["a type the AI doesn't accept", withFigures({ figures: [{ ...figure(), media_type: "image/x-emf" }] }), "the request is not allowed"],
    ["figures in a drafting request", (() => {
      const { blocks } = readRequest();
      const marking = { kind: "marking", heading: "THE EDUCATOR'S MARKING", text: "Mark: 62", approved_sha256: sha256Text("Mark: 62") };
      return readRequest({ prompt: { version: "feedback-v3", instructions: "Draft." }, blocks: [blocks[0], { ...submission(TEXT), figures: [figure()] }, marking] });
    })(), "figures may be sent only with a submission, in a reading or a proposal"],
    ["figures with the brief", (() => {
      const { blocks } = readRequest();
      return readRequest({ blocks: [blocks[0], { ...blocks[1], figures_not_sent: ["[FIGURE_1]"] }, blocks[2]] });
    })(), "figures may be sent only with a submission"],
  ])("refuses %s", async (_, body, why) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(why);
    expect((proxy.provider as FakeProvider).calls).toEqual([]);
  });
});

test("a request's size is counted in UTF-8 bytes, as the provider counts it: under the limit in characters, over it in bytes, it is refused", async () => {
  const image = Buffer.alloc(7.5 * 1024 * 1024, 7); // 10 MB as base64, the most one figure may be
  const data = image.toString("base64");
  const approved = createHash("sha256").update(image).digest("hex");
  const text = `${"é".repeat(1_900_000)}\n\n[FIGURE_1]\n\n[FIGURE_2]\n\n[FIGURE_3]`; // 1.9 million characters, 3.8 million bytes
  const figures = ["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]"].map((placeholder) => ({ placeholder, media_type: "image/png", data, approved_sha256: approved }));
  const { blocks } = readRequest();
  const body = readRequest({ blocks: [blocks[0], blocks[1], { ...submission(text), figures }] });
  expect(JSON.stringify(body).length).toBeLessThan(32 * 1024 * 1024); // fewer characters than the limit…
  const { res, json, proxy } = await read(body);
  expect(res.status).toBe(422); // …but more bytes
  expect(json.error.message).toMatch(/^the request is 3\d\.\d MB with its figures, more than the provider's 32 MB/);
  expect((proxy.provider as FakeProvider).calls).toEqual([]);
}, 30_000);

describe("a rubric transcription request (ADR 0009): one image of a rubric, and nothing else", () => {
  const IMAGE = Buffer.from("\x89PNG fictional rubric image bytes"); // only hashed and sent here, never decoded
  const TEXT = "The image of the rubric follows.\n\n[FIGURE_1]";
  const figure = (extra: Record<string, unknown> = {}) => ({ placeholder: "[FIGURE_1]", media_type: "image/png", data: IMAGE.toString("base64"), approved_sha256: createHash("sha256").update(IMAGE).digest("hex"), ...extra });
  const block = (extra: Record<string, unknown> = {}) => ({ kind: "rubric_image", heading: "RUBRIC IMAGE", text: TEXT, approved_sha256: sha256Text(TEXT), figures: [figure()], ...extra });
  const request = (extra: Record<string, unknown> = {}) => ({
    model: "claude-sonnet-5",
    max_output_tokens: 8000,
    prompt: { version: "rubric-transcription-v1", instructions: "Transcribe the rubric in the image." },
    blocks: [block()],
    output_schema: { type: "object" },
    ...extra,
  });

  test("is sent as the text and the image, and the log holds only hashes", async () => {
    const { res, json, proxy } = await read(request());
    expect(res.status).toBe(200);
    expect(json.outcome).toBe("complete");
    const [sent] = (proxy.provider as FakeProvider).calls;
    expect(sent.instructions).toBe("Transcribe the rubric in the image.");
    expect(sent.blocks).toEqual([
      [
        { type: "text", text: "RUBRIC IMAGE\n\nThe image of the rubric follows.\n\n[FIGURE_1]" },
        { type: "image", media_type: "image/png", data: IMAGE.toString("base64") },
      ],
    ]);
    expect(proxy.egressText()).not.toContain(IMAGE.toString("base64"));
  });

  test.each([
    ["with a submission beside the image", request({ blocks: [block(), readRequest().blocks[2]] }), "must be the rubric's image alone"],
    ["with the rubric's text instead of its image", request({ blocks: [readRequest().blocks[0]] }), "must be the rubric's image alone"],
    ["in a reading, which has its own shape", readRequest({ blocks: [block(), ...readRequest().blocks.slice(1)] }), "only in a rubric transcription request"],
    ["with the rubric's image under a reading's instructions", request({ prompt: { version: "reading-v4", instructions: "Read it." } }), "only in a rubric transcription request"],
    ["with a reading's blocks under its instructions", request({ blocks: readRequest().blocks }), "must be the rubric's image alone"],
    ["with no image", request({ blocks: [block({ figures: [] })] }), "exactly one image"],
    ["with two images", request({ blocks: [block({ figures: [figure(), figure({ placeholder: "[FIGURE_2]" })] })] }), "exactly one image"],
    ["with an image that isn't the one approved", request({ blocks: [block({ figures: [figure({ data: Buffer.from("changed").toString("base64") })] })] }), "does not match its approval hash"],
    ["with text that isn't the approved text", request({ blocks: [block({ text: `${TEXT} Jordan` })] }), "does not match its approval hash"],
    ["with an image missing from its text", request({ blocks: [block({ text: "No image here.", approved_sha256: sha256Text("No image here.") })] }), "not in the rubric image block's text exactly once"],
    ["with a type the AI doesn't accept", request({ blocks: [block({ figures: [figure({ media_type: "image/x-emf" })] })] }), "the request is not allowed"],
  ])("refuses it %s", async (_, body, message) => {
    const { res, json, proxy } = await read(body);
    expect(res.status).toBe(422);
    expect(json.error.message).toContain(message);
    expect((proxy.provider as FakeProvider).calls).toHaveLength(0);
  });

  test("the output schema may not be larger than any other request's", async () => {
    const big = { type: "object", description: "x".repeat(70_000) };
    const { res, json } = await read(request({ output_schema: big }));
    expect(res.status).toBe(422);
    expect(json.error.message).toContain("the output schema is larger than");
  });

  test("the leak checks still read its text and instructions", async () => {
    const { res, json } = await read(request({ prompt: { version: "rubric-transcription-v1", instructions: "Write to marker@example.com." } }));
    expect(res.status).toBe(422);
    expect(json.error.message).toContain("an email address");
  });
});
