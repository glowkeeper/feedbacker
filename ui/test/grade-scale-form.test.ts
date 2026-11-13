/** Reading the grade scale form into a scale, and a saved scale back into the form. */

import { expect, test } from "vitest";
import { GradeScale } from "../src/core/index.ts";
import { blankForm, formOf, scaleFrom } from "../src/app/gradeScaleForm.ts";
import { FormProblem } from "../src/app/forms.ts";

test("each choice makes the scale it says, and the scale makes the same choice again", () => {
  const forms = [
    { ...blankForm() },
    { ...blankForm(), rounding: "ending" as const },
    { ...blankForm(), outOf: "10", rounding: "step" as const, step: "0.5" },
    { ...blankForm(), rounding: "pattern" as const, every: "5", at: "1, 3" },
    { ...blankForm(), outOf: "7", rounding: "list" as const, points: "1 2 3, 4\n5" },
  ];
  expect(scaleFrom(forms[0])).toEqual(GradeScale.parse({}));
  expect(scaleFrom(forms[1])).toEqual(GradeScale.parse({ rounding: "pattern", every: 10, at: [2, 5, 8] }));
  expect(scaleFrom(forms[2])).toEqual(GradeScale.parse({ out_of: 10, rounding: "step", step: 0.5 }));
  expect(scaleFrom(forms[3])).toEqual(GradeScale.parse({ rounding: "pattern", every: 5, at: [1, 3] }));
  for (const f of forms) {
    const back = formOf(scaleFrom(f));
    expect(back.rounding).toBe(f.rounding);
    expect(scaleFrom(back)).toEqual(scaleFrom(f));
  }
});

test("a number that is not one, or a rule that is not valid, is reported with everything else that is wrong", () => {
  const problems = (f: object) => {
    try {
      scaleFrom({ ...blankForm(), ...f });
    } catch (err) {
      return (err as FormProblem).problems;
    }
    return [];
  };
  expect(problems({ outOf: "ten", rounding: "step", step: "half" })).toEqual(["what the overall mark is out of must be a number, not 'ten'", "the step must be a number, not 'half'"]);
  expect(problems({ rounding: "step" })).toEqual(["rounding to a step needs the step"]);
  expect(problems({ rounding: "list", points: "" })).toEqual(["rounding to a list needs at least one grade point"]);
  expect(problems({ outOf: "10", rounding: "list", points: "5, 12" })).toEqual(["a grade point is above 10, what the mark is out of"]);
});
