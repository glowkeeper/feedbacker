/**
 * The Export step in the app (#20): whether the moderation is ready to
 * approve (and, if not, why), whether an approval still matches the
 * workspace, and a preview of the summary; then the exports themselves.
 */

import {
  assembleRecord,
  exportApproved,
  loadApprovedRecord,
  REQUEST,
  sameModeration,
  summaryBlocks,
  type ModerationRecord,
  type SummaryBlock,
  type Workspace,
} from "../core/index.ts";

export interface ExportState {
  problems: string[]; // why the moderation isn't ready to approve; empty when it is
  approved: ModerationRecord | null; // the last approval, if any
  approvalProblem: string | null; // the approved record doesn't load
  current: boolean; // the approval still matches the workspace, so it can be exported
  preview: SummaryBlock[] | null; // the summary of what is approved (if current), or of what would be
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadExportState(ws: Workspace): Promise<ExportState> {
  const state: ExportState = { problems: [], approved: null, approvalProblem: null, current: false, preview: null };
  if (!(await ws.exists(REQUEST))) {
    state.problems = ["record the moderation request first"];
    return state;
  }
  const { record, problems } = await assembleRecord(ws);
  state.problems = problems;
  try {
    state.approved = await loadApprovedRecord(ws);
  } catch (err) {
    state.approvalProblem = message(err);
  }
  state.current = state.approved !== null && record !== null && sameModeration(record, state.approved);
  state.preview = state.current ? summaryBlocks(state.approved!) : record ? summaryBlocks(record) : null;
  return state;
}

/** Export the approved record (JSON) and its summary (Markdown and Word), from one snapshot, all or nothing; the paths written. */
export async function exportAll(ws: Workspace): Promise<string[]> {
  return (await exportApproved(ws)).paths;
}
