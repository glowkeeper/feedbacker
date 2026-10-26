/**
 * A pattern to start a criterion's levels from, for a rubric whose levels are fixed percentage bands of the criterion's points: each
 * level's name and the percentage it starts at. It fills only the labels, with their ranges (a level runs from where it starts to a
 * hundredth of the criterion below where the level above starts); the points and descriptors are typed from the image.
 */

export interface PatternLevel {
  name: string;
  starts: string;
}

export const DEFAULT_PATTERN: PatternLevel[] = [
  { name: "Excellent", starts: "80" },
  { name: "Very Good", starts: "70" },
  { name: "Good", starts: "60" },
  { name: "Adequate", starts: "50" },
  { name: "Marginal Fail", starts: "40" },
  { name: "Fail with omissions", starts: "30" },
  { name: "Fail with major omissions", starts: "20" },
  { name: "Not done", starts: "0" },
];

const tidy = (n: number) => String(Math.round(n * 100) / 100);

/** Level labels like "Very Good (14-15.8)" for a criterion marked out of `max`; null if the pattern or `max` isn't usable. */
export function labelsFromPattern(pattern: PatternLevel[], max: number): string[] | null {
  const rows = pattern.filter((p) => p.name.trim() || p.starts.trim());
  const starts = rows.map((p) => (/^\d+(?:\.\d+)?$/.test(p.starts.trim()) ? Number(p.starts.trim()) : NaN));
  if (!rows.length || !(max > 0) || starts.some((s) => Number.isNaN(s) || s > 100) || rows.some((p) => !p.name.trim())) return null;
  if (starts.some((s, i) => i > 0 && s >= starts[i - 1])) return null; // each level starts lower than the one above
  return rows.map((p, i) => {
    const low = (max * starts[i]) / 100;
    const high = i === 0 ? max : (max * starts[i - 1]) / 100 - max / 100;
    return `${p.name.trim()} (${tidy(low)}-${tidy(high)})`;
  });
}
