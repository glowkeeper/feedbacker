/**
 * The approval gate every model call must pass (#16, ADR 0003): a port of
 * `core/src/feedbacker_core/boundary.py` (#50).
 *
 * Nothing may be sent to a model provider unless it is exactly the anonymised
 * text the moderator approved. `approvedText` is the only way the reading
 * (#53) obtains submission text, and `requireApproved` re-checks the exact
 * string against the persisted approval of that submission, immediately
 * before sending. Neither accepts an approval from the caller. Both only read
 * the workspace: a refusal happens before any network call.
 */

import { loadBrief } from "./brief.ts";
import type { Approval } from "./models.ts";
import { loadSubmission } from "./originals.ts";
import { sha256Text } from "./text.ts";
import type { Workspace } from "./workspace.ts";

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
  if (!sub.approval) throw new UnapprovedText(`${submissionId} has not been approved by the moderator`);
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
  return approval;
}

/** The approved anonymised brief, and its persisted approval (#31). */
export async function approvedBriefText(ws: Workspace): Promise<[string, Approval]> {
  const brief = await loadBrief(ws);
  if (!brief.anonymised) throw new UnapprovedText("the brief has not been anonymised");
  if (!brief.approval) throw new UnapprovedText("the brief has not been approved by the moderator");
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
  return approval;
}
