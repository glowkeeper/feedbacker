/**
 * The Export step in the app: whether the moderation is ready to
 * approve (and, if not, why), whether an approval still matches the
 * workspace, and a preview of the summary; then the exports themselves.
 */

import {
  assembleRecord,
  EXPORTS,
  exportApproved,
  loadApprovedRecord,
  REQUEST,
  sameModeration,
  summaryBlocks,
  type ModerationRecord,
  type RecordProblem,
  type SummaryBlock,
  type Workspace,
} from "../core/index.ts";

export interface ExportState {
  problems: string[]; // why the moderation isn't ready to approve; empty when it is
  reasons: RecordProblem[]; // the same, each with where it is put right
  approved: ModerationRecord | null; // the last approval, if any
  approvalProblem: string | null; // the approved record doesn't load
  current: boolean; // the approval still matches the workspace, so it can be exported
  preview: SummaryBlock[] | null; // the summary of what is approved (if current), or of what would be
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function loadExportState(ws: Workspace): Promise<ExportState> {
  const state: ExportState = { problems: [], reasons: [], approved: null, approvalProblem: null, current: false, preview: null };
  if (!(await ws.exists(REQUEST))) {
    state.problems = ["record the moderation request first"];
    state.reasons = [{ text: state.problems[0], area: null }];
    return state;
  }
  const { record, problems, reasons } = await assembleRecord(ws);
  state.problems = problems;
  state.reasons = reasons;
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

/** The files in the workspace's exports folder, by name; a re-identified copy is marked, since it holds personal data. */
export async function listExports(ws: Workspace): Promise<{ name: string; path: string; reidentified: boolean }[]> {
  if (!(await ws.exists(EXPORTS))) return [];
  return (await ws.fs.list(EXPORTS))
    .filter((e) => e.kind === "file")
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, path: `${ws.registration.path}/${EXPORTS}/${name}`, reidentified: name.includes("-reidentified.") }));
}
