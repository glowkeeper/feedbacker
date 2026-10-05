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

// What the AI may be sent (PRODUCT.md): the versioned prompt, the rubric's
// criteria and levels, the approved anonymised brief, and the approved
// anonymised submission. A drafting request (ADR 0006) may also be sent the
// educator's marking of that one submission (their levels, marks and
// anonymised comments) and their approved feedback guide for the assessment,
// each approved as exactly what is sent. A suggestion request (ADR 0006's
// amendment) is sent the rubric, the educator's marking of one criterion (or
// the overall), and their recorded feedback on it with the checks' flags,
// approved as sent, and no submission. Nothing else has a field in the request.
export const BLOCK_KINDS = ["rubric", "brief", "guide", "submission", "marking", "feedback"] as const;

/** The instructions a drafting request is sent with, and only a drafting request: "feedback-v1", "feedback-v2", … */
export const isDraftingPrompt = (version: string) => /^feedback-v\d+$/.test(version);
/** The instructions a suggestion request is sent with, and only a suggestion request: "feedback-edit-v1", … */
export const isEditPrompt = (version: string) => /^feedback-edit-v\d+$/.test(version);

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Heading = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\r\n]+$/, "a heading is a single line");

/** The image types the AI accepts (ADR 0007). */
export const FIGURE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** The provider's limits on images: base64 characters an image, images a request (ADR 0007). */
export const MAX_FIGURE_BASE64 = 10 * 1024 * 1024;
export const MAX_FIGURES = 100;
const PLACEHOLDER = /^\[FIGURE_[1-9][0-9]*\]$/;

/** A figure sent with a submission (ADR 0007): its image, placed after its placeholder, as approved. */
export const FigurePart = z.strictObject({
  placeholder: z.string().regex(PLACEHOLDER),
  media_type: z.enum(FIGURE_TYPES),
  data: z.string().max(MAX_FIGURE_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/, "an image's data is base64"),
  approved_sha256: Sha256,
});
export type FigurePart = z.output<typeof FigurePart>;

export const Block = z.strictObject({
  kind: z.enum(BLOCK_KINDS),
  heading: Heading,
  text: z.string().max(2_000_000),
  approved_sha256: Sha256.nullable().default(null),
  // A submission's approved figures, in a reading or a proposal only; and its figures that are not sent, each marked so where it was.
  figures: z.array(FigurePart).max(MAX_FIGURES).default([]),
  figures_not_sent: z.array(z.string().regex(PLACEHOLDER)).max(1000).default([]),
});
export type Block = z.output<typeof Block>;

export const ReadRequest = z.strictObject({
  model: z.string().min(1).max(64),
  max_output_tokens: z.int().min(1).max(128_000),
  prompt: z.strictObject({
    version: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    instructions: z.string().min(1).max(200_000),
  }),
  blocks: z.array(Block).min(2).max(5),
  output_schema: z.record(z.string(), z.unknown()),
});
export type ReadRequest = z.output<typeof ReadRequest>;

const MAX_SCHEMA_BYTES = 64_000;

export class Refusal extends Error {
  readonly type: "boundary" | "leak" | "spend" | "model" | "run" | "key" | "batch";

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

/** The block's text as it is sent: its heading, a blank line, then its text (as the Python reading renders it), each figure that isn't sent marked where it was. */
export const renderBlock = (block: z.input<typeof Block>) => {
  let text = block.text;
  for (const placeholder of block.figures_not_sent ?? []) text = text.replace(placeholder, `${placeholder} (figure not sent)`);
  return `${block.heading}\n\n${text}`;
};

/** A part of a block as it is sent: text, or an image. */
export type Part = { type: "text"; text: string } | { type: "image"; media_type: FigurePart["media_type"]; data: string };

/** The block as it is sent: its text, or, with figures, its text split after each figure's placeholder with the image there. */
export function renderParts(block: Block): string | Part[] {
  const text = renderBlock(block);
  if (!block.figures.length) return text;
  const parts: Part[] = [];
  let from = 0;
  const at = (p: string) => text.indexOf(p);
  for (const f of [...block.figures].sort((a, b) => at(a.placeholder) - at(b.placeholder))) {
    const end = at(f.placeholder) + f.placeholder.length;
    parts.push({ type: "text", text: text.slice(from, end) }, { type: "image", media_type: f.media_type, data: f.data });
    from = end;
  }
  if (from < text.length) parts.push({ type: "text", text: text.slice(from) });
  return parts;
}

/** Every figure sent in a request. */
export const figuresOf = (request: ReadRequest) => request.blocks.flatMap((b) => b.figures);

/**
 * Check the request's shape against the rules on what the AI may be sent. The order is
 * fixed, stable content first: the rubric, an optional brief, then exactly
 * one submission, and, in a drafting request only, the educator's marking of
 * it. A suggestion request is the rubric, the marking, then the educator's
 * feedback, and nothing else. Approved text must still hash to its approval.
 */
export function checkBoundary(request: ReadRequest): void {
  const kinds = request.blocks.map((b) => b.kind).join(",");
  const drafting = isDraftingPrompt(request.prompt.version);
  const editing = isEditPrompt(request.prompt.version);
  const reading = kinds === "rubric,brief,submission" || kinds === "rubric,submission";
  // A drafting request: the rubric, an optional brief, an optional feedback guide, the submission, then the marking.
  const draftingShape = /^rubric,(?:brief,)?(?:guide,)?submission,marking$/.test(kinds);
  if (editing ? kinds !== "rubric,marking,feedback" : drafting ? !draftingShape : !reading) {
    throw new Refusal(
      "boundary",
      editing
        ? `a suggestion request's blocks must be a rubric, the educator's marking, then their feedback (got ${kinds})`
        : drafting
          ? `a drafting request's blocks must be a rubric, an optional brief, an optional feedback guide, one submission, then the educator's marking (got ${kinds})`
          : kinds.includes("feedback")
            ? "the educator's feedback may be sent only in a suggestion request"
            : kinds.includes("marking") || kinds.includes("guide")
              ? "the educator's marking and feedback guide may be sent only in a drafting request"
              : `blocks must be a rubric, an optional brief, then one submission (got ${kinds})`,
    );
  }
  for (const block of request.blocks) {
    if (block.kind !== "rubric" && block.kind !== "brief" && block.approved_sha256 === null) {
      throw new Refusal("boundary", `the ${block.kind} block has no approval hash`);
    }
    if (block.kind === "rubric" && block.approved_sha256 !== null) {
      throw new Refusal("boundary", "the rubric block needs no approval hash");
    }
    if (block.approved_sha256 !== null && sha256Text(block.text) !== block.approved_sha256) {
      throw new Refusal("boundary", `the ${block.kind} text does not match its approval hash`);
    }
    checkFigures(block, !drafting && !editing);
  }
  if (Buffer.byteLength(JSON.stringify(request.output_schema)) > MAX_SCHEMA_BYTES) {
    throw new Refusal("boundary", `the output schema is larger than ${MAX_SCHEMA_BYTES} bytes`);
  }
}

/**
 * A submission's figures (ADR 0007): only in a reading or a proposal, each in the text once, as approved. Each image
 * must hash to the approval it is sent under; a figure marked as not sent must be in the text, and not sent too.
 */
function checkFigures(block: Block, reading: boolean): void {
  if (!block.figures.length && !block.figures_not_sent.length) return;
  if (block.kind !== "submission" || !reading) throw new Refusal("boundary", "figures may be sent only with a submission, in a reading or a proposal");
  const placeholders = [...block.figures.map((f) => f.placeholder), ...block.figures_not_sent];
  if (new Set(placeholders).size !== placeholders.length) throw new Refusal("boundary", "a figure is given twice");
  for (const p of placeholders) {
    if (block.text.split(p).length !== 2) throw new Refusal("boundary", `${p} is not in the submission's text exactly once`);
  }
  for (const f of block.figures) {
    if (createHash("sha256").update(Buffer.from(f.data, "base64")).digest("hex") !== f.approved_sha256) {
      throw new Refusal("boundary", `the image of ${f.placeholder} does not match its approval hash`);
    }
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
