/**
 * Import the assessment brief: a port of `core/src/feedbacker_core/brief.py`
 *.
 *
 * The brief is extracted locally with the same extractor as submissions;
 * document metadata is never read. It is then redacted by anonymisation and
 * must be approved by the moderator before the AI reading may use it
 * (boundary.ts).
 */

import { extract, sha256Bytes, sourceFormat } from "./extract.ts";
import { Brief } from "./models.ts";
import { MODERATOR } from "./request.ts";
import type { ByteSource } from "./zip.ts";
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

const failed = (err: unknown) =>
  new WorkspaceError(`the brief could not be imported (${(err as Error).name}); any previously imported brief is unchanged`);

/**
 * Import (or replace) the brief, complete-or-nothing.
 *
 * The file is read and extracted in memory; an unsupported or unsuitable file
 * fails with an ExtractionError and nothing is written. The new source is
 * stored under a content-addressed name beside the old one, then the record
 * is written; that write is the switch-over. Only after it succeeds are older
 * sources removed, so a failure at any point leaves the previous record and
 * its source intact.
 */
export async function importBrief(ws: Workspace, source: ByteSource, options: { replace?: boolean; now?: Date } = {}): Promise<Brief> {
  if ((await ws.exists(BRIEF)) && !options.replace) {
    throw new WorkspaceError("a brief is already imported; use replace to import again");
  }
  const format = sourceFormat(source.name); // an ExtractionError for unsupported types
  let bytes: Uint8Array;
  try {
    bytes = await source.read(0, source.size);
  } catch (err) {
    throw failed(err);
  }
  const now = options.now ?? new Date();
  const extracted = await extract(source.name, bytes, now); // fails clearly; nothing is kept
  const digest = sha256Bytes(bytes);
  const brief = Brief.parse({
    source_format: format,
    source_sha256: digest,
    extract: extracted,
    provenance: {
      source: `file:sha256:${digest}`,
      transformation: "imported",
      actor: MODERATOR,
      timestamp: now.toISOString(),
      input_hashes: [digest],
    },
  });
  const final = briefSource(brief);
  const others = (await ws.exists("sources")) ? (await ws.fs.list("sources")).filter((e) => e.kind === "file" && /^brief-.*\./.test(e.name)) : [];
  const existed = others.some((e) => `sources/${e.name}` === final);
  try {
    await ws.writeBytes(final, bytes); // beside any previous source; nothing is removed yet
    // The switch-over. Written without the proxy's confirmation, which follows
    // separately, so a failure here really does leave the previous brief.
    await ws.writeJson(BRIEF, brief);
  } catch (err) {
    if (!existed) await ws.fs.remove(final).catch(() => {}); // don't leave the unused new source behind
    await ws.secure().catch(() => {});
    throw failed(err);
  }
  // The new brief is in place. An old source that can't be removed is only
  // left over (the record names its own), and the next import removes it.
  for (const old of others) if (`sources/${old.name}` !== final) await ws.fs.remove(`sources/${old.name}`).catch(() => {});
  await ws.secure(); // private; if the workspace can't be confirmed, that is the error reported
  return brief;
}
