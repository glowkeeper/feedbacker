/**
 * Workspace creation and registration (ADR 0004).
 *
 * A browser folder handle reveals neither the folder's path nor its parents,
 * so the checks the Python core makes by path are made here: the proxy
 * creates or registers a workspace by path, refuses any path inside a git
 * working tree, sets restrictive permissions, and writes a random
 * registration ID into it. The app opens only folders whose ID the proxy
 * confirms, and the proxy re-checks the registered path every time.
 *
 * The app makes new workspaces by name, inside one workspaces folder (ADR
 * 0008), and lists those registered, from their manifests alone.
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
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import * as z from "zod";
import { Refusal } from "./boundary.ts";

// As in core/src/feedbacker_core/workspace.py, so the command line can open
// a workspace the proxy created.
export const MANIFEST = "workspace.json";
export const PRIVATE = "private";
export const LAYOUT_VERSION = 1;
export const DEFAULT_RETENTION_DAYS = 90;
export const REGISTRATION = "registration.json";
/**
 * The workspaces folder's own ID, written into it when the proxy prepares it. The app can't learn the path of the folder
 * the educator picks, so it checks the picked folder holds this ID: the wrong folder is refused before anything is made.
 */
export const FOLDER_ID = "feedbacker-workspaces.json";

/** The manifest as `WorkspaceManifest` in workspace.py requires it, checked before registering. */
const Manifest = z.strictObject({
  layout_version: z.literal(LAYOUT_VERSION),
  name: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  retention_days: z.int().positive().optional(),
  retention_source: z.string().optional(),
  workspace_type: z.enum(["moderation", "marking", "module"]).optional(),
  module: z.string().nullable().optional(),
  shared_key: z.boolean().nullable().optional(),
});

/** One-time identity checks, written into the registered folder when the app opens it. */
const CHALLENGE = /^challenge-[A-Za-z0-9_-]{16,64}\.json$/;
const CHALLENGE_MAX_AGE_MS = 10 * 60_000;

export interface Retention {
  retention_days?: number;
  retention_source?: string;
  workspace_type?: "moderation" | "marking" | "module"; // what the workspace is for; moderation when not given
  /** For an assessment: the module it is in, by the module's folder name (ADR 0010). */
  module?: string;
  /** For a module: whether its assessments share one pseudonym key. Fixed when it is made. */
  shared_key?: boolean;
}

interface Registration {
  id: string;
  path: string;
  registered_at: string;
  /** Where it was before it was moved into the workspaces folder, and when (ADR 0013). */
  moved_from?: string;
  moved_at?: string;
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

/** A registered workspace as the home screen lists it: what its manifest says, and nothing from its records. */
export interface Listed {
  registration_id: string;
  path: string;
  /** The folder's own name, to open it inside the workspaces folder. */
  folder: string;
  /** Whether it is directly inside the workspaces folder (otherwise the app asks for its folder). */
  in_workspaces_folder: boolean;
  /** From the manifest; null when it can't be read (then `problem` says why). */
  name: string | null;
  workspace_type: "moderation" | "marking" | "module" | null;
  /** The module an assessment is in, by folder name; null for a workspace of its own or a module. */
  module: string | null;
  created_at: string | null;
  retention_days: number | null;
  retention_source: string | null;
  problem: string | null;
}

/** What a module keeps in its own folder, beside its assessments: an assessment can't have one of these as its name. */
const MODULE_OWN = new Set(["private", "sources", "anonymisation", "exports", "judgements", "verdicts", "marking", "submissions", "readings"]);

/** The longest workspace name, in characters. */
export const MAX_NAME = 64;

/**
 * Why a name can't be a workspace's folder name, or null if it can: letters,
 * digits, spaces, hyphens, underscores and full stops, with a letter or digit,
 * not starting with a full stop or a space, not ending with a space, and at
 * most 64 characters (ADR 0008). Letters include accented ones; the name is
 * compared in its composed form (NFC), as it is stored.
 */
export function nameProblem(name: string): string | null {
  const n = name.normalize("NFC");
  if (!n) return "give the workspace a name";
  if ([...n].length > MAX_NAME) return `a workspace's name can be at most ${MAX_NAME} characters`;
  if (!/^[\p{L}\p{N} ._-]+$/u.test(n)) return "a workspace's name can have only letters, digits, spaces, hyphens, underscores and full stops";
  if (!/[\p{L}\p{N}]/u.test(n)) return "a workspace's name needs at least one letter or digit";
  if (n.startsWith(".")) return "a workspace's name can't start with a full stop";
  if (n !== n.trim()) return "a workspace's name can't start or end with a space";
  return null;
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

/**
 * Write a file by writing a private temporary file beside it, and renaming that into place. A failure part-way (a full
 * disk, say) leaves the file exactly as it was, never half-written; the temporary file is removed.
 */
function replaceFile(path: string, text: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(9).toString("base64url")}`);
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } catch (err) {
    try {
      unlinkSync(temporary);
    } catch {
      // it was never made, or is already gone
    }
    throw err;
  }
}

export class Workspaces {
  readonly registryPath: string;
  /** The workspaces folder (ADR 0008), in its real form once prepared; null if there is none. */
  #folder: string | null;
  #prepared = false;
  #folderId: string | null = null;

  constructor(registryPath: string, workspacesFolder: string | null = null) {
    this.registryPath = registryPath;
    this.#folder = workspacesFolder;
  }

  /**
   * Make the workspaces folder ready, when the proxy starts: create it if it
   * is missing, or set it to exactly 700 if it already exists (the command
   * line creates it with ordinary permissions; a stricter mode such as 500
   * would leave no way to make a workspace in it). After this, a folder whose
   * permissions are changed again is refused, as a workspace's is. Returns its path, and why it can't be used, if it can't.
   */
  prepareFolder(): { path: string | null; tightened: boolean; problem: string | null } {
    if (!this.#folder) return { path: null, tightened: false, problem: "no workspaces folder was given" };
    const asked = this.#folder;
    let tightened = false;
    try {
      if (!existsSync(asked)) mkdirSync(asked, { recursive: true, mode: 0o700 });
      if (!statSync(asked).isDirectory()) return { path: asked, tightened, problem: `${asked} is not a folder` };
      const real = realpathSync(asked);
      const tree = gitWorkingTree(real);
      if (tree) return { path: real, tightened, problem: `the workspaces folder is inside a git working tree (${tree}); start the proxy with --workspaces <a folder outside any repository>` };
      if ((statSync(real).mode & 0o777) !== 0o700) {
        chmodSync(real, 0o700);
        tightened = true;
      }
      this.#folderId = this.#ensureFolderId(real);
      this.#folder = real;
      this.#prepared = true;
      return { path: real, tightened, problem: null };
    } catch (err) {
      return { path: asked, tightened, problem: `the workspaces folder can't be used: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** The folder's ID, kept if it already has a valid one, so a folder the app was given before is still recognised. */
  #ensureFolderId(folder: string): string {
    const file = join(folder, FOLDER_ID);
    try {
      if (lstatSync(file).isFile()) {
        const id = JSON.parse(readFileSync(file, "utf8")).folder_id;
        if (typeof id === "string" && /^wf-[A-Za-z0-9_-]{24}$/.test(id)) {
          chmodSync(file, 0o600);
          return id;
        }
      }
    } catch {
      // missing or unreadable: a new one is written
    }
    // Written to a new file of its own, then renamed into place: whatever was there (even a link) is replaced, never followed.
    const id = `wf-${randomBytes(18).toString("base64url")}`;
    const temporary = join(folder, `.${FOLDER_ID}.${randomBytes(9).toString("base64url")}`);
    writeFileSync(temporary, JSON.stringify({ folder_id: id }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
    return id;
  }

  /** The workspaces folder's ID, which the app checks the folder it was given holds. */
  get folderId(): string | null {
    return this.#prepared ? this.#folderId : null;
  }

  /** The workspaces folder, checked again: still a folder, outside git, readable only by its owner. */
  #workspacesFolder(): string {
    if (!this.#folder || !this.#prepared) throw new Refusal("boundary", "there is no workspaces folder; the proxy couldn't prepare one when it started");
    const folder = this.#folder;
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Refusal("boundary", `the workspaces folder is no longer at ${folder}`);
    if (realpathSync(folder) !== folder) throw new Refusal("boundary", `the workspaces folder ${folder} now leads somewhere else (a folder above it was replaced by a link)`);
    const tree = gitWorkingTree(folder);
    if (tree) throw new Refusal("boundary", `the workspaces folder is now inside a git working tree (${tree})`);
    if ((statSync(folder).mode & 0o777) !== 0o700) throw new Refusal("boundary", `permissions were changed on the workspaces folder; run: chmod 700 '${folder}'`);
    return folder;
  }

  /** The workspaces folder's path, if there is one. */
  get folder(): string | null {
    return this.#prepared ? this.#folder : null;
  }

  #read(): Registration[] {
    if (!existsSync(this.registryPath)) return [];
    return JSON.parse(readFileSync(this.registryPath, "utf8")).registrations;
  }

  /** The registry holds every workspace's path, so it is replaced whole or not at all. */
  #write(registrations: Registration[]): void {
    replaceFile(this.registryPath, JSON.stringify({ registrations }, null, 2) + "\n");
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
      workspace_type: retention.workspace_type ?? "moderation",
      ...(retention.module ? { module: retention.module } : {}),
      ...(retention.workspace_type === "module" ? { shared_key: retention.shared_key === true } : {}),
    };
    writeFileSync(join(target, MANIFEST), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    return this.#register(target, now);
  }

  /** Create a new workspace by name, inside the workspaces folder (ADR 0008). */
  createNamed(name: string, now: Date, retention: Retention = {}): Registration {
    const problem = nameProblem(name);
    if (problem) throw new Refusal("boundary", problem);
    if (retention.module && retention.workspace_type === "module") throw new Refusal("boundary", "a module can't be inside another module");
    if (retention.shared_key !== undefined && retention.workspace_type !== "module") throw new Refusal("boundary", "only a module chooses whether its assessments share a pseudonym key");
    const folder = this.#workspacesFolder();
    const composed = name.normalize("NFC");
    if (retention.module) return this.#createInModule(folder, retention.module, composed, now, retention);
    if (existsSync(join(folder, composed))) throw new Refusal("boundary", `a workspace called '${composed}' already exists; choose another name`);
    return this.create(join(folder, composed), now, retention);
  }

  /** An assessment inside a registered module (ADR 0010): in the module's folder, under a name that can't be one of the module's own files. */
  #createInModule(folder: string, module: string, name: string, now: Date, retention: Retention): Registration {
    const moduleProblem = nameProblem(module);
    if (moduleProblem) throw new Refusal("boundary", `the module's name: ${moduleProblem}`);
    const modulePath = join(folder, module.normalize("NFC"));
    const registered = this.list().find((l) => l.path === modulePath);
    if (!registered || registered.workspace_type !== "module" || registered.problem) {
      throw new Refusal("boundary", `'${module}' is not a module registered with this proxy`);
    }
    // The module keeps its own files and folders beside its assessments, so an assessment can't take their names.
    if (MODULE_OWN.has(name.toLowerCase()) || name.toLowerCase().endsWith(".json")) {
      throw new Refusal("boundary", `'${name}' is a name the module keeps for its own files; choose another name`);
    }
    if (existsSync(join(modulePath, name))) throw new Refusal("boundary", `the module already has an assessment called '${name}'; choose another name`);
    // An assessment is kept for as long as its module is, whatever the caller asks for (ADR 0010).
    return this.create(join(modulePath, name), now, {
      workspace_type: retention.workspace_type,
      retention_days: registered.retention_days ?? DEFAULT_RETENTION_DAYS,
      retention_source: registered.retention_source ?? "default",
      module: module.normalize("NFC"),
    });
  }

  /**
   * Move a workspace kept elsewhere into the workspaces folder, so the browser opens it like any other (ADR 0013). Everything
   * is checked first, so a refused move leaves the folder where it was. The folder is renamed, never copied (so nothing is
   * ever held twice) and keeps its registration ID; the registry records where it was. Only a workspace of its own can be
   * moved: a module holds its assessments, and an assessment belongs in its module. It keeps its folder's name unless
   * `newName` is given (when that name is taken, say): then the folder takes it, and so does the name in its manifest, so the
   * folder and the list agree; nothing else inside is touched.
   */
  moveIntoFolder(id: string, now: Date, newName?: string): Registration {
    const registration = this.#read().find((r) => r.id === id);
    if (!registration) throw new Refusal("boundary", "this folder is not registered with the proxy");
    const folder = this.#workspacesFolder();
    // The workspace itself must be sound before it is moved, as it must be to be opened.
    const confirmation = this.confirm(id);
    if (!confirmation.confirmed) throw new Refusal("boundary", confirmation.reason ?? "the workspace can't be confirmed");
    const listed = this.list().find((l) => l.registration_id === id);
    if (!listed || listed.problem) throw new Refusal("boundary", listed?.problem ?? "the workspace can't be read");
    if (listed.in_workspaces_folder) throw new Refusal("boundary", "this workspace is already in the workspaces folder");
    if (listed.workspace_type === "module") throw new Refusal("boundary", "a module can't be moved: it holds its assessments");
    if (listed.module) throw new Refusal("boundary", "an assessment belongs in its module's folder, so it can't be moved on its own");
    const { path } = registration;
    if (this.#read().some((r) => r.id !== id && r.path.startsWith(path + sep))) {
      throw new Refusal("boundary", "another registered workspace is inside this one, so it can't be moved");
    }
    const renamed = newName !== undefined && newName.normalize("NFC") !== basename(path).normalize("NFC");
    const name = (renamed ? newName! : basename(path)).normalize("NFC");
    const problem = nameProblem(name);
    if (problem) throw new Refusal("boundary", renamed ? `the new name: ${problem}` : `its folder's name '${name}' can't be used in the workspaces folder: ${problem}; give it another name`);
    const target = join(folder, name);
    if (existsSync(target)) throw new Refusal("boundary", `a workspace called '${name}' already exists in the workspaces folder; give it another name`);
    const manifestPath = join(path, MANIFEST);
    const manifestText = readFileSync(manifestPath, "utf8");
    try {
      renameSync(path, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Refusal("boundary", "the workspaces folder is on a different disk from this workspace, so it can't be moved in one step; nothing was changed");
      }
      throw new Refusal("boundary", `the workspace couldn't be moved: ${err instanceof Error ? err.message : String(err)}; nothing was changed`);
    }
    const moved: Registration = { ...registration, path: target, moved_from: path, moved_at: now.toISOString() };
    let manifestChanged = false;
    try {
      if (renamed) {
        replaceFile(join(target, MANIFEST), JSON.stringify({ ...JSON.parse(manifestText), name }, null, 2) + "\n");
        manifestChanged = true;
      }
      this.#write(this.#read().map((r) => (r.id === id ? moved : r)));
    } catch (err) {
      // Put everything back as it was. Each step is tried whatever happened to the other, and anything that can't be undone is said.
      const stuck: string[] = [];
      if (manifestChanged) {
        try {
          replaceFile(join(target, MANIFEST), manifestText);
        } catch (e) {
          stuck.push(`its manifest couldn't be restored, so its recorded name is now '${name}' (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      try {
        renameSync(target, path);
      } catch (e) {
        stuck.push(`the folder couldn't be put back, and is at ${target} (${e instanceof Error ? e.message : String(e)}); register it there to use it`);
      }
      const why = err instanceof Error ? err.message : String(err);
      throw new Refusal("boundary", stuck.length ? `the workspace couldn't be moved (${why}), and couldn't be fully put back: ${stuck.join("; ")}` : `the workspace couldn't be moved: ${why}; nothing was changed`);
    }
    return moved;
  }

  /**
   * The registered workspaces, newest first, with what each one's manifest
   * says and nothing else. An older manifest without a type or keep-for
   * period is a moderation kept for 90 days, as the command line reads it.
   * Problems are reported, not thrown: opening a workspace checks it fully.
   */
  list(): Listed[] {
    const folder = this.folder;
    const listed = this.#read().map((r): Listed => {
      const base: Listed = {
        registration_id: r.id,
        path: r.path,
        folder: basename(r.path),
        in_workspaces_folder: folder !== null && dirname(r.path) === folder,
        name: null,
        workspace_type: null,
        module: null,
        created_at: null,
        retention_days: null,
        retention_source: null,
        problem: null,
      };
      // As confirming does: the registered path must still lead to itself, and
      // hold this registration, before anything in it is read.
      try {
        if (!lstatSync(r.path).isDirectory()) return { ...base, problem: `the registered folder is no longer at ${r.path}` };
        if (realpathSync(r.path) !== r.path) return { ...base, problem: `the registered path ${r.path} now leads somewhere else` };
      } catch {
        return { ...base, problem: `the registered folder is no longer at ${r.path}` };
      }
      try {
        if (JSON.parse(readFileSync(join(r.path, REGISTRATION), "utf8")).registration_id !== r.id) {
          return { ...base, problem: `the folder at ${r.path} holds a different registration` };
        }
      } catch {
        return { ...base, problem: `the folder at ${r.path} has no readable registration` };
      }
      const manifestPath = join(r.path, MANIFEST);
      try {
        if (!lstatSync(manifestPath).isFile()) return { ...base, problem: `${MANIFEST} in ${r.path} is not a file` };
      } catch {
        return { ...base, problem: `${MANIFEST} in ${r.path} is missing` };
      }
      let parsed;
      try {
        parsed = Manifest.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
      } catch {
        return { ...base, problem: `${MANIFEST} in ${r.path} can't be read` };
      }
      if (!parsed.success) return { ...base, problem: `${MANIFEST} in ${r.path} is not a valid workspace manifest` };
      const m = parsed.data;
      // An assessment sits in the folder of the module it names, and nowhere else.
      if (m.module && basename(dirname(r.path)) !== m.module) {
        return { ...base, problem: `${MANIFEST} in ${r.path} says it is in the module '${m.module}', but it is not in that module's folder` };
      }
      return {
        ...base,
        // An assessment is reached through its module's folder, which is in the workspaces folder: only a workspace that names the module it sits in
        // counts. One that is merely two levels down (say in an 'archive' folder) is kept elsewhere, and opened by choosing its folder.
        in_workspaces_folder: base.in_workspaces_folder || (folder !== null && m.module !== null && m.module !== undefined && dirname(dirname(r.path)) === folder),
        name: m.name,
        workspace_type: m.workspace_type ?? "moderation",
        module: m.module ?? null,
        created_at: m.created_at,
        retention_days: m.retention_days ?? DEFAULT_RETENTION_DAYS,
        retention_source: m.retention_source ?? "default",
      };
    });
    const when = (l: Listed) => (l.created_at ? Date.parse(l.created_at) : 0);
    return listed.sort((a, b) => when(b) - when(a));
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
  /**
   * Forget a registration, once its workspace has been deleted: the registry
   * then holds no path to it (a path can name the module). The folder itself
   * is deleted by the app, through the folder the moderator opened. Returns
   * whether there was such a registration.
   */
  /** Whether a workspace with this registration exists. */
  has(id: string): boolean {
    return this.#read().some((r) => r.id === id);
  }

  forget(id: string): boolean {
    const registrations = this.#read();
    const gone = registrations.find((r) => r.id === id);
    // A deleted module takes its assessments with it, so none of their registrations is left holding a path to nothing.
    const kept = registrations.filter((r) => r.id !== id && !(gone && r.path.startsWith(gone.path + sep)));
    if (!gone) return false;
    this.#write(kept);
    return true;
  }

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
