/**
 * Anonymisation that doesn't depend on the order of steps (#83).
 *
 * Text is anonymised when it is made: the submissions and the brief when the
 * moderator presses "Anonymise now", the marker's comments when the marking is
 * imported, the moderator's comments when they are recorded. The pseudonym key
 * and the rules can grow afterwards (a later import can add a name; the
 * moderator can add a rule), so `anonymiseAll` anonymises the submissions and
 * the brief (anonymiseWorkspace), then re-applies the current key and rules to
 * every comment already stored. Anonymising anonymised text only redacts what
 * is newly covered, so nothing else changes.
 *
 * The other safeguards check completeness where it matters: before anything
 * is sent to a model (boundary.ts) and before the record is approved or
 * exported (record.ts).
 */

import * as z from "zod";
import { anonymiseWorkspace, apply, detect, loadRules, type AnonymiseResult, type AnonymisationRules, type Detector } from "./anonymise.ts";
import { MARKING } from "./marking.ts";
import { ModeratorJudgement, OriginalAssessment, SubmissionVerdict } from "./models.ts";
import { JUDGEMENTS } from "./reviewState.ts";
import { VERDICTS } from "./verdict.ts";
import type { PseudonymKey, Workspace } from "./workspace.ts";

export interface AnonymiseAllResult extends AnonymiseResult {
  /** The stored records whose comments were anonymised again. */
  commentsUpdated: string[];
}

/** The JSON files directly in a folder (not its history), sorted. */
async function files(ws: Workspace, dir: string): Promise<string[]> {
  if (!(await ws.exists(dir))) return [];
  return (await ws.fs.list(dir))
    .filter((e) => e.kind === "file" && e.name.endsWith(".json"))
    .map((e) => `${dir}/${e.name}`)
    .sort();
}

/** Re-apply the current key and rules to every stored comment; the files that changed. */
export async function reanonymiseComments(ws: Workspace, now?: Date): Promise<string[]> {
  const key: PseudonymKey = await ws.readKey();
  const rules: AnonymisationRules = await loadRules(ws);
  const fix = (t: string | null) => (t ? apply(t, detect(t, key, rules), key)[0] : t);
  const writes: [string, unknown][] = [];

  for (const path of (await files(ws, MARKING)).filter((p) => !p.endsWith("criteria-map.json"))) {
    const parsed = OriginalAssessment.safeParse(await ws.readJson(path).catch(() => null));
    if (!parsed.success) continue; // a damaged record is reported where it is used
    const a = parsed.data;
    const fixed = {
      ...a,
      overall_comment: fix(a.overall_comment),
      criterion_marks: a.criterion_marks.map((m) => ({ ...m, comment: fix(m.comment) })),
      annotations: a.annotations.map((x) => ({ ...x, text: fix(x.text)!, anchor_text: fix(x.anchor_text) })),
    };
    if (JSON.stringify(fixed) !== JSON.stringify(a)) {
      // Noted on the record, so it is clear the comments were redacted after import.
      const note = `comments anonymised again on ${(now ?? new Date()).toISOString().slice(0, 10)}, after the anonymisation rules or pseudonym key changed`;
      writes.push([path, OriginalAssessment.parse({ ...fixed, import_notes: [...a.import_notes, note] })]);
    }
  }
  for (const path of (await files(ws, JUDGEMENTS)).filter((p) => !p.endsWith("--review.json"))) {
    const parsed = z.array(ModeratorJudgement).safeParse(await ws.readJson(path).catch(() => null));
    if (!parsed.success) continue;
    const fixed = parsed.data.map((j) => ({
      ...j,
      first: { ...j.first, comment: fix(j.first.comment) },
      revised: j.revised ? { ...j.revised, comment: fix(j.revised.comment) } : null,
    }));
    if (JSON.stringify(fixed) !== JSON.stringify(parsed.data)) writes.push([path, fixed.map((j) => ModeratorJudgement.parse(j))]);
  }
  for (const path of await files(ws, VERDICTS)) {
    const parsed = SubmissionVerdict.safeParse(await ws.readJson(path).catch(() => null));
    if (!parsed.success) continue;
    const comment = fix(parsed.data.comment);
    if (comment !== parsed.data.comment) writes.push([path, SubmissionVerdict.parse({ ...parsed.data, comment })]);
  }
  if (!writes.length) return [];

  // Key first (redacting may have added tokens), then the records that use them.
  await ws.writeKey(key);
  try {
    for (const [path, data] of writes) await ws.writeJson(path, data);
  } finally {
    await ws.secure(); // whatever was written is made private
  }
  return writes.map(([path]) => path);
}

/** "Anonymise now": the submissions and the brief, then every stored comment, with the current key and rules. */
export async function anonymiseAll(ws: Workspace, options: { extra?: Detector[]; now?: Date } = {}): Promise<AnonymiseAllResult> {
  const result = await anonymiseWorkspace(ws, options);
  return { ...result, commentsUpdated: await reanonymiseComments(ws, options.now) };
}
