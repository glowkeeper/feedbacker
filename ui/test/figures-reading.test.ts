/**
 * Sending a submission's approved figures with its reading or proposals (ADR 0007), through the real proxy to a scripted
 * fake API: each image after its placeholder, a figure not sent marked so, the call recording what was sent, the reuse
 * key, the run's option, and the provider's limits checked first. Synthetic material only. No test contacts the API.
 */

import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  buildRequest,
  currentRequest,
  FIGURE_LIMITS,
  figureLimitSentence,
  fitFigures,
  readingProblems,
  figureLimitProblems,
  figurePath,
  importCohort,
  importRubric,
  loadReadings,
  loadRubric,
  loadSubmission,
  planReadings,
  requestKey,
  runReadings,
  setFigureExcluded,
} from "../src/core/index.ts";
import { encodePng, PIXELS } from "../src/core/png.ts";
import { packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

/** A proposal for every criterion, quoting nothing. */
const proposals =
  (criteria: string[]) =>
  (): Reply => ({
    message: {
      model: "claude-sonnet-5",
      content: [{ type: "text", text: JSON.stringify({ criteria: criteria.map((criterion_id) => ({ criterion_id, suggested_level_id: "p68", rationale: "[FIGURE_1] shows the trend.", evidence: [], draft_comment: "", missing_evidence: false })) }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    },
    requestId: "req_fig",
  });

/** A marking workspace with one submission, the PDF report with three charts, approved with all its figures. */
async function setUp(name: string) {
  const replies: ((body: any) => Reply)[] = [];
  const fake = fakeAnthropic(replies);
  const { ws, client } = await newWorkspace(name, { provider: fake.provider, workspace_type: "marking" });
  await importCohort(ws, bytesSource("100200301 - QUILL AVERY . - report.pdf", packFile("figures/report-with-figures.pdf")));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const criteria = (await loadRubric(ws)).criteria.map((c) => c.id);
  return { ws, client, replies, sent: fake.sent, criteria };
}

test("each approved figure is sent as an image straight after its placeholder, and the call records what was sent", async () => {
  const { ws, client, replies, sent, criteria } = await setUp("figread-1");
  await setFigureExcluded(ws, "sub-001", "[FIGURE_2]", true, "Shows a colleague");
  await approve(ws, "sub-001");
  const plan = await planReadings(ws, client, null, { withBrief: false });
  const [planned] = plan.readings;
  const block = planned.request.blocks.at(-1)!;
  expect([block.figures!.map((f) => [f.placeholder, f.media_type]), block.figures_not_sent]).toEqual([[["[FIGURE_1]", "image/png"], ["[FIGURE_3]", "image/png"]], ["[FIGURE_2]"]]);
  replies.push(proposals(criteria));
  await runReadings(ws, plan, { proxy: client });
  // What the provider was sent: the submission's text, cut after each sent figure's placeholder, with its image there.
  const content = (sent[0] as any).messages[0].content as any[];
  const kinds = content.map((p) => (p.type === "image" ? `image:${p.source.media_type}` : p.text.trimEnd().split("\n").at(-1)));
  expect(kinds.slice(-5)).toEqual(["[FIGURE_1]", "image:image/png", "[FIGURE_3]", "image:image/png", "The last page's text."]);
  expect(content.find((p) => p.type === "text" && p.text.includes("[FIGURE_2] (figure not sent)"))).toBeTruthy();
  const figures = (await loadSubmission(ws, "sub-001")).extract!.figures;
  const [reading] = await loadReadings(ws, "sub-001");
  expect(reading.call.figures).toEqual([figures[0], figures[2]].map((f) => ({ placeholder: f.placeholder, sha256: f.sha256 })));
});

test("without figures, every placeholder is marked as not sent, and the reuse key differs; the worst case counts each image", async () => {
  const { ws, client } = await setUp("figread-2");
  const withImages = (await planReadings(ws, client, null, { withBrief: false })).readings[0];
  const without = (await planReadings(ws, client, null, { withBrief: false, withFigures: false })).readings[0];
  expect([without.request.blocks.at(-1)!.figures, without.request.blocks.at(-1)!.figures_not_sent]).toEqual([[], ["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]"]]);
  expect(requestKey(withImages.request)).not.toBe(requestKey(without.request));
  expect(withImages.tokensIn - without.tokensIn).toBe(3 * 4784 - 18); // each image, less the three markers of " (figure not sent)" (54 characters)
});

test("a submission without figures is asked for exactly as before", async () => {
  const { ws, client } = await newWorkspace("figread-3", { workspace_type: "marking" });
  await importCohort(ws, bytesSource("100200301 - QUILL AVERY . - a.docx", packFile("submissions/sub-a.docx")));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const block = (await planReadings(ws, client, null, { withBrief: false })).readings[0].request.blocks.at(-1)!;
  expect(Object.keys(block)).toEqual(["kind", "heading", "text", "approved_sha256"]);
});

test("a figure whose image has changed since it was approved keeps the submission out of the plan, and nothing is sent", async () => {
  const { ws, client, sent } = await setUp("figread-4");
  const [first] = (await loadSubmission(ws, "sub-001")).extract!.figures;
  await ws.writeBytes(figurePath("sub-001", first)!, encodePng(1, 1, PIXELS.RGB, new Uint8Array([0, 0, 0])));
  const plan = await planReadings(ws, client, null, { withBrief: false });
  expect([plan.readings, plan.skipped.get("sub-001")]).toEqual([[], expect.stringMatching(/isn't the image that was extracted.*its approval no longer holds/)]);
  expect(sent).toEqual([]);
});

test("the provider's limits on images are checked before anything is sent, naming the figure to leave out", () => {
  const rubric = { title: "R", version: "1", criteria: [] } as any;
  const figure = (placeholder: string, width: number, height: number) => {
    const png = encodePng(width, height, PIXELS.GREY_1BIT, new Uint8Array(Math.ceil(width / 8) * height));
    return { placeholder, media_type: "image/png", data: Buffer.from(png).toString("base64"), approved_sha256: "0".repeat(64) };
  };
  const request = (figures: ReturnType<typeof figure>[]) =>
    buildRequest(rubric, null, "[STUDENT_A]", { text: figures.map((f) => f.placeholder).join("\n\n"), sha256: "0".repeat(64) }, "claude-sonnet-5", "reading-v3", { sent: figures, notSent: [], notes: [] });
  expect(figureLimitProblems(request([figure("[FIGURE_1]", 400, 300)]))).toEqual([]);
  expect(figureLimitProblems(request([figure("[FIGURE_1]", 8001, 8)]))).toEqual(["[FIGURE_1] is 8001×8 pixels, more than the 8000 a side the AI accepts; leave it out"]);
  // More than 20 images: each at most 2000 pixels a side.
  const many = Array.from({ length: 21 }, (_, i) => figure(`[FIGURE_${i + 1}]`, i === 4 ? 2001 : 8, 8));
  expect(figureLimitProblems(request(many))).toEqual(["[FIGURE_5] is 2001×8 pixels, more than the 2000 a side the AI accepts with more than 20 figures; leave it out"]);
});

// --- From code review ----------------------------------------------------------------------------------------

test("a reading sent a figure that is no longer approved is out of date; one sent without figures stands", async () => {
  const { ws, client, replies, criteria } = await setUp("figread-5");
  replies.push(proposals(criteria), proposals(criteria));
  await runReadings(ws, await planReadings(ws, client, null, { withBrief: false }), { proxy: client });
  const withImages = await loadReadings(ws, "sub-001");
  await runReadings(ws, await planReadings(ws, client, null, { withBrief: false, withFigures: false, replace: true }), { proxy: client });
  const without = await loadReadings(ws, "sub-001");
  // [FIGURE_2] is now kept back, and the text and the rest approved again: the approval's ID is the same.
  await setFigureExcluded(ws, "sub-001", "[FIGURE_2]", true);
  const approval = await approve(ws, "sub-001");
  const check = (readings: typeof without) => readingProblems("sub-001", readings, approval.approved_text_sha256, { approvalId: approval.id, rubric: null, approvedFigures: approval.figures });
  expect(check(withImages)).toEqual(["readings/sub-001.json was read with a figure that is no longer approved to be sent; run the reading again"]);
  expect(check(without)).toEqual([]);
});

test("a batch sent with instructions written before figures is rebuilt as it was sent: no figures, nothing marked", async () => {
  const { ws } = await setUp("figread-6");
  const legacy = await currentRequest(ws, false, "sub-001", "[STUDENT_A]", "claude-sonnet-5", "anthropic", "marking-v2", false);
  expect(Object.keys(legacy.request.blocks.at(-1)!)).toEqual(["kind", "heading", "text", "approved_sha256"]);
  const current = await currentRequest(ws, false, "sub-001", "[STUDENT_A]", "claude-sonnet-5", "anthropic", "marking-v3", false);
  expect(current.request.blocks.at(-1)!.figures_not_sent).toEqual(["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]"]);
});

test("sizes are counted in UTF-8 bytes, as they are sent, for a request and a whole batch", async () => {
  const rubric = { title: "R", version: "1", criteria: [] } as any;
  const text = "é".repeat(1000); // 1,000 characters, 2,000 bytes
  const request = buildRequest(rubric, null, "[STUDENT_A]", { text, sha256: "0".repeat(64) }, "claude-sonnet-5", "reading-v3", { sent: [], notSent: [], notes: [] });
  const limit = FIGURE_LIMITS.requestBytes;
  try {
    FIGURE_LIMITS.requestBytes = JSON.stringify(request).length + 10; // more than its characters, fewer than its bytes
    const withFigure = buildRequest(rubric, null, "[STUDENT_A]", { text: `${text}\n\n[FIGURE_1]`, sha256: "0".repeat(64) }, "claude-sonnet-5", "reading-v3", {
      sent: [{ placeholder: "[FIGURE_1]", media_type: "image/png", data: Buffer.from(encodePng(1, 1, PIXELS.RGB, new Uint8Array(3))).toString("base64"), approved_sha256: "0".repeat(64) }],
      notSent: [],
      notes: [],
    });
    expect(figureLimitProblems(withFigure).at(-1)).toMatch(/^with its figures, the request is .* MB, more than the .* MB the AI accepts/);
  } finally {
    FIGURE_LIMITS.requestBytes = limit;
  }
  // A batch: the whole body, as the proxy receives it.
  const { ws, client } = await setUp("figread-7");
  const batchLimit = FIGURE_LIMITS.batchBytes;
  try {
    FIGURE_LIMITS.batchBytes = 1000;
    await expect(planReadings(ws, client, null, { withBrief: false, batch: true })).rejects.toThrow(/a batch can be; read them one at a time/);
  } finally {
    FIGURE_LIMITS.batchBytes = batchLimit;
  }
});

// --- More figures than the AI can be sent -------------------------------------------------------------------

const sizedFigure = (placeholder: string, width: number, height: number) => {
  const png = encodePng(width, height, PIXELS.GREY_1BIT, new Uint8Array(Math.ceil(width / 8) * height));
  return { placeholder, media_type: "image/png", data: Buffer.from(png).toString("base64"), approved_sha256: "0".repeat(64) };
};
const approvedOf = (figures: ReturnType<typeof sizedFigure>[]) => ({ sent: figures, notSent: [], notes: [] });

test("with more figures than the AI accepts, the first 100 in the text are sent, and the rest are left out as not sent, with why", () => {
  const figures = Array.from({ length: 146 }, (_, i) => sizedFigure(`[FIGURE_${i + 1}]`, 8, 8));
  const { figures: fitted, info } = fitFigures(approvedOf(figures), 1000);
  expect(fitted.sent.map((f) => f.placeholder)).toEqual(figures.slice(0, FIGURE_LIMITS.perRequest).map((f) => f.placeholder)); // the first 100, in the text's order
  expect(fitted.notSent).toEqual(figures.slice(FIGURE_LIMITS.perRequest).map((f) => f.placeholder));
  expect([info.total, info.fit, info.left.length]).toEqual([146, 100, 46]);
  expect(info.left[0]).toEqual({ placeholder: "[FIGURE_101]", why: "more than the 100 figures the AI can be sent at once" });
  expect(fitted.notes[0]).toBe("[FIGURE_101] isn't sent: more than the 100 figures the AI can be sent at once");
  expect(figureLimitSentence(info)).toBe("it has 146 figures to send, and 46 can't be sent with the rest (the AI can be sent at most 100 images at once): 100 fit");
});

test("with more than 20 figures each is within 2000 pixels a side, so the larger ones are left out; with 20 or fewer, the larger ones stay", () => {
  const mixed = Array.from({ length: 30 }, (_, i) => sizedFigure(`[FIGURE_${i + 1}]`, i % 10 === 0 ? 2400 : 8, 8)); // 3 larger, 27 small
  const { figures, info } = fitFigures(approvedOf(mixed), 1000);
  expect(figures.sent).toHaveLength(27);
  expect(info.left.map((l) => l.placeholder)).toEqual(["[FIGURE_1]", "[FIGURE_11]", "[FIGURE_21]"]);
  expect(info.left[0].why).toBe("2400×8 pixels, more than the 2000 a side the AI accepts with more than 20 figures");
  // Only 19 small ones: the first 20 of all of them may be sent, larger ones too, since 20 or fewer need no limit of 2000.
  const few = Array.from({ length: 30 }, (_, i) => sizedFigure(`[FIGURE_${i + 1}]`, i < 11 ? 2400 : 8, 8));
  const kept = fitFigures(approvedOf(few), 1000);
  expect(kept.figures.sent.map((f) => f.placeholder)).toEqual(few.slice(0, 20).map((f) => f.placeholder));
  expect(kept.info.left).toHaveLength(10);
  // A figure beyond 8000 pixels, or an image that can't be read, is left out whatever the count.
  const odd = [sizedFigure("[FIGURE_1]", 8001, 8), { ...sizedFigure("[FIGURE_2]", 8, 8), data: Buffer.from("not an image").toString("base64") }, sizedFigure("[FIGURE_3]", 8, 8)];
  const oddFit = fitFigures(approvedOf(odd), 1000);
  expect(oddFit.figures.sent.map((f) => f.placeholder)).toEqual(["[FIGURE_3]"]);
  expect(oddFit.info.left.map((l) => l.why)).toEqual(["8001×8 pixels, more than the 8000 a side the AI accepts", "its image can't be read"]);
});

test("the request's size is within the AI's limit too: figures are kept in order until it would not be", () => {
  const f = Array.from({ length: 5 }, (_, i) => sizedFigure(`[FIGURE_${i + 1}]`, 8, 8));
  const each = JSON.stringify(f[0]).length + 1;
  const { figures, info } = fitFigures(approvedOf(f), FIGURE_LIMITS.requestBytes - 3 * each - 1);
  expect(figures.sent.map((x) => x.placeholder)).toEqual(["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]"]);
  expect(info.left.map((l) => l.why)).toEqual(Array(2).fill("the request would be more than the 32 MB the AI accepts"));
});

/** A figure of the size given (its image header says 8×8 unless told otherwise), padded so its data is about `padBytes` bytes before base64. */
const heavyFigure = (placeholder: string, padBytes: number, width = 8, height = 8) => {
  const png = encodePng(width, height, PIXELS.GREY_1BIT, new Uint8Array(Math.ceil(width / 8) * height));
  return { placeholder, media_type: "image/png", data: Buffer.concat([Buffer.from(png), Buffer.alloc(padBytes)]).toString("base64"), approved_sha256: "0".repeat(64) };
};

test("the count-dependent pixel limit and the request's size are weighed together, so an earlier figure is not left out when the size lets fewer than 21 through", () => {
  // A small 2001×1 first figure, then 21 figures of about 2 MB each: the size alone lets 16 of those through, so there are fewer than 21 and 2001 pixels is fine.
  const figures = [sizedFigure("[FIGURE_1]", 2001, 1), ...Array.from({ length: 21 }, (_, i) => heavyFigure(`[FIGURE_${i + 2}]`, 1_500_000))];
  const { figures: fitted, info } = fitFigures(approvedOf(figures), 1000);
  expect(fitted.sent.map((f) => f.placeholder)).toEqual(Array.from({ length: 17 }, (_, i) => `[FIGURE_${i + 1}]`));
  expect(info.left.map((l) => l.placeholder)).toEqual(Array.from({ length: 5 }, (_, i) => `[FIGURE_${i + 18}]`));
  expect(new Set(info.left.map((l) => l.why))).toEqual(new Set(["the request would be more than the 32 MB the AI accepts"]));
});

test("a figure that doesn't fit the request's size takes nothing from the figures after it: a later, smaller one is still sent", () => {
  const figures = [...[1, 2, 3].map((n) => heavyFigure(`[FIGURE_${n}]`, 6_000_000)), heavyFigure("[FIGURE_4]", 7_200_000), sizedFigure("[FIGURE_5]", 8, 8)];
  const { figures: fitted, info } = fitFigures(approvedOf(figures), 1000);
  expect(fitted.sent.map((f) => f.placeholder)).toEqual(["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]", "[FIGURE_5]"]);
  expect(info.left).toEqual([{ placeholder: "[FIGURE_4]", why: "the request would be more than the 32 MB the AI accepts" }]);
});

test("a submission whose figures go beyond the limit is left out, saying how many fit; the moderator reads it with those that fit, or without figures, and the record says which were not sent", async () => {
  const { ws, client, replies, sent, criteria } = await setUp("figread-limit");
  const limits = FIGURE_LIMITS as { perRequest: number };
  const before = limits.perRequest;
  limits.perRequest = 2; // the report's three charts are one too many
  try {
    const plan = await planReadings(ws, client, null, { withBrief: false });
    expect(plan.readings).toEqual([]);
    expect(plan.skipped.get("sub-001")).toBe("it has 3 figures to send, and 1 can't be sent with the rest (the AI can be sent at most 2 images at once): 2 fit; choose how to read it"); // the limit lowered, for the test
    expect(plan.figureLimits.get("sub-001")).toMatchObject({ total: 3, fit: 2, left: [{ placeholder: "[FIGURE_3]" }] });
    expect(sent).toEqual([]);
    // Those that fit: the first two in the text; the third is marked as not sent where it was, and the plan says so.
    const fit = await planReadings(ws, client, null, { withBrief: false, figureChoices: { "sub-001": "fit" } });
    const [planned] = fit.readings;
    expect([planned.figureChoice, planned.figureLeft.map((l) => l.placeholder), planned.request.blocks.at(-1)!.figures!.map((f) => f.placeholder), planned.request.blocks.at(-1)!.figures_not_sent]).toEqual(["fit", ["[FIGURE_3]"], ["[FIGURE_1]", "[FIGURE_2]"], ["[FIGURE_3]"]]);
    replies.push(proposals(criteria));
    await runReadings(ws, fit, { proxy: client }); // rebuilt as chosen, and equal to what was confirmed
    const [reading] = await loadReadings(ws, "sub-001");
    expect(reading.call.figures.map((f) => f.placeholder)).toEqual(["[FIGURE_1]", "[FIGURE_2]"]);
    expect(reading.call.figures_not_sent).toEqual(["[FIGURE_3]"]); // the comparison and the verdict suggestion can say the AI did not see it
    expect(sent).toHaveLength(1);
    // Without figures: every placeholder is marked as not sent.
    const none = await planReadings(ws, client, null, { withBrief: false, replace: true, figureChoices: { "sub-001": "none" } });
    expect([none.readings[0].figureChoice, none.readings[0].request.blocks.at(-1)!.figures_not_sent]).toEqual(["none", ["[FIGURE_1]", "[FIGURE_2]", "[FIGURE_3]"]]);
  } finally {
    limits.perRequest = before;
  }
});
