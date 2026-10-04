/**
 * What a marking workspace is marking: the assessment's title, module and
 * programme, as the educator enters them. Kept in `assessment.json`; nothing in
 * it identifies a student.
 */

import { pyStrip } from "./pytext.ts";
import { AssessmentDetails, type Actor } from "./models.ts";
import { MODERATOR } from "./request.ts";
import { WorkspaceError, type Workspace } from "./workspace.ts";

export const ASSESSMENT = "assessment.json";
export const EDUCATOR: Actor = { kind: "educator", label: "educator" };

/** Who works the workspace, and so imports, records and approves in it: the educator marking, or the moderator. */
export const ownerOf = (ws: Workspace): Actor => (ws.manifest.workspace_type === "marking" ? EDUCATOR : MODERATOR);

const blankToNull = (value: string | null | undefined) => (value ? pyStrip(value) || null : null);

/** Record the assessment's details, replacing any already recorded. The title is required. */
export async function recordAssessment(
  ws: Workspace,
  details: { title: string; module?: string | null; programme?: string | null },
  now: Date = new Date(),
): Promise<AssessmentDetails> {
  const title = pyStrip(details.title);
  if (!title) throw new WorkspaceError("give the assessment's title");
  const record = AssessmentDetails.parse({
    title,
    module: blankToNull(details.module),
    programme: blankToNull(details.programme),
    provenance: { source: "manual entry", transformation: "recorded", actor: EDUCATOR, timestamp: now.toISOString() },
  });
  await ws.writeJson(ASSESSMENT, record);
  return record;
}

/** The assessment's details, or null while none are recorded. */
export async function loadAssessment(ws: Workspace): Promise<AssessmentDetails | null> {
  if (!(await ws.exists(ASSESSMENT))) return null;
  const parsed = AssessmentDetails.safeParse(await ws.readJson(ASSESSMENT));
  if (!parsed.success) throw new WorkspaceError(`${ASSESSMENT} is not a valid record of the assessment`);
  return parsed.data;
}
