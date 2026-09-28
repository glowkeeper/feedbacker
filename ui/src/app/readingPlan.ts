/**
 * The AI reading step in the app: what stops a plan, said in the app's terms
 * rather than the command line's (the core's messages name its commands).
 */

import { approvedBriefText, BRIEF, requireComplete, UnapprovedText, type BatchProgress, type Workspace } from "../core/index.ts";

/** Why the brief can't be included in a reading, or null if it can. */
export async function briefProblem(ws: Workspace): Promise<string | null> {
  const untick = 'or untick "Include the approved brief" to read without it';
  if (!(await ws.exists(BRIEF))) return `no brief has been imported; import it (Brief) and approve it (Anonymisation), ${untick}`;
  try {
    const [text] = await approvedBriefText(ws);
    await requireComplete(ws, "the brief", text);
    return null;
  } catch (err) {
    if (err instanceof UnapprovedText) return `${err.message}; review and approve it under Anonymisation, ${untick}`;
    throw err;
  }
}

/** How far a batch has got, in a sentence. */
export function batchStatusText(p: BatchProgress): string {
  const c = p.counts;
  const total = c.processing + c.succeeded + c.errored + c.canceled + c.expired;
  if (p.status === "ended") {
    const notDone = c.errored + c.canceled + c.expired;
    return `It has finished: ${c.succeeded} of ${total} came back${notDone ? `, ${notDone} didn't (they can be read again one at a time)` : ""}. Collect the results.`;
  }
  if (p.status === "canceling") return "It is being cancelled; readings already done can be collected once it has stopped.";
  return `Still in progress (${c.processing} of ${total} waiting); it expires ${p.expires_at.slice(0, 16).replace("T", " ")} UTC.`;
}
