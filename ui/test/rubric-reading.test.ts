/**
 * Asking the AI to propose a transcription of a rubric's image (ADR 0009), through the real proxy to a scripted fake API:
 * what is shown and sent (the image alone), what a proposal is (a draft for the editor, never a rubric), and what is recorded
 * when one is saved. No test contacts the API. The rubric and its image are fictional.
 */

import { expect, test } from "vitest";
import { fakeAnthropic, type Reply } from "../../proxy/test/fakeAnthropic.ts";
import {
  buildRubricRequest,
  enterRubricFromImage,
  gridFlags,
  imageTypeOf,
  loadRubric,
  planRubricReading,
  proposalToGrid,
  PROPOSAL_SCHEMA,
  RUBRIC_PROMPT_VERSION,
  runRubricReading,
  sha256Bytes,
  type RubricProposal,
} from "../src/core/index.ts";
import { crc32 } from "../src/core/zip.ts";
import { newWorkspace } from "./proxyHarness.ts";

// A real 1 x 1 png (a screenshot's stand-in), and the same with a text chunk of the kind a picture can carry hidden in it.
const IMAGE = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const FILE = { name: "screenshot.png", bytes: IMAGE };
function withText(png: Uint8Array, keyword: string, value: string): Uint8Array {
  const data = new TextEncoder().encode(`${keyword}\0${value}`);
  const type = new TextEncoder().encode("tEXt");
  const crcInput = new Uint8Array([...type, ...data]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(crcInput));
  return new Uint8Array([...png.subarray(0, 33), ...chunk, ...png.subarray(33)]); // after the 8-byte signature and the 25-byte IHDR chunk
}

const level = (label: string, points: number | null, descriptor: string) => ({ label, points, descriptor });
const PROPOSAL: RubricProposal = {
  title: "Fictional rubric",
  criteria: [
    { title: "Criterion one", weight_percent: 60, max_points: 60, levels: [level("Strong (48-60)", 54, "Strong work."), level("Weak (0-47.4)", 20, "Weak work.")] },
    { title: "Criterion two", weight_percent: 40, max_points: 40, levels: [level("Strong (32-40)", 36, "Strong work."), level("Weak (0-31.6)", null, "Weak work.")] },
  ],
};
const answers = (value: unknown, stop = "end_turn") => (): Reply => ({
  message: { model: "claude-sonnet-5", content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], stop_reason: stop, usage: { input_tokens: 1500, output_tokens: 600 } },
  requestId: "req_rubric",
});

async function setUp(reply: () => Reply) {
  const replies = [reply];
  const fake = fakeAnthropic(replies);
  const made = await newWorkspace("rubric-read", { provider: fake.provider });
  return { ...made, sent: fake.sent, replies };
}

test("the plan is the image of the rubric alone, with the worst-case cost, and nothing else is in it", async () => {
  const { client } = await setUp(answers(PROPOSAL));
  const plan = await planRubricReading(client, FILE, { model: "claude-sonnet-5", limitUsd: 0.5 });
  expect(plan.request.prompt.version).toBe(RUBRIC_PROMPT_VERSION);
  expect(plan.request.blocks.map((b) => b.kind)).toEqual(["rubric_image"]);
  const [block] = plan.request.blocks;
  expect(block.figures).toHaveLength(1);
  expect(block.figures![0].approved_sha256).toBe(sha256Bytes(IMAGE));
  expect(plan.worstUsd).toBeGreaterThan(0);
  expect(plan.imageBytes).toBe(IMAGE.length);
  expect(plan.request.output_schema).toBe(PROPOSAL_SCHEMA);
  expect(() => buildRubricRequest({ name: "rubric.pdf", bytes: IMAGE }, "claude-sonnet-5")).toThrow("png, jpg, webp or gif");
  expect(["a.PNG", "b.jpeg", "c.webp", "d.gif", "e.pdf", "f"].map(imageTypeOf)).toEqual(["image/png", "image/jpeg", "image/webp", "image/gif", null, null]);
});

test("the image is sent without its hidden metadata, and the original stays as the source", async () => {
  const tagged = withText(IMAGE, "Author", "Dr Fictional Person");
  expect(Buffer.from(tagged).includes("Dr Fictional Person")).toBe(true);
  const { client, sent, ws } = await setUp(answers(PROPOSAL));
  const plan = await planRubricReading(client, { name: "tagged.png", bytes: tagged }, { model: "claude-sonnet-5", limitUsd: 0.5 });
  const [figure] = plan.request.blocks[0].figures!;
  const cleaned = Buffer.from(figure.data, "base64");
  expect(cleaned.includes("Dr Fictional Person")).toBe(false);
  expect(figure.approved_sha256).toBe(sha256Bytes(new Uint8Array(cleaned))); // what is approved is what is sent
  expect(figure.approved_sha256).not.toBe(sha256Bytes(tagged));
  const { record } = await runRubricReading(client, plan, { bytes: tagged });
  expect(record.image_sha256).toBe(sha256Bytes(tagged)); // the source as chosen
  expect(record.sent_sha256).toBe(figure.approved_sha256);
  expect(Buffer.from(sent[0].messages[0].content[1].source.data, "base64").includes("Dr Fictional Person")).toBe(false);
  // The rubric keeps the original as its source.
  const entered = await enterRubricFromImage(ws, { name: "tagged.png", bytes: tagged }, proposalToGrid(PROPOSAL), { proposal: record });
  expect(Array.from((await ws.readBytes(entered.imagePath))!)).toEqual(Array.from(tagged));
});

test("an image that can't be read to remove its metadata isn't sent", async () => {
  const { client, sent } = await setUp(answers(PROPOSAL));
  await expect(planRubricReading(client, { name: "broken.png", bytes: new Uint8Array([1, 2, 3, 4]) }, { model: "claude-sonnet-5", limitUsd: 0.5 })).rejects.toThrow("couldn't be read to remove its hidden metadata");
  expect(sent).toEqual([]);
});

test("without a key, or for a model with no price, nothing is planned", async () => {
  const { client } = await setUp(answers(PROPOSAL));
  await expect(planRubricReading(client, FILE, { model: "some-other-model", limitUsd: 0.5 })).rejects.toThrow("no price is known");
  const keyless = await newWorkspace("rubric-nokey", { provider: null });
  await expect(planRubricReading(keyless.client, FILE, { model: "claude-sonnet-5", limitUsd: 0.5 })).rejects.toThrow("no API key");
});

test("sent, it goes as the instructions, the text and the image, and nothing about anyone; what comes back is a proposal with its record", async () => {
  const { client, sent } = await setUp(answers(PROPOSAL));
  const plan = await planRubricReading(client, FILE, { model: "claude-sonnet-5", limitUsd: 0.5 });
  const { proposal, record } = await runRubricReading(client, plan, FILE, () => new Date(Date.UTC(2026, 9, 27, 12)));
  expect(proposal).toEqual(PROPOSAL);
  expect(record).toMatchObject({ prompt_version: RUBRIC_PROMPT_VERSION, model: "claude-sonnet-5", request_id: "req_rubric", image_sha256: sha256Bytes(IMAGE), at: "2026-10-27T12:00:00.000Z" });
  expect(record.request_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(record.cost_usd).toBeGreaterThan(0);
  expect(sent).toHaveLength(1);
  const content = sent[0].messages[0].content;
  expect(content.map((c: { type: string }) => c.type)).toEqual(["text", "image"]);
  expect(content[1].source.data).toBe(Buffer.from(IMAGE).toString("base64"));
  expect(sent[0].system).toContain("Transcribe it exactly");
  expect(JSON.stringify(sent[0])).not.toMatch(/STUDENT|submission|pseudonym/i);
});

test("a proposal is a grid for the editor to check, never a rubric, and the editor's checks run on it", async () => {
  const { client, ws } = await setUp(answers(PROPOSAL));
  const plan = await planRubricReading(client, FILE, { model: "claude-sonnet-5", limitUsd: 0.5 });
  const { proposal } = await runRubricReading(client, plan, FILE);
  const grid = proposalToGrid(proposal);
  expect(grid.criteria[0]).toEqual({ title: "Criterion one", weight: "60", max_points: "", levels: [{ label: "Strong (48-60)", points: "54", descriptor: "Strong work." }, { label: "Weak (0-47.4)", points: "20", descriptor: "Weak work." }] });
  expect(grid.criteria[1].levels[1].points).toBe(""); // not read: left for the moderator
  expect(gridFlags(grid)).toEqual([]);
  expect(await ws.exists("rubric.json")).toBe(false); // nothing is saved by asking
  // A misread weight is flagged, like a typed one.
  expect(gridFlags({ ...grid, criteria: [{ ...grid.criteria[0], weight: "70" }, grid.criteria[1]] })).toContain("The weights add up to 110, not 100.");
});

test("a rubric saved from a proposal records that it began as one; a different image, or one typed later, doesn't", async () => {
  const { client, ws } = await setUp(answers(PROPOSAL));
  const plan = await planRubricReading(client, FILE, { model: "claude-sonnet-5", limitUsd: 0.5 });
  const { proposal, record } = await runRubricReading(client, plan, FILE);
  await expect(enterRubricFromImage(ws, { name: "other.png", bytes: new Uint8Array([1, 2, 3]) }, proposalToGrid(proposal), { proposal: record })).rejects.toThrow("different image");
  expect(await ws.exists("rubric.json")).toBe(false);
  await enterRubricFromImage(ws, FILE, proposalToGrid(proposal), { proposal: record });
  expect(await ws.readJson("rubric-proposal.json")).toEqual(record);
  expect((await loadRubric(ws)).provenance).toMatchObject({ transformation: "entered", actor: { kind: "moderator" } }); // saved by the moderator, who checked it
  // A rubric replaced by one that was typed leaves no record of an earlier proposal.
  await enterRubricFromImage(ws, FILE, proposalToGrid(proposal), { replace: true });
  expect(await ws.exists("rubric-proposal.json")).toBe(false);
});

test.each([
  ["declined", answers("", "refusal"), "declined to read it"],
  ["cut short", answers('{"title": "Fict', "max_tokens"), "cut short"],
  ["not in the shape asked for", answers({ title: "x", criteria: [{ title: "y" }] }), "wasn't in the shape asked for"],
  ["not JSON", answers("I cannot see an image."), "wasn't in the shape asked for"],
])("an answer that is %s is an error, never a proposal", async (_, reply, message) => {
  const { client } = await setUp(reply);
  const plan = await planRubricReading(client, FILE, { model: "claude-sonnet-5", limitUsd: 0.5 });
  await expect(runRubricReading(client, plan, FILE)).rejects.toThrow(message);
});

test("the spend limit holds: a limit too low for the worst case sends nothing", async () => {
  const { client, sent } = await setUp(answers(PROPOSAL));
  const plan = await planRubricReading(client, FILE, { model: "claude-sonnet-5", limitUsd: 0.0001 });
  await expect(runRubricReading(client, plan, FILE)).rejects.toThrow();
  expect(sent).toEqual([]);
});
