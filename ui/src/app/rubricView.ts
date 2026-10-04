/**
 * How the rubric step describes a rubric: each criterion's levels in words, and the weights its criteria's names
 * seem to carry (a name such as "Use and Evaluation of AI 15"), so a weight that differs can be pointed out. The
 * names are only ever a hint: a weight is never taken from them.
 */

import type { Criterion } from "../core/index.ts";
import { pyFormatG } from "../core/pytext.ts";

/** "9 levels, from FAIL (20) to 1ST (85)": lowest to highest by points when every level has points, else as listed (highest first). */
export function levelsText(c: Criterion): string {
  const n = c.levels.length;
  if (!n) return "No levels";
  if (n === 1) return `1 level, ${c.levels[0].label}`;
  const byPoints = c.levels.every((l) => l.points !== null) ? [...c.levels].sort((a, b) => a.points! - b.points!) : [...c.levels].reverse();
  return `${n} levels, from ${byPoints[0].label} to ${byPoints[n - 1].label}`;
}

const TRAILING_NUMBER = /(?:^|\s)(\d+(?:\.\d+)?)\s*%?\s*$/;

/**
 * The weight each criterion's name ends in, by criterion id, when every name ends in a number and those numbers add
 * up to 100 (so they are almost certainly weights, not, say, a task number); otherwise none.
 */
export function weightsInNames(criteria: Criterion[]): Map<string, number> {
  const found = criteria.map((c) => [c.id, TRAILING_NUMBER.exec(c.title.trim())?.[1]] as const);
  if (!found.length || found.some(([, n]) => n === undefined)) return new Map();
  const weights = new Map(found.map(([id, n]) => [id, Number(n)]));
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  return Math.abs(total - 100) < 1e-9 ? weights : new Map();
}

/** What to say beside a weight box whose value differs from the weight its criterion's name carries; null if it agrees (or isn't a number yet). */
export function weightNote(nameWeight: number | undefined, entered: string): string | null {
  if (nameWeight === undefined) return null;
  const value = Number(entered.trim());
  if (entered.trim() === "" || !Number.isFinite(value) || Math.abs(value - nameWeight) < 1e-9) return null;
  return `Its name ends in ${pyFormatG(nameWeight)}, which may be its weight: check it.`;
}
