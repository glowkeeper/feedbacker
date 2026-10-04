/** How the rubric step describes levels, and points out a weight that differs from the one a criterion's name carries. */

import { expect, test } from "vitest";
import { levelsText, weightNote, weightsInNames } from "../src/app/rubricView.ts";
import type { Criterion } from "../src/core/index.ts";

const criterion = (id: string, title: string, points: (number | null)[] = [85, 20]): Criterion =>
  ({ id, title, description: null, weight: null, max_points: null, levels: points.map((p, i) => ({ id: `l${i}`, label: p === null ? `Level ${i}` : `L (${p})`, points: p, descriptor: "", min_mark: null, max_mark: null })) }) as unknown as Criterion;

test("levels are described from lowest to highest", () => {
  expect(levelsText(criterion("a", "A", [85, 68, 20]))).toBe("3 levels, from L (20) to L (85)");
  expect(levelsText(criterion("a", "A", [null, null]))).toBe("2 levels, from Level 1 to Level 0"); // as listed, highest first
  expect(levelsText(criterion("a", "A", [50]))).toBe("1 level, L (50)");
});

test("a weight that differs from the one in the criterion's name is pointed out, and nothing is taken from the name", () => {
  const criteria = [criterion("a", "Analytical Focus 25"), criterion("b", "Data Story 20"), criterion("c", "Use of AI 15"), criterion("d", "Visualisation 20"), criterion("e", "Evaluation 20")];
  const named = weightsInNames(criteria);
  expect([...named.values()]).toEqual([25, 20, 15, 20, 20]);
  expect(weightNote(named.get("b"), "15")).toBe("Its name ends in 20, which may be its weight: check it.");
  expect(weightNote(named.get("b"), "20")).toBeNull();
  expect(weightNote(named.get("b"), "")).toBeNull();
  // Numbers that don't add up to 100 (task numbers, say) aren't taken for weights.
  expect(weightsInNames([criterion("a", "Task 1"), criterion("b", "Task 2")]).size).toBe(0);
  expect(weightsInNames([criterion("a", "Analysis 60"), criterion("b", "Writing")]).size).toBe(0);
});
