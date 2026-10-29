/**
 * A module groups assessments (ADR 0010). The module is a workspace that holds what its assessments share, each of which is a workspace
 * in a folder inside it:
 *
 *     <module>/
 *         workspace.json          type "module", and whether its assessments share one pseudonym key
 *         module-context.json     the programme and module, once
 *         request-cohort.json     the request document, read once: every assessment's cohort, weightings and which rows are one student
 *         brief.json, sources/    the brief, whole; each assessment takes its own section of it
 *         anonymisation/rules.json  the rules (the real names to redact), shared
 *         private/pseudonym-key.json  only if the module was made to share the key
 *         <assessment>/           an ordinary workspace
 *
 * An assessment's gates, approvals and records stay in the assessment; `Workspace` reads and writes the shared files through the module.
 * A workspace made on its own is a module of one.
 */

import { Brief, ModuleContext, type CohortRef, type RequestCohort } from "./models.ts";
import { pyStrip } from "./pytext.ts";
import { briefSections, briefSource, importBrief, loadBrief } from "./brief.ts";
import { MODERATOR } from "./request.ts";
import { loadRequestCohort, recordRequestCohort } from "./requestCohort.ts";
import type { RequestFindings } from "./requestDocument.ts";
import { loadVerdict, verdictStands } from "./verdict.ts";
import { bytesSource } from "./zip.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const MODULE_CONTEXT = "module-context.json";

const blankToNull = (value: string | null | undefined) => (value ? pyStrip(value) || null : null);

function requireModule(ws: Workspace): void {
  if (ws.manifest.workspace_type !== "module") throw new WorkspaceError("this isn't a module");
}

/** The module an assessment is in, or an error: for what is only done inside a module. */
function moduleOf(ws: Workspace): Workspace {
  if (!ws.module) throw new WorkspaceError("this workspace is not in a module");
  return ws.module;
}

// --- The module's context ------------------------------------------------------------------------------------------------------------------

/** Record the programme and module, replacing any recorded. */
export async function recordModuleContext(
  ws: Workspace,
  details: { programme?: string | null; module?: string | null },
  options: { source?: string; now?: Date } = {},
): Promise<ModuleContext> {
  requireModule(ws);
  const record = ModuleContext.parse({
    programme: blankToNull(details.programme),
    module: blankToNull(details.module),
    provenance: { source: options.source ?? "manual entry", transformation: "recorded", actor: MODERATOR, timestamp: (options.now ?? new Date()).toISOString() },
  });
  await ws.writeJson(MODULE_CONTEXT, record);
  return record;
}

export async function loadModuleContext(ws: Workspace): Promise<ModuleContext | null> {
  if (!(await ws.exists(MODULE_CONTEXT))) return null;
  const parsed = ModuleContext.safeParse(await ws.readJson(MODULE_CONTEXT));
  if (!parsed.success) throw new WorkspaceError(`${MODULE_CONTEXT} is not a valid module context`);
  return parsed.data;
}

/** The module's context, for an assessment in a module to start from; null for a workspace of its own, or while none is recorded. */
export async function contextOfModule(ws: Workspace): Promise<ModuleContext | null> {
  return ws.module ? loadModuleContext(ws.module) : null;
}

// --- The request document, read once -------------------------------------------------------------------------------------------------------

/**
 * Keep the request document's cohort in the module: every assessment's rows with their marks and weightings, and which rows are one
 * student. Names and IDs are never kept (only the sampled students', in an assessment's key). The programme and module it gave are
 * kept as the module's context, unless the moderator has entered some.
 */
export async function recordModuleRequest(ws: Workspace, findings: RequestFindings, now: Date = new Date()): Promise<RequestCohort> {
  requireModule(ws);
  if (!findings.cohort.length) throw new WorkspaceError("the request document lists no students, so there is no cohort to keep");
  const cohort = await recordRequestCohort(ws, findings, { assessment: "", sampled: [], now });
  if (!(await loadModuleContext(ws)) && (findings.programme || findings.module)) {
    await recordModuleContext(ws, { programme: findings.programme, module: findings.module }, { source: `file:sha256:${findings.source_sha256}`, now });
  }
  return cohort;
}

// --- The brief, held once ------------------------------------------------------------------------------------------------------------------

export type ModuleBriefState =
  | { state: "none" } // the module has no brief
  | { state: "not-taken" } // the module has one; this assessment has none
  | { state: "current" } // this assessment's is the module's
  | { state: "different" }; // this assessment's brief is another document: its own, or the module's before it was replaced

/** Whether an assessment's brief is the module's: it has the module's document, by its hash. */
export async function moduleBriefState(ws: Workspace): Promise<ModuleBriefState> {
  const module = moduleOf(ws);
  if (!(await module.exists("brief.json"))) return { state: "none" };
  const held = Brief.parse(await module.readJson("brief.json"));
  if (!(await ws.exists("brief.json"))) return { state: "not-taken" };
  const own = Brief.parse(await ws.readJson("brief.json"));
  return { state: own.source_sha256 === held.source_sha256 ? "current" : "different" };
}

/**
 * Take the module's brief for this assessment, whole: the assessment then chooses its own section of it, and anonymises, approves and
 * sends only that. Replacing what the assessment had clears its approval, as importing a brief again does.
 */
export async function useModuleBrief(ws: Workspace, now: Date = new Date()): Promise<Brief> {
  const module = moduleOf(ws);
  const held = await loadBrief(module);
  const bytes = await module.readBytes(briefSource(held));
  if (!bytes) throw new WorkspaceError("the module's brief file is missing; import it into the module again");
  return importBrief(ws, bytesSource(`brief.${held.source_format}`, bytes), { replace: true, now });
}

/**
 * An assessment in a module starts with the module's brief: taken, without importing it again, when it has none of its own and the module
 * has one. An assessment that has a brief (the module's, or its own) is left as it is, and the educator may take the module's again, or
 * import another, whenever they choose. Nothing is anonymised, approved or sent by this, and the part that applies is the educator's to choose.
 * Whether it was taken.
 */
export function takeModuleBriefIfNew(ws: Workspace, now: Date = new Date()): Promise<boolean> {
  // One at a time for an assessment: the screen that opens it and the Brief step may both ask, and the second shares the first's answer.
  const id = ws.registration.registration_id;
  const running = taking.get(id);
  if (running) return running;
  const take = (async () => {
    if (!ws.module) return false;
    if ((await moduleBriefState(ws)).state !== "not-taken") return false;
    await useModuleBrief(ws, now);
    return true;
  })().finally(() => taking.delete(id));
  taking.set(id, take);
  return take;
}
const taking = new Map<string, Promise<boolean>>();

/** Whether `name` is in `text` as a whole word or phrase, ignoring case (so "Report" is in "Assessment 1: Report (60%)" but not in "Reporting"). */
const names = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);

/**
 * Which of the module's cohort the assessment is, by its name: the one assessment the request names with the assessment's name in it
 * (as a whole word), or null where none, or more than one, does. The educator is asked where it can't be told.
 */
export function moduleCohortAssessment(cohort: RequestCohort, assessmentName: string): string | null {
  if (!assessmentName.trim()) return null;
  const matches = cohort.assessments.filter((a) => names(a.assessment, assessmentName) || names(a.title, assessmentName));
  return matches.length === 1 ? matches[0].assessment : null;
}

/**
 * The part of the module's brief that is probably this assessment's: the one section whose heading names the assessment (as a whole
 * word), or null where none, or more than one, does. It is suggested to the educator, never chosen for them.
 */
export function briefPartFor(brief: Brief, assessmentName: string): { title: string; start: number; end: number } | null {
  if (!assessmentName.trim()) return null;
  const matches = briefSections(brief).filter((s) => names(s.title, assessmentName));
  return matches.length === 1 ? { title: matches[0].title, start: matches[0].start, end: matches[0].end } : null;
}

// --- The module as a whole -----------------------------------------------------------------------------------------------------------------

/**
 * The moderator's overall mark for a sampled submission: the mark suggested, else the one their criterion marks imply; null while neither.
 * A verdict given on marking, approved text, rubric or marks since changed no longer stands, so its mark is left out (`stale`) until it is
 * checked and recorded again.
 */
export async function moderatorMark(ws: Workspace, submissionId: string): Promise<{ mark: number | null; stale: boolean }> {
  const verdict = await loadVerdict(ws, submissionId);
  if (!verdict) return { mark: null, stale: false };
  if (!(await verdictStands(ws, submissionId, verdict))) return { mark: null, stale: true };
  return { mark: verdict.suggested_mark ?? verdict.criteria_mark ?? null, stale: false };
}

/**
 * The moderator's overall marks in one assessment, by the request's row, from the cohort the assessment recorded. Null when the
 * assessment has recorded none, or from another document than the module's (its rows would not be the module's).
 */
export async function moderatedRows(ws: Workspace, moduleCohort: RequestCohort): Promise<{ marks: Map<string, number | null>; notes: string[] }> {
  const cohort = await loadRequestCohort(ws);
  const marks = new Map<string, number | null>();
  if (!cohort || !cohort.sampled.length) return { marks, notes: [] };
  if (cohort.source_sha256 !== moduleCohort.source_sha256) {
    return { marks, notes: [`${ws.manifest.name} was read from a different request document from the module's, so its marks are not shown here.`] };
  }
  let stale = 0;
  for (const s of cohort.sampled) {
    const { mark, stale: out } = await moderatorMark(ws, s.submission_id);
    marks.set(`${s.assessment}\u0000${s.row}`, mark);
    if (out) stale++;
  }
  const notes = stale ? [`${stale} of your verdicts in ${ws.manifest.name} ${stale === 1 ? "was" : "were"} given on marking, text, rubric or marks that have since changed, so ${stale === 1 ? "its mark is" : "their marks are"} left out until you check ${stale === 1 ? "it" : "them"} again on Review.`] : [];
  return { marks, notes };
}

export interface StudentMarks {
  initial: number | null;
  /** After the partner's internal moderation: the agreed mark where there is one, else the initial. */
  internal: number | null;
  /** The moderator's own, where the student was sampled and the moderator has a mark. */
  moderator: number | null;
}

export interface ModuleStudent {
  /** "Student 1", in the order the request lists them: no name and no ID is held. */
  label: string;
  /** By assessment name; absent where the request does not list the student for it. */
  marks: Map<string, StudentMarks & { submitted: boolean }>;
  module: StudentMarks;
}

export interface ModuleMarks {
  assessments: { name: string; title: string; weight: number | null }[];
  students: ModuleStudent[];
  notes: string[];
}

/** A module mark to one decimal place, or an em dash while it can't be worked out. */
export const showModuleMark = (mark: number | null) => (mark === null ? "—" : String(Math.round(mark * 10) / 10));

/**
 * What each student's marks make of the module, at three levels: the original marker's, after the partner's internal moderation, and the
 * moderator's own. A module mark is each assessment's mark weighted by what it is worth (as a share of the weightings given), and
 * is worked out only for a student with a mark in every assessment at that level, and only where every assessment has a weighting. So
 * the first two are filled for the whole cohort that submitted everything, while the moderator's is filled for those the moderator has marked in
 * every assessment, and blank for the rest.
 */
export function moduleMarks(cohort: RequestCohort, moderated: Map<string, number | null>): ModuleMarks {
  const assessments = cohort.assessments.map((a) => ({ name: a.assessment, title: a.title, weight: a.weight }));
  const key = (a: string, row: number) => `${a}\u0000${row}`;
  // One student per group of linked rows; every other row is a student of its own.
  const linked = new Map<string, CohortRef[]>();
  for (const group of cohort.links) for (const ref of group) linked.set(key(ref.assessment, ref.row), group);
  const seen = new Set<CohortRef[]>();
  const groups: CohortRef[][] = [];
  for (const a of cohort.assessments) {
    for (const r of a.rows) {
      const group = linked.get(key(a.assessment, r.row));
      if (group) {
        if (!seen.has(group)) (seen.add(group), groups.push(group));
      } else groups.push([{ assessment: a.assessment, row: r.row }]);
    }
  }
  const weights = assessments.map((a) => a.weight);
  const weighted = weights.every((w) => w !== null && w > 0);
  const total = weighted ? (weights as number[]).reduce((sum, w) => sum + w, 0) : 0;
  const notes: string[] = [];
  if (!weighted) notes.push("The request doesn't give every assessment a weighting, so no module mark is worked out.");
  else if (Math.round(total * 1000) !== 100_000) notes.push(`The weightings add up to ${Math.round(total * 10) / 10}%, not 100%, so each module mark is shown as a share of ${Math.round(total * 10) / 10}%.`);

  const students: ModuleStudent[] = groups.map((group, i) => {
    const marks = new Map<string, StudentMarks & { submitted: boolean }>();
    for (const ref of group) {
      const line = cohort.assessments.find((a) => a.assessment === ref.assessment)!.rows.find((r) => r.row === ref.row)!;
      const submitted = line.submitted;
      marks.set(ref.assessment, {
        submitted,
        initial: submitted ? line.initial : null,
        // A mark the request gave but that couldn't be read is not an omitted one: it is not taken for the initial mark.
        internal: submitted ? (line.unreadable.includes("agreed") ? null : (line.agreed ?? line.initial)) : null,
        moderator: moderated.get(key(ref.assessment, ref.row)) ?? null,
      });
    }
    const combine = (level: keyof StudentMarks): number | null => {
      if (!weighted) return null;
      let sum = 0;
      for (const a of assessments) {
        const mark = marks.get(a.name)?.[level] ?? null;
        if (mark === null) return null;
        sum += (a.weight as number) * mark;
      }
      return sum / total;
    };
    return { label: `Student ${i + 1}`, marks, module: { initial: combine("initial"), internal: combine("internal"), moderator: combine("moderator") } };
  });
  return { assessments, students, notes };
}
