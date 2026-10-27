/**
 * The rubric a marking platform prints on its marked views, kept as shown and compared with the source rubric.
 *
 * A marked view from some platforms carries the platform's own copy of the rubric: each criterion's name, weight and maximum, and its
 * levels with their points. A source rubric entered by the moderator (typed from an image, say) can be checked against the pattern it
 * follows, but not against that independent copy, so the copy is kept (in `embedded-rubric.json`, beside the marking, never as the source
 * rubric and never holding a student's mark) and each difference is listed in words. Differences are listed, never corrected. Marked
 * views that carry no rubric have nothing to compare with.
 */

import { ownerOf } from "./assessment.ts";
import { type CriteriaMap, mapCriterion } from "./marking.ts";
import type { MarkedView } from "./markedView.ts";
import { EmbeddedRubric, type EmbeddedCriterion, type Rubric } from "./models.ts";
import { pyCasefold } from "./pyre.ts";
import type { Workspace } from "./workspace.ts";
import { WorkspaceError } from "./workspace.ts";

export const EMBEDDED_RUBRIC = "embedded-rubric.json";

const shown = (v: MarkedView): EmbeddedCriterion[] =>
  v.criteria.map((c) => ({ name: c.name, weight: c.weight, max_points: c.max_points, levels: c.level_list.map((l) => ({ label: l.label, points: l.points })) }));

/**
 * Keep the rubric the marked views carry: the first view's, with how many views carried it and how many carried a different one. Nothing is
 * kept where no view carries a rubric (and an earlier record is left as it was).
 */
export async function recordEmbeddedRubric(ws: Workspace, views: { view: MarkedView; sha256: string }[], now: Date = new Date()): Promise<EmbeddedRubric | null> {
  const carrying = views.filter((v) => v.view.criteria.length > 0);
  if (!carrying.length) return null;
  // A view carries the same rubric if its printed maximum and its criteria (with their levels) are the same.
  const identity = (v: MarkedView) => JSON.stringify([v.rubric_max, shown(v)]);
  const first = shown(carrying[0].view);
  const same = (v: MarkedView) => identity(v) === identity(carrying[0].view);
  const record = EmbeddedRubric.parse({
    max: carrying[0].view.rubric_max,
    criteria: first,
    views: carrying.filter((v) => same(v.view)).length,
    differing: carrying.filter((v) => !same(v.view)).length,
    provenance: {
      source: "marked views: the marking platform's own copy of the rubric (not the source rubric)",
      transformation: "imported",
      actor: ownerOf(ws),
      timestamp: now.toISOString(),
      input_hashes: carrying.map((v) => v.sha256),
    },
  });
  await ws.writeJson(EMBEDDED_RUBRIC, record, { private: true });
  return record;
}

/** What is in the file now, to put back if the import that is about to replace it fails. */
export const embeddedRubricText = (ws: Workspace) => ws.fs.readText(EMBEDDED_RUBRIC);

/** Put back what `embeddedRubricText` read: the earlier record, or no record if there was none. */
export async function restoreEmbeddedRubric(ws: Workspace, previous: string | null): Promise<void> {
  await (previous === null ? ws.fs.remove(EMBEDDED_RUBRIC) : ws.fs.writeText(EMBEDDED_RUBRIC, previous));
}

/** The rubric the marked views carried, or null where none did. */
export async function loadEmbeddedRubric(ws: Workspace): Promise<EmbeddedRubric | null> {
  if (!(await ws.exists(EMBEDDED_RUBRIC))) return null;
  const parsed = EmbeddedRubric.safeParse(await ws.readJson(EMBEDDED_RUBRIC));
  if (!parsed.success) throw new WorkspaceError(`${EMBEDDED_RUBRIC} is not a valid record of the marked views' rubric`);
  return parsed.data;
}

const squash = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
/**
 * A level's name without the points in brackets the platform prints after it (a number, or a range of them), compared without regard to
 * case. Any other bracketed text ("Pass (conditional)") is part of the name.
 */
const nameOfLevel = (label: string) => pyCasefold(squash(label.replace(/\(\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*\)\s*$/, "")));
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * How the source rubric differs from the one the marked views carry, in words: a criterion without a counterpart on either side, a different
 * weight or maximum, a level without a counterpart (matched by points), or with another name. An empty list is no difference found.
 */
export function compareWithEmbedded(rubric: Rubric, embedded: EmbeddedRubric, map: CriteriaMap): string[] {
  const out: string[] = [];
  const matched = new Set<string>();
  for (const e of embedded.criteria) {
    const id = mapCriterion(e.name, rubric, map);
    const c = id === null ? null : (rubric.criteria.find((x) => x.id === id) ?? null);
    if (!c) {
      out.push(`The marked views' criterion '${e.name}' has no counterpart in the rubric.`);
      continue;
    }
    if (matched.has(c.id)) {
      out.push(`The marked views' criterion '${e.name}' matches the rubric's '${c.title}' as well as another of theirs.`);
      continue;
    }
    matched.add(c.id);
    const at = `'${c.title}'`;
    if (c.weight === null) out.push(`${at}: the marked views give a weight of ${num(e.weight)}%, and the rubric gives none.`);
    else if (!same(c.weight, e.weight)) out.push(`${at}: the marked views give a weight of ${num(e.weight)}%, and the rubric ${num(c.weight)}%.`);
    if (c.max_points === null) out.push(`${at}: the marked views give a maximum of ${num(e.max_points)}, and the rubric gives none.`);
    else if (!same(c.max_points, e.max_points)) out.push(`${at}: the marked views give a maximum of ${num(e.max_points)}, and the rubric ${num(c.max_points)}.`);
    const usable = c.levels.some((l) => l.points !== null);
    const used = new Set<string>();
    for (const l of e.levels) {
      const counterpart = c.levels.find((x) => !used.has(x.id) && x.points !== null && same(x.points, l.points));
      if (!counterpart) {
        // Without any points in the rubric's levels, a level can only be told by its name.
        const byName = usable ? undefined : c.levels.find((x) => !used.has(x.id) && nameOfLevel(x.label) === nameOfLevel(l.label));
        if (byName) {
          used.add(byName.id);
          // Matched by name alone, so the points haven't been compared: said, or checked against the band the rubric gives the level.
          const low = byName.min_mark;
          const high = byName.max_mark;
          if (low !== null && high !== null && (l.points < low || l.points > high)) {
            out.push(`${at}: the marked views give '${l.label}' ${num(l.points)} points, which is outside the rubric's band of ${num(low)} to ${num(high)} for that level.`);
          } else if (low === null && high === null) {
            out.push(`${at}: the rubric's level '${byName.label}' gives no points, so the marked views' ${num(l.points)} points for it couldn't be compared.`);
          }
        } else out.push(`${at}: the marked views have a level '${l.label}' (${num(l.points)} points) with no counterpart in the rubric.`);
        continue;
      }
      used.add(counterpart.id);
      if (nameOfLevel(counterpart.label) !== nameOfLevel(l.label)) out.push(`${at}: the level of ${num(l.points)} points is '${nameOfLevel(l.label)}' in the marked views and '${nameOfLevel(counterpart.label)}' in the rubric.`);
    }
    for (const x of c.levels) if (!used.has(x.id)) out.push(`${at}: the rubric has a level '${x.label}'${x.points === null ? "" : ` (${num(x.points)} points)`} with no counterpart in the marked views.`);
  }
  for (const c of rubric.criteria) if (!matched.has(c.id)) out.push(`The rubric's criterion '${c.title}' has no counterpart in the marked views.`);
  if (embedded.differing) out.push(`${embedded.differing} of the marked views carried a rubric that differs from the one compared (the first view's).`);
  return out;
}
