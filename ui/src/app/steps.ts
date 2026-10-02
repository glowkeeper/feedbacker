/**
 * The workspace's steps (#103): their order and grouping in the navigation,
 * each one's status, and the locks on Review and Export. A workspace's type
 * supplies its step list; moderation is the only one so far. Everything is
 * worked out from the overview and the record's readiness, as the workspace
 * is now, so a step that becomes unready locks again and says why.
 */

import type { Overview, Step } from "./overview.ts";

export type StepId = "overview" | "request" | "rubric" | "brief" | "originals" | "marking" | "anonymisation" | "reading" | "review" | "export";

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
  locked: Reason[] | null; // why it can't be opened yet; null when it can
}

/** What the Export step's readiness says: why the record can't be approved yet, and whether an approval matches the workspace. */
export interface Readiness {
  problems: string[];
  current: boolean;
}

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
  // Marking needs importing, not confirming: a submission reviewed blind keeps its marking unconfirmed until the reveal.
  const marking = rows.filter((r) => r.marking === "missing").length;
  const approved = rows.filter((r) => r.approved !== "done").length;
  if (originals) reasons.push({ text: `Import the original files of ${plural(originals, "more submission", "more submissions")}`, goTo: "originals" });
  if (marking) reasons.push({ text: `Import the original marking of ${plural(marking, "more submission", "more submissions")}`, goTo: "marking" });
  if (approved) reasons.push({ text: `Approve the anonymised text of ${plural(approved, "more submission", "more submissions")}`, goTo: "anonymisation" });
  return reasons;
}

/** Each step's status, and whether it is locked, from the workspace as it is now. */
export function moderationStates(o: Overview, readiness: Readiness): Map<StepId, StepState> {
  const rows = o.submissions;
  const open = (status: Step | null): StepState => ({ status, locked: null });
  const brief: Step = o.brief.imported === "attention" ? "attention" : o.brief.imported === "missing" ? "missing" : o.brief.approved === "done" ? "done" : "attention";
  const anonymised: Step[] = rows.map((r) => (r.approved === "done" ? "done" : r.anonymised === "done" ? "attention" : "missing"));
  if (o.brief.imported === "done") anonymised.push(o.brief.approved === "done" ? "done" : "attention");
  const reviewed: Step[] = rows.map((r) => (r.judgedStep === "done" && r.verdict && !r.verdictStale ? "done" : r.judgedStep === "missing" && !r.verdict ? "missing" : "attention"));
  const toReview = reviewReasons(o);
  const toExport = toReview.length ? toReview : readiness.problems.map((text) => ({ text, goTo: null }));
  return new Map<StepId, StepState>([
    ["overview", open(null)],
    ["request", open(o.problem ? "attention" : o.request ? "done" : "missing")],
    ["rubric", open(o.rubric)],
    ["brief", open(brief)],
    ["originals", open(rows.length ? across(rows.map((r) => r.original)) : "missing")],
    ["marking", open(rows.length ? across(rows.map((r) => r.marking)) : "missing")],
    ["anonymisation", open(rows.length ? across(anonymised) : "missing")],
    ["reading", open(rows.length ? across(rows.map((r) => r.reading)) : "missing")],
    ["review", { status: rows.length ? across(reviewed) : "missing", locked: toReview.length ? toReview : null }],
    ["export", { status: readiness.current ? "done" : "missing", locked: toExport.length ? toExport : null }],
  ]);
}
