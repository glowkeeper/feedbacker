/**
 * Workspaces stay outside git and keep the pseudonym key private. A port of
 * `core/tests/test_workspace.py`, run end to end against the real proxy code
 * (in-process), plus what the browser workflow adds.
 *
 * Intended difference: Python takes a workspace *name* under a root folder;
 * the app takes the full *path* the moderator chooses, because the proxy
 * creates it by path. Name rules still apply to the last part of the path.
 */

import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkspace,
  MemoryFileSystem,
  openWorkspace,
  PseudonymKey,
  registerWorkspace,
  tokenFor,
  withEntries,
  type ProxyClient,
} from "../src/core/index.ts";
import { NodeFileSystem } from "./nodeFileSystem.ts";
import { realProxy, tempDir } from "./proxyHarness.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

async function created(options: Parameters<typeof createWorkspace>[2] = {}) {
  const { client, calls } = realProxy();
  const root = tempDir();
  const registration = await createWorkspace(client, join(root, "mod-1"), options);
  const fs = new NodeFileSystem(registration.path);
  return { client, calls, root, registration, fs, open: () => openWorkspace(fs, client) };
}

// --- The Python tests ------------------------------------------------------------

test("create and open", async () => {
  const { open, registration } = await created({ retention_days: 60, retention_source: "terms" });
  const ws = await open();
  expect([ws.manifest.retention_days, ws.manifest.retention_source]).toEqual([60, "terms"]);
  expect(ws.registration.path).toBe(registration.path); // shown to the moderator on every open
});

test("the default retention is 90 days", async () => {
  expect((await (await created()).open()).manifest.retention_days).toBe(90);
});

test("refuses to create inside a git working tree", async () => {
  const { client } = realProxy();
  const repo = tempDir();
  mkdirSync(join(repo, ".git"));
  await expect(createWorkspace(client, join(repo, "deep", "mod-1"))).rejects.toThrow("inside a git working tree");
  expect(existsSync(join(repo, "deep"))).toBe(false);
});

test("refuses to open inside a git working tree", async () => {
  const { open, root } = await created();
  mkdirSync(join(root, ".git"));
  await expect(open()).rejects.toThrow("inside a git working tree");
});

test("refuses existing and invalid names", async () => {
  const { client, registration } = await created();
  await expect(createWorkspace(client, registration.path)).rejects.toThrow("already exists");
  for (const bad of ["/", "/tmp/.hidden", "/tmp/.."]) {
    await expect(createWorkspace(client, bad), bad).rejects.toThrow("invalid workspace name");
  }
});

test("a relative path is refused before the proxy is asked", async () => {
  const { client, calls } = realProxy();
  for (const bad of ["", "relative/mod-1", "./mod-1", "mod-1"]) {
    await expect(createWorkspace(client, bad), bad).rejects.toThrow("the workspace path must be absolute");
  }
  expect(calls).toEqual([]);
});

test("open rejects a folder that isn't a workspace", async () => {
  const { client } = realProxy();
  await expect(openWorkspace(new NodeFileSystem(tempDir()), client)).rejects.toThrow("not registered with the Feedbacker proxy");
  const { open, registration } = await created();
  rmSync(join(registration.path, "workspace.json"));
  await expect(open()).rejects.toThrow("not a Feedbacker workspace");
});

test("the key is private to the owner", async () => {
  const { open, calls, registration } = await created();
  const ws = await open();
  const before = calls.length;
  await ws.writeKey(
    PseudonymKey.parse({ entries: [{ submission_id: "sub-001", pseudonym: "[STUDENT_A]", external_id: "100200300" }] }),
  );
  // Written with default permissions, as a browser would, then tightened by the proxy.
  expect(calls.length).toBe(before + 1);
  expect(mode(join(registration.path, "private", "pseudonym-key.json"))).toBe(0o600);
  expect(mode(join(registration.path, "private"))).toBe(0o700);
  expect((await ws.readKey()).entries[0].external_id).toBe("100200300");
});

test("invalid retention creates nothing", async () => {
  const { client, calls } = realProxy();
  const root = tempDir();
  await expect(createWorkspace(client, join(root, "mod-1"), { retention_days: 0 })).rejects.toThrow("invalid workspace settings");
  expect(calls).toEqual([]); // the proxy was never asked
  expect(existsSync(join(root, "mod-1"))).toBe(false);
});

// --- What the browser workflow adds --------------------------------------------------

describe("opening", () => {
  test("a copy of a registered folder is refused (it isn't at the registered path)", async () => {
    const { registration, client, root } = await created();
    const copy = join(root, "copy");
    cpSync(registration.path, copy, { recursive: true });
    rmSync(registration.path, { recursive: true });
    await expect(openWorkspace(new NodeFileSystem(copy), client)).rejects.toThrow("no longer at");
  });

  test("a copy is refused even while the original is still in place", async () => {
    const { registration, client, root, open } = await created();
    const copy = join(root, "copy");
    cpSync(registration.path, copy, { recursive: true });
    await expect(openWorkspace(new NodeFileSystem(copy), client)).rejects.toThrow("is not the registered workspace");
    // The original still opens, and a successful open leaves no identity check behind. The one the
    // refused copy couldn't collect stays in the original until the proxy clears it (after ten minutes).
    const leftover = readdirSync(registration.path).filter((f) => f.startsWith("challenge-"));
    expect(leftover).toHaveLength(1);
    await open();
    expect(readdirSync(registration.path).filter((f) => f.startsWith("challenge-"))).toEqual(leftover);
    expect(readdirSync(copy).filter((f) => f.startsWith("challenge-"))).toEqual([]);
  });

  test("an unsupported layout version is refused", async () => {
    const fs = new MemoryFileSystem({
      "registration.json": JSON.stringify({ registration_id: "ws-1" }),
      "workspace.json": JSON.stringify({ layout_version: 2, name: "m", created_at: "2026-01-15T09:00:00Z" }),
    });
    const proxy: ProxyClient = {
      createWorkspace: async () => ({ registration_id: "", path: "" }),
      registerWorkspace: async () => ({ registration_id: "", path: "" }),
      confirmWorkspace: async () => {
        await fs.writeText("challenge-abcdefghijklmnop.json", JSON.stringify({ challenge: "v" }));
        return { confirmed: true, path: "/somewhere/m", reason: null, tightened: [], challenge: { file: "challenge-abcdefghijklmnop.json", value: "v" } };
      },
    };
    await expect(openWorkspace(fs, proxy)).rejects.toThrow("layout version 2 is not supported (expected 1)");
  });

  test("the proxy's reason is passed on when it can't confirm", async () => {
    const { open, registration } = await created();
    chmodSync(registration.path, 0o755);
    await expect(open()).rejects.toThrow("permissions were loosened on the workspace folder itself");
  });

  test("a workspace made by the command line can be registered and opened", async () => {
    const { client } = realProxy();
    const root = join(tempDir(), "from-cli");
    const cli = new NodeFileSystem(root);
    await cli.writeText("workspace.json", JSON.stringify({ layout_version: 1, name: "from-cli", created_at: "2026-01-15T09:00:00.123456Z", retention_days: 30, retention_source: "terms" }));
    await cli.writeText("private/pseudonym-key.json", JSON.stringify({ entries: [], tokens: [] }));
    const registration = await registerWorkspace(client, root);
    const ws = await openWorkspace(cli, client);
    expect(ws.manifest).toMatchObject({ name: "from-cli", retention_days: 30, created_at: "2026-01-15T09:00:00.123456Z" });
    expect(registration.path).toBe(root);
  });
});

describe("writing", () => {
  test("records are written as the Python core writes them", async () => {
    const ws = await (await created()).open();
    await ws.writeJson("request.json", { kind: "moderation_request", note: "Zoë 🙂" });
    expect(await ws.fs.readText("request.json")).toBe('{\n  "kind": "moderation_request",\n  "note": "Zoë 🙂"\n}\n');
    expect(await ws.readJson("request.json")).toEqual({ kind: "moderation_request", note: "Zoë 🙂" });
  });

  test("the manifest and registration can't be rewritten, and paths can't leave the workspace", async () => {
    const ws = await (await created()).open();
    await expect(ws.writeJson("workspace.json", {})).rejects.toThrow("managed by the proxy");
    await expect(ws.writeJson("registration.json", {})).rejects.toThrow("managed by the proxy");
    for (const bad of ["../escape.json", "a/../../b.json", "/abs.json", "a\\b.json"]) {
      await expect(ws.writeJson(bad, {}), bad).rejects.toThrow("not a path inside the workspace");
    }
  });

  test("exports go only into exports/, with the blocked name pattern", async () => {
    const { open, registration } = await created();
    const ws = await open();
    expect(await ws.writeExport("moderation-record", "json", "{}")).toBe("exports/moderation-record.feedbacker-export.json");
    expect(existsSync(join(registration.path, "exports", "moderation-record.feedbacker-export.json"))).toBe(true);
    for (const bad of ["../x", "a/b", ".hidden", ""]) {
      await expect(ws.writeExport(bad, "json", "{}"), bad).rejects.toThrow("invalid export name");
    }
  });
});

describe("deleting", () => {
  test("needs the workspace's name typed to confirm, then removes everything", async () => {
    const { open, registration } = await created();
    const ws = await open();
    await ws.writeKey(PseudonymKey.parse({}));
    await expect(ws.delete("mod")).rejects.toThrow("type the workspace's name, 'mod-1'");
    expect(existsSync(registration.path)).toBe(true);
    await ws.delete("mod-1");
    expect(existsSync(registration.path)).toBe(false);
  });
});

describe("the pseudonym key", () => {
  test("tokens are stable, append-only and case-insensitive (as Python's casefold)", () => {
    const key = PseudonymKey.parse({});
    expect(tokenFor(key, "ORG", "Acme Ltd")).toBe("[ORG_1]");
    expect(tokenFor(key, "ORG", "ACME LTD")).toBe("[ORG_1]");
    expect(tokenFor(key, "ORG", "Straße GmbH")).toBe("[ORG_2]");
    expect(tokenFor(key, "ORG", "STRASSE GMBH")).toBe("[ORG_2]"); // casefold: ß matches SS
    expect(tokenFor(key, "PERSON", "Acme Ltd")).toBe("[PERSON_1]");
    const rebuilt = withEntries(key, []);
    expect(rebuilt.tokens).toHaveLength(3);
  });
});

test("everything written by the app ends up readable only by the moderator", async () => {
  const { open, registration } = await created();
  const ws = await open();
  await ws.writeJson("marking/sub-001--marker.json", { ok: true });
  await ws.writeKey(PseudonymKey.parse({}));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? [join(dir, e.name), ...walk(join(dir, e.name))] : [join(dir, e.name)],
    );
  for (const path of walk(registration.path)) {
    expect(mode(path), path).toBe(statSync(path).isDirectory() ? 0o700 : 0o600);
  }
  expect(JSON.parse(readFileSync(join(registration.path, "workspace.json"), "utf8")).name).toBe("mod-1");
});
