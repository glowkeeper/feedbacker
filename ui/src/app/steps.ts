/**
 * The workspace's steps: their order and grouping in the navigation,
 * each one's status, and the locks on Review and Export. A workspace's type
 * supplies its step list; moderation is the only one so far. Everything is
 * worked out from the overview and the record's readiness, as the workspace
 * is now, so a step that becomes unready locks again and says why.
 */

import { loadAssessment, type AssessmentDetails, type RecordArea, type RecordProblem, type Workspace } from "../core/index.ts";
import { loadExportState } from "./exportStep.ts";
import { loadOverview, type Overview, type Step } from "./overview.ts";

export type StepId = "overview" | "request" | "assessment" | "cohort" | "rubric" | "brief" | "originals" | "marking" | "anonymisation" | "reading" | "review" | "export";

export interface StepDef {
  id: StepId;
  label: string; // its name in the navigation
  heading: string; // its screen's heading, which is also the page title (WCAG 2.4.2)
  optional?: boolean;
}

/** A step on its own, or a named group of steps that belong together. */
export type NavEntry = { step: StepDef } | { group: string; steps: StepDef[] };

/** Moderation, in working order. The rubric comes before the submissions: importing the original marking maps the marker's criteria onto it. */
export const MODERATION_STEPS: NavEntry[] = [
  { step: { id: "overview", label: "Overview", heading: "Moderation overview" } },
  { step: { id: "request", label: "Request", heading: "Moderation request" } },
  {
    group: "Assessment",
    steps: [
      { id: "rubric", label: "Rubric", heading: "Source rubric" },
      { id: "brief", label: "Brief", heading: "Assessment brief", optional: true },
    ],
  },
  {
    group: "Submissions",
    steps: [
      { id: "originals", label: "Original files", heading: "Original submissions" },
      { id: "marking", label: "Original marking", heading: "Original marking" },
    ],
  },
  { step: { id: "anonymisation", label: "Anonymisation", heading: "Anonymisation" } },
  { step: { id: "reading", label: "AI reading", heading: "AI reading", optional: true } },
  { step: { id: "review", label: "Review", heading: "Review" } },
  { step: { id: "export", label: "Export", heading: "Export" } },
];

export const stepList = (entries: NavEntry[]): StepDef[] => entries.flatMap((e) => ("step" in e ? [e.step] : e.steps));

/** Something still to do before a locked step opens, and the step where it is done (if there is one place). */
export interface Reason {
  text: string;
  goTo: StepId | null;
}

export interface StepState {
  status: Step | null; // null for a step with nothing to finish (the overview)
  reason: string | null; // why it has that status, in a few words, as its screen says it
  locked: Reason[] | null; // why it can't be opened yet; null when it can
}

const WORDS: Record<Step, string> = { done: "Done", attention: "Needs attention", missing: "Not started" };

/** A step's status in a word, as the navigation and its screen both say it; null for a step with no status. */
export function statusWord(state: StepState | undefined, optional = false): string | null {
  if (!state) return null;
  if (state.locked) return "Locked";
  if (state.status === null) return null;
  return state.status === "missing" && optional ? "Optional" : WORDS[state.status];
}

/** What the Export step's readiness says: why the record can't be approved yet (each with where it is put right), and whether an approval matches the workspace. */
export interface Readiness {
  reasons: RecordProblem[];
  current: boolean;
}

/** The step where each part of the record is put right. */
const AREA_STEP: Record<RecordArea, StepId> = { rubric: "rubric", anonymisation: "anonymisation", marking: "marking", review: "review", reading: "reading" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Done when every one is done, not started when none has begun, and needing attention otherwise. */
function across(steps: Step[]): Step {
  if (steps.length && steps.every((s) => s === "done")) return "done";
  if (steps.every((s) => s === "missing")) return "missing";
  return "attention";
}

/** What Review needs: the request and rubric, and every sampled submission's original, approved text and imported marking. */
function reviewReasons(o: Overview): Reason[] {
  const reasons: Reason[] = [];
  if (!o.request) return [{ text: "Record the moderation request", goTo: "request" }];
  if (o.rubric !== "done") reasons.push({ text: o.rubric === "attention" ? "Fix the source rubric, which doesn't load" : "Save the source rubric", goTo: "rubric" });
  const rows = o.submissions;
  const originals = rows.filter((r) => r.original !== "done").length;
  // Marking needs a record that loads, not a confirmed one: a submission reviewed blind keeps its marking unconfirmed until the reveal.
  const marking = rows.filter((r) => !r.markingImported).length;
  const approved = rows.filter((r) => r.approved !== "done").length;
  if (originals) reasons.push({ text: `Import the original files of ${plural(originals, "more submission", "more submissions")}`, goTo: "originals" });
  if (marking) reasons.push({ text: `Import the original marking of ${plural(marking, "more submission", "more submissions")}, so that each has a marking record that loads`, goTo: "marking" });
  if (approved) reasons.push({ text: `Approve the anonymised text of ${plural(approved, "more submission", "more submissions")}`, goTo: "anonymisation" });
  return reasons;
}

/** "k of n <things> <done>", for a reason. */
const ofAll = (k: number, n: number, things: string, done: string) => `${k} of ${n} ${things} ${done}`;

/** Each step's status, why, and whether it is locked, from the workspace as it is now. */
export function moderationStates(o: Overview, readiness: Readiness): Map<StepId, StepState> {
  const rows = o.submissions;
  const n = rows.length;
  const count = (test: (r: (typeof rows)[number]) => boolean) => rows.filter(test).length;
  const open = (status: Step | null, reason: string | null): StepState => ({ status, reason, locked: null });
  // Each step's reason gives that step's own problem, never another's (a submission can have several).
  const problemOf = (step: keyof (typeof rows)[number]["problems"]) => rows.find((r) => r.problems[step])?.problems[step] ?? null;
  const brief: Step = o.brief.imported === "attention" ? "attention" : o.brief.imported === "missing" ? "missing" : o.brief.approved === "done" ? "done" : "attention";
  const anonymised: Step[] = rows.map((r) => (r.approved === "done" ? "done" : r.anonymised === "done" ? "attention" : "missing"));
  if (o.brief.imported === "done") anonymised.push(o.brief.approved === "done" ? "done" : "attention");
  const reviewed: Step[] = rows.map((r) => (r.judgedStep === "done" && r.verdict && !r.verdictStale ? "done" : r.judgedStep === "missing" && !r.verdict ? "missing" : "attention"));
  const toReview = reviewReasons(o);
  const toExport = toReview.length ? toReview : readiness.reasons.map((r) => ({ text: r.text, goTo: r.area ? AREA_STEP[r.area] : null }));
  const originals: Step = n ? across(rows.map((r) => r.original)) : "missing";
  const marking: Step = n ? across(rows.map((r) => r.marking)) : "missing";
  const texts = n + (o.brief.imported === "done" ? 1 : 0);
  const approvedTexts = count((r) => r.approved === "done") + (o.brief.approved === "done" ? 1 : 0);
  return new Map<StepId, StepState>([
    ["overview", open(null, null)],
    [
      "request",
      open(
        o.problem ? "attention" : o.request ? "done" : "missing",
        o.problem ?? (o.request ? `${plural(n, "sampled submission", "sampled submissions")}${o.request.module ? `, ${o.request.module}` : ""}` : "no moderation request recorded yet"),
      ),
    ],
    [
      "rubric",
      open(o.rubric, o.rubric === "done" ? `${plural(o.criteria, "criterion", "criteria")}` : o.rubric === "attention" ? (o.rubricProblem ?? "the rubric doesn't load") : "no source rubric saved yet"),
    ],
    [
      "brief",
      open(
        brief,
        o.brief.problem ??
          (o.brief.imported === "missing"
            ? "no brief imported; it is optional, but the AI reading and your review use it"
            : brief === "done"
              ? "imported, anonymised and approved"
              : "imported; anonymise and approve it on Anonymisation"),
      ),
    ],
    [
      "originals",
      open(
        originals,
        !n ? "record the moderation request first" : (problemOf("original") ?? ofAll(count((r) => r.original === "done"), n, "sampled submissions", "imported")),
      ),
    ],
    [
      "marking",
      open(
        marking,
        !n
          ? "record the moderation request first"
          : (problemOf("marking") ??
            `${ofAll(count((r) => r.markingImported), n, "sampled submissions", "imported")}; ${count((r) => r.marking === "done")} confirmed`),
      ),
    ],
    ["anonymisation", open(n ? across(anonymised) : "missing", !n ? "record the moderation request first" : ofAll(approvedTexts, texts, "texts", "approved"))],
    ["reading", open(n ? across(rows.map((r) => r.reading)) : "missing", !n ? "record the moderation request first" : ofAll(count((r) => r.reading === "done"), n, "sampled submissions", "read"))],
    ["review", { status: n ? across(reviewed) : "missing", reason: n ? ofAll(reviewed.filter((s) => s === "done").length, n, "sampled submissions", "reviewed, with a current verdict") : null, locked: toReview.length ? toReview : null }],
    ["export", { status: readiness.current ? "done" : "missing", reason: readiness.current ? "approved, and nothing has changed since" : toExport.length ? "not ready to approve yet" : "nothing approved yet; everything is ready for you to approve", locked: toExport.length ? toExport : null }],
  ]);
}

/** A workspace type's navigation: its steps, what the navigation is called, and how each step's state is read from the workspace. */
export interface Navigation {
  label: string;
  entries: NavEntry[];
  states: (ws: Workspace) => Promise<Map<StepId, StepState>>;
}

export const MODERATION: Navigation = {
  label: "Moderation steps",
  entries: MODERATION_STEPS,
  states: async (ws) => {
    const [overview, readiness] = await Promise.all([loadOverview(ws), loadExportState(ws)]);
    return moderationStates(overview, readiness);
  },
};

/**
 * Marking, in working order: so far, what the assessment is and what it is marked against, the cohort's submissions,
 * and their anonymisation. The AI's suggestions, the educator's marks, feedback and export join as they are built, so
 * no step leads nowhere.
 */
export const MARKING_STEPS: NavEntry[] = [
  { step: { id: "overview", label: "Overview", heading: "Marking overview" } },
  {
    group: "Assessment",
    steps: [
      { id: "assessment", label: "Details", heading: "The assessment" },
      { id: "rubric", label: "Rubric", heading: "Source rubric" },
      { id: "brief", label: "Brief", heading: "Assessment brief", optional: true },
    ],
  },
  { step: { id: "cohort", label: "Submissions", heading: "The cohort's submissions" } },
  { step: { id: "anonymisation", label: "Anonymisation", heading: "Anonymisation" } },
];

/** A marking workspace's steps: the assessment's details, then the rubric, brief and anonymisation as in moderation, from the cohort. */
export function markingStates(o: Overview, assessment: AssessmentDetails | null, assessmentProblem: string | null): Map<StepId, StepState> {
  const shared = moderationStates(o, { reasons: [], current: false }); // the rubric, the brief and anonymisation work as in moderation
  const rows = o.submissions;
  const n = rows.length;
  const open = (status: Step | null, reason: string | null): StepState => ({ status, reason, locked: null });
  const imported = rows.filter((r) => r.original === "done").length;
  const cohort = o.problem
    ? open("attention", o.problem)
    : n
      ? open(across(rows.map((r) => r.original)), rows.find((r) => r.problems.original)?.problems.original ?? `${plural(imported, "submission", "submissions")} imported`)
      : open("missing", "no submissions imported yet");
  const anonymisation = n ? shared.get("anonymisation")! : open("missing", "import the cohort's submissions first");
  return new Map<StepId, StepState>([
    ["overview", open(null, null)],
    ["assessment", open(assessmentProblem ? "attention" : assessment ? "done" : "missing", assessmentProblem ?? (assessment ? assessment.title : "no assessment recorded yet"))],
    ["rubric", shared.get("rubric")!],
    ["brief", o.brief.imported === "missing" ? open("missing", "no brief imported; it is optional, but the AI's suggestions use it") : shared.get("brief")!],
    ["cohort", cohort],
    ["anonymisation", anonymisation],
  ]);
}

export const MARKING: Navigation = {
  label: "Marking steps",
  entries: MARKING_STEPS,
  states: async (ws) => {
    let assessment: AssessmentDetails | null = null;
    let problem: string | null = null;
    try {
      assessment = await loadAssessment(ws);
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    return markingStates(await loadOverview(ws), assessment, problem);
  },
};

/** The navigation for a workspace, by its type. */
export const navigationFor = (ws: Workspace): Navigation => (ws.manifest.workspace_type === "marking" ? MARKING : MODERATION);
