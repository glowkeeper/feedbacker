/**
 * Approving each student's marks and feedback, and exporting them to paste into the marking platform.
 *
 * A submission is approved on exactly what the student will receive: every criterion's mark and feedback, and the
 * overall mark and feedback, as they are exported. It can be approved only once every criterion is marked, every
 * piece of feedback is recorded on the marks as they are now, and every check's flag is accepted with a reason. The
 * approval records a digest of that content (and of the flags accepted), so any later change clears it.
 *
 * Exports, as in moderation: the standard ones are pseudonymous and written all or nothing (each approved student's
 * feedback as text, one file of them all, a marks table, and the structured record). A re-identified copy is made
 * only when the educator confirms it, each time, and restores only each student's platform ID (e.g. their Turnitin
 * ID) in place of their pseudonym, as moderation's does: nothing else.
 */

import { EDUCATOR, loadAssessment } from "./assessment.ts";
import { loadCohort } from "./cohort.ts";
import { serialiseRecord } from "./contract.ts";
import { educatorMarking, feedbackFlags, loadDrafts, loadFeedback, OVERALL, type EducatorMarking } from "./drafting.ts";
import { loadGuide } from "./guide.ts";
import { loadJudgements } from "./judgement.ts";
import { entryMark, criterionMax, provisionalMark } from "./marks.ts";
import { MarkingRecord, SubmissionApproval, type AISuggestion } from "./models.ts";
import { pyFormatG } from "./pytext.ts";
import { loadReadings, readingPath } from "./reading.ts";
import { slug } from "./rubric.ts";
import { loadSubmissionMark } from "./submissionMark.ts";
import { sha256Text } from "./text.ts";
import { EXPORTS, type Workspace, WorkspaceError } from "./workspace.ts";

export const approvalPath = (submissionId: string) => `feedback/${submissionId}--approval.json`;

/** What one student receives: their overall mark, then each criterion's mark and feedback, then the overall feedback. */
export interface StudentFeedback {
  submissionId: string;
  pseudonym: string;
  mark: number;
  criteria: { title: string; mark: number | null; outOf: number | null; feedback: string }[];
  overall: string;
}

/** As plain text, to paste into Turnitin's or Canvas's comment box: headings on their own lines, a blank line between parts. */
export function feedbackText(f: StudentFeedback): string {
  const parts = [`Overall mark: ${pyFormatG(f.mark)}`];
  for (const c of f.criteria) parts.push(`${c.title}${c.mark !== null ? `: ${pyFormatG(c.mark)}${c.outOf !== null ? ` out of ${pyFormatG(c.outOf)}` : ""}` : ""}\n${c.feedback}`);
  parts.push(`Overall\n${f.overall}`);
  return parts.join("\n\n") + "\n";
}

/** One criterion's part, as pasted on its own. */
export const criterionText = (c: StudentFeedback["criteria"][number]) => c.feedback;

/** What still stops a submission being approved, and what it would be approved on. */
export interface Readiness {
  feedback: StudentFeedback | null; // what the student will receive, once complete
  problems: string[]; // why it can't be approved yet
  digest: string | null; // of the content and the flags accepted, when it can be
}

export async function readiness(ws: Workspace, submissionId: string): Promise<Readiness> {
  const m: EducatorMarking = await educatorMarking(ws, submissionId);
  const given = await loadFeedback(ws, submissionId);
  const flags = await feedbackFlags(ws, submissionId);
  const problems: string[] = [];
  for (const [target, why] of m.missing) problems.push(`${target === OVERALL ? "Overall" : (m.rubric.criteria.find((c) => c.id === target)?.title ?? target)}: ${why}`);
  const textOf = (criterionId: string | null, title: string) => {
    const f = given.find((x) => x.criterion_id === criterionId);
    const target = criterionId ?? OVERALL;
    if (!m.basis.has(target)) return "";
    if (!f) problems.push(`${title}: no feedback recorded`);
    else if (m.basis.get(target) !== f.given_on) problems.push(`${title}: the feedback was given on other marking than there is now; check it and record it again`);
    const open = flags.find((x) => x.target === target)?.open ?? [];
    for (const flag of open) problems.push(`${title}: ${flag.message} (change the feedback, or accept the flag with a reason)`);
    return f?.text ?? "";
  };
  const criteria = m.rubric.criteria.map((c) => {
    const e = m.entries.get(c.id);
    return { title: c.title, mark: e ? entryMark(c, e) : null, outOf: criterionMax(c), feedback: textOf(c.id, c.title) };
  });
  const overall = textOf(null, "Overall");
  if (problems.length || !m.overall) return { feedback: null, problems, digest: null };
  const feedback: StudentFeedback = { submissionId, pseudonym: m.pseudonym, mark: m.overall.mark, criteria, overall };
  const accepted = given.flatMap((f) => f.accepted_flags.map((a) => [f.criterion_id ?? OVERALL, a.check, a.detail, a.reason])).sort();
  return { feedback, problems, digest: sha256Text(JSON.stringify([feedbackText(feedback), accepted])) };
}

export async function loadSubmissionApproval(ws: Workspace, submissionId: string): Promise<SubmissionApproval | null> {
  const path = approvalPath(submissionId);
  if (!(await ws.exists(path))) return null;
  const parsed = SubmissionApproval.safeParse(await ws.readJson(path));
  if (!parsed.success || parsed.data.submission_id !== submissionId) throw new WorkspaceError(`${path} is not a valid approval`);
  return parsed.data;
}

/** A submission's approval as it stands: approved on what the student would receive now, or not (and why not). */
export interface ApprovalState extends Readiness {
  approval: SubmissionApproval | null;
  current: boolean; // approved, on exactly what there is now
}

export async function approvalState(ws: Workspace, submissionId: string): Promise<ApprovalState> {
  const r = await readiness(ws, submissionId);
  const approval = await loadSubmissionApproval(ws, submissionId);
  return { ...r, approval, current: approval !== null && r.digest !== null && approval.content_sha256 === r.digest };
}

/** Approve exactly what the student will receive now. */
export async function approveSubmission(ws: Workspace, submissionId: string, now: Date = new Date()): Promise<SubmissionApproval> {
  const r = await readiness(ws, submissionId);
  if (!r.digest) throw new WorkspaceError(`${submissionId} can't be approved yet: ${r.problems.join("; ")}`);
  const approval = SubmissionApproval.parse({ submission_id: submissionId, content_sha256: r.digest, approved_by: EDUCATOR, approved_at: now.toISOString() });
  await ws.writeJson(approvalPath(submissionId), approval, { private: true });
  await ws.secure();
  return approval;
}

// --- Exports -----------------------------------------------------------------------------------------

/** Every submission approved on what it is now, with what its student receives, in the cohort's order. */
async function approvedNow(ws: Workspace): Promise<{ state: ApprovalState; feedback: StudentFeedback }[]> {
  const out: { state: ApprovalState; feedback: StudentFeedback }[] = [];
  for (const s of (await loadCohort(ws)).submissions) {
    const state = await approvalState(ws, s.submission_id);
    if (state.current && state.feedback) out.push({ state, feedback: state.feedback });
  }
  if (!out.length) throw new WorkspaceError("no submission is approved on its marks and feedback as they are now; approve at least one first");
  return out;
}

/** The record's id: the assessment's title, as a slug, else the workspace's name. */
async function recordId(ws: Workspace): Promise<string> {
  const assessment = await loadAssessment(ws);
  return `marking-${slug(assessment?.title ?? ws.manifest.name).slice(0, 60) || "cohort"}`;
}

const markdownOf = (f: StudentFeedback, who: string, level = 1) => {
  const h = "#".repeat(level);
  const lines = [`${h} Feedback for ${who}`, "", `Overall mark: ${pyFormatG(f.mark)}`];
  for (const c of f.criteria) lines.push("", `${h}# ${c.title}${c.mark !== null ? `: ${pyFormatG(c.mark)}${c.outOf !== null ? ` out of ${pyFormatG(c.outOf)}` : ""}` : ""}`, "", c.feedback);
  lines.push("", `${h}# Overall`, "", f.overall);
  return lines.join("\n");
};

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The marks table: one row per student, each criterion's mark, then the overall. */
function marksCsv(rows: StudentFeedback[], who: (f: StudentFeedback) => string): string {
  const head = ["Submission", "Student", ...rows[0].criteria.map((c) => c.title), "Overall mark"];
  const body = rows.map((f) => [f.submissionId, who(f), ...f.criteria.map((c) => (c.mark === null ? "" : pyFormatG(c.mark))), pyFormatG(f.mark)]);
  return [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** Write every file, made private, or none: a failure part-way never leaves some of them behind. */
async function writeAll(ws: Workspace, files: [string, string, string][]): Promise<string[]> {
  const paths: string[] = [];
  try {
    for (const [name, ext, content] of files) paths.push(await ws.writeExport(name, ext, content));
    await ws.secure();
  } catch (err) {
    for (const [name, ext] of files) await ws.fs.remove(`${EXPORTS}/${name}.feedbacker-export.${ext}`).catch(() => {});
    await ws.secure().catch(() => {});
    throw err;
  }
  return paths;
}

/** The structured record of the approved submissions: everything that went into each, with where it came from. */
export async function markingRecord(ws: Workspace, now: Date = new Date()): Promise<MarkingRecord> {
  const approved = await approvedNow(ws);
  const ids = new Set(approved.map((a) => a.feedback.submissionId));
  const rubric = (await educatorMarking(ws, approved[0].feedback.submissionId)).rubric;
  const record = {
    id: await recordId(ws),
    assessment: await loadAssessment(ws),
    rubric,
    cohort: await loadCohort(ws),
    guide: await loadGuide(ws),
    ai_suggestions: [] as AISuggestion[],
    provisional_marks: [] as { submission_id: string; mark: number | null; why_none: string | null }[],
    judgements: [] as unknown[],
    marks: [] as unknown[],
    drafts: [] as unknown[],
    feedback: [] as unknown[],
    approvals: [] as unknown[],
    exported_at: now.toISOString(),
  };
  for (const id of ids) {
    const readings = (await ws.exists(readingPath(id))) ? await loadReadings(ws, id) : [];
    record.ai_suggestions.push(...readings);
    const p = readings.length ? provisionalMark(rubric.criteria, (cid) => readings.find((r) => r.criterion_id === cid)) : { missing: "there are no AI proposals" };
    record.provisional_marks.push({ submission_id: id, mark: "mark" in p ? p.mark : null, why_none: "missing" in p ? p.missing : null });
    record.judgements.push(...(await loadJudgements(ws, id)));
    const mark = await loadSubmissionMark(ws, id);
    if (mark) record.marks.push(mark);
    record.drafts.push(...(await loadDrafts(ws, id)));
    record.feedback.push(...(await loadFeedback(ws, id)));
    record.approvals.push((await loadSubmissionApproval(ws, id))!);
  }
  return MarkingRecord.parse(record);
}

/** The standard exports, pseudonymous: each approved student's feedback, one file of them all, the marks table, and the record. */
export async function exportMarking(ws: Workspace, now: Date = new Date()): Promise<{ paths: string[]; submissions: string[] }> {
  const approved = (await approvedNow(ws)).map((a) => a.feedback);
  const id = await recordId(ws);
  const who = (f: StudentFeedback) => `${f.submissionId} ${f.pseudonym}`;
  const files: [string, string, string][] = [
    ...approved.map((f): [string, string, string] => [`${id}-feedback-${f.submissionId}`, "md", markdownOf(f, who(f)) + "\n"]),
    [`${id}-feedback`, "md", approved.map((f) => markdownOf(f, who(f), 2)).join("\n\n") + "\n"],
    [`${id}-marks`, "csv", marksCsv(approved, (f) => f.pseudonym)],
    [`${id}-record`, "json", serialiseRecord(MarkingRecord, await markingRecord(ws, now), "marking record")],
  ];
  return { paths: await writeAll(ws, files), submissions: approved.map((f) => f.submissionId) };
}

export const REIDENTIFIED_MARKING_NOTICE =
  "Re-identified copy: this contains personal data, each student's platform ID (e.g. their Turnitin ID) in place of their pseudonym. It was made at the educator's request, is kept only in this workspace, and is deleted with it.";

/**
 * A re-identified copy of the feedback and the marks table, made only when the educator confirms it, each time: each
 * student's platform ID in place of their pseudonym, and nothing else restored. The record stays pseudonymous.
 */
export async function exportMarkingReidentified(ws: Workspace, options: { confirmed: boolean }): Promise<{ paths: string[] }> {
  if (options.confirmed !== true) throw new WorkspaceError("a re-identified copy restores each student's platform ID; it is made only when you confirm it");
  const approved = (await approvedNow(ws)).map((a) => a.feedback);
  const key = await ws.readKey();
  const ids = new Map<string, string>();
  for (const f of approved) {
    const entry = key.entries.find((e) => e.submission_id === f.submissionId && e.pseudonym === f.pseudonym);
    if (!entry?.external_id.trim()) throw new WorkspaceError(`the pseudonym key has no ID for ${f.submissionId} ${f.pseudonym}`);
    ids.set(f.pseudonym, entry.external_id.trim());
  }
  const restore = (text: string) => [...ids].reduce((t, [pseudonym, real]) => t.split(pseudonym).join(real), text);
  const id = await recordId(ws);
  const notice = `> ${REIDENTIFIED_MARKING_NOTICE}\n\n`;
  const who = (f: StudentFeedback) => ids.get(f.pseudonym)!;
  const files: [string, string, string][] = [
    ...approved.map((f): [string, string, string] => [`${id}-feedback-${f.submissionId}-reidentified`, "md", notice + restore(markdownOf(f, who(f))) + "\n"]),
    [`${id}-feedback-reidentified`, "md", notice + approved.map((f) => restore(markdownOf(f, who(f), 2))).join("\n\n") + "\n"],
    [`${id}-marks-reidentified`, "csv", marksCsv(approved, who)],
  ];
  return { paths: await writeAll(ws, files) };
}
