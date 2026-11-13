/**
 * The scale the educator's overall mark is given on, and the grade points it is rounded to.
 *
 * The overall mark is worked out from the criteria as a share of the whole (marks.ts), so it can be given out of any
 * number: 100 for a percentage, 10 or 7 for a rubric that is marked that way. Some institutions give overall marks
 * only on fixed grade points (marks that end in 2, 5 or 8), and a workspace can say so. The rounding only proposes:
 * the overall mark stays the educator's, who sees the mark worked out and the mark proposed, and can enter any mark.
 *
 * Kept in `marks/grade-scale.json`. With none kept, the overall is out of 100 and is not rounded.
 */

import { GradeScale, type SubmissionMark } from "./models.ts";
import { pyFormatG } from "./pytext.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const GRADE_SCALE = "marks/grade-scale.json";

/** The default: a percentage, not rounded. */
export const DEFAULT_GRADE_SCALE: GradeScale = GradeScale.parse({});

/** Marks that end in 2, 5 or 8: the grade points of 42, 45, 48, 52, 55, 58 and so on. */
export const ENDING_IN_2_5_8 = { rounding: "pattern", every: 10, at: [2, 5, 8] } as const;

export async function loadGradeScale(ws: Workspace): Promise<GradeScale> {
  if (!(await ws.exists(GRADE_SCALE))) return DEFAULT_GRADE_SCALE;
  const parsed = GradeScale.safeParse(await ws.readJson(GRADE_SCALE));
  if (!parsed.success) throw new WorkspaceError(`${GRADE_SCALE} is not a valid grade scale: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

/** Keep the workspace's grade scale. The default is kept as nothing at all, so that a workspace that never chose one has none. */
export async function saveGradeScale(ws: Workspace, scale: GradeScale): Promise<GradeScale> {
  const checked = GradeScale.parse(scale);
  if (isDefault(checked)) {
    if (await ws.exists(GRADE_SCALE)) await ws.fs.remove(GRADE_SCALE);
    return DEFAULT_GRADE_SCALE;
  }
  await ws.writeJson(GRADE_SCALE, checked);
  return checked;
}

export const isDefault = (scale: GradeScale) => scale.out_of === 100 && scale.rounding === "none";

/** Whether a scale changes anything the educator is shown: another maximum, or a rounding rule. */
export const roundsOrScales = (scale: GradeScale) => !isDefault(scale);

/** Mark arithmetic is done to a few decimal places, so that 0.1 + 0.2 is 0.3 and not a hair over. */
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;

/**
 * Every grade point of a scale, lowest first, or null when it doesn't round. A step or a pattern also takes 0 and the
 * top of the scale as grade points, so a mark is never pushed past either end; a list is exactly what was listed.
 */
export function gradePoints(scale: GradeScale): number[] | null {
  const points = new Set<number>();
  if (scale.rounding === "none") return null;
  if (scale.rounding === "list") for (const p of scale.points) points.add(tidy(p));
  else {
    points.add(0).add(scale.out_of);
    if (scale.rounding === "step") for (let k = 1; tidy(k * scale.step!) < scale.out_of; k++) points.add(tidy(k * scale.step!));
    else for (let base = 0; base <= scale.out_of; base += scale.every!) for (const a of scale.at) if (tidy(base + a) <= scale.out_of) points.add(tidy(base + a));
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * The grade point nearest a mark, rounding up when it is exactly halfway (63.5 is 65 when the points are 62 and 65).
 * A mark below the lowest grade point goes to it, and above the highest, to it. With no rounding, the mark as it is.
 */
export function roundToScale(mark: number, scale: GradeScale): number {
  const points = gradePoints(scale);
  if (!points) return mark;
  let nearest = points[0];
  for (const p of points) if (Math.abs(p - mark) <= Math.abs(nearest - mark) + 1e-9) nearest = p; // lowest first, so a point as near as the last, and higher, wins: halfway rounds up
  return nearest;
}

/** The overall mark worked out from the criteria as a percentage, on the scale, to one decimal place: the mark as the educator sees it before any rounding. */
export const onScale = (percentage: number, scale: GradeScale) => Math.min(scale.out_of, Math.round(percentage * scale.out_of * 0.1) / 10); // never above the top, which one decimal place can otherwise pass (100% of 7.25)

export interface ProposedOverall {
  /** Worked out from the criteria, on the scale, to one decimal place. */
  worked: number;
  /** What it is rounded to: the same as `worked` when nothing is rounded, or it already is a grade point. */
  mark: number;
}

/** The overall mark proposed from the criteria: the percentage they imply, put on the scale and rounded to its grade points. */
export function proposeOverall(percentage: number, scale: GradeScale): ProposedOverall {
  const worked = onScale(percentage, scale);
  return { worked, mark: roundToScale(worked, scale) };
}

/** The rule in words, as the educator would say it. */
export function describeRounding(scale: GradeScale): string {
  switch (scale.rounding) {
    case "none":
      return "not rounded";
    case "step":
      return `rounded to the nearest ${pyFormatG(scale.step!)}`;
    case "pattern":
      return scale.every === 10 ? `rounded to marks ending in ${listOf(scale.at)}` : `rounded to the marks ${listOf(scale.at)} in every ${pyFormatG(scale.every!)}`;
    case "list":
      return `rounded to ${listOf(gradePoints(scale)!)}`;
  }
}

const listOf = (numbers: number[]) => {
  const words = [...numbers].sort((a, b) => a - b).map((n) => pyFormatG(n));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : (words[0] ?? "");
};

/** What the overall mark is out of, in words: "a percentage" for 100, or "out of 10". */
export const describeOutOf = (scale: GradeScale) => (scale.out_of === 100 ? "a percentage" : `out of ${pyFormatG(scale.out_of)}`);

/** The mark worked out and the mark proposed, as the educator is shown them: "66.3, rounded to 65", or just the mark when rounding made no difference. */
export function describeProposal(p: ProposedOverall): string {
  const mark = pyFormatG(p.mark);
  return p.worked === p.mark ? mark : `${pyFormatG(p.worked)}, rounded to ${mark}`;
}

/** What an overall mark is out of: 100 unless it was given on another scale. */
export const outOfOf = (overall: Pick<SubmissionMark, "grade_scale">) => overall.grade_scale?.out_of ?? 100;

/**
 * An overall mark as a percentage, which is what the checks on feedback, the bands and a percentage named in feedback are all about: a mark of 7 out of 10 is 70.
 * The record carries what it was given out of, so a mark is read on the scale it was given on, whatever the workspace is set to now.
 */
export const percentOfOverall = (overall: Pick<SubmissionMark, "mark" | "grade_scale">) => Math.round((overall.mark * 100 * 1000) / outOfOf(overall)) / 1000;
