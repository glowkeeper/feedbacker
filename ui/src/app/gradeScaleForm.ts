/**
 * The grade scale form: what the overall mark is out of, and how it is rounded. The form is a kind of rounding and the boxes that kind needs, read into the
 * core's GradeScale with every problem reported together; and a saved scale read back into the form.
 */

import { ENDING_IN_2_5_8, GradeScale } from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";
import { FormProblem, parseMark } from "./forms.ts";

export type RoundingChoice = "none" | "ending" | "step" | "pattern" | "list";

export interface GradeScaleForm {
  outOf: string;
  rounding: RoundingChoice;
  step: string;
  every: string;
  at: string; // the marks in each block, separated by commas, spaces or new lines
  points: string; // the grade points, separated by commas, spaces or new lines
}

export const blankForm = (): GradeScaleForm => ({ outOf: "100", rounding: "none", step: "", every: "", at: "", points: "" });

const numbers = (text: string, what: string): number[] =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => parseMark(t, what)!);

/** A saved scale as the form shows it. Marks ending in 2, 5 or 8 are the choice of that name, and any other pattern is a pattern. */
export function formOf(scale: GradeScale): GradeScaleForm {
  const form: GradeScaleForm = { ...blankForm(), outOf: pyFormatG(scale.out_of) };
  if (scale.rounding === "step") return { ...form, rounding: "step", step: pyFormatG(scale.step!) };
  if (scale.rounding === "list") return { ...form, rounding: "list", points: scale.points.map(pyFormatG).join(", ") };
  if (scale.rounding === "pattern") {
    const ending = scale.every === ENDING_IN_2_5_8.every && scale.at.join() === ENDING_IN_2_5_8.at.join();
    return { ...form, rounding: ending ? "ending" : "pattern", every: pyFormatG(scale.every!), at: scale.at.map(pyFormatG).join(", ") };
  }
  return form;
}

/** The scale the form says, or every problem with it. */
export function scaleFrom(form: GradeScaleForm): GradeScale {
  const problems: string[] = [];
  const attempt = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch (err) {
      if (!(err instanceof FormProblem)) throw err;
      problems.push(...err.problems);
      return undefined;
    }
  };
  const outOf = attempt(() => parseMark(form.outOf, "what the overall mark is out of") ?? 100);
  const input: Record<string, unknown> = { out_of: outOf };
  if (form.rounding === "ending") Object.assign(input, ENDING_IN_2_5_8, { at: [...ENDING_IN_2_5_8.at] });
  if (form.rounding === "step") Object.assign(input, { rounding: "step", step: attempt(() => parseMark(form.step, "the step")) });
  if (form.rounding === "pattern") Object.assign(input, { rounding: "pattern", every: attempt(() => parseMark(form.every, "the size of the block")), at: attempt(() => numbers(form.at, "a mark in the block")) ?? [] });
  if (form.rounding === "list") Object.assign(input, { rounding: "list", points: attempt(() => numbers(form.points, "a grade point")) ?? [] });
  if (problems.length) throw new FormProblem(problems);
  const parsed = GradeScale.safeParse(input);
  if (!parsed.success) throw new FormProblem(parsed.error.issues.map((i) => i.message));
  return parsed.data;
}
