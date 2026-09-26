/** Workspaces are created and registered by path, and confirmed only while they stay safe (ADR 0004). */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
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

/** A workspace as the Python command line leaves it, before any tightening. */
function commandLineWorkspace(root: string) {
  mkdirSync(join(root, PRIVATE), { recursive: true });
  writeFileSync(join(root, MANIFEST), "{}");
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
    expect(await confirm(registration_id)).toEqual({ confirmed: true, path: registered, reason: null });
  });

  test.each([
    ["a relative path", () => "relative/folder", "must be absolute"],
    ["an existing folder", () => tempDir(), "already exists"],
    ["a missing parent", () => join(tempDir(), "missing", "ws"), "does not exist"],
  ])("refuses %s", async (_, path, message) => {
    const { create } = setup();
    const res = await create(path());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain(message);
  });

  test("refuses a path inside a git working tree, however deep", async () => {
    const { create } = setup();
    const repo = tempDir("proxy-repo-");
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "a", "b"), { recursive: true });
    for (const path of [join(repo, "ws"), join(repo, "a", "b", "ws")]) {
      const res = await create(path);
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toContain("inside a git working tree");
      expect(existsSync(path)).toBe(false);
    }
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

  test.each([
    ["the workspace folder", (p: string) => p, 0o755, "."],
    ["the private folder", (p: string) => join(p, PRIVATE), 0o750, PRIVATE],
    ["a private file", (p: string) => (writeFileSync(join(p, PRIVATE, "pseudonym-key.json"), "{}", { mode: 0o600 }), join(p, PRIVATE, "pseudonym-key.json")), 0o644, join(PRIVATE, "pseudonym-key.json")],
    ["the registration", (p: string) => join(p, REGISTRATION), 0o644, REGISTRATION],
  ])("permissions on %s were loosened", async (_, target, loose, shown) => {
    const { confirm, id, path } = await created();
    chmodSync(target(path), loose);
    const result = await confirm(id);
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain(shown);
  });

  test("another folder was put in its place", async () => {
    const { confirm, id, path } = await created();
    renameSync(path, `${path}-old`);
    mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(path, REGISTRATION), JSON.stringify({ registration_id: "ws-someone-else" }), { mode: 0o600 });
    expect((await confirm(id)).reason).toContain("holds a different registration");
  });
});
