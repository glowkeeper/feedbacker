/**
 * A rubric entered from an image of it (a screenshot of the marking platform's rubric, say).
 *
 * Transcribing an image is lossy by nature, so nothing here reads the image: the moderator types the grid beside it, the image
 * is kept as the rubric's source with its hash, and the grid is checked against the pattern the rubric itself follows. A cell that
 * departs from that pattern is flagged for the moderator and never corrected: a rubric can have genuine slips, and the source is
 * kept as it is written. The saved rubric records that it was entered from the image, by the moderator.
 */

import { sha256Bytes } from "./extract.ts";
import { buildRubric, RUBRIC, RUBRIC_PROPOSAL, RUBRIC_WARNINGS, RubricError } from "./rubric.ts";
import type { ProposalRecord } from "./rubricReading.ts";
import type { Rubric } from "./models.ts";
import { ownerOf } from "./assessment.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

/** What the moderator types, as text: a level's label (with its range, as written), its points, and its descriptor. */
export interface GridLevel {
  label: string;
  points: string;
  descriptor: string;
}

export interface GridCriterion {
  title: string;
  weight: string;
  max_points: string;
  levels: GridLevel[];
}

export interface RubricGrid {
  title: string;
  criteria: GridCriterion[];
}

/** What a criterion is marked out of: its own box, or else its weight (a rubric whose points are its percentage weights). */
const outOf = (c: { weight: string; max_points: string }) => (c.max_points.trim() ? c.max_points : c.weight);

const num = (text: string): number | null => {
  const t = text.trim().replace(/%$/, "");
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
};

/** The range a level's label gives, "Excellent (16-20)" or "(12- 13.8)": its low and high marks. */
export function rangeOfLabel(label: string): { low: number; high: number } | null {
  const m = /\(\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*\)\s*$/.exec(label.trim());
  return m ? { low: Number(m[1]), high: Number(m[2]) } : null;
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.05;

/**
 * What in the grid departs from the pattern the rubric follows, in words, for the moderator to look at beside the image. Nothing is
 * corrected. The pattern is the rubric's own: each level of a criterion starts at the same percentage of the criterion's points as
 * the same level of the others (judged where at least three criteria give a range), the levels run from high to low without
 * overlapping, each level's points lie within its range, and the weights add to 100.
 */
export function gridFlags(grid: RubricGrid): string[] {
  const flags: string[] = [];
  const named = grid.criteria.filter((c) => c.title.trim());
  const weights = named.map((c) => num(c.weight));
  if (weights.length && weights.every((w) => w !== null)) {
    const total = (weights as number[]).reduce((a, b) => a + b, 0);
    if (!same(total, 100)) flags.push(`The weights add up to ${Math.round(total * 100) / 100}, not 100.`);
  }
  const counts = new Map<number, number>();
  for (const c of named) counts.set(c.levels.length, (counts.get(c.levels.length) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const c of named) if (usual !== undefined && c.levels.length !== usual && counts.size > 1) flags.push(`${c.title.trim()} has ${c.levels.length} levels; the others mostly have ${usual}.`);

  for (const c of named) {
    const max = num(outOf(c));
    let above: { low: number; label: string } | null = null;
    c.levels.forEach((l, i) => {
      const where = `${c.title.trim()}, ${l.label.trim() || `level ${i + 1}`}`;
      const points = num(l.points);
      const range = rangeOfLabel(l.label);
      if (points !== null && max !== null && points > max) flags.push(`${where}: ${points} points is more than the criterion's ${max}.`);
      if (range && points !== null && (points < range.low - 0.001 || points > range.high + 0.001)) flags.push(`${where}: ${points} points is outside its range ${range.low}-${range.high}.`);
      if (range && range.high < range.low) flags.push(`${where}: its range ${range.low}-${range.high} runs backwards.`);
      if (range && above && range.high >= above.low) flags.push(`${where}: its range overlaps ${above.label}'s.`);
      if (range) above = { low: range.low, label: l.label.trim() };
      const next = c.levels[i + 1] && num(c.levels[i + 1].points);
      if (points !== null && next !== null && next !== undefined && next >= points) flags.push(`${where}: the next level down has ${next} points, which isn't fewer.`);
    });
  }

  // Each level's start as a percentage of its criterion's points, against what the other criteria give for the same level.
  const depth = Math.max(0, ...named.map((c) => c.levels.length));
  for (let i = 0; i < depth; i++) {
    const starts = named.flatMap((c) => {
      const max = num(outOf(c));
      const range = c.levels[i] ? rangeOfLabel(c.levels[i].label) : null;
      return range && max ? [{ c, level: c.levels[i], percent: (100 * range.low) / max }] : [];
    });
    if (starts.length < 3) continue;
    const tally = new Map<number, number>();
    for (const s of starts) tally.set(Math.round(s.percent), (tally.get(Math.round(s.percent)) ?? 0) + 1);
    const [usualPercent, votes] = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (votes < 2) continue;
    for (const s of starts) {
      if (Math.abs(s.percent - usualPercent) > 0.75) {
        flags.push(`${s.c.title.trim()}, ${s.level.label.trim()}: it starts at ${Math.round(s.percent * 10) / 10}% of the criterion's points; the same level of the other criteria starts at ${usualPercent}%.`);
      }
    }
  }
  return flags;
}

export interface EnteredRubric {
  rubric: Rubric;
  flags: string[];
  imagePath: string;
}

/** The sources folder's name for a rubric image: by content, so a different image never overwrites another. */
export const rubricImagePath = (hash: string, name: string) => `sources/rubric-image-${hash.slice(0, 16)}${/\.(png|jpe?g|webp|gif)$/i.exec(name)?.[0].toLowerCase() ?? ""}`;

/**
 * Save the rubric entered from an image: the image as its source, the rubric built from the grid with the usual checks (a problem
 * refuses it, listed together), and the flags kept with it as its warnings. Replacing a rubric needs `replace`.
 */
export async function enterRubricFromImage(
  ws: Workspace,
  image: { name: string; bytes: Uint8Array },
  grid: RubricGrid,
  options: { version?: string; replace?: boolean; now?: Date; proposal?: ProposalRecord | null } = {},
): Promise<EnteredRubric> {
  if ((await ws.exists(RUBRIC)) && !options.replace) throw new WorkspaceError("a rubric is already imported; use replace to import again");
  if (!/\.(png|jpe?g|webp|gif)$/i.test(image.name)) throw new RubricError(["the rubric's image must be a png, jpg, webp or gif"]);
  const hash = sha256Bytes(image.bytes);
  if (options.proposal && options.proposal.image_sha256 !== hash) throw new WorkspaceError("the AI's proposal was made from a different image than the one being saved");
  const [rubric, built] = buildRubric(
    {
      title: grid.title,
      criteria: grid.criteria
        .filter((c) => c.title.trim() || c.levels.some((l) => l.label.trim() || l.descriptor.trim()))
        .map((c) => ({
          title: c.title,
          weight: c.weight,
          max_points: outOf(c),
          levels: c.levels.filter((l) => l.label.trim() || l.points.trim() || l.descriptor.trim()).map((l) => ({ label: l.label, points: l.points, descriptor: l.descriptor })),
        })),
    },
    { title: grid.title.trim() || "Rubric", version: options.version ?? "1", sourceHash: hash, now: options.now, actor: ownerOf(ws), provenance: { source: `image:sha256:${hash}`, transformation: "entered" }, keepEscapes: true },
  );
  // What departs from the pattern, and anything the builder noted: both are kept with the rubric, and shown.
  const flags = [...gridFlags(grid), ...built];
  const imagePath = rubricImagePath(hash, image.name);
  const previousWarnings = await ws.fs.readText(RUBRIC_WARNINGS);
  const previousProposal = await ws.fs.readText(RUBRIC_PROPOSAL);
  const imageExisted = await ws.exists(imagePath);
  try {
    await ws.writeBytes(imagePath, image.bytes);
    await ws.writeJson(RUBRIC_WARNINGS, flags);
    // A rubric that began as the AI's proposal says so, beside it; one that didn't leaves no record of an earlier one's.
    if (options.proposal) await ws.writeJson(RUBRIC_PROPOSAL, options.proposal);
    else if (previousProposal !== null) await ws.fs.remove(RUBRIC_PROPOSAL);
    await ws.writeJson(RUBRIC, rubric);
  } catch (err) {
    // The metadata and the rubric go together: whatever was written is put back as it was, and an image no rubric uses isn't left.
    if (!imageExisted) await ws.fs.remove(imagePath).catch(() => {});
    await (previousWarnings !== null ? ws.fs.writeText(RUBRIC_WARNINGS, previousWarnings) : ws.fs.remove(RUBRIC_WARNINGS)).catch(() => {});
    await (previousProposal !== null ? ws.fs.writeText(RUBRIC_PROPOSAL, previousProposal) : ws.fs.remove(RUBRIC_PROPOSAL)).catch(() => {});
    throw err;
  }
  await ws.secure();
  return { rubric, flags, imagePath };
}
