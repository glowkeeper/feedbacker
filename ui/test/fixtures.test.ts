/**
 * The synthetic pack is valid and internally consistent. A port of
 * `core/tests/test_fixtures.py`, except its two checks on the zip timestamps
 * and modified times inside the docx and xlsx fixtures: those test the Python
 * fixture generator, which stays in Python (ADR 0004), so they stay there.
 */

import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ModerationRecord, OriginalAssessment, Rubric } from "../src/core/index.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PACK, exampleRecord, load } from "./helpers.ts";

test("the rubric is valid", () => {
  expect(Rubric.parse(load("rubric.json")).criteria.map((c) => c.id)).toEqual([
    "design",
    "implementation",
    "testing",
    "reflection",
  ]);
});

test("the original assessments are valid", () => {
  const originals = load("original-assessments.json").map((o: unknown) => OriginalAssessment.parse(o));
  expect(new Set(originals.map((o: OriginalAssessment) => o.submission_id))).toEqual(
    new Set(["sub-a", "sub-b", "sub-c", "sub-d"]),
  );
});

test("the example record is valid", () => {
  const revised = ModerationRecord.parse(exampleRecord()).judgements.filter((j) => j.revised);
  expect(revised).toHaveLength(1);
  expect(revised[0].first.level_id).not.toBe(revised[0].revised?.level_id);
});

test("submission hashes match their files", () => {
  for (const sub of exampleRecord().submissions) {
    const bytes = readFileSync(new URL(`submissions/${sub.id}.${sub.source_format}`, PACK));
    expect(bytesToHex(sha256(bytes)), sub.id).toBe(sub.source_sha256);
  }
});

test("the pack covers both formats", () => {
  const subs = exampleRecord().submissions;
  expect(new Set(subs.map((s: any) => s.source_format))).toEqual(new Set(["docx", "pdf"]));
  expect(subs.length).toBeGreaterThanOrEqual(3);
  expect(subs.length).toBeLessThanOrEqual(5);
});

test("seeded identifiers use reserved domains", () => {
  for (const ids of Object.values(load("seeded-identifiers.json")) as { emails: string[]; urls: string[] }[]) {
    for (const value of [...ids.emails, ...ids.urls]) {
      expect(["example.com", "example.org", "example.net"].some((d) => value.includes(d)), value).toBe(true);
    }
  }
});

test("the pack declares that it is synthetic", () => {
  expect(readFileSync(new URL("README.md", PACK), "utf8")).toContain("It contains no real data");
});

test("every JSON fixture in the pack validates", () => {
  // Beyond the Python tests: each JSON file is either a contract record or known not to be one.
  const notRecords = new Set(["seeded-identifiers.json"]);
  const files = readdirSync(PACK).filter((f) => f.endsWith(".json") && !notRecords.has(f));
  expect(files.sort()).toEqual(["moderation-record.example.json", "original-assessments.json", "rubric.json"]);
});
