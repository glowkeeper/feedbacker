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

/**
 * Keep a submission's figures in place of any it had before: the new ones are written first, then the old ones that
 * remain are removed. If that fails part way, the previous set is put back, and it throws. Otherwise it returns how to
 * put the previous set back, for when the submission's record can't be written. Call `secure()` afterwards.
 */
export async function replaceFigures(ws: Workspace, submissionId: string, extract: Extract, bytes: Map<string, Uint8Array>): Promise<() => Promise<void>> {
  const dir = `${FIGURES}/${submissionId}`;
  const previous = new Map<string, Uint8Array>();
  if (await ws.exists(dir)) {
    for (const old of await ws.fs.list(dir)) {
      const data = old.kind === "file" ? await ws.readBytes(`${dir}/${old.name}`) : null;
      if (data) previous.set(`${dir}/${old.name}`, data);
    }
  }
  const written: string[] = [];
  const restore = async () => {
    for (const path of written) if (!previous.has(path)) await ws.fs.remove(path).catch(() => {});
    for (const [path, data] of previous) await ws.writeBytes(path, data);
  };
  try {
    for (const figure of extract.figures) {
      const path = figurePath(submissionId, figure);
      const data = bytes.get(figure.placeholder);
      if (!path || !data) continue;
      await ws.writeBytes(path, data);
      written.push(path);
    }
    for (const path of previous.keys()) if (!written.includes(path)) await ws.fs.remove(path);
  } catch (err) {
    await restore().catch(() => {});
    throw err;
  }
  return restore;
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
