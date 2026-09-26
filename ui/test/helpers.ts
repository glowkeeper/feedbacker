/** Shared test data, mirroring `core/tests/conftest.py`. */

import { readFileSync } from "node:fs";
import {
  AnonymisedText,
  Approval,
  Extract,
  ModelCall,
  Provenance,
  Rubric,
  sha256Text,
  type Actor,
  type Transformation,
} from "../src/core/index.ts";

export const ROOT = new URL("../../", import.meta.url);
export const PACK = new URL("fixtures/synthetic/pack-01/", ROOT);
const T0 = Date.UTC(2026, 0, 15, 9, 0);
export const MODERATOR: Actor = { kind: "moderator", label: "moderator" };
export const MODEL: Actor = { kind: "model", label: "test-model" };

/** A timestamp `minutes` after the fixtures' start time, as Python writes it. */
export const t = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString().replace(".000Z", "Z");
export const h = sha256Text;

export const prov = (actor: Actor = MODERATOR, transformation: Transformation = "recorded", minutes = 0) =>
  Provenance.parse({ source: "test", transformation, actor, timestamp: t(minutes) });

export const load = (name: string) => JSON.parse(readFileSync(new URL(name, PACK), "utf8"));
export const rubric = () => Rubric.parse(load("rubric.json"));
export const exampleRecord = () => load("moderation-record.example.json");
export const clone = <T>(value: T): T => structuredClone(value);

/** Extend a hash-only submission with extract, anonymised text, and approval. */
export function approvedSubmission(submission: Record<string, unknown>) {
  const anon = "[STUDENT_B] wrote this.";
  return {
    ...clone(submission),
    extract: Extract.parse({
      text: "Jordan Pike wrote this.",
      source_sha256: submission.source_sha256,
      provenance: prov(MODERATOR, "extracted"),
    }),
    anonymised: AnonymisedText.parse({
      text: anon,
      text_sha256: h(anon),
      redactions: [{ start: 0, end: 11, replacement: "[STUDENT_B]", reason: "name" }],
      provenance: prov(MODERATOR, "anonymised"),
    }),
    approval: Approval.parse({ id: "appr-b", approved_text_sha256: h(anon), approved_by: MODERATOR, approved_at: t(1) }),
  } as Record<string, any>;
}

export const modelCall = (overrides: Record<string, unknown> = {}) =>
  ModelCall.parse({
    provider: "test",
    model_requested: "test-model",
    prompt_version: "p1",
    rubric_version: "1.0",
    approval_id: "appr-b",
    approved_text_sha256: h("[STUDENT_B] wrote this."),
    request_sha256: h("request"),
    produced_by: "live",
    timestamp: t(2),
    ...overrides,
  });

export const aiSuggestion = (overrides: Record<string, unknown> = {}) => ({
  kind: "ai_suggestion",
  id: "ai-1",
  submission_id: "sub-b",
  criterion_id: "design",
  suggested_level_id: "p48",
  rationale: "Design is not justified.",
  evidence: [{ text: "wrote this", verified: true }],
  call: modelCall(),
  provenance: prov(MODEL, "generated", 2),
  ...overrides,
});
