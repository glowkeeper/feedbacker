/**
 * The contract is generated, keeps judgement types distinct, and agrees with
 * the Python reference models. A port of `core/tests/test_contract.py`, plus
 * the conformance cases shared with it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CONTRACT_TYPES, ContractError, serialiseRecord } from "../src/core/index.ts";
import { render } from "../scripts/contract.ts";
import { ROOT, clone } from "./helpers.ts";

const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

test("the schema is up to date", () => {
  expect(render(), "run `npm run contract`").toBe(read("contract/feedbacker.schema.json"));
});

test("contract types have distinct kinds", () => {
  const kinds = Object.values(CONTRACT_TYPES).map((schema) => schema.shape.kind.parse(undefined));
  expect(new Set(kinds).size).toBe(kinds.length);
  for (const kind of ["ai_suggestion", "moderator_judgement", "original_assessment"]) expect(kinds).toContain(kind);
});

// --- Conformance with the Python reference ------------------------------------

type Step = string | number;
type Op =
  | { op: "set"; path: Step[]; value: unknown }
  | { op: "remove"; path: Step[] }
  | { op: "duplicate"; path: Step[]; index: number };
interface Case {
  name: string;
  type: keyof typeof CONTRACT_TYPES;
  valid: boolean;
  fixture?: string;
  data?: unknown;
  select?: Step[];
  patch?: Op[];
}

/** Negative indexes count from the end, as in Python. */
const at = (container: any, step: Step) =>
  Array.isArray(container) && typeof step === "number" && step < 0 ? container.length + step : step;

/** The case's input, built exactly as `feedbacker_core.contract.build_case` builds it. */
function buildCase(c: Case): unknown {
  let data: any = clone(c.fixture ? JSON.parse(read(c.fixture)) : c.data);
  for (const step of c.select ?? []) data = data[at(data, step)];
  for (const op of c.patch ?? []) {
    let container = data;
    for (const step of op.path.slice(0, -1)) container = container[at(container, step)];
    const key = at(container, op.path[op.path.length - 1]);
    if (op.op === "set") container[key] = clone(op.value);
    else if (op.op === "remove") Array.isArray(container) ? container.splice(key as number, 1) : delete container[key];
    else container[key].push(clone(container[key][at(container[key], op.index)]));
  }
  return data;
}

const { cases } = JSON.parse(read("contract/conformance.json")) as { cases: Case[] };
const expected = JSON.parse(read("contract/conformance.expected.json")) as Record<string, unknown>;

describe("conformance with the Python reference models", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const result = CONTRACT_TYPES[c.type].safeParse(buildCase(c));
    const detail = result.success ? "" : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    expect(result.success, detail).toBe(c.valid);
    // What this core writes must be exactly what the Python reference writes.
    if (result.success) expect(result.data).toEqual(expected[c.name]);
  });

  test("every valid case has a Python reference output", () => {
    expect(Object.keys(expected).sort()).toEqual(cases.filter((c) => c.valid).map((c) => c.name).sort());
  });
});

// --- Serialising records --------------------------------------------------------

describe("serialising records", () => {
  const byName = (name: string) => cases.find((c) => c.name === name)!;

  test("writes exactly what the Python reference writes, formatted as the workspace stores it", () => {
    const c = byName("example moderation record");
    const written = serialiseRecord(CONTRACT_TYPES[c.type], buildCase(c));
    expect(written.endsWith("}\n")).toBe(true);
    expect(written.split("\n")[1]).toMatch(/^ {2}"kind": "moderation_record",$/);
    expect(JSON.parse(written)).toEqual(expected[c.name]);
  });

  test("normalises timestamps on the way out", () => {
    const c = byName("timestamps are written in one form");
    const written = JSON.parse(serialiseRecord(CONTRACT_TYPES[c.type], buildCase(c)));
    expect(written.revealed_at).toBe("2026-01-15T09:20:00Z");
    expect(written.revised.recorded_at).toBe("2026-01-15T09:25:00.123456Z");
  });

  test("refuses to write an invalid record", () => {
    const c = byName("judgement from a model");
    expect(() => serialiseRecord(CONTRACT_TYPES[c.type], buildCase(c), "judgement")).toThrow(ContractError);
    expect(() => serialiseRecord(CONTRACT_TYPES[c.type], buildCase(c), "judgement")).toThrow(
      "invalid judgement:\n- a moderator judgement's provenance actor must be the moderator",
    );
  });
});
