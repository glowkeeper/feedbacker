/** Workspaces are created and registered by path, and confirmed only while they stay safe (ADR 0004). */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MANIFEST, PRIVATE, REGISTRATION } from "../src/workspaces.ts";
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
