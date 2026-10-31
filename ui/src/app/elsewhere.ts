/**
 * A workspace kept outside the workspaces folder (ADR 0008): what its card says, and which can be moved in (ADR 0013).
 * The browser can open a folder only once the educator has shown it that folder, so the card says what Continue will
 * do, in the browser's own terms, rather than always saying "the first time".
 */

import { MAX_WORKSPACE_NAME, workspaceNameProblem, type ListedWorkspace } from "../core/index.ts";

/** Whether this browser can open the folder now (granted), needs a click to allow it again (prompt), or has never been shown it (none). */
export type ElsewhereAccess = "granted" | "prompt" | "none";

/** What Continue will do, said before it is pressed; nothing until the browser's state is known, and nothing when it will simply open. */
export function elsewhereNote(access: ElsewhereAccess | undefined): string {
  if (access === "none") return "Continue asks you to choose that folder, once on this computer.";
  if (access === "prompt") return "Continue asks you to allow access to it again.";
  return "";
}

/** The Continue button's words: it says so when the folder picker will open. */
export function continueLabel(access: ElsewhereAccess | undefined): string {
  return access === "none" ? "Choose its folder to continue" : "Continue";
}

/** Only a workspace of its own, kept elsewhere and sound, can be moved into the workspaces folder: a module holds its assessments, and an assessment belongs in its module. */
export function canMove(w: ListedWorkspace): boolean {
  return !w.in_workspaces_folder && w.problem === null && w.workspace_type !== "module" && w.module === null;
}

const lower = (name: string) => name.normalize("NFC").toLowerCase(); // a folder's name is the same in any case on some systems

/** The names in use in the workspaces folder itself: a workspace of its own there, or a module (an assessment is inside its module's folder). */
const taken = (all: ListedWorkspace[]) => new Set(all.filter((o) => o.in_workspaces_folder && o.module === null).map((o) => lower(o.folder)));

/** Why a workspace can't keep its folder's name in the workspaces folder, or null if it can: the name can't be a workspace's, or another has it. */
export function moveNameProblem(w: ListedWorkspace, all: ListedWorkspace[]): string | null {
  const problem = workspaceNameProblem(w.folder);
  if (problem) return `Its folder's name can't be used in the workspaces folder: ${problem}. Give it another name there.`;
  if (taken(all).has(lower(w.folder))) return `A workspace called ${w.folder} is already in the workspaces folder. Give this one another name there.`;
  return null;
}

/**
 * A name to offer when it can't keep its folder's: its own with a number, the first not in use. The folder's name is cut
 * (by characters, not code units) to leave room for the number, so what is offered is never over the longest name.
 */
export function suggestName(w: ListedWorkspace, all: ListedWorkspace[]): string {
  const base = [...w.folder.normalize("NFC")].filter((c) => /[\p{L}\p{N} ._-]/u.test(c)).join("").trim().replace(/^\.+/, "") || "Workspace";
  const used = taken(all);
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${[...base].slice(0, MAX_WORKSPACE_NAME - suffix.length).join("").trimEnd()}${suffix}`;
    if (!used.has(lower(candidate))) return candidate;
  }
}
