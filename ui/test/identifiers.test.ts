/** What looks like an identifier in text about to be sent: found by the app, shown with where it is, and added to the rules. All material is synthetic. */

import { expect, test } from "vitest";
import { findLeaks, LEAK_PATTERNS } from "../../proxy/src/boundary.ts";
import { fakeAnthropic } from "../../proxy/test/fakeAnthropic.ts";
import {
  addIdentifiersToRules,
  anonymiseWorkspace,
  approve,
  bytesSource,
  describeIdentifiers,
  IDENTIFIER_PATTERNS,
  identifierMatches,
  importOriginals,
  importRubric,
  loadRules,
  planReadings,
  recordRequest,
  valuesToRedact,
} from "../src/core/index.ts";
import { docx, makeZip, packFile, para } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

const TABLE = "The scores were 0.156 0.20 0.206 0.00 0 for the first run and 00 2.23 1 14 1.28 for the second.";

test("the app's patterns are the proxy's, exactly", () => {
  expect(IDENTIFIER_PATTERNS.map(([what, p]) => [what, p.source, p.flags])).toEqual(LEAK_PATTERNS.map(([what, p]) => [what, p.source, p.flags]));
});

test("each match is found with what it looks like, as the proxy sees it", () => {
  const text = `${"a ".repeat(50)}${TABLE} Write to j.pike@example.com or ring 07700 900123. Student 12345678.`;
  const matches = identifierMatches(text, "submission");
  expect(matches.map((m) => [m.kind, m.value]).sort()).toEqual(
    [
      ["a long number (7 or more digits)", "12345678"],
      ["a phone number", "00 2.23 1 14 1.28"],
      ["a phone number", "0.156 0.20 0.206 0.00 0"],
      ["a phone number", "07700 900123"],
      ["an email address", "j.pike@example.com"],
    ].sort(),
  );
  expect(matches.every((m) => m.where === "submission")).toBe(true);
});

test("it reports what the proxy would, in the same words, and nothing for clean text", () => {
  const text = `${TABLE} Write to j.pike@example.com.`;
  const matches = identifierMatches(text);
  expect(describeIdentifiers(matches)).toBe("an email address and a phone number (2 times)"); // in the proxy's order
  expect(findLeaks(text).sort()).toEqual(["a phone number (2 times)", "an email address"]);
  expect(identifierMatches("Nothing to find here: 3 tests, 42%, version 1.2.")).toEqual([]);
  const [first] = identifierMatches(`Before the scores: ${TABLE}`);
  expect(first.value).toBe("0.156 0.20 0.206 0.00 0");
  expect(first.before.endsWith("The scores were ")).toBe(true);
  expect(first.after.startsWith(" for the first run")).toBe(true);
  expect(first.position).toBeGreaterThan(0.2);
  expect(first.position).toBeLessThan(0.5);
});

test("a submission that looks like it holds an identifier is left out of the plan with what was found; added to the rules, it can be read", async () => {
  const fake = fakeAnthropic([]);
  const { ws, client } = await newWorkspace("ids-1", { provider: fake.provider });
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
  const leaky = docx({ body: para("Report") + para(TABLE) + para("The end.") });
  await importOriginals(ws, bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": leaky, "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })));
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  await approve(ws, "sub-002");
  const plan = await planReadings(ws, client, null, { withBrief: false });
  expect(plan.readings.map((r) => r.submissionId)).toEqual(["sub-002"]); // the other can't be sent
  expect(plan.skipped.get("sub-001")).toBe("can't be sent, because it may identify someone: the submission contains a phone number (2 times). What was found is listed below, to add to the anonymisation rules");
  const found = plan.identifiers.get("sub-001")!;
  expect(found.map((m) => [m.where, m.value])).toEqual([["submission", "0.156 0.20 0.206 0.00 0"], ["submission", "00 2.23 1 14 1.28"]]);
  expect(plan.identifiers.has("sub-002")).toBe(false);
  // Added to the rules in one action, then anonymised and approved again, it reads.
  expect(valuesToRedact(found)).toEqual(["0.156 0.20 0.206 0.00 0", "00 2.23 1 14 1.28"]);
  expect(await addIdentifiersToRules(ws, found)).toBe(2);
  expect(Object.entries((await loadRules(ws)).redact)).toEqual([["0.156 0.20 0.206 0.00 0", "REDACTED"], ["00 2.23 1 14 1.28", "REDACTED"]]);
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const again = await planReadings(ws, client, null, { withBrief: false });
  expect(again.readings.map((r) => r.submissionId).sort()).toEqual(["sub-001", "sub-002"]);
  expect(again.identifiers.size).toBe(0);
  expect(await addIdentifiersToRules(ws, [])).toBe(0);
});
