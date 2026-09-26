/**
 * What the app may ask the proxy to send, and the checks run before anything
 * leaves the machine (ADR 0004).
 *
 * The app's approval gate is the privacy control. These checks are a
 * backstop: they refuse a request whose shape goes beyond the model data
 * boundary in PRODUCT.md, whose submission text isn't the text that was
 * approved, or whose text contains what looks like a direct identifier.
 * Refusal reasons name the block and the kind of problem, never the text.
 */

import { createHash } from "node:crypto";
import * as z from "zod";

// The model data boundary (PRODUCT.md): the versioned prompt, the rubric's
// criteria and levels, the approved anonymised brief, and the approved
// anonymised submission. Nothing else has a field in the request.
export const BLOCK_KINDS = ["rubric", "brief", "submission"] as const;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Heading = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\r\n]+$/, "a heading is a single line");

export const Block = z.strictObject({
  kind: z.enum(BLOCK_KINDS),
  heading: Heading,
  text: z.string().max(2_000_000),
  approved_sha256: Sha256.nullable().default(null),
});
export type Block = z.output<typeof Block>;

export const ReadRequest = z.strictObject({
  model: z.string().min(1).max(64),
  max_output_tokens: z.int().min(1).max(128_000),
  prompt: z.strictObject({
    version: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    instructions: z.string().min(1).max(200_000),
  }),
  blocks: z.array(Block).min(2).max(3),
  output_schema: z.record(z.string(), z.unknown()),
});
export type ReadRequest = z.output<typeof ReadRequest>;

const MAX_SCHEMA_BYTES = 64_000;

export class Refusal extends Error {
  readonly type: "boundary" | "leak" | "spend" | "model" | "run" | "key";

  constructor(type: Refusal["type"], message: string) {
    super(message);
    this.name = "Refusal";
    this.type = type;
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** SHA-256 of UTF-8 text, as the core's `sha256Text` and Python's `sha256_text` compute it. */
export function sha256Text(text: string): string {
  if (LONE_SURROGATE.test(text)) throw new Refusal("boundary", "text contains a lone surrogate and cannot be encoded as UTF-8");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The block as it is sent: its heading, a blank line, then its text (as the Python reading renders it). */
export const renderBlock = (block: Block) => `${block.heading}\n\n${block.text}`;

/**
 * Check the request's shape against the model data boundary. The order is
 * fixed, stable content first: the rubric, an optional brief, then exactly
 * one submission. Approved text must still hash to its approval.
 */
export function checkBoundary(request: ReadRequest): void {
  const kinds = request.blocks.map((b) => b.kind).join(",");
  if (kinds !== "rubric,brief,submission" && kinds !== "rubric,submission") {
    throw new Refusal("boundary", `blocks must be a rubric, an optional brief, then one submission (got ${kinds})`);
  }
  for (const block of request.blocks) {
    if (block.kind === "submission" && block.approved_sha256 === null) {
      throw new Refusal("boundary", "the submission block has no approval hash");
    }
    if (block.kind === "rubric" && block.approved_sha256 !== null) {
      throw new Refusal("boundary", "the rubric block needs no approval hash");
    }
    if (block.approved_sha256 !== null && sha256Text(block.text) !== block.approved_sha256) {
      throw new Refusal("boundary", `the ${block.kind} text does not match its approval hash`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(request.output_schema)) > MAX_SCHEMA_BYTES) {
    throw new Refusal("boundary", `the output schema is larger than ${MAX_SCHEMA_BYTES} bytes`);
  }
}

// --- Leak checks ---------------------------------------------------------------

/**
 * Patterns for direct identifiers that anonymisation replaces with tokens
 * such as [EMAIL_1] or [ID_1]. Finding one means something slipped through.
 */
export const LEAK_PATTERNS: [string, RegExp][] = [
  ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
  ["a web address", /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi],
  ["a phone number", /(?:\+|\b0)(?:[ ().-]*\d){9,14}\b/g],
  // Student and submission IDs; not decimals such as 0.1234567.
  ["a long number (7 or more digits)", /(?<![\d.])\d{7,}(?!\.\d)/g],
];

/** What looks like a direct identifier in `text`, by kind and count; never the values. */
export function findLeaks(text: string): string[] {
  const found: string[] = [];
  for (const [what, pattern] of LEAK_PATTERNS) {
    const count = [...text.matchAll(pattern)].length;
    if (count) found.push(count === 1 ? what : `${what} (${count} times)`);
  }
  return found;
}

/** Refuse the request if any text that would leave the machine contains an apparent identifier. */
export function checkLeaks(request: ReadRequest): void {
  const parts: [string, string][] = [
    ["the prompt version", request.prompt.version],
    ["the model name", request.model],
    ["the instructions", request.prompt.instructions],
    ...request.blocks.map((b) => [`the ${b.kind} block`, renderBlock(b)] as [string, string]),
    ["the output schema", JSON.stringify(request.output_schema)],
  ];
  const problems = parts.flatMap(([where, text]) => findLeaks(text).map((what) => `${where} contains ${what}`));
  if (problems.length) {
    throw new Refusal("leak", `not sent, because it may identify someone: ${problems.join("; ")}`);
  }
}
