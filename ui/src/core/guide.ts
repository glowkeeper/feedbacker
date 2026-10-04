/**
 * The educator's feedback guide (ADR 0006): what each level of each criterion typically needs to hear, and the
 * common next steps, written for the assessment. Once approved, it is sent with every drafting request, so drafts
 * across the cohort start from the same place.
 *
 * It is anonymised with the workspace's rules and pseudonym key when it is saved, as the educator's comments are,
 * and only the anonymised text is kept (`feedback/guide.json`, private). Each save is a new version, and clears the
 * approval: the educator approves exactly the text that will be sent. Earlier versions are kept in the history.
 */

import { apply, detect, loadRules } from "./anonymise.ts";
import { EDUCATOR } from "./assessment.ts";
import { requireComplete, UnapprovedText } from "./boundary.ts";
import { Approval, FeedbackGuide } from "./models.ts";
import { stampOf } from "./reading.ts";
import { sha256Text } from "./text.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const GUIDE = "feedback/guide.json";

/** The workspace's feedback guide, or null while none is written. */
export async function loadGuide(ws: Workspace): Promise<FeedbackGuide | null> {
  if (!(await ws.exists(GUIDE))) return null;
  const parsed = FeedbackGuide.safeParse(await ws.readJson(GUIDE));
  if (!parsed.success) throw new WorkspaceError(`${GUIDE} is not a valid feedback guide`);
  return parsed.data;
}

async function keep(ws: Workspace, guide: FeedbackGuide, when: Date) {
  if (await ws.exists(GUIDE)) await ws.writeJson(`feedback/history/guide--${stampOf(when)}.json`, await ws.readJson(GUIDE), { private: true });
  await ws.writeJson(GUIDE, guide, { private: true });
}

/** Save the guide as a new version: anonymised with the workspace's rules, and not approved until the educator approves it. */
export async function saveGuide(ws: Workspace, text: string, now: Date = new Date()): Promise<FeedbackGuide> {
  if (ws.manifest.workspace_type !== "marking") throw new WorkspaceError("only a marking workspace has a feedback guide");
  const raw = text.trim();
  if (!raw) throw new WorkspaceError("write the guide first");
  const previous = await loadGuide(ws);
  const key = await ws.readKey();
  const rules = await loadRules(ws);
  const anonymised = apply(raw, detect(raw, key, rules), key)[0];
  const guide = FeedbackGuide.parse({
    version: (previous?.version ?? 0) + 1,
    text: anonymised,
    text_sha256: sha256Text(anonymised),
    approval: null,
    provenance: { source: "manual entry", transformation: previous ? "revised" : "recorded", actor: EDUCATOR, timestamp: now.toISOString() },
  });
  try {
    await ws.writeKey(key); // anonymising may have added a token
    await keep(ws, guide, now);
  } finally {
    await ws.secure().catch(() => {});
  }
  return guide;
}

/** Approve exactly the guide's current text for the AI. */
export async function approveGuide(ws: Workspace, now: Date = new Date()): Promise<FeedbackGuide> {
  const guide = await loadGuide(ws);
  if (!guide) throw new WorkspaceError("write the guide first");
  const approval = Approval.parse({ id: `appr-guide-v${guide.version}-${guide.text_sha256.slice(0, 12)}`, approved_text_sha256: guide.text_sha256, approved_by: EDUCATOR, approved_at: now.toISOString() });
  const approved = FeedbackGuide.parse({ ...guide, approval });
  await keep(ws, approved, now);
  return approved;
}

/** The approved guide as it may be sent: its text, hash and version. Refused if it isn't approved, or a later rule would redact more of it. */
export async function approvedGuide(ws: Workspace): Promise<{ text: string; sha256: string; version: number }> {
  const guide = await loadGuide(ws);
  if (!guide) throw new UnapprovedText("there is no feedback guide");
  if (!guide.approval) throw new UnapprovedText("the feedback guide has not been approved for the AI; approve it, or draft without it");
  await requireComplete(ws, "the feedback guide", guide.text);
  return { text: guide.text, sha256: guide.text_sha256, version: guide.version };
}
