/** Workspaces are created and registered by path, and confirmed only while they stay safe (ADR 0004). */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FOLDER_ID, MANIFEST, MAX_NAME, nameProblem, PRIVATE, REGISTRATION, Workspaces } from "../src/workspaces.ts";
import { makeProxy, tempDir } from "./helpers.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

function setup() {
  const proxy = makeProxy();
  const create = (path: string) => proxy.call("/api/workspaces", { body: { action: "create", path } });
  const register = (path: string) => proxy.call("/api/workspaces", { body: { action: "register", path } });
  const confirm = async (registration_id: string) =>
    (await proxy.call("/api/workspaces/confirm", { body: { registration_id } })).json();
  return { ...proxy, create, register, confirm };
}

const VALID_MANIFEST = { layout_version: 1, name: "ws", created_at: "2026-01-15T09:00:00.123456Z", retention_days: 90, retention_source: "default" };

/** A workspace as the Python command line leaves it, before any tightening. */
function commandLineWorkspace(root: string) {
  mkdirSync(join(root, PRIVATE), { recursive: true });
  writeFileSync(join(root, MANIFEST), JSON.stringify(VALID_MANIFEST));
  writeFileSync(join(root, PRIVATE, "pseudonym-key.json"), "{}");
  chmodSync(root, 0o755);
  chmodSync(join(root, PRIVATE), 0o755);
  chmodSync(join(root, PRIVATE, "pseudonym-key.json"), 0o644);
  return root;
}

describe("creating a workspace", () => {
  test("makes a locked-down folder holding its registration", async () => {
    const { create, confirm, data } = setup();
    const path = join(tempDir(), "moderation-1");
    const res = await create(path);
    expect(res.status).toBe(201);
    const { registration_id, path: registered } = await res.json();
    expect(registered.endsWith("moderation-1")).toBe(true);
    expect(mode(registered)).toBe(0o700);
    expect(mode(join(registered, PRIVATE))).toBe(0o700);
    expect(mode(join(registered, REGISTRATION))).toBe(0o600);
    expect(JSON.parse(readFileSync(join(registered, REGISTRATION), "utf8")).registration_id).toBe(registration_id);
    expect(mode(join(data, "registry.json"))).toBe(0o600);
    expect(await confirm(registration_id)).toEqual({ confirmed: true, path: registered, reason: null, tightened: [] });
  });

  test.each([
    ["a relative path", () => "relative/folder", "must be absolute"],
    ["an existing folder", () => tempDir(), "already exists"],
  ])("refuses %s", async (_, path, message) => {
    const { create } = setup();
    const res = await create(path());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain(message);
  });

  test("creates missing parent folders, as the Python core does", async () => {
    const { create, confirm } = setup();
    const path = join(tempDir(), "Feedbacker", "workspaces", "mod-1");
    const { registration_id } = await (await create(path)).json();
    expect(existsSync(join(path, MANIFEST))).toBe(true);
    expect((await confirm(registration_id)).confirmed).toBe(true);
  });

  test("refuses a path inside a git working tree, however deep", async () => {
    const { create } = setup();
    const repo = tempDir("proxy-repo-");
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "a", "b"), { recursive: true });
    // Including below folders that don't exist yet: nothing is created.
    for (const path of [join(repo, "ws"), join(repo, "a", "b", "ws"), join(repo, "not", "yet", "ws")]) {
      const res = await create(path);
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toContain("inside a git working tree");
      expect(existsSync(path)).toBe(false);
    }
    expect(existsSync(join(repo, "not"))).toBe(false);
  });

  test("treats a .git file (a worktree or submodule) as a git working tree", async () => {
    const { create } = setup();
    const repo = tempDir("proxy-worktree-");
    writeFileSync(join(repo, ".git"), "gitdir: elsewhere");
    expect((await create(join(repo, "ws"))).status).toBe(422);
  });
});

describe("a workspace's type", () => {
  test("is recorded as asked, and is moderation when not given", async () => {
    const proxy = setup();
    const marking = join(tempDir(), "marking-1");
    const res = await proxy.call("/api/workspaces", { body: { action: "create", path: marking, workspace_type: "marking" } });
    expect(res.status).toBe(201);
    const { path: registered } = await res.json();
    expect(JSON.parse(readFileSync(join(registered, MANIFEST), "utf8")).workspace_type).toBe("marking");
    const plain = await (await proxy.create(join(tempDir(), "moderation-1"))).json();
    expect(JSON.parse(readFileSync(join(plain.path, MANIFEST), "utf8")).workspace_type).toBe("moderation");
  });

  test("must be one Feedbacker knows, when created or registered", async () => {
    const proxy = setup();
    const res = await proxy.call("/api/workspaces", { body: { action: "create", path: join(tempDir(), "x"), workspace_type: "calibration" } });
    expect(res.status).toBe(422); // refused, as any request outside the boundary
    const root = commandLineWorkspace(join(tempDir(), "ws"));
    writeFileSync(join(root, MANIFEST), JSON.stringify({ ...VALID_MANIFEST, workspace_type: "calibration" }));
    expect((await proxy.register(root)).status).toBe(422);
    writeFileSync(join(root, MANIFEST), JSON.stringify({ ...VALID_MANIFEST, workspace_type: "marking" }));
    expect((await proxy.register(root)).status).toBe(201);
  });
});

describe("registering an existing workspace", () => {
  test("tightens its permissions and registers it", async () => {
    const { register, confirm } = setup();
    const root = commandLineWorkspace(join(tempDir(), "from-cli"));
    const { registration_id, path } = await (await register(root)).json();
    expect(mode(path)).toBe(0o700);
    expect(mode(join(path, PRIVATE))).toBe(0o700);
    expect(mode(join(path, PRIVATE, "pseudonym-key.json"))).toBe(0o600);
    expect((await confirm(registration_id)).confirmed).toBe(true);
  });

  test("refuses a folder that isn't a Feedbacker workspace", async () => {
    const { register } = setup();
    const res = await register(tempDir());
    expect((await res.json()).error.message).toContain(`has no ${MANIFEST}`);
  });

  test("refuses a symbolic link as the workspace path, changing nothing", async () => {
    const { register } = setup();
    const root = commandLineWorkspace(join(tempDir(), "real"));
    const link = join(tempDir(), "link");
    symlinkSync(root, link);
    expect((await (await register(link)).json()).error.message).toContain("is a symbolic link");
    expect(existsSync(join(root, REGISTRATION))).toBe(false);
    expect(mode(root)).toBe(0o755);
  });

  test.each([
    ["not JSON", "{not json", "is not valid JSON"],
    ["another layout version", JSON.stringify({ ...VALID_MANIFEST, layout_version: 2 }), "not a valid workspace manifest"],
    ["missing a field", JSON.stringify({ layout_version: 1, name: "ws" }), "not a valid workspace manifest"],
    ["an unknown field", JSON.stringify({ ...VALID_MANIFEST, owner: "x" }), "not a valid workspace manifest"],
    ["zero retention", JSON.stringify({ ...VALID_MANIFEST, retention_days: 0 }), "not a valid workspace manifest"],
  ])("refuses a manifest that is %s, changing nothing", async (_, manifest, message) => {
    const { register } = setup();
    const root = commandLineWorkspace(join(tempDir(), "ws"));
    writeFileSync(join(root, MANIFEST), manifest);
    expect((await (await register(root)).json()).error.message).toContain(message);
    expect(existsSync(join(root, REGISTRATION))).toBe(false);
    expect(mode(root)).toBe(0o755);
    expect(mode(join(root, PRIVATE, "pseudonym-key.json"))).toBe(0o644);
  });

  test("refuses a workspace containing a symbolic link", async () => {
    const { register } = setup();
    const root = commandLineWorkspace(join(tempDir(), "ws"));
    symlinkSync("/etc/hosts", join(root, PRIVATE, "link"));
    expect((await (await register(root)).json()).error.message).toContain("symbolic link");
    // Refused before anything was written or changed.
    expect(mode(join(root, PRIVATE))).toBe(0o755);
    expect(existsSync(join(root, REGISTRATION))).toBe(false);
  });

  test("refuses a workspace inside a git working tree", async () => {
    const { register } = setup();
    const repo = tempDir("proxy-repo-");
    mkdirSync(join(repo, ".git"));
    const root = commandLineWorkspace(join(repo, "nested", "ws"));
    expect((await (await register(root)).json()).error.message).toContain("inside a git working tree");
  });

  test("registering again replaces the old registration", async () => {
    const { register, confirm } = setup();
    const root = commandLineWorkspace(join(tempDir(), "ws"));
    const first = (await (await register(root)).json()).registration_id;
    const second = (await (await register(root)).json()).registration_id;
    expect(first).not.toBe(second);
    expect((await confirm(first)).confirmed).toBe(false);
    expect((await confirm(second)).confirmed).toBe(true);
  });
});

describe("confirmation tightens what the browser created", () => {
  // The browser can't set permissions, so what the app writes gets the
  // system defaults. Inside a 700 workspace folder that is safe, and the
  // proxy restores the stricter modes whenever it confirms.
  test.each([
    ["a new folder", (p: string) => (mkdirSync(join(p, "marking"), { mode: 0o755 }), chmodSync(join(p, "marking"), 0o755), "marking"), 0o700],
    ["the private folder", (p: string) => (chmodSync(join(p, PRIVATE), 0o755), PRIVATE), 0o700],
    ["a private file", (p: string) => (writeFileSync(join(p, PRIVATE, "pseudonym-key.json"), "{}"), chmodSync(join(p, PRIVATE, "pseudonym-key.json"), 0o644), join(PRIVATE, "pseudonym-key.json")), 0o600],
    ["the registration", (p: string) => (chmodSync(join(p, REGISTRATION), 0o644), REGISTRATION), 0o600],
  ])("%s", async (_, loosen, expected) => {
    const s = setup();
    const { registration_id, path } = await (await s.create(join(tempDir(), "ws"))).json();
    const loosened = loosen(path);
    const result = await s.confirm(registration_id);
    expect(result).toMatchObject({ confirmed: true, tightened: [loosened] });
    expect(mode(join(path, loosened))).toBe(expected);
    expect((await s.confirm(registration_id)).tightened).toEqual([]); // nothing left to do
  });

  test("and ordinary records too: every file inside becomes 600", async () => {
    const s = setup();
    const { registration_id, path } = await (await s.create(join(tempDir(), "ws"))).json();
    writeFileSync(join(path, "request.json"), "{}", { mode: 0o644 });
    chmodSync(join(path, "request.json"), 0o644);
    expect((await s.confirm(registration_id)).tightened).toEqual(["request.json"]);
    expect(mode(join(path, "request.json"))).toBe(0o600);
  });
});

describe("the identity check when opening", () => {
  async function created() {
    const s = setup();
    const { registration_id, path } = await (await s.create(join(tempDir(), "ws"))).json();
    const confirm = async (challenge: boolean) =>
      (await s.call("/api/workspaces/confirm", { body: { registration_id, challenge } })).json();
    return { ...s, confirm, path: path as string };
  }

  test("writes a one-time value into the registered folder, readable only by the moderator", async () => {
    const { confirm, path } = await created();
    const result = await confirm(true);
    expect(result).toMatchObject({ confirmed: true, tightened: [] });
    expect(result.challenge.file).toMatch(/^challenge-[A-Za-z0-9_-]+\.json$/);
    const file = join(path, result.challenge.file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ challenge: result.challenge.value });
    expect(mode(file)).toBe(0o600);
  });

  test("gives each open its own value", async () => {
    const { confirm } = await created();
    const [a, b] = [await confirm(true), await confirm(true)];
    expect(a.challenge.file).not.toBe(b.challenge.file);
    expect(a.challenge.value).not.toBe(b.challenge.value);
  });

  test("isn't written when not asked for (reconfirming after a write)", async () => {
    const { confirm, path } = await created();
    expect((await confirm(false)).challenge).toBeUndefined();
    expect(readdirSync(path).filter((f) => f.startsWith("challenge-"))).toEqual([]);
  });

  test("clears values the app never collected", async () => {
    const { confirm, path } = await created();
    const stale = join(path, "challenge-abcdefghijklmnopqrstuvwx.json");
    writeFileSync(stale, "{}", { mode: 0o600 });
    const old = new Date("2026-01-15T08:00:00Z"); // before the proxy's clock (09:00)
    (await import("node:fs")).utimesSync(stale, old, old);
    await confirm(true);
    expect(existsSync(stale)).toBe(false);
  });
});

describe("confirmation fails when", () => {
  async function created() {
    const s = setup();
    const { registration_id, path } = await (await s.create(join(tempDir(), "ws"))).json();
    return { ...s, id: registration_id as string, path: path as string };
  }

  test("the ID isn't registered", async () => {
    const { confirm } = await created();
    expect(await confirm("ws-unknown")).toMatchObject({ confirmed: false, reason: "this folder is not registered with the proxy" });
  });

  test("the folder has been moved", async () => {
    const { confirm, id, path } = await created();
    renameSync(path, `${path}-moved`);
    expect(await confirm(id)).toMatchObject({ confirmed: false, reason: `the registered folder is no longer at ${path}` });
  });

  test("the folder has been moved into a git working tree", async () => {
    const { confirm, id, path } = await created();
    mkdirSync(join(path, "..", ".git"));
    expect((await confirm(id)).reason).toContain("now inside a git working tree");
  });

  test("permissions on the workspace folder itself were loosened", async () => {
    const { confirm, id, path } = await created();
    chmodSync(path, 0o755);
    const result = await confirm(id);
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("loosened on the workspace folder itself");
    expect(mode(path)).toBe(0o755); // not silently changed back
  });

  test("it contains a symbolic link", async () => {
    const { confirm, id, path } = await created();
    symlinkSync(tempDir(), join(path, PRIVATE, "elsewhere"));
    expect((await confirm(id)).reason).toContain("contains a symbolic link (private/elsewhere)");
  });
  test("a folder above it was replaced by a link into a git working tree", async () => {
    const s = setup();
    const outer = tempDir();
    const { registration_id, path } = await (await s.create(join(outer, "registered", "ws"))).json();
    // Move the real folder into a repository, and leave a link where its parent was.
    const repo = tempDir("proxy-repo-");
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "sub"));
    renameSync(join(outer, "registered", "ws"), join(repo, "sub", "ws"));
    (await import("node:fs")).rmSync(join(outer, "registered"), { recursive: true });
    symlinkSync(join(repo, "sub"), join(outer, "registered"));
    const result = await s.confirm(registration_id);
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("now leads somewhere else");
    expect(result.path).toBe(path);
  });

  test("another folder was put in its place", async () => {
    const { confirm, id, path } = await created();
    renameSync(path, `${path}-old`);
    mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(path, REGISTRATION), JSON.stringify({ registration_id: "ws-someone-else" }), { mode: 0o600 });
    expect((await confirm(id)).reason).toContain("holds a different registration");
  });
});

describe("forgetting a deleted workspace", () => {
  test("removes its registration, so the registry no longer holds its path", async () => {
    const s = setup();
    const path = join(tempDir(), "module-2026");
    const { registration_id } = await (await s.create(path)).json();
    const other = await (await s.create(join(tempDir(), "other"))).json();
    const registry = () => readFileSync(join(s.data, "registry.json"), "utf8");
    expect(registry()).toContain("module-2026");
    const res = await s.call("/api/workspaces/forget", { body: { registration_id } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forgotten: true });
    expect(registry()).not.toContain("module-2026");
    expect(registry()).toContain(other.registration_id); // others are kept
    expect(await s.confirm(registration_id)).toMatchObject({ confirmed: false, reason: "this folder is not registered with the proxy" });
    // Forgetting again, or a registration that never was, is not an error.
    expect(await (await s.call("/api/workspaces/forget", { body: { registration_id } })).json()).toEqual({ forgotten: false });
  });

  test("needs the session token and the app's origin, like every API call", async () => {
    const s = setup();
    const { registration_id } = await (await s.create(join(tempDir(), "ws"))).json();
    const noToken = await s.call("/api/workspaces/forget", { body: { registration_id }, headers: { authorization: "" } });
    const otherOrigin = await s.call("/api/workspaces/forget", { body: { registration_id }, headers: { origin: "http://evil.example" } });
    expect([noToken.status, otherOrigin.status].every((n) => n >= 400)).toBe(true);
    expect(await s.confirm(registration_id)).toMatchObject({ confirmed: true });
  });

  test("refuses a malformed request", async () => {
    const s = setup();
    const res = await s.call("/api/workspaces/forget", { body: { registration_id: "" } });
    expect(res.status).toBe(422);
  });
});

describe("the workspaces folder (ADR 0008)", () => {
  test("is created when the proxy starts, readable only by its owner", () => {
    const folder = join(tempDir(), "Feedbacker", "workspaces");
    const prepared = new Workspaces(join(tempDir(), "registry.json"), folder).prepareFolder();
    expect(prepared).toMatchObject({ tightened: false, problem: null });
    expect(mode(folder)).toBe(0o700);
  });

  test("made by the command line with ordinary permissions, it is made readable only by its owner", () => {
    const folder = join(tempDir(), "workspaces");
    mkdirSync(folder, { mode: 0o755 });
    chmodSync(folder, 0o755);
    expect(new Workspaces(join(tempDir(), "registry.json"), folder).prepareFolder()).toMatchObject({ tightened: true, problem: null });
    expect(mode(folder)).toBe(0o700);
  });

  test("holds its own ID, which the listing gives, so the app can check the folder it is given; the ID is kept across starts", async () => {
    const folder = join(tempDir(), "workspaces");
    const first = new Workspaces(join(tempDir(), "registry.json"), folder);
    first.prepareFolder();
    expect(first.folderId).toMatch(/^wf-/);
    expect(mode(join(folder, FOLDER_ID))).toBe(0o600);
    expect(JSON.parse(readFileSync(join(folder, FOLDER_ID), "utf8")).folder_id).toBe(first.folderId);
    const again = new Workspaces(join(tempDir(), "registry.json"), folder);
    again.prepareFolder();
    expect(again.folderId).toBe(first.folderId);
    const { call } = setupWith(again);
    expect((await (await call("/api/workspaces", { method: "GET" })).json()).folder_id).toBe(first.folderId);
  });

  test("an ID file that isn't valid is replaced", () => {
    const folder = join(tempDir(), "workspaces");
    mkdirSync(folder);
    writeFileSync(join(folder, FOLDER_ID), "{");
    const workspaces = new Workspaces(join(tempDir(), "registry.json"), folder);
    workspaces.prepareFolder();
    expect(workspaces.folderId).toMatch(/^wf-[A-Za-z0-9_-]{24}$/);
  });

  test("can't be inside a git working tree: new work then can't be started", async () => {
    const repo = tempDir();
    mkdirSync(join(repo, ".git"));
    const workspaces = new Workspaces(join(tempDir(), "registry.json"), join(repo, "workspaces"));
    expect(workspaces.prepareFolder().problem).toMatch(/inside a git working tree/);
    const { call } = setupWith(workspaces);
    const res = await call("/api/workspaces", { body: { action: "create", name: "module 2026" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/no workspaces folder/);
  });

  test("whose permissions are widened again is refused", async () => {
    const { call, workspaces } = setupWith();
    chmodSync(workspaces.folder!, 0o755);
    const res = await call("/api/workspaces", { body: { action: "create", name: "module 2026" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/permissions were changed on the workspaces folder/);
  });

  test.each([0o500, 0o600, 0o711])("with too few permissions (%o) or too many, it is set to exactly 700 at start-up", (start) => {
    const folder = join(tempDir(), "workspaces");
    mkdirSync(folder);
    chmodSync(folder, start);
    const workspaces = new Workspaces(join(tempDir(), "registry.json"), folder);
    expect(workspaces.prepareFolder()).toMatchObject({ tightened: true, problem: null });
    expect(mode(folder)).toBe(0o700);
    expect(() => workspaces.createNamed("module", new Date())).not.toThrow();
  });
});

describe("a workspace's name", () => {
  test.each(["module-2026", "Module 2026", "CS101.2026_resit", "Études 2026", "a", "x".repeat(MAX_NAME)])("accepts %j", (name) => {
    expect(nameProblem(name)).toBeNull();
  });

  test.each([
    ["", /give the workspace a name/],
    ["   ", /letter or digit/],
    ["---", /letter or digit/],
    [" module", /start or end with a space/],
    ["module ", /start or end with a space/],
    [".module", /full stop/],
    ["..", /full stop|letter or digit/],
    ["a/b", /only letters/],
    ["a\\b", /only letters/],
    ["a\u0000b", /only letters/],
    ["module​2026", /only letters/],
    ["x".repeat(MAX_NAME + 1), /at most 64/],
  ])("refuses %j", (name, why) => {
    expect(nameProblem(name)).toMatch(why);
  });
});

describe("creating a workspace by name", () => {
  test("makes it inside the workspaces folder, registered and locked down, with its type and keep-for period", async () => {
    const { call, workspaces, confirm } = setupWith();
    const res = await call("/api/workspaces", { body: { action: "create", name: "Module 2026", workspace_type: "marking", retention_days: 30 } });
    expect(res.status).toBe(201);
    const { registration_id, path } = await res.json();
    expect(path).toBe(join(workspaces.folder!, "Module 2026"));
    expect(mode(path)).toBe(0o700);
    expect(JSON.parse(readFileSync(join(path, MANIFEST), "utf8"))).toMatchObject({ name: "Module 2026", workspace_type: "marking", retention_days: 30 });
    expect((await confirm(registration_id)).confirmed).toBe(true);
  });

  test("stores an accented name in its composed form", async () => {
    const { call, workspaces } = setupWith();
    const res = await call("/api/workspaces", { body: { action: "create", name: "Études" } });
    expect((await res.json()).path).toBe(join(workspaces.folder!, "Études"));
  });

  test("refuses a name that already exists, changing nothing", async () => {
    const { call, workspaces } = setupWith();
    await call("/api/workspaces", { body: { action: "create", name: "module" } });
    const before = readdirSync(workspaces.folder!);
    const res = await call("/api/workspaces", { body: { action: "create", name: "module" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/already exists; choose another name/);
    expect(readdirSync(workspaces.folder!)).toEqual(before);
  });

  test("refuses a name that would reach outside the workspaces folder", async () => {
    const { call, workspaces } = setupWith();
    for (const name of ["../escape", "/tmp/escape", "a/b"]) {
      const res = await call("/api/workspaces", { body: { action: "create", name } });
      expect(res.status).toBe(422);
    }
    expect(readdirSync(workspaces.folder!)).toEqual([FOLDER_ID]);
  });

  test("takes a name or a path, never both, and registers only by path", async () => {
    const { call } = setupWith();
    for (const body of [
      { action: "create", name: "a", path: join(tempDir(), "a") },
      { action: "create" },
      { action: "register", name: "a" },
    ]) {
      expect((await call("/api/workspaces", { body })).status).toBe(422);
    }
  });
});

describe("listing the workspaces", () => {
  test("gives each one's manifest, newest first, and where it is", async () => {
    const { call, workspaces } = setupWith();
    let clock = 10; // after the command-line workspace's manifest (09:00)
    const at = () => new Date(Date.UTC(2026, 0, 15, 9, clock++));
    workspaces.createNamed("first", at(), { workspace_type: "marking" });
    workspaces.createNamed("second", at(), { workspace_type: "moderation", retention_days: 30 });
    const elsewhere = commandLineWorkspace(join(tempDir(), "elsewhere"));
    workspaces.register(elsewhere, at());
    const res = await call("/api/workspaces", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.folder).toBe(workspaces.folder);
    expect(body.workspaces.map((w: { folder: string; in_workspaces_folder: boolean }) => [w.folder, w.in_workspaces_folder])).toEqual([
      ["second", true],
      ["first", true],
      ["elsewhere", false],
    ]);
    expect(body.workspaces[0]).toMatchObject({ name: "second", workspace_type: "moderation", retention_days: 30, problem: null });
    expect(body.workspaces[1]).toMatchObject({ name: "first", workspace_type: "marking", retention_days: 90 });
  });

  test("reads an older manifest as the command line does: a moderation, kept for 90 days", async () => {
    const { call, workspaces } = setupWith();
    const old = join(tempDir(), "old");
    mkdirSync(join(old, PRIVATE), { recursive: true });
    writeFileSync(join(old, MANIFEST), JSON.stringify({ layout_version: 1, name: "old", created_at: "2025-11-04T09:00:00Z" }));
    workspaces.register(old, new Date());
    const [listed] = (await (await call("/api/workspaces", { method: "GET" })).json()).workspaces;
    expect(listed).toMatchObject({ name: "old", workspace_type: "moderation", retention_days: 90, retention_source: "default" });
  });

  test("reads only the manifest: unreadable records elsewhere in the workspace don't matter", async () => {
    const { call, workspaces } = setupWith();
    const reg = workspaces.createNamed("module", new Date());
    mkdirSync(join(reg.path, "records"));
    writeFileSync(join(reg.path, "records", "x.json"), "{not json");
    chmodSync(join(reg.path, "records", "x.json"), 0o000);
    const [listed] = (await (await call("/api/workspaces", { method: "GET" })).json()).workspaces;
    expect(listed).toMatchObject({ name: "module", problem: null });
  });

  test("reports a workspace whose folder has gone, or whose manifest is broken, without failing", async () => {
    const { call, workspaces } = setupWith();
    const gone = workspaces.createNamed("gone", new Date());
    renameSync(gone.path, join(tempDir(), "moved"));
    const broken = workspaces.createNamed("broken", new Date());
    writeFileSync(join(broken.path, MANIFEST), "{");
    const listed = (await (await call("/api/workspaces", { method: "GET" })).json()).workspaces;
    expect(listed.map((w: { folder: string; problem: string }) => [w.folder, w.problem])).toEqual(
      expect.arrayContaining([
        ["gone", expect.stringMatching(/no longer at/)],
        ["broken", expect.stringMatching(/can't be read/)],
      ]),
    );
  });

  test("checks, before reading anything, that the registered path still leads to that workspace", async () => {
    const { call, workspaces } = setupWith();
    const replaced = workspaces.createNamed("replaced", new Date());
    workspaces.createNamed("untouched", new Date());
    const swapped = workspaces.createNamed("swapped", new Date());
    // The folder itself replaced by a link to another workspace.
    const decoy = workspaces.createNamed("decoy", new Date());
    renameSync(replaced.path, join(tempDir(), "replaced-moved"));
    symlinkSync(decoy.path, replaced.path);
    // Another workspace's folder put in this one's place.
    const other = commandLineWorkspace(join(tempDir(), "other"));
    writeFileSync(join(other, REGISTRATION), JSON.stringify({ registration_id: "ws-someone-else" }));
    renameSync(swapped.path, join(tempDir(), "swapped-moved"));
    renameSync(other, swapped.path);
    const listed = (await (await call("/api/workspaces", { method: "GET" })).json()).workspaces as { folder: string; problem: string | null; name: string | null }[];
    const of = (folder: string) => listed.find((w) => w.folder === folder)!;
    expect(of("replaced")).toMatchObject({ name: null, problem: expect.stringMatching(/no longer at|leads somewhere else/) });
    expect(of("swapped")).toMatchObject({ name: null, problem: expect.stringMatching(/different registration/) });
    expect(of("untouched").problem).toBeNull();
  });

  test("a folder above the workspaces folder replaced by a link: each workspace is reported, not read", async () => {
    const outer = tempDir();
    const workspaces = new Workspaces(join(tempDir(), "registry.json"), join(outer, "inner", "workspaces"));
    workspaces.prepareFolder();
    workspaces.createNamed("module", new Date());
    const elsewhere = tempDir();
    renameSync(join(outer, "inner"), join(elsewhere, "inner"));
    symlinkSync(join(elsewhere, "inner"), join(outer, "inner"));
    const [listed] = workspaces.list();
    expect(listed).toMatchObject({ name: null, problem: expect.stringMatching(/leads somewhere else/) });
  });

  test("needs the session token, like every API call", async () => {
    const { app } = setupWith();
    expect((await app.request("/api/workspaces", { headers: { host: "127.0.0.1:8765" } })).status).toBe(403);
  });
});

function setupWith(workspaces?: Workspaces) {
  const proxy = makeProxy(workspaces ? { workspaces } : {});
  const confirm = async (registration_id: string) => (await proxy.call("/api/workspaces/confirm", { body: { registration_id } })).json();
  return { ...proxy, confirm };
}
