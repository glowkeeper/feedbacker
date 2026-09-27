/** Agreement across the sample (#19): by submission and by criterion, from the same comparison the review shows. */

import { expect, test } from "vitest";
import { describe, loadAgreement } from "../src/app/agreement.ts";
import {
  anonymiseWorkspace,
  approve,
  bytesSource,
  chooseReviewMode,
  enterMarking,
  importOriginals,
  importRubric,
  loadRubric,
  recordJudgement,
  recordRequest,
  recordVerdict,
  reveal,
} from "../src/core/index.ts";
import { makeZip, packFile, suggestion } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

test("agreement is counted by submission and by criterion, and a blind review only once revealed", async () => {
  const { ws } = await newWorkspace();
  expect(await loadAgreement(ws)).toBeNull(); // no rubric yet
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
  await importOriginals(
    ws,
    bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  await approve(ws, "sub-002");
  const rubric = await loadRubric(ws);
  const [a, b, c] = rubric.criteria;
  const at = (crit: typeof a, points: number) => crit.levels.find((l) => l.points === points)!.id;

  // sub-001, open: the marker gave a 75 and b 62; the AI suggests the top level throughout.
  await enterMarking(ws, "sub-001", { criteria: { [a.id]: 75, [b.id]: 62 } });
  const sub1 = (await ws.readJson("submissions/sub-001.json")) as { approval: { approved_text_sha256: string } };
  await ws.writeJson("readings/sub-001.json", rubric.criteria.map((x) => suggestion("sub-001", x.id, sub1.approval.approved_text_sha256, { suggested_level_id: x.levels[0].id })));
  await recordJudgement(ws, "sub-001", a.id, { levelId: at(a, 68) });
  await recordJudgement(ws, "sub-001", b.id, { levelId: at(b, 62) });
  await recordVerdict(ws, "sub-001", { verdict: "generous" });

  // sub-002, blind: judged but not revealed, so not counted.
  await chooseReviewMode(ws, "sub-002", "blind");
  for (const x of rubric.criteria) await recordJudgement(ws, "sub-002", x.id, { levelId: at(x, 55) });

  let agreement = (await loadAgreement(ws))!;
  const [one, two] = agreement.submissions;
  expect(one).toMatchObject({ id: "sub-001", status: "compared", compared: 2, marking: { agree: 1, higher: 1, lower: 0, different: 0 }, ai: { agree: 0, higher: 2 }, verdict: "generous" });
  expect(two).toMatchObject({ id: "sub-002", status: "hidden", compared: 0, verdict: null });
  expect(agreement.criteria.map((x) => [x.id, x.compared, x.marking.agree, x.marking.higher])).toEqual([
    [a.id, 1, 0, 1],
    [b.id, 1, 1, 0],
    [c.id, 0, 0, 0],
    [rubric.criteria[3].id, 0, 0, 0],
  ]);
  expect(describe(one.marking, "marking")).toBe("1 agree; 1 differs (1 more generous)");
  expect(describe(one.ai, "ai")).toBe("0 agree; 2 differ (2 higher)");
  expect(describe(agreement.criteria[2].marking, "marking")).toBe("Nothing to compare");

  // Revealed, sub-002 counts: it has no marking, and no AI reading, so there's nothing to compare but its criteria.
  await reveal(ws, "sub-002");
  agreement = (await loadAgreement(ws))!;
  expect(agreement.submissions[1]).toMatchObject({ status: "compared", compared: 4, marking: { agree: 0, higher: 0, lower: 0, different: 0 } });
  expect(agreement.criteria[2].compared).toBe(1);
});

test("a submission not yet chosen or not approved isn't compared", async () => {
  const { ws } = await newWorkspace();
  await recordRequest(ws, [{ external_id: "100200301" }, { external_id: "100200302" }]);
  await importOriginals(
    ws,
    bytesSource("o.zip", makeZip({ "100200301 - QUILL AVERY . - a.docx": packFile("submissions/sub-a.docx"), "100200302 - PIKE JORDAN - b.pdf": packFile("submissions/sub-b.pdf") })),
  );
  await importRubric(ws, bytesSource("rubric.csv", packFile("rubric.csv")), { title: "Synthetic" });
  await anonymiseWorkspace(ws);
  await approve(ws, "sub-001");
  const { submissions } = (await loadAgreement(ws))!;
  expect(submissions.map((s) => s.status)).toEqual(["not judged", "unavailable"]);
});
