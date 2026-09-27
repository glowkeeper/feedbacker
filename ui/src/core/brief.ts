/**
 * The assessment brief's record: a port of the parts of
 * `core/src/feedbacker_core/brief.py` that anonymisation and the approval
 * gate use (#50). Importing a brief is ported with #51.
 */

import { sha256Bytes } from "./extract.ts";
import { Brief } from "./models.ts";
import { type Workspace, WorkspaceError } from "./workspace.ts";

export const BRIEF = "brief.json";
export const BRIEF_ID = "brief";

/** The stored source, named by content so old and new can coexist on replacement. */
export const briefSource = (brief: Brief) => `sources/brief-${brief.source_sha256.slice(0, 16)}.${brief.source_format}`;

/** Load the brief and confirm its stored source file still matches the record. */
export async function loadBrief(ws: Workspace): Promise<Brief> {
  if (!(await ws.exists(BRIEF))) throw new WorkspaceError("no brief has been imported");
  const parsed = Brief.safeParse(await ws.readJson(BRIEF));
  if (!parsed.success) throw new WorkspaceError(`${BRIEF} is not a valid brief`);
  const stored = await ws.readBytes(briefSource(parsed.data));
  if (!stored || sha256Bytes(stored) !== parsed.data.source_sha256) {
    throw new WorkspaceError("the brief's stored source file is missing or does not match the record; import it again");
  }
  return parsed.data;
}

export async function saveBrief(ws: Workspace, brief: Brief): Promise<void> {
  await ws.writeJson(BRIEF, Brief.parse(brief), { private: true });
}
