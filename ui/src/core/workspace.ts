/**
 * The moderation workspace (ADR 0001, amended by ADR 0004): a port of
 * `core/src/feedbacker_core/workspace.py`, reading and writing the same layout.
 *
 *     <workspace>/
 *         workspace.json          layout version, retention period
 *         registration.json       the proxy's registration ID (ADR 0004)
 *         request.json            the moderation request (pseudonymous)
 *         exports/                the only place exports are written
 *         private/
 *             pseudonym-key.json  pseudonyms -> real identifiers; never leaves the core
 *
 * A browser can't see a folder's path or set permissions, so workspaces are
 * created and registered by the local proxy, by path. The app opens a folder
 * only after the proxy confirms its registration and the folder proves it is
 * the registered one, not a copy (see `openWorkspace`); the registered path
 * is shown every time.
 * After writing a private file, the core asks the proxy to confirm again,
 * which restores the permissions the browser couldn't set.
 */

import * as z from "zod";
import { type FileSystem, segments } from "./fs.ts";
import { Timestamp } from "./models.ts";
import { pyCasefold } from "./pyre.ts";

export const LAYOUT_VERSION = 1;
export const DEFAULT_RETENTION_DAYS = 90;

export const MANIFEST = "workspace.json";
export const REGISTRATION = "registration.json";
export const REQUEST = "request.json";
export const PRIVATE = "private";
export const KEY = "pseudonym-key.json";
export const EXPORTS = "exports";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

// --- Models (as in workspace.py) ------------------------------------------------

export const WorkspaceManifest = z.strictObject({
  layout_version: z.int().default(LAYOUT_VERSION),
  name: z.string(),
  created_at: Timestamp,
  retention_days: z
    .int()
    .positive()
    .default(DEFAULT_RETENTION_DAYS)
    .describe("Days after report submission before the workspace is deleted."),
  retention_source: z
    .string()
    .default("default")
    .describe("Where the retention period came from, e.g. the commissioning body's terms."),
});
export type WorkspaceManifest = z.output<typeof WorkspaceManifest>;

/** Links a pseudonym to real identifiers. Never exported to the UI or a model. */
export const KeyEntry = z.strictObject({
  submission_id: z.string(),
  pseudonym: z.string(),
  external_id: z.string(),
  names: z.array(z.string()).default([]),
  source_files: z
    .record(z.string(), z.string())
    .default({})
    .describe("Original file names by role (e.g. 'original'); names may identify the student."),
});
export type KeyEntry = z.output<typeof KeyEntry>;

/** A pseudonym for a redacted value that is not a sampled student (e.g. [ORG_1]). */
export const TokenEntry = z.strictObject({ token: z.string(), kind: z.string(), value: z.string() });
export type TokenEntry = z.output<typeof TokenEntry>;

/**
 * Append-only: once assigned, a pseudonym always refers to the same
 * identifier. Entries are never removed or reassigned, even when a submission
 * leaves the sample, so records keyed by a pseudonym can never point at
 * another student.
 */
export const PseudonymKey = z.strictObject({
  entries: z.array(KeyEntry).default([]),
  tokens: z.array(TokenEntry).default([]),
});
export type PseudonymKey = z.output<typeof PseudonymKey>;

/** The stable token for a value; allocates the next one if new (append-only). */
export function tokenFor(key: PseudonymKey, kind: string, value: string): string {
  const folded = pyCasefold(value);
  const existing = key.tokens.find((t) => t.kind === kind && pyCasefold(t.value) === folded);
  if (existing) return existing.token;
  const token = `[${kind}_${1 + key.tokens.filter((t) => t.kind === kind).length}]`;
  key.tokens.push({ token, kind, value });
  return token;
}

/** A copy with new entries and every existing token kept. Always rebuild the key this way. */
export const withEntries = (key: PseudonymKey, entries: KeyEntry[]): PseudonymKey => ({
  entries,
  tokens: [...key.tokens],
});

export const byExternalId = (key: PseudonymKey, externalId: string) =>
  key.entries.find((e) => e.external_id === externalId) ?? null;

export const byPseudonym = (key: PseudonymKey, pseudonym: string) =>
  key.entries.find((e) => e.pseudonym === pseudonym) ?? null;

// --- The proxy ------------------------------------------------------------------

export interface Registration {
  registration_id: string;
  path: string;
}

export interface Confirmation {
  confirmed: boolean;
  path: string | null;
  reason: string | null;
  tightened: string[];
  /** A one-time value the proxy wrote into the registered folder, when asked for. */
  challenge?: { file: string; value: string };
}

/** What the core needs from the local proxy (proxy/README.md). */
export interface ProxyClient {
  createWorkspace(path: string, retention: { retention_days: number; retention_source: string }): Promise<Registration>;
  registerWorkspace(path: string): Promise<Registration>;
  /** With `challenge`, the proxy also writes a one-time value into the registered folder. */
  confirmWorkspace(registrationId: string, options?: { challenge?: boolean }): Promise<Confirmation>;
  /** Once a workspace is deleted, the proxy forgets its registration (and so its path). */
  forgetWorkspace(registrationId: string): Promise<{ forgotten: boolean }>;
}

/** The proxy refused a request before sending anything (its `type` says why: boundary, leak, spend, model, run, key). */
export class ProxyRefusal extends Error {
  readonly type: string;

  constructor(type: string, message: string) {
    super(message);
    this.name = "ProxyRefusal";
    this.type = type;
  }
}

/**
 * The provider failed a call the proxy sent. `fatal` errors (a rejected key,
 * an unknown model) stop a run. `requestSha256` is the proxy's hash of what it
 * forwarded, for the audit record of the failed call.
 */
export class ProviderError extends Error {
  readonly fatal: boolean;
  readonly requestSha256: string | null;

  constructor(message: string, fatal = false, requestSha256: string | null = null) {
    super(message);
    this.name = "ProviderError";
    this.fatal = fatal;
    this.requestSha256 = requestSha256;
  }
}

/** What the proxy says about itself: whether it has a key, its provider's name, and model prices (USD per million tokens). */
export interface ProxyHealth {
  key_configured: boolean;
  /** The provider's name, for call records (null without a key). */
  provider: string | null;
  prices: Record<string, { input: number; output: number }>;
}

/** The proxy over HTTP, from the app it serves (same origin, with the session token). */
export class HttpProxyClient implements ProxyClient {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #base: string;

  constructor(token: string, options: { fetch?: typeof fetch; base?: string } = {}) {
    this.#token = token;
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#base = options.base ?? "";
  }

  async #call(path: string, body?: unknown): Promise<{ res: Response; data: { error?: { type?: string; message?: string; fatal?: boolean } } | null }> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new WorkspaceError("the Feedbacker proxy could not be reached; is it running?");
    }
    return { res, data: await res.json().catch(() => null) };
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const { res, data } = await this.#call(path, body);
    if (!res.ok) throw new WorkspaceError(data?.error?.message ?? `the proxy refused the request (HTTP ${res.status})`);
    return data as T;
  }

  /** For the reading: refusals and provider failures keep their kind. */
  async #reading<T>(path: string, body?: unknown): Promise<T> {
    const { res, data } = await this.#call(path, body);
    if (res.ok) return data as T;
    const error = data?.error as { type?: string; message?: string; fatal?: boolean; request_sha256?: string } | undefined;
    if (error?.type === "provider") {
      const hash = typeof error.request_sha256 === "string" && /^[0-9a-f]{64}$/.test(error.request_sha256) ? error.request_sha256 : null;
      throw new ProviderError(error.message ?? "the request to the provider failed", error.fatal === true, hash);
    }
    throw new ProxyRefusal(error?.type ?? "unknown", error?.message ?? `the proxy refused the request (HTTP ${res.status})`);
  }

  health(): Promise<ProxyHealth> {
    return this.#reading<ProxyHealth>("/api/health");
  }

  openRun(limitUsd: number, estimateUsd: number): Promise<{ id: string }> {
    return this.#reading("/api/runs", { limit_usd: limitUsd, estimate_usd: estimateUsd, confirmed: true });
  }

  read(runId: string, request: unknown): Promise<unknown> {
    return this.#reading(`/api/runs/${encodeURIComponent(runId)}/read`, request);
  }

  createWorkspace(path: string, retention: { retention_days: number; retention_source: string }) {
    return this.#post<Registration>("/api/workspaces", { action: "create", path, ...retention });
  }

  registerWorkspace(path: string) {
    return this.#post<Registration>("/api/workspaces", { action: "register", path });
  }

  confirmWorkspace(registrationId: string, options: { challenge?: boolean } = {}) {
    return this.#post<Confirmation>("/api/workspaces/confirm", { registration_id: registrationId, ...options });
  }

  forgetWorkspace(registrationId: string) {
    return this.#post<{ forgotten: boolean }>("/api/workspaces/forget", { registration_id: registrationId });
  }
}

// --- Creating, registering and opening -----------------------------------------------

/** Absolute on macOS and Linux ("/…") or Windows ("C:\\…"). */
const isAbsolutePath = (path: string) => /^(\/|[A-Za-z]:[\\/])/.test(path);

function nameOf(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

/**
 * Ask the proxy to create a workspace at `path`. Everything is validated
 * before the proxy is asked, so a bad input never leaves a partial workspace
 * behind (as in Python). The moderator then picks that folder to open it.
 */
export async function createWorkspace(
  proxy: ProxyClient,
  path: string,
  options: { retention_days?: number; retention_source?: string } = {},
): Promise<Registration> {
  if (!isAbsolutePath(path)) throw new WorkspaceError(`the workspace path must be absolute (got '${path}')`);
  const name = nameOf(path);
  if (!name || name.startsWith(".") || name === "..") throw new WorkspaceError(`invalid workspace name '${name}'`);
  const retention = {
    retention_days: options.retention_days ?? DEFAULT_RETENTION_DAYS,
    retention_source: options.retention_source ?? "default",
  };
  const check = WorkspaceManifest.safeParse({ name, created_at: new Date().toISOString(), ...retention });
  if (!check.success) {
    const problems = check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new WorkspaceError(`invalid workspace settings: ${problems}`);
  }
  return proxy.createWorkspace(path, retention);
}

/** Ask the proxy to register an existing workspace, such as one made by the command line. */
export function registerWorkspace(proxy: ProxyClient, path: string): Promise<Registration> {
  return proxy.registerWorkspace(path);
}

async function readJsonFile(fs: FileSystem, path: string, what: string): Promise<unknown | null> {
  const text = await fs.readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkspaceError(`${what} is not valid JSON`);
  }
}

/**
 * Open the folder the moderator picked. It must hold a registration the proxy
 * confirms (still at its registered path, outside git, locked down) and a
 * manifest of the supported layout. The registered path is returned, to be
 * shown every time.
 *
 * The picked folder must also *be* the registered folder, not a copy of it:
 * the proxy writes a one-time value into the registered folder, and it must
 * be readable through the picked one. A copy, even with the original still in
 * place, won't contain it.
 */
export async function openWorkspace(fs: FileSystem, proxy: ProxyClient): Promise<Workspace> {
  const registration = (await readJsonFile(fs, REGISTRATION, REGISTRATION)) as { registration_id?: unknown } | null;
  if (!registration || typeof registration.registration_id !== "string") {
    throw new WorkspaceError(
      "this folder is not registered with the Feedbacker proxy; create the workspace through Feedbacker, or register it first",
    );
  }
  const confirmation = await proxy.confirmWorkspace(registration.registration_id, { challenge: true });
  if (!confirmation.confirmed || !confirmation.path) {
    throw new WorkspaceError(`this workspace can't be opened: ${confirmation.reason ?? "the proxy did not confirm it"}`);
  }
  const { challenge } = confirmation;
  if (!challenge || !/^challenge-[A-Za-z0-9_-]+\.json$/.test(challenge.file)) {
    throw new WorkspaceError("the proxy did not provide an identity check for this workspace");
  }
  const seen = (await readJsonFile(fs, challenge.file, "the identity check")) as { challenge?: unknown } | null;
  await fs.remove(challenge.file);
  if (seen?.challenge !== challenge.value) {
    throw new WorkspaceError(
      `this folder is not the registered workspace at ${confirmation.path}; it may be a copy. Open the folder at that path`,
    );
  }
  const data = await readJsonFile(fs, MANIFEST, MANIFEST);
  if (data === null) throw new WorkspaceError(`not a Feedbacker workspace: ${confirmation.path}`);
  const manifest = WorkspaceManifest.safeParse(data);
  if (!manifest.success) throw new WorkspaceError(`${MANIFEST} is not a valid workspace manifest`);
  if (manifest.data.layout_version !== LAYOUT_VERSION) {
    throw new WorkspaceError(
      `workspace layout version ${manifest.data.layout_version} is not supported (expected ${LAYOUT_VERSION})`,
    );
  }
  return new Workspace(fs, manifest.data, { registration_id: registration.registration_id, path: confirmation.path }, proxy);
}

// --- The workspace ------------------------------------------------------------------

export class Workspace {
  readonly fs: FileSystem;
  readonly manifest: WorkspaceManifest;
  /** Where the proxy registered this workspace; show it whenever it is opened. */
  readonly registration: Registration;
  readonly #proxy: ProxyClient;

  constructor(fs: FileSystem, manifest: WorkspaceManifest, registration: Registration, proxy: ProxyClient) {
    this.fs = fs;
    this.manifest = manifest;
    this.registration = registration;
    this.#proxy = proxy;
  }

  exists(relative: string): Promise<boolean> {
    return this.fs.exists(relative);
  }

  async readJson(relative: string): Promise<unknown> {
    const data = await readJsonFile(this.fs, relative, relative);
    if (data === null) throw new WorkspaceError(`${relative} does not exist in the workspace`);
    return data;
  }

  /**
   * Write JSON as the Python core does (two-space indentation, a final
   * newline). After a private write, the proxy re-confirms the workspace,
   * which restores the permissions the browser couldn't set.
   */
  async writeJson(relative: string, data: unknown, options: { private?: boolean } = {}): Promise<void> {
    segments(relative);
    if (relative === MANIFEST || relative === REGISTRATION) {
      throw new WorkspaceError(`${relative} is managed by the proxy and can't be rewritten`);
    }
    await this.fs.writeText(relative, JSON.stringify(data, null, 2) + "\n");
    if (options.private) await this.#reconfirm();
  }

  /** Read a binary file, such as a stored original; null if it doesn't exist. */
  readBytes(relative: string): Promise<Uint8Array | null> {
    return this.fs.readBytes(relative);
  }

  /** Write a binary file. Call `secure()` afterwards if it is private. */
  async writeBytes(relative: string, bytes: Uint8Array): Promise<void> {
    segments(relative);
    if (relative === MANIFEST || relative === REGISTRATION) {
      throw new WorkspaceError(`${relative} is managed by the proxy and can't be rewritten`);
    }
    await this.fs.writeBytes(relative, bytes);
  }

  /**
   * Ask the proxy to confirm the workspace again, which restores the
   * permissions the browser couldn't set on what it has just written. Use
   * once after a batch of private writes.
   */
  secure(): Promise<void> {
    return this.#reconfirm();
  }

  async #reconfirm(): Promise<void> {
    const confirmation = await this.#proxy.confirmWorkspace(this.registration.registration_id);
    if (!confirmation.confirmed) {
      throw new WorkspaceError(`the workspace can no longer be confirmed: ${confirmation.reason}`);
    }
  }

  // --- pseudonym key ---------------------------------------------------------

  async readKey(): Promise<PseudonymKey> {
    const data = await readJsonFile(this.fs, `${PRIVATE}/${KEY}`, KEY);
    if (data === null) return PseudonymKey.parse({});
    const key = PseudonymKey.safeParse(data);
    if (!key.success) throw new WorkspaceError(`${KEY} is not a valid pseudonym key`);
    return key.data;
  }

  writeKey(key: PseudonymKey): Promise<void> {
    return this.writeJson(`${PRIVATE}/${KEY}`, PseudonymKey.parse(key), { private: true });
  }

  // --- exports ----------------------------------------------------------------

  /**
   * Exports go only into the workspace's `exports/` folder, named
   * `<name>.feedbacker-export.<ext>` (a pattern `.gitignore` blocks). A
   * browser can't check where a save dialog would write, so there is no
   * "save elsewhere" (ADR 0004).
   */
  async writeExport(name: string, extension: string, content: string | Uint8Array): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) || !/^[a-z0-9]{1,10}$/.test(extension)) {
      throw new WorkspaceError(`invalid export name '${name}.${extension}'`);
    }
    const path = `${EXPORTS}/${name}.feedbacker-export.${extension}`;
    await (typeof content === "string" ? this.fs.writeText(path, content) : this.fs.writeBytes(path, content));
    return path;
  }

  // --- deletion ---------------------------------------------------------------

  /**
   * Delete the whole workspace in one action: every record, the pseudonym
   * key, and any re-identified export. The moderator must type the
   * workspace's name to confirm; nothing is ever deleted without that. The
   * proxy then forgets its registration, so no path to it is kept; it does
   * so even if the folder could only be emptied (that error is still
   * reported), since nothing is left in it to open.
   */
  async delete(confirmName: string): Promise<void> {
    if (confirmName !== this.manifest.name) {
      throw new WorkspaceError(`type the workspace's name, '${this.manifest.name}', to confirm deleting it`);
    }
    // Both are attempted, and a failure of either is reported, the folder's first: it says what is left to do by hand.
    const failures: string[] = [];
    await this.fs.removeAll().catch((err: unknown) => failures.push(err instanceof Error ? err.message : String(err)));
    await this.#proxy
      .forgetWorkspace(this.registration.registration_id)
      .catch((err: unknown) => failures.push(`the proxy couldn't forget the workspace's registration (${err instanceof Error ? err.message : String(err)})`));
    if (failures.length) throw new WorkspaceError(failures.join("; and "));
  }
}
