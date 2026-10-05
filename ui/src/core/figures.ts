/**
 * A submission's figures, kept in the workspace's private area beside its record: one file a figure,
 * `private/figures/<submission>/FIGURE_<n>.<ext>`, as its extract lists it (placeholder, media type, hash, size).
 * A figure is a student's work and may show something identifying, so it is never anywhere but the private area.
 */

import { sha256Bytes } from "./extract.ts";
import type { Extract, Figure } from "./models.ts";
import { PRIVATE, type Workspace, WorkspaceError } from "./workspace.ts";

export const FIGURES = `${PRIVATE}/figures`;

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg", "image/x-emf": "emf", "image/x-wmf": "wmf" };
const extensionOf = (mediaType: string) => EXTENSIONS[mediaType] ?? mediaType.slice("image/".length).replace(/^x-/, "");

/** Where a figure's bytes are kept; null for a figure without bytes. */
export function figurePath(submissionId: string, figure: Figure): string | null {
  return figure.media_type ? `${FIGURES}/${submissionId}/${figure.placeholder.slice(1, -1)}.${extensionOf(figure.media_type)}` : null;
}

/** Keep a submission's figures, replacing any it had before. Call `secure()` afterwards. */
export async function writeFigures(ws: Workspace, submissionId: string, extract: Extract, bytes: Map<string, Uint8Array>): Promise<void> {
  const dir = `${FIGURES}/${submissionId}`;
  if (await ws.exists(dir)) for (const old of await ws.fs.list(dir)) await ws.fs.remove(`${dir}/${old.name}`);
  for (const figure of extract.figures) {
    const path = figurePath(submissionId, figure);
    const data = bytes.get(figure.placeholder);
    if (path && data) await ws.writeBytes(path, data);
  }
}

/** A figure's bytes, checked against its hash; refused if they are missing or not what was extracted. */
export async function readFigure(ws: Workspace, submissionId: string, figure: Figure): Promise<Uint8Array> {
  const path = figurePath(submissionId, figure);
  if (!path) throw new WorkspaceError(`${submissionId} ${figure.placeholder}: its image wasn't extracted`);
  const bytes = await ws.readBytes(path);
  if (!bytes) throw new WorkspaceError(`${submissionId} ${figure.placeholder}: ${path} is missing; import the submission again`);
  if (sha256Bytes(bytes) !== figure.sha256) throw new WorkspaceError(`${submissionId} ${figure.placeholder}: ${path} isn't the image that was extracted; import the submission again`);
  return bytes;
}
