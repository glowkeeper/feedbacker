/** Malformed records are rejected with clear errors. A port of `core/tests/test_models.py`. */

import { describe, expect, test } from "vitest";
import * as z from "zod";
import {
  AISuggestion,
  Approval,
  ContractError,
  Level,
  ModerationRecord,
  ModeratorJudgement,
  OriginalAssessment,
  parseRecord,
  Rubric,
  Submission,
  SubmissionVerdict,
  criterionOf,
} from "../src/core/index.ts";
import {
  MODEL,
  MODERATOR,
  aiSuggestion,
  approvedSubmission,
  clone,
  exampleRecord,
  h,
  modelCall,
  prov,
  rubric,
  t,
} from "./helpers.ts";

function rejects(schema: z.ZodType, data: unknown, message: string) {
  let error: unknown;
  try {
    parseRecord(schema, data);
  } catch (err) {
    error = err;
  }
  expect(error, "expected the record to be rejected").toBeInstanceOf(ContractError);
  expect((error as ContractError).message).toContain(message);
}

// --- The three judgement types cannot be confused ---------------------------

describe("the three judgement types cannot be confused", () => {
  test("an AI suggestion cannot parse as a moderator judgement", () => {
    rejects(ModeratorJudgement, aiSuggestion(), 'expected "moderator_judgement"');
  });

  test("a moderator judgement cannot parse as an AI suggestion", () => {
    rejects(AISuggestion, exampleRecord().judgements[0], 'expected "ai_suggestion"');
  });

  test("an original assessment cannot parse as a moderator judgement", () => {
    rejects(ModeratorJudgement, exampleRecord().original_assessments[0], 'expected "moderator_judgement"');
  });

  test("an AI suggestion must come from a model", () => {
    rejects(AISuggestion, aiSuggestion({ provenance: prov(MODERATOR) }), "actor must be a model");
  });

  test("a judgement must come from the moderator", () => {
    const data = clone(exampleRecord().judgements[0]);
    data.provenance.actor = MODEL;
    rejects(ModeratorJudgement, data, "actor must be the moderator");
  });

  test("an original assessment cannot come from a model", () => {
    const data = clone(exampleRecord().original_assessments[0]);
    data.provenance.actor = MODEL;
    rejects(OriginalAssessment, data, "original marker");
  });

  test("unknown fields are rejected", () => {
    const data = { ...clone(exampleRecord().judgements[0]), final_mark: 70 };
    rejects(ModeratorJudgement, data, 'Unrecognized key: "final_mark"');
  });
});

// --- Judge first, then reveal ------------------------------------------------

const judgement = (overrides: Record<string, unknown> = {}) => ({
  submission_id: "sub-b",
  criterion_id: "design",
  mode: "blind",
  first: { level_id: "p48", recorded_at: t(10) },
  provenance: prov(),
  ...overrides,
});

describe("judge first, then reveal", () => {
  test("the first judgement must precede the reveal", () => {
    rejects(ModeratorJudgement, judgement({ revealed_at: t(5) }), "before the reveal");
  });

  test("a revision requires a reveal", () => {
    rejects(
      ModeratorJudgement,
      judgement({ revised: { level_id: "p35", recorded_at: t(20) } }),
      "only possible after the reveal",
    );
  });

  test("a revision must follow the reveal", () => {
    rejects(
      ModeratorJudgement,
      judgement({ revealed_at: t(15), revised: { level_id: "p35", recorded_at: t(12) } }),
      "after the reveal",
    );
  });

  test("valid first and revised judgements are both kept", () => {
    const j = ModeratorJudgement.parse(
      judgement({ revealed_at: t(15), revised: { level_id: "p35", recorded_at: t(16) } }),
    );
    expect([j.first.level_id, j.revised?.level_id]).toEqual(["p48", "p35"]);
  });
});

// --- Pipeline integrity --------------------------------------------------------

describe("pipeline integrity", () => {
  const subB = () => approvedSubmission(exampleRecord().submissions[1]);

  test("the approval must match the anonymised text", () => {
    const sub = subB();
    sub.approval.approved_text_sha256 = h("something else");
    rejects(Submission, sub, "approval does not match");
  });

  test("an approval requires anonymised text", () => {
    const sub = subB();
    delete sub.anonymised;
    rejects(Submission, sub, "approval requires anonymised text");
  });

  test("an approval must be given by the moderator", () => {
    rejects(
      Approval,
      { id: "a", approved_text_sha256: h("x"), approved_by: MODEL, approved_at: t(1) },
      "approval must be given by the moderator",
    );
  });

  test("the extract must match the submission's source", () => {
    const sub = subB();
    sub.extract.source_sha256 = h("other file");
    rejects(Submission, sub, "extract source hash does not match");
  });

  test("a cached result must link to its origin", () => {
    expect(() => modelCall({ produced_by: "cache" })).toThrow("link to the originating request");
  });

  test.each([
    ["source_sha256", "not-a-hash", "must match pattern"],
    ["pseudonym", "Jordan Pike", "must match pattern"],
    ["source_format", "odt", 'expected one of "docx"|"pdf"'],
    ["source_kind", "email", 'expected one of "marked_view"|"original"'],
  ])("submission field format: %s", (field, value, message) => {
    rejects(Submission, { ...exampleRecord().submissions[0], [field]: value }, message);
  });

  test("a level's mark range must be ordered", () => {
    rejects(Level, { id: "x", label: "X", descriptor: "d", min_mark: 70, max_mark: 40 }, "exceeds max_mark");
    rejects(Level, { id: "x", label: "X", descriptor: "d", min_mark: 70, max_mark: 40 }, "min_mark 70.0 exceeds max_mark 40.0");
  });

  test("duplicate criteria are rejected", () => {
    const data = clone(rubric());
    data.criteria.push(data.criteria[0]);
    rejects(Rubric, data, "duplicate rubric criterion 'design'");
  });
});

// --- Moderation record cross-references ----------------------------------------

const recordWith = (changes: Record<string, unknown>) => ({ ...clone(exampleRecord()), ...changes });

describe("moderation record cross-references", () => {
  const approvedSubs = () => {
    const subs = clone(exampleRecord().submissions);
    subs[1] = approvedSubmission(subs[1]);
    return subs;
  };

  test("a valid record with an AI suggestion", () => {
    const record = ModerationRecord.parse(recordWith({ submissions: approvedSubs(), ai_suggestions: [aiSuggestion()] }));
    expect(record.ai_suggestions[0].call.approval_id).toBe(record.submissions[1].approval?.id);
  });

  test("an AI suggestion requires an approved submission", () => {
    rejects(ModerationRecord, recordWith({ ai_suggestions: [aiSuggestion()] }), "submission 'sub-b' has no approval");
  });

  test("an AI suggestion's rubric version must match", () => {
    const bad = aiSuggestion({ call: modelCall({ rubric_version: "2.0" }) });
    rejects(
      ModerationRecord,
      recordWith({ submissions: approvedSubs(), ai_suggestions: [bad] }),
      "rubric version '2.0' does not match '1.0'",
    );
  });

  test("an unknown criterion and a foreign level are reported together", () => {
    const data = clone(exampleRecord());
    data.judgements[0].criterion_id = "security";
    data.judgements[1].first.level_id = "distinction";
    let message = "";
    try {
      parseRecord(ModerationRecord, data);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("unknown criterion 'security'");
    expect(message).toContain("level 'distinction' is not a level of criterion 'implementation'");
  });

  test("a duplicate judgement is rejected", () => {
    const data = clone(exampleRecord());
    data.judgements.push(data.judgements[0]);
    rejects(ModerationRecord, data, "duplicate moderator judgement 'sub-b/design'");
  });

  test("record approval must be complete and by the moderator", () => {
    rejects(ModerationRecord, recordWith({ approved_at: t(40) }), "needs both approved_by and approved_at");
    rejects(ModerationRecord, recordWith({ approved_at: t(40), approved_by: MODEL }), "must be approved by the moderator");
  });

  test("timestamps must be timezone-aware", () => {
    const data = clone(exampleRecord().judgements[0]);
    data.first.recorded_at = "2026-01-15T09:10:00";
    rejects(ModeratorJudgement, data, "first.recorded_at: Invalid ISO datetime");
  });
});

// --- Open and blind review ---------------------------------------------------

describe("open and blind review", () => {
  test("open review is the default and has no reveal", () => {
    const { mode: _, ...withoutMode } = judgement();
    expect(ModeratorJudgement.parse(withoutMode).mode).toBe("open");
    expect(ModeratorJudgement.parse(judgement({ mode: "open" })).mode).toBe("open");
    rejects(ModeratorJudgement, judgement({ mode: "open", revealed_at: t(15) }), "open review has no reveal or revision");
  });

  test("the example record has both review modes", () => {
    const modes = new Set(exampleRecord().judgements.map((j: any) => `${j.submission_id}:${j.mode}`));
    expect(modes).toEqual(new Set(["sub-b:blind", "sub-a:open"]));
  });
});

// --- Original marker's wording and routes --------------------------------------

describe("the original marker's wording and routes", () => {
  test("the marker's wording is kept exactly", () => {
    const record = ModerationRecord.parse(exampleRecord());
    const subB = record.original_assessments.find((a) => a.submission_id === "sub-b")!;
    const mark = subB.criterion_marks[0];
    expect([mark.raw_label, mark.raw_score, mark.mark]).toEqual(["2:1 (68)", "68 / 100", 68]);
    expect(subB.import_route).toBe("turnitin_current_view");
    expect(subB.annotations[0]?.anchor_text).toBeTruthy();
  });

  test("a mislabelled rubric level is preserved", () => {
    const testing = criterionOf(rubric(), "testing")!;
    expect(testing.levels.find((l) => l.points === 68)?.label).toBe("2:2 (68)");
  });

  test("an unmapped original level is valid", () => {
    const data = clone(exampleRecord().original_assessments[0]);
    data.criterion_marks[0].level_id = null;
    data.criterion_marks[0].raw_label = "Merit+";
    expect(OriginalAssessment.parse(data).criterion_marks[0].level_id).toBeNull();
  });

  test("several labelled markers per submission", () => {
    const data = clone(exampleRecord());
    const second = { ...clone(data.original_assessments[0]), marker_label: "second marker" };
    data.original_assessments.push(second);
    ModerationRecord.parse(data);
    data.original_assessments.push(clone(second));
    rejects(ModerationRecord, data, "duplicate original assessment 'sub-a/second marker'");
  });

  test("the import route is required", () => {
    const data = clone(exampleRecord().original_assessments[0]);
    delete data.import_route;
    rejects(OriginalAssessment, data, "import_route");
  });
});

// --- Verdicts and context ------------------------------------------------------

describe("verdicts and context", () => {
  test("a verdict must come from the moderator", () => {
    const data = clone(exampleRecord().verdicts[0]);
    data.provenance.actor = MODEL;
    rejects(SubmissionVerdict, data, "actor must be the moderator");
  });

  test("a verdict for an unknown submission is rejected", () => {
    const data = clone(exampleRecord());
    data.verdicts[0].submission_id = "sub-z";
    rejects(ModerationRecord, data, "unknown submission 'sub-z'");
  });

  test("the context is recorded", () => {
    const record = ModerationRecord.parse(exampleRecord());
    expect(record.context?.cohort_size).toBe(4);
    expect(record.context?.band_distribution.reduce((n, b) => n + b.count, 0)).toBe(4);
  });
});

// --- Review fixes: hash integrity, strict ordering, provenance -----------------

describe("hash integrity, strict ordering, provenance", () => {
  test("anonymised text must match its hash", () => {
    const sub = approvedSubmission(exampleRecord().submissions[1]);
    sub.anonymised.text = "[STUDENT_B] wrote something else.";
    rejects(Submission, sub, "anonymised text does not match text_sha256");
  });

  test("tampered text cannot keep its approval", () => {
    // Swapping text while keeping the old hash and approval must fail.
    const subs = clone(exampleRecord().submissions);
    subs[1] = approvedSubmission(subs[1]);
    subs[1].anonymised.text = "Jordan Pike wrote this.";
    rejects(ModerationRecord, recordWith({ submissions: subs, ai_suggestions: [aiSuggestion()] }), "anonymised text does not match text_sha256");
  });

  test("a first judgement at reveal time is rejected", () => {
    rejects(ModeratorJudgement, judgement({ revealed_at: t(10) }), "before the reveal");
  });

  test("a revision at reveal time is rejected", () => {
    rejects(
      ModeratorJudgement,
      judgement({ revealed_at: t(15), revised: { level_id: "p35", recorded_at: t(15) } }),
      "after the reveal",
    );
  });

  test("a submission requires provenance", () => {
    const { provenance: _, ...data } = clone(exampleRecord().submissions[0]);
    rejects(Submission, data, "provenance");
  });

  test("the context requires provenance", () => {
    const data = clone(exampleRecord());
    delete data.context.provenance;
    rejects(ModerationRecord, data, "context.provenance");
  });
});
