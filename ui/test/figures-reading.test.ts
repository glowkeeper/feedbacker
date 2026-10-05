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
