/**
 * Workspace creation and registration (ADR 0004).
 *
 * A browser folder handle reveals neither the folder's path nor its parents,
 * so the checks the Python core makes by path are made here: the proxy
 * creates or registers a workspace by path, refuses any path inside a git
 * working tree, sets restrictive permissions, and writes a random
 * registration ID into it. The app opens only folders whose ID the proxy
 * confirms, and the proxy re-checks the registered path every time.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import * as z from "zod";
import { Refusal } from "./boundary.ts";

// As in core/src/feedbacker_core/workspace.py, so the command line can open
// a workspace the proxy created.
export const MANIFEST = "workspace.json";
export const PRIVATE = "private";
export const LAYOUT_VERSION = 1;
export const DEFAULT_RETENTION_DAYS = 90;
export const REGISTRATION = "registration.json";

/** The manifest as `WorkspaceManifest` in workspace.py requires it, checked before registering. */
const Manifest = z.strictObject({
  layout_version: z.literal(LAYOUT_VERSION),
  name: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  retention_days: z.int().positive().optional(),
  retention_source: z.string().optional(),
});

/** One-time identity checks, written into the registered folder when the app opens it. */
const CHALLENGE = /^challenge-[A-Za-z0-9_-]{16,64}\.json$/;
const CHALLENGE_MAX_AGE_MS = 10 * 60_000;

export interface Retention {
  retention_days?: number;
  retention_source?: string;
}

interface Registration {
  id: string;
  path: string;
  registered_at: string;
}

export interface Confirmation {
  confirmed: boolean;
  path: string | null;
  reason: string | null;
  /** Folders and files whose permissions the proxy restored. */
  tightened: string[];
  /**
   * When asked for, a one-time value written into the registered folder. The
   * app must read it back through the folder it picked: a copy of the
   * workspace won't contain it. The app deletes the file afterwards.
   */
  challenge?: { file: string; value: string };
}

/** The enclosing git working tree, if any: a `.git` in the folder or any parent. */
export function gitWorkingTree(path: string): string | null {
  let candidate = path;
  for (;;) {
    if (existsSync(join(candidate, ".git"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

function refuseGit(path: string): void {
  const tree = gitWorkingTree(path);
  if (tree) throw new Refusal("boundary", `refusing a workspace inside a git working tree (${tree}); choose a folder outside any repository`);
}

/**
 * Lock down everything inside a workspace: every folder 700 and every file
 * 600. (The Python core writes ordinary records as 644 and private ones as
 * 600, some outside `private/`; making them all 600 is stricter and changes
 * nothing for their owner.) Returns what had to change.
 *
 * The browser can't set permissions, so folders and files the app creates
 * get the system defaults (typically 755 and 644). That is safe while the
 * workspace folder itself is 700, since nothing inside is then reachable by
 * anyone else; the proxy restores the stricter modes whenever it checks.
 * Symbolic links are refused: nothing Feedbacker writes makes one, and
 * changing a link's mode would change whatever it points to.
 * (POSIX permissions; on Windows these modes carry no meaning.)
 */
/** Refuse, before anything is changed, a workspace holding a symbolic link. */
function refuseSymlinks(root: string): void {
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Refusal("boundary", `the workspace contains a symbolic link (${relative(root, full)}); remove it`);
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
}

function tightenInside(root: string): string[] {
  refuseSymlinks(root);
  const changed: string[] = [];
  const set = (path: string, mode: number) => {
    if ((statSync(path).mode & 0o777) !== mode) {
      chmodSync(path, mode);
      changed.push(relative(root, path));
    }
  };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        set(full, 0o700);
        walk(full);
      } else {
        set(full, 0o600);
      }
    }
  };
  walk(root);
  return changed;
}

export class Workspaces {
  readonly registryPath: string;

  constructor(registryPath: string) {
    this.registryPath = registryPath;
  }

  #read(): Registration[] {
    if (!existsSync(this.registryPath)) return [];
    return JSON.parse(readFileSync(this.registryPath, "utf8")).registrations;
  }

  #write(registrations: Registration[]): void {
    writeFileSync(this.registryPath, JSON.stringify({ registrations }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(this.registryPath, 0o600);
  }

  #register(path: string, now: Date): Registration {
    const registration: Registration = { id: `ws-${randomBytes(18).toString("base64url")}`, path, registered_at: now.toISOString() };
    chmodSync(path, 0o700);
    writeFileSync(
      join(path, REGISTRATION),
      JSON.stringify({ registration_id: registration.id, registered_at: registration.registered_at }, null, 2) + "\n",
      { mode: 0o600 },
    );
    tightenInside(path);
    this.#write([...this.#read().filter((r) => r.path !== path), registration]);
    return registration;
  }

  /**
   * Create a new workspace at `path`, as `Workspace.create` in the Python core
   * does: the folder, its private folder, and a valid manifest, so the
   * command line can open it too.
   */
  create(path: string, now: Date, retention: Retention = {}): Registration {
    if (!isAbsolute(path)) throw new Refusal("boundary", "the workspace path must be absolute");
    const name = basename(path);
    if (!name || name.startsWith(".")) throw new Refusal("boundary", `invalid workspace name '${name}'`);
    const retentionDays = retention.retention_days ?? DEFAULT_RETENTION_DAYS;
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Refusal("boundary", "retention_days must be a whole number of days, at least 1");
    }
    // As Workspace.create does: refuse git first (from the nearest folder that
    // exists), then refuse an existing path, then create any missing parents.
    let existing = dirname(path);
    while (!existsSync(existing)) existing = dirname(existing);
    refuseGit(realpathSync(existing));
    if (existsSync(path)) throw new Refusal("boundary", `${path} already exists; register it instead, or choose a new folder`);
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const target = join(realpathSync(parent), name);
    mkdirSync(target, { mode: 0o700 });
    mkdirSync(join(target, PRIVATE), { mode: 0o700 });
    const manifest = {
      layout_version: LAYOUT_VERSION,
      name,
      created_at: now.toISOString(),
      retention_days: retentionDays,
      retention_source: retention.retention_source ?? "default",
    };
    writeFileSync(join(target, MANIFEST), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    return this.#register(target, now);
  }

  /**
   * Register an existing workspace, such as one made by the command line.
   * Everything is checked before anything is written or changed, so a
   * refused folder is left exactly as it was.
   */
  register(path: string, now: Date): Registration {
    if (!isAbsolute(path)) throw new Refusal("boundary", "the workspace path must be absolute");
    if (!existsSync(path)) throw new Refusal("boundary", `${path} is not a folder`);
    if (lstatSync(path).isSymbolicLink()) {
      throw new Refusal("boundary", `${path} is a symbolic link; register the folder it points to, by its own path`);
    }
    if (!statSync(path).isDirectory()) throw new Refusal("boundary", `${path} is not a folder`);
    const target = realpathSync(path);
    const manifestPath = join(target, MANIFEST);
    if (!existsSync(manifestPath)) {
      throw new Refusal("boundary", `${target} is not a Feedbacker workspace (it has no ${MANIFEST})`);
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      throw new Refusal("boundary", `${MANIFEST} in ${target} is not valid JSON`);
    }
    if (!Manifest.safeParse(manifest).success) {
      throw new Refusal("boundary", `${MANIFEST} in ${target} is not a valid workspace manifest (layout version ${LAYOUT_VERSION})`);
    }
    refuseGit(target);
    refuseSymlinks(target);
    return this.#register(target, now);
  }

  /**
   * Confirm a registration ID: the registered folder is still there, outside
   * git, still readable only by its owner, and holds that ID. Anything inside
   * that the browser created with default permissions is tightened.
   */
  confirm(id: string, options: { challenge?: boolean; now?: Date } = {}): Confirmation {
    const registration = this.#read().find((r) => r.id === id);
    if (!registration) return { confirmed: false, path: null, reason: "this folder is not registered with the proxy", tightened: [] };
    const { path } = registration;
    const no = (reason: string): Confirmation => ({ confirmed: false, path, reason, tightened: [] });
    if (!existsSync(path) || !lstatSync(path).isDirectory()) return no(`the registered folder is no longer at ${path}`);
    // The path was stored in its real form; if it now resolves elsewhere, a
    // folder above it has been replaced by a link. Refuse, rather than follow.
    if (realpathSync(path) !== path) {
      return no(`the registered path ${path} now leads somewhere else (a folder above it was replaced by a link)`);
    }
    const tree = gitWorkingTree(path);
    if (tree) return no(`the registered folder is now inside a git working tree (${tree})`);
    let recorded: string | null = null;
    try {
      recorded = JSON.parse(readFileSync(join(path, REGISTRATION), "utf8")).registration_id;
    } catch {
      return no(`the folder at ${path} has no readable registration`);
    }
    if (recorded !== id) return no(`the folder at ${path} holds a different registration`);
    // The workspace folder is what keeps everything inside private. The proxy
    // made it 700, so a looser mode means someone changed it: refuse.
    if (statSync(path).mode & 0o077) {
      return no(`permissions were loosened on the workspace folder itself; run: chmod 700 '${path}'`);
    }
    let tightened: string[];
    try {
      tightened = tightenInside(path);
    } catch (err) {
      if (err instanceof Refusal) return no(err.message);
      throw err;
    }
    if (!options.challenge) return { confirmed: true, path, reason: null, tightened };
    this.#clearStaleChallenges(path, options.now ?? new Date());
    const value = randomBytes(24).toString("base64url");
    const file = `challenge-${randomBytes(12).toString("base64url")}.json`;
    writeFileSync(join(path, file), JSON.stringify({ challenge: value }) + "\n", { mode: 0o600 });
    return { confirmed: true, path, reason: null, tightened, challenge: { file, value } };
  }

  /** Remove identity checks the app never collected (for example, if it closed mid-open). */
  #clearStaleChallenges(path: string, now: Date): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isFile() || !CHALLENGE.test(entry.name)) continue;
      const file = join(path, entry.name);
      if (now.getTime() - statSync(file).mtimeMs > CHALLENGE_MAX_AGE_MS) unlinkSync(file);
    }
  }
}
