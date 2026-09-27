/**
 * The readable moderation summary (#20), in Markdown, from the approved
 * record: the sample, each submission's judgements beside the original
 * marking and the AI suggestion, agreement and patterns across the sample,
 * the overall comment, and a section ready to copy into a moderation form
 * (the sample by grade band, and the moderator's comment).
 *
 * - Everything comes from the approved record, including each submission's
 *   grade band; nothing is inferred.
 * - The AI's part is always labelled: its suggestions are never marks, and a
 *   comment adapted from its draft says so.
 * - Patterns are computed from the agreement counts and stated plainly, so
 *   each statement can be traced to them; no model writes them.
 * - It is pseudonymous: students appear only by pseudonym and submission ID.
 * - Its structure is real (headings in order, tables with header rows), so
 *   the document is accessible, and nothing depends on colour.
 */

import { writeDocx } from "./docxWriter.ts";
import { describeBetween } from "./marking.ts";
import { currentApprovedRecord } from "./record.ts";
import type { Criterion, JudgementEntry, ModerationRecord, ModeratorJudgement, OriginalCriterionMark, Verdict } from "./models.ts";
import { pyFormatG } from "./pytext.ts";
import type { Workspace } from "./workspace.ts";

/**
 * Text as text in Markdown, never structure: on one line (breaks and runs of
 * spaces collapsed), with the characters that would make a table break,
 * emphasis, code, HTML or a link escaped, and a line that would start a
 * heading, list, quote or rule escaped. Brackets alone (as in a pseudonym,
 * "[STUDENT_A]") and underscores inside words stay as they are.
 */
const LINE_START = /^([#+\-=]|\d+[.)])/; // what would start a heading, list or rule
const cell = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*|<>]/g, (c) => `\\${c}`)
    .replace(/\]\(/g, "]\\(")
    .replace(LINE_START, "\\$1");
/** As cell, for a run inside a line: its surrounding spaces kept, and no line-start escape (it may not start the line). */
const cellInline = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/[\\`*|<>]/g, (c) => `\\${c}`)
    .replace(/\]\(/g, "]\\(");
const table = (head: string[], rows: string[][]) =>
  [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

const VERDICT: Record<Verdict, string> = { agree: "Agree", generous: "Generous", harsh: "Harsh", inconsistent: "Inconsistent" };
/** A timestamp in UTC, whatever offset it was recorded with. */
const date = (iso: string) => {
  const utc = new Date(iso).toISOString();
  return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
};
const levelOf = (c: Criterion, id: string | null) => (id === null ? null : (c.levels.find((l) => l.id === id) ?? null));
const labelOf = (c: Criterion, id: string | null) => levelOf(c, id)?.label ?? id ?? "no level";

type Direction = "agree" | "higher" | "lower" | "different";

/** The marker's mark against the moderator's level: the same level, or which way it differs. */
function markDirection(mark: OriginalCriterionMark | undefined, c: Criterion, levelId: string): Direction | null {
  if (!mark || mark.mark === null) return null;
  if (mark.level_id === levelId) return "agree";
  const points = levelOf(c, levelId)?.points ?? null;
  if (points === null) return "different";
  return mark.mark === points ? "agree" : mark.mark > points ? "higher" : "lower";
}

/** The AI's suggested level against the moderator's. */
function levelDirection(suggested: string | null, c: Criterion, levelId: string): Direction | null {
  if (suggested === null) return null;
  if (suggested === levelId) return "agree";
  const [a, b] = [levelOf(c, suggested)?.points ?? null, levelOf(c, levelId)?.points ?? null];
  return a === null || b === null || a === b ? "different" : a > b ? "higher" : "lower";
}

export interface Tally {
  agree: number;
  higher: number;
  lower: number;
  different: number;
}
const empty = (): Tally => ({ agree: 0, higher: 0, lower: 0, different: 0 });
const differ = (t: Tally) => t.higher + t.lower + t.different;
const compared = (t: Tally) => t.agree + differ(t);

/** The moderator's current level: the revision after a blind reveal, if any. */
const current = (j: ModeratorJudgement): JudgementEntry => j.revised ?? j.first;

/** Agreement with the moderator's levels, by criterion and by submission, for the marking and for the AI. */
export function agreement(record: ModerationRecord) {
  const byCriterion = new Map(record.rubric.criteria.map((c) => [c.id, { marking: empty(), ai: empty() }]));
  const bySubmission = new Map(record.submissions.map((s) => [s.id, { marking: empty(), ai: empty() }]));
  for (const j of record.judgements) {
    const c = record.rubric.criteria.find((x) => x.id === j.criterion_id)!;
    const level = current(j).level_id;
    const add = (t: Tally[], d: Direction | null) => d && t.forEach((x) => (x[d] += 1));
    for (const a of record.original_assessments.filter((x) => x.submission_id === j.submission_id)) {
      add([byCriterion.get(c.id)!.marking, bySubmission.get(j.submission_id)!.marking], markDirection(a.criterion_marks.find((m) => m.criterion_id === c.id), c, level));
    }
    const s = record.ai_suggestions.find((x) => x.submission_id === j.submission_id && x.criterion_id === c.id);
    if (s) add([byCriterion.get(c.id)!.ai, bySubmission.get(j.submission_id)!.ai], levelDirection(s.suggested_level_id, c, level));
  }
  return { byCriterion, bySubmission };
}

/** A tally in words: "3 of 4 agree; 1 more generous". */
function inWords(t: Tally, higher: string, lower: string): string {
  if (!compared(t)) return "Nothing to compare";
  const ways = [t.higher ? `${t.higher} ${higher}` : "", t.lower ? `${t.lower} ${lower}` : "", t.different ? `${t.different} at a different level` : ""].filter(Boolean);
  return `${t.agree} of ${compared(t)} agree${ways.length ? `; ${ways.join(", ")}` : ""}`;
}

/** Plain statements of what the counts show, each traceable to them. */
function patterns(record: ModerationRecord, byCriterion: Map<string, { marking: Tally; ai: Tally }>): string[] {
  const out: string[] = [];
  const all = { marking: empty(), ai: empty() };
  for (const t of byCriterion.values()) {
    for (const k of ["agree", "higher", "lower", "different"] as const) {
      all.marking[k] += t.marking[k];
      all.ai[k] += t.ai[k];
    }
  }
  // "more generous in 3 and harsher in 2", leaving out any that didn't happen.
  const ways = (t: Tally, higher: string, lower: string) => {
    const parts = [t.higher ? `${higher} in ${t.higher}` : "", t.lower ? `${lower} in ${t.lower}` : "", t.different ? `at a different level in ${t.different}` : ""].filter(Boolean);
    return parts.length ? `; ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.` : ".";
  };
  if (compared(all.marking)) {
    out.push(`Across the sample, the original marking agreed with your level in ${all.marking.agree} of ${compared(all.marking)} comparisons${ways(all.marking, "it was more generous", "harsher")}`);
  }
  for (const c of record.rubric.criteria) {
    const t = byCriterion.get(c.id)!.marking;
    if (!compared(t)) continue;
    // A criterion is named when the marking differed from the moderator in at least half its comparisons, in one direction.
    if (t.higher * 2 >= compared(t) && t.higher > t.lower) out.push(`${c.title}: the marking was more generous than your level in ${t.higher} of ${compared(t)} comparisons.`);
    else if (t.lower * 2 >= compared(t) && t.lower > t.higher) out.push(`${c.title}: the marking was harsher than your level in ${t.lower} of ${compared(t)} comparisons.`);
  }
  if (compared(all.ai)) {
    out.push(`The AI suggestion (a second reading, not a mark) agreed with your level in ${all.ai.agree} of ${compared(all.ai)} comparisons${ways(all.ai, "it suggested a higher level", "a lower one")}`);
  }
  const verdicts = new Map<Verdict, number>();
  for (const v of record.verdicts) verdicts.set(v.verdict, (verdicts.get(v.verdict) ?? 0) + 1);
  if (verdicts.size) {
    out.push(`Verdicts on the marking: ${(["agree", "generous", "harsh", "inconsistent"] as const).filter((v) => verdicts.has(v)).map((v) => `${VERDICT[v]} ${verdicts.get(v)}`).join(", ")}.`);
  }
  return out;
}

/** The sample's bands, in the order the request's band distribution reports them, then any others, then none. */
function bandOrder(record: ModerationRecord): (string | null)[] {
  const listed = (record.context?.band_distribution ?? []).map((b) => b.label);
  const seen = [...new Set(record.submissions.map((s) => s.listed_band))];
  const order = [...listed.filter((b) => seen.includes(b)), ...seen.filter((b): b is string => b !== null && !listed.includes(b))];
  return seen.includes(null) ? [...order, null] : order;
}

const markText = (m: OriginalCriterionMark | undefined, c: Criterion) => {
  if (!m || m.mark === null) return "No mark";
  // Where the score sits on the source rubric: its level, or between which levels (never rounded to one).
  const onRubric = m.level_id ? labelOf(c, m.level_id) : describeBetween(m.mark, c);
  return `${m.raw_score || pyFormatG(m.mark)}${m.raw_label ? `; the marker's level: ${m.raw_label}` : ""}; on the source rubric: ${onRubric}`;
};

/** Some text, or a code span (an identifier, e.g. the record's name). */
export type Run = string | { code: string };

/**
 * The summary as an outline, rendered as Markdown (renderSummary) and as a
 * Word document (docxWriter.ts), so the two always say the same. Text is
 * plain; each renderer escapes it for its format.
 */
export type SummaryBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; lines: Run[][] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; caption: string; head: string[]; rows: string[][] };

/** The summary's outline, from the approved record (each submission's grade band is in the record). */
export function summaryBlocks(record: ModerationRecord): SummaryBlock[] {
  const { byCriterion, bySubmission } = agreement(record);
  const ctx = record.context;
  const title = ctx?.module || record.id;
  const out: SummaryBlock[] = [];
  const heading = (level: 1 | 2 | 3 | 4, text: string) => out.push({ kind: "heading", level, text });
  const para = (...lines: Run[][]) => out.push({ kind: "paragraph", lines });
  const list = (items: string[]) => items.length && out.push({ kind: "list", items });
  const table = (caption: string, head: string[], rows: string[][]) => out.push({ kind: "table", caption, head, rows });

  heading(1, `Moderation summary: ${title}`);
  para(
    [record.approved_at ? `Approved by the moderator on ${date(record.approved_at)}.` : "Not yet approved."],
    [
      "Students appear by pseudonym only. AI suggestions are a second reading, never marks; the judgements and verdicts are the moderator's. The structured record (",
      { code: `${record.id}-record` },
      ") holds the full provenance.",
    ],
  );

  heading(2, "Context");
  const facts: [string, string | null][] = [
    ["Programme", ctx?.programme ?? null],
    ["Module", ctx?.module ?? null],
    ["Cohort size", ctx?.cohort_size != null ? String(ctx.cohort_size) : null],
    ["How the sample was chosen", ctx?.sample_note ?? null],
    ["Source rubric", `${record.rubric.title} (version ${record.rubric.version}), ${record.rubric.criteria.length} criteria`],
    ["Sample", `${record.submissions.length} submissions`],
  ];
  list(facts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`));
  if (ctx?.band_distribution.length) {
    table("Marked assessments by grade band", ["Grade band", "Marked assessments"], ctx.band_distribution.map((b) => [b.label, String(b.count)]));
  }

  heading(2, "Sample overview");
  table(
    "Each sampled submission: its band, review, agreement and verdict",
    ["Submission", "Grade band", "Review", "Agreement with the original marking", "Agreement with the AI suggestion", "Verdict", "Suggested mark"],
    record.submissions.map((s) => {
      const js = record.judgements.filter((j) => j.submission_id === s.id);
      const mode = js[0]?.mode === "blind" ? "Blind, then revealed" : "Open";
      const v = record.verdicts.find((x) => x.submission_id === s.id);
      const t = bySubmission.get(s.id)!;
      return [
        `${s.id} ${s.pseudonym}`,
        s.listed_band ?? "Not listed",
        mode,
        inWords(t.marking, "more generous", "harsher"),
        inWords(t.ai, "higher", "lower"),
        v ? VERDICT[v.verdict] : "None",
        v?.suggested_mark != null ? pyFormatG(v.suggested_mark) : "None",
      ];
    }),
  );

  heading(2, "Each submission");
  for (const s of record.submissions) {
    const js = record.judgements.filter((j) => j.submission_id === s.id);
    const markings = record.original_assessments.filter((a) => a.submission_id === s.id);
    const v = record.verdicts.find((x) => x.submission_id === s.id);
    heading(3, `${s.id} ${s.pseudonym}`);
    const blind = js.find((j) => j.mode === "blind");
    const shown = record.ai_suggestions.some((x) => x.submission_id === s.id) ? "the original marking and the AI reading were" : "the original marking was (there was no AI reading)";
    list([
      `Grade band: ${s.listed_band ?? "not listed"}`,
      `Review: ${blind ? `blind; ${shown} revealed on ${date(blind.revealed_at!)}, after a level was recorded for every criterion` : `open; ${shown} shown throughout`}`,
      ...markings.map((m) => `The ${m.marker_label}'s overall mark: ${m.raw_overall || (m.overall_mark !== null ? pyFormatG(m.overall_mark) : "not recorded")}`),
      `Verdict on the marking: ${v ? `${VERDICT[v.verdict]}${v.suggested_mark !== null ? `; suggested mark ${pyFormatG(v.suggested_mark)}` : ""}` : "none"}`,
    ]);
    table(
      `${s.id} ${s.pseudonym}: your level, the original marking and the AI suggestion, by criterion`,
      ["Criterion", "Your level", ...markings.map((m) => `The ${m.marker_label}`), "AI suggestion (not a mark)"],
      record.rubric.criteria.map((c) => {
        const j = js.find((x) => x.criterion_id === c.id);
        const yours = j ? (j.revised ? `${labelOf(c, j.revised.level_id)} (revised after the reveal from ${labelOf(c, j.first.level_id)})` : labelOf(c, j.first.level_id)) : "Not judged";
        const ai = record.ai_suggestions.find((x) => x.submission_id === s.id && x.criterion_id === c.id);
        return [c.title, yours, ...markings.map((m) => markText(m.criterion_marks.find((x) => x.criterion_id === c.id), c)), ai ? labelOf(c, ai.suggested_level_id) : "None"];
      }),
    );
    const comments = record.rubric.criteria.flatMap((c) => {
      const j = js.find((x) => x.criterion_id === c.id);
      return j ? [j.first, ...(j.revised ? [j.revised] : [])].filter((e) => e.comment).map((e) => ({ c, e, revised: e === j.revised })) : [];
    });
    if (comments.length) {
      para(["Your comments:"]);
      list(comments.map(({ c, e, revised }) => `${c.title}${revised ? " (after the reveal)" : ""}: ${e.comment}${e.comment_derived_from_ai ? " (adapted from the AI draft)" : ""}`));
    }
    for (const m of markings.filter((x) => x.overall_comment)) para([`The ${m.marker_label}'s overall comment: ${m.overall_comment}`]);
    if (v?.comment) para([`Your comment on the marking: ${v.comment}`]);
  }

  heading(2, "Patterns across the sample");
  table(
    "Agreement with your levels, by criterion",
    ["Criterion", "The original marking against your level", "The AI suggestion against your level"],
    record.rubric.criteria.map((c) => {
      const t = byCriterion.get(c.id)!;
      return [c.title, inWords(t.marking, "more generous", "harsher"), inWords(t.ai, "higher", "lower")];
    }),
  );
  list(patterns(record, byCriterion));

  const overall = record.overall_comment?.trim() || "No overall comment was recorded."; // an empty comment is no comment
  heading(2, "Overall moderator's comment");
  para([overall]);

  heading(2, "For the moderation form");
  heading(3, "Sampled items by grade band");
  for (const band of bandOrder(record)) {
    heading(4, band ?? "No band listed");
    list(
      record.submissions
        .filter((x) => x.listed_band === band)
        .map((s) => {
          const v = record.verdicts.find((x) => x.submission_id === s.id);
          return `${s.pseudonym} (${s.id}): ${v ? VERDICT[v.verdict] : "no verdict"}${v?.suggested_mark != null ? `; suggested mark ${pyFormatG(v.suggested_mark)}` : ""}`;
        }),
    );
  }
  heading(3, "Moderator's comments");
  para([overall]);
  return out;
}

/** The outline as Markdown: every piece of text escaped, so nothing in it becomes structure. */
export function toMarkdown(blocks: SummaryBlock[]): string {
  const md = (b: SummaryBlock): string => {
    switch (b.kind) {
      case "heading":
        return `${"#".repeat(b.level)} ${cell(b.text)}`;
      case "paragraph":
        // Each line joined, then trimmed and guarded at its start, as a whole line of text is.
        return b.lines
          .map((runs) => runs.map((r) => (typeof r === "string" ? cellInline(r) : `\`${r.code}\``)).join("").trim().replace(LINE_START, "\\$1"))
          .join("\n");
      case "list":
        return b.items.map((i) => `- ${cell(i)}`).join("\n");
      case "table":
        return table(b.head, b.rows);
    }
  };
  return blocks.map(md).join("\n\n") + "\n";
}

/** The summary, in Markdown, of the approved record. */
export const renderSummary = (record: ModerationRecord): string => toMarkdown(summaryBlocks(record));

/** Export the summary of the approved record, as Markdown, into `exports/`, while the workspace still matches the approval. */
export async function exportSummary(ws: Workspace, now?: Date): Promise<{ path: string; markdown: string }> {
  const record = await currentApprovedRecord(ws, now); // the bands are in it, so they are what was approved
  const markdown = renderSummary(record);
  const path = await ws.writeExport(`${record.id}-summary`, "md", markdown);
  await ws.secure();
  return { path, markdown };
}

/** Export the summary of the approved record as a Word document into `exports/`, while the workspace still matches the approval. */
export async function exportSummaryDocx(ws: Workspace, now?: Date): Promise<{ path: string; bytes: Uint8Array }> {
  const record = await currentApprovedRecord(ws, now);
  const blocks = summaryBlocks(record);
  const title = blocks[0].kind === "heading" ? blocks[0].text : `Moderation summary: ${record.id}`;
  const bytes = writeDocx(blocks, title);
  const path = await ws.writeExport(`${record.id}-summary`, "docx", bytes);
  await ws.secure();
  return { path, bytes };
}
