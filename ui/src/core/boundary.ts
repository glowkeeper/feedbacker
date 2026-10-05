/**
 * The approval gate everything sent to the AI must pass (ADR 0003): a port of
 * `core/src/feedbacker_core/boundary.py`.
 *
 * Nothing may be sent to a model provider unless it is exactly the anonymised
 * text the moderator approved. `approvedText` is the only way the reading
 * obtains submission text, and `requireApproved` re-checks the exact
 * string against the persisted approval of that submission, immediately
 * before sending. Neither accepts an approval from the caller. Both only read
 * the workspace: a refusal happens before any network call.
 */

import { incompleteIn } from "./anonymise.ts";
import { loadBrief } from "./brief.ts";
import { readFigure } from "./figures.ts";
import type { Approval } from "./models.ts";
import { loadSubmission } from "./originals.ts";
import { sha256Text } from "./text.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

/** Text is not the moderator-approved anonymised text. Nothing is sent. */
export class UnapprovedText extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnapprovedText";
  }
}

/** The approved anonymised text for a submission, and its persisted approval. */
export async function approvedText(ws: Workspace, submissionId: string): Promise<[string, Approval]> {
  const sub = await loadSubmission(ws, submissionId);
  if (!sub.anonymised) throw new UnapprovedText(`${submissionId} has not been anonymised`);
  if (!sub.approval) throw new UnapprovedText(`${submissionId} has not been approved for the AI`);
  if (sha256Text(sub.anonymised.text) !== sub.approval.approved_text_sha256) {
    throw new UnapprovedText(`${submissionId}: approval does not match its anonymised text`);
  }
  return [sub.anonymised.text, sub.approval];
}

/**
 * Final check before sending: `text` must be exactly the approved text of
 * this submission in this workspace. The approval is reloaded from the
 * workspace, never taken from the caller, so it cannot be borrowed from
 * another submission or made up. Returns the persisted approval for the call
 * record.
 */
export async function requireApproved(ws: Workspace, submissionId: string, text: string): Promise<Approval> {
  const [approved, approval] = await approvedText(ws, submissionId);
  if (text !== approved || sha256Text(text) !== approval.approved_text_sha256) {
    throw new UnapprovedText(`${submissionId}: text does not match the moderator's approval; nothing was sent`);
  }
  await requireComplete(ws, submissionId, text);
  return approval;
}

/** The image types the AI accepts (ADR 0007); a figure in another type is kept, but not sent. */
export const SENDABLE_FIGURES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** A figure as it is sent: after its placeholder, as approved (ADR 0007). */
export interface SentFigure {
  placeholder: string;
  media_type: string;
  data: string; // the image, base64
  approved_sha256: string;
}

/** A submission's figures as they may be sent with its reading: those sent, and those not (each marked so where it was). */
export interface ApprovedFigures {
  sent: SentFigure[];
  notSent: string[]; // placeholders
  notes: string[]; // why an included figure isn't sent (its format, or its image wasn't extracted)
}

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/**
 * The figures of a submission that may be sent with its reading (ADR 0007): every one included and approved with its
 * text, in a type the AI accepts, read from the workspace and checked against the hash approved. Every other figure is
 * not sent, and marked so; with `withFigures` false, none is sent. Refused if an approved figure's image is missing or
 * changed: the approval no longer holds. The approval is reloaded, never taken from the caller.
 */
export async function approvedFigures(ws: Workspace, submissionId: string, withFigures: boolean): Promise<ApprovedFigures> {
  const sub = await loadSubmission(ws, submissionId);
  const out: ApprovedFigures = { sent: [], notSent: [], notes: [] };
  if (!sub.approval) throw new UnapprovedText(`${submissionId} has not been approved for the AI`);
  for (const f of sub.extract?.figures ?? []) {
    const approved = sub.approval.figures.find((a) => a.placeholder === f.placeholder);
    if (!withFigures || !approved) {
      out.notSent.push(f.placeholder);
      continue;
    }
    if (!f.media_type || !approved.sha256 || !SENDABLE_FIGURES.has(f.media_type)) {
      out.notSent.push(f.placeholder);
      out.notes.push(`${f.placeholder} isn't sent: ${f.media_type ? `the AI can't be sent its format (${f.media_type})` : "its image wasn't extracted"}`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await readFigure(ws, submissionId, f);
    } catch (err) {
      if (err instanceof WorkspaceError) throw new UnapprovedText(`${err.message}, or don't send it; its approval no longer holds`);
      throw err;
    }
    if (f.sha256 !== approved.sha256) throw new UnapprovedText(`${submissionId} ${f.placeholder}: it isn't the image approved`);
    out.sent.push({ placeholder: f.placeholder, media_type: f.media_type, data: base64(bytes), approved_sha256: approved.sha256 });
  }
  return out;
}

/** The approved anonymised brief, and its persisted approval. */
export async function approvedBriefText(ws: Workspace): Promise<[string, Approval]> {
  const brief = await loadBrief(ws);
  if (!brief.anonymised) throw new UnapprovedText("the brief has not been anonymised");
  if (!brief.approval) throw new UnapprovedText("the brief has not been approved for the AI");
  if (sha256Text(brief.anonymised.text) !== brief.approval.approved_text_sha256) {
    throw new UnapprovedText("the brief's approval does not match its anonymised text");
  }
  return [brief.anonymised.text, brief.approval];
}

/**
 * Final check before sending the brief: it must be exactly the approved text,
 * checked against the persisted approval, never one supplied by the caller.
 */
export async function requireApprovedBrief(ws: Workspace, text: string): Promise<Approval> {
  const [approved, approval] = await approvedBriefText(ws);
  if (text !== approved || sha256Text(text) !== approval.approved_text_sha256) {
    throw new UnapprovedText("the brief does not match the moderator's approval; nothing was sent");
  }
  await requireComplete(ws, "the brief", text);
  return approval;
}

/**
 * Refuse approved text that the current key and rules would still redact:
 * something was added to them after it was anonymised (a name from a later
 * import, a rule). It must be anonymised and approved again before any of it
 * is sent. The message names the text, never what was found.
 */
export async function requireComplete(ws: Workspace, what: string, text: string): Promise<void> {
  if (await incompleteIn(ws, text)) {
    throw new UnapprovedText(
      `${what}: its approved text contains something the anonymisation rules or pseudonym key now redact; anonymise it again and approve it (nothing of it is sent until then)`,
    );
  }
}
