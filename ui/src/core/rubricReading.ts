/**
 * Asking the AI to propose a transcription of a rubric's image (ADR 0009).
 *
 * The request is the image of the rubric and nothing else: no student's material, no brief, no pseudonym. The moderator sees what
 * is sent, and its worst-case cost, and confirms before it goes; it travels through the local proxy, which applies the spend limit
 * and records the image's hash, never its content. What comes back is only a proposal: it fills the rubric editor's grid for the
 * moderator to check against the image, and nothing is saved until they save it. A rubric saved from one records that it began so.
 */

import * as z from "zod";
import { sha256Bytes } from "./extract.ts";
import { cleanable, withoutMetadata } from "./imageMetadata.ts";
import { estimate, type ProxyResponse, type ReadingProxy, type ReadingRequest } from "./reading.ts";
import type { RubricGrid } from "./rubricImage.ts";
import { sha256Text } from "./text.ts";

export const RUBRIC_PROMPT_VERSION = "rubric-transcription-v1";
export const RUBRIC_MAX_OUTPUT_TOKENS = 12000;

export const RUBRIC_INSTRUCTIONS = `You are given an image of a marking rubric. Transcribe it exactly as it is written. Do not correct it, complete it, summarise it, or add anything that is not in the image: a mistake in the rubric is to be kept as it is.

Return the rubric as the schema describes:
- title: the rubric's title as shown in the image (an empty string if it shows none).
- criteria: each criterion, in the order they appear from top to bottom.
  - title: the criterion's name, without any percentage in brackets that follows it.
  - weight_percent: the percentage in brackets after the criterion's name, as a number, or null if there is none.
  - max_points: the criterion's total points shown for it (for example "20 pts" at the end of its row), as a number, or null if none is shown.
  - levels: that criterion's levels, in the order they appear from left to right (best first).
    - label: the level's name exactly as written, including any range in brackets (for example "Excellent (16-20)"), but not the points line above it.
    - points: the points shown for the level (for example "15 Pts"), as a number, or null if none is shown.
    - descriptor: the text describing the level, exactly as written.

If you cannot read something, use null for a number and an empty string for text, rather than guessing.`;

export const RubricProposal = z.strictObject({
  title: z.string(),
  criteria: z.array(
    z.strictObject({
      title: z.string(),
      weight_percent: z.number().nullable(),
      max_points: z.number().nullable(),
      levels: z.array(z.strictObject({ label: z.string(), points: z.number().nullable(), descriptor: z.string() })),
    }),
  ),
});
export type RubricProposal = z.output<typeof RubricProposal>;

/** The JSON Schema the AI must follow (without "$schema", whose URL the proxy would take for a leak). */
export const PROPOSAL_SCHEMA: Record<string, unknown> = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(RubricProposal) as Record<string, unknown>;
  return schema;
})();

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
/** The image types the AI accepts, by a file name's ending. */
export const imageTypeOf = (name: string): string | null => TYPES[/\.([A-Za-z]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? null;

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** The size in bytes of base64 text. */
const bytesOfBase64 = (data: string) => (data.length * 3) / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

/**
 * Exactly what is sent: the image of the rubric, in a block of its own, and the instructions that go with it. The image goes
 * without its hidden metadata (names, places and the like that a picture can carry), as every image the AI is sent does; the
 * request approves that cleaned image, and the original stays in the workspace as the rubric's source.
 */
export function buildRubricRequest(image: { name: string; bytes: Uint8Array }, model: string): ReadingRequest {
  const mediaType = imageTypeOf(image.name);
  if (!mediaType) throw new Error("the rubric's image must be a png, jpg, webp or gif");
  if (!cleanable(mediaType)) throw new Error(`the hidden metadata of a ${mediaType} image can't be removed, so it can't be sent`);
  const sent = withoutMetadata(image.bytes, mediaType);
  if (!sent) throw new Error("the image couldn't be read to remove its hidden metadata, so it isn't sent; check it is a valid picture");
  const text = "The image of the rubric follows.\n\n[FIGURE_1]";
  return {
    model,
    max_output_tokens: RUBRIC_MAX_OUTPUT_TOKENS,
    prompt: { version: RUBRIC_PROMPT_VERSION, instructions: RUBRIC_INSTRUCTIONS },
    blocks: [
      {
        kind: "rubric_image",
        heading: "RUBRIC IMAGE",
        text,
        approved_sha256: sha256Text(text),
        figures: [{ placeholder: "[FIGURE_1]", media_type: mediaType, data: base64(sent), approved_sha256: sha256Bytes(sent) }],
      },
    ],
    output_schema: PROPOSAL_SCHEMA,
  };
}

/** What a rubric saved from a proposal records of how it began: the call, never the image's content. */
export interface ProposalRecord {
  prompt_version: string;
  model: string;
  provider: string;
  request_id: string | null;
  request_sha256: string;
  /** The image as chosen, which is kept as the rubric's source. */
  image_sha256: string;
  /** The image as sent, without its hidden metadata. */
  sent_sha256: string;
  cost_usd: number;
  at: string;
}

export interface RubricPlan {
  request: ReadingRequest;
  model: string;
  /** The worst case, in USD, as the proxy reserves it. */
  worstUsd: number;
  limitUsd: number;
  /** The size of the image as sent. */
  imageBytes: number;
}

/** What would be sent and what it could cost at most, before anything is: for the moderator to confirm. */
export async function planRubricReading(proxy: ReadingProxy, image: { name: string; bytes: Uint8Array }, options: { model: string; limitUsd: number }): Promise<RubricPlan> {
  const health = await proxy.health();
  if (!health.key_configured) throw new Error("the proxy has no API key, so it can't send the image; put the key in ~/Feedbacker/.env and restart the proxy, or type the grid yourself");
  if (!health.prices[options.model]) throw new Error(`no price is known for model '${options.model}', so its spend can't be bounded`);
  const request = buildRubricRequest(image, options.model);
  const [, , worstUsd] = estimate(health.prices, request);
  return { request, model: options.model, worstUsd, limitUsd: options.limitUsd, imageBytes: bytesOfBase64(request.blocks[0].figures![0].data) };
}

export interface RubricReadingResult {
  proposal: RubricProposal;
  record: ProposalRecord;
}

/** Send the confirmed request through the proxy and read what comes back; anything that isn't a complete, well-formed proposal is an error. */
export async function runRubricReading(proxy: ReadingProxy, plan: RubricPlan, image: { bytes: Uint8Array }, now: () => Date = () => new Date()): Promise<RubricReadingResult> {
  const run = await proxy.openRun(plan.limitUsd, plan.worstUsd);
  const response = (await proxy.read(run.id, plan.request)) as ProxyResponse;
  if (response.outcome !== "complete") {
    const why = response.outcome === "refused" ? "the AI declined to read it" : response.outcome === "truncated" ? "its answer was cut short (the rubric may be too long to transcribe at once)" : "its answer wasn't in the shape asked for";
    throw new Error(`the AI didn't give a proposal: ${why}`);
  }
  const parsed = RubricProposal.safeParse(response.parsed);
  if (!parsed.success) throw new Error("the AI didn't give a proposal: its answer wasn't in the shape asked for");
  return {
    proposal: parsed.data,
    record: {
      prompt_version: RUBRIC_PROMPT_VERSION,
      model: response.model_reported ?? plan.model,
      provider: response.provider,
      request_id: response.request_id,
      request_sha256: response.request_sha256,
      image_sha256: sha256Bytes(image.bytes),
      sent_sha256: plan.request.blocks[0].figures![0].approved_sha256,
      cost_usd: response.cost_usd,
      at: now().toISOString(),
    },
  };
}

const text = (n: number | null) => (n === null ? "" : String(n));

/** A proposal as the editor's grid, as typed text. A blank "out of" means the criterion's weight, so it is left blank where it is the same. */
export function proposalToGrid(p: RubricProposal): RubricGrid {
  return {
    title: p.title,
    criteria: p.criteria.map((c) => ({
      title: c.title,
      weight: text(c.weight_percent),
      max_points: c.max_points !== null && c.max_points !== c.weight_percent ? String(c.max_points) : "",
      levels: c.levels.map((l) => ({ label: l.label, points: text(l.points), descriptor: l.descriptor })),
    })),
  };
}
