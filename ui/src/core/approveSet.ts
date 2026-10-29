/**
 * Approving a set of anonymised texts in one action, after reviewing by exception (ADR 0012).
 *
 * The safeguard is unchanged: every text is approved explicitly, by its own hash, and nothing is sent until it is. What changes is that the educator
 * looks properly at the texts the app flagged (opening each one's review) and skims the rest, then approves the set. A text that is flagged and
 * has not been opened, as it now is, is not approved by this action, and is said. Each approval records that it was made in a set, how big, how
 * many were flagged, and what became of this text.
 */

import { approve } from "./anonymise.ts";
import { flagTexts } from "./anonymisationFlags.ts";
import type { Workspace } from "./workspace.ts";
import { WorkspaceError } from "./workspace.ts";

export interface SetApproval {
  /** The texts approved, by ID. */
  approved: string[];
  /** The texts that weren't, with why. */
  skipped: { id: string; label: string; why: string }[];
  /** How many texts were waiting for approval, and how many of them were flagged. */
  size: number;
  flagged: number;
}

/**
 * Approve every anonymised text that is waiting for approval, except the flagged ones the educator has not opened. `opened` is what they opened, by
 * text ID, with the hash of the text they opened (so a text anonymised again since is not counted as opened). `skimmed` is their confirmation that they
 * skimmed the unflagged texts, as the list showed them: those texts by ID, with the hash of each (null if they haven't confirmed). Without it nothing is
 * approved, when there are any unflagged; and an unflagged text that has changed since they confirmed is not approved by it (they skimmed another text).
 */
export async function approveSet(ws: Workspace, options: { opened: Record<string, string>; skimmed: Record<string, string> | null; now?: Date }): Promise<SetApproval> {
  const waiting = (await flagTexts(ws)).filter((t) => !t.approved);
  const flagged = waiting.filter((t) => t.reasons.length).length;
  const result: SetApproval = { approved: [], skipped: [], size: waiting.length, flagged };
  if (!waiting.length) return result;
  const confirmed = options.skimmed !== null;
  if (waiting.length > flagged && !confirmed) {
    throw new WorkspaceError("confirm that you have skimmed the texts that are not flagged, then approve the set; nothing was approved");
  }
  for (const t of waiting) {
    const opened = options.opened[t.id] === t.sha256;
    if (t.reasons.length && !opened) {
      result.skipped.push({ id: t.id, label: t.label, why: "it is flagged, and its review hasn't been opened as it now is" });
      continue;
    }
    // An unflagged text is approved on the confirmation only as it was when they confirmed (or if they opened it as it now is).
    if (!t.reasons.length && !opened && options.skimmed![t.id] !== t.sha256) {
      result.skipped.push({ id: t.id, label: t.label, why: "its text isn't the one you confirmed you had skimmed (it was anonymised again, or wasn't listed): skim it, and confirm again" });
      continue;
    }
    try {
      await approve(ws, t.id, options.now, { size: waiting.length, flagged, flagged_this: t.reasons.length > 0, opened_this: opened, skimmed_unflagged: confirmed });
      result.approved.push(t.id);
    } catch (err) {
      if (!(err instanceof WorkspaceError)) throw err;
      result.skipped.push({ id: t.id, label: t.label, why: err.message });
    }
  }
  return result;
}
