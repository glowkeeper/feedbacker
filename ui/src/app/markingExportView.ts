/**
 * The marking workspace's Export step: each submission, and whether it is approved on exactly what its student will
 * receive, approved but changed since, ready to approve, or not ready (and why).
 */

import { approvalState, type ApprovalState, type Workspace } from "../core/index.ts";
import { reviewChoices } from "./review.ts";

export interface ApprovalRow {
  id: string;
  label: string;
  status: "approved" | "changed" | "ready" | "not ready";
  state: ApprovalState | null;
  problem: string | null; // its records can't be read yet, and why
}

export const STATUS_TEXT: Record<ApprovalRow["status"], string> = {
  approved: "Approved",
  changed: "Changed since it was approved: check it and approve it again",
  ready: "Ready to approve",
  "not ready": "Not ready",
};

export async function approvalRows(ws: Workspace): Promise<ApprovalRow[]> {
  const out: ApprovalRow[] = [];
  for (const c of await reviewChoices(ws)) {
    try {
      const state = await approvalState(ws, c.id);
      const status = state.current ? "approved" : state.approval ? "changed" : state.digest ? "ready" : "not ready";
      out.push({ id: c.id, label: c.label, status, state, problem: null });
    } catch (err) {
      out.push({ id: c.id, label: c.label, status: "not ready", state: null, problem: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
