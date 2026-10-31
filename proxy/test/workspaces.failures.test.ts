/**
 * A move that fails part-way (a full disk, say) leaves nothing damaged, and says so plainly when it can't put everything
 * back (ADR 0013). The file writes are made to fail after they have begun, which a read-only file can't show.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { MANIFEST, PRIVATE } from "../src/workspaces.ts";
import { makeProxy, tempDir } from "./helpers.ts";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) };
});

// The real functions, for what the mocked ones should still do: this file's own imports of them are the mocks.
const { writeFileSync: realWrite, renameSync: realRename } = await vi.importActual<typeof import("node:fs")>("node:fs");
const write = vi.mocked(fs.writeFileSync);
const rename = vi.mocked(fs.renameSync);
afterEach(() => {
  write.mockReset().mockImplementation(realWrite as never);
  rename.mockReset().mockImplementation(realRename as never);
});

/** A write that gets half its text down and then fails, as a full disk does. */
const failsHalfWay = (p: unknown, data: unknown, options: unknown) => {
  realWrite(p as string, String(data).slice(0, 12), options as never);
  throw new Error("no space left on device");
};

async function keptElsewhere(name = "datavis") {
  const s = makeProxy();
  const old = join(tempDir(), name);
  mkdirSync(join(old, PRIVATE), { recursive: true });
  realWrite(join(old, MANIFEST), JSON.stringify({ layout_version: 1, name, created_at: "2026-01-15T09:00:00.123456Z", retention_days: 90, retention_source: "default", workspace_type: "moderation" }, null, 2) + "\n");
  chmodSync(old, 0o700);
  const { registration_id } = await (await s.call("/api/workspaces", { body: { action: "register", path: old } })).json();
  const move = (name?: string) => s.call("/api/workspaces/move", { body: { registration_id, ...(name ? { name } : {}) } });
  const registry = () => readFileSync(join(s.data, "registry.json"), "utf8");
  const confirm = async () => (await s.call("/api/workspaces/confirm", { body: { registration_id } })).json();
  const listed = async () => (await (await s.call("/api/workspaces", { method: "GET" })).json()).workspaces;
  return { ...s, old, registration_id, move, registry, confirm, listed };
}
const leftovers = (dir: string, prefix: string) => readdirSync(dir).filter((f) => f.startsWith(prefix));

describe("a move that fails while the registry is being written", () => {
  test("leaves the registry exactly as it was, with no half-written file, and puts the workspace back", async () => {
    const s = await keptElsewhere();
    const before = s.registry();
    const manifest = readFileSync(join(s.old, MANIFEST), "utf8");
    write.mockImplementation(((p: unknown, data: unknown, options: unknown) => (String(p).includes("/.registry.json.") ? failsHalfWay(p, data, options) : realWrite(p as string, data as string, options as never))) as never);
    const res = await s.move();
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/no space left on device; nothing was changed/);
    expect(s.registry()).toBe(before); // whole, not truncated: every workspace is still listed
    expect(leftovers(s.data, ".registry.json.")).toEqual([]);
    expect(readFileSync(join(s.old, MANIFEST), "utf8")).toBe(manifest);
    expect(existsSync(join(s.workspaces.folder!, "datavis"))).toBe(false);
    expect(await s.confirm()).toMatchObject({ confirmed: true });
    expect(await s.listed()).toHaveLength(1);
  });
});

describe("a move under a new name that fails while the manifest is being written", () => {
  test("leaves the manifest as it was, and puts the folder back", async () => {
    const s = await keptElsewhere();
    const manifest = readFileSync(join(s.old, MANIFEST), "utf8");
    const before = s.registry();
    write.mockImplementation(((p: unknown, data: unknown, options: unknown) => (String(p).includes("/.workspace.json.") ? failsHalfWay(p, data, options) : realWrite(p as string, data as string, options as never))) as never);
    const res = await s.move("Another name");
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/nothing was changed/);
    expect(readFileSync(join(s.old, MANIFEST), "utf8")).toBe(manifest); // not truncated
    expect(leftovers(s.old, ".workspace.json.")).toEqual([]);
    expect(s.registry()).toBe(before);
    expect(existsSync(join(s.workspaces.folder!, "Another name"))).toBe(false);
    expect(await s.confirm()).toMatchObject({ confirmed: true });
  });
});

describe("when a failure can't be fully undone, it says what is left", () => {
  test("the folder can't be put back: it says where it is, and the manifest is still restored", async () => {
    const s = await keptElsewhere();
    const target = join(s.workspaces.folder!, "Renamed");
    const manifest = readFileSync(join(s.old, MANIFEST), "utf8");
    write.mockImplementation(((p: unknown, data: unknown, options: unknown) => (String(p).includes("/.registry.json.") ? failsHalfWay(p, data, options) : realWrite(p as string, data as string, options as never))) as never);
    rename.mockImplementation(((from: unknown, to: unknown) => {
      if (String(from) === target) throw new Error("permission denied"); // the move back
      return realRename(from as string, to as string);
    }) as never);
    const res = await s.move("Renamed");
    expect(res.status).toBe(422);
    const message = (await res.json()).error.message as string;
    expect(message).toMatch(/couldn't be moved \(no space left on device\), and couldn't be fully put back/);
    expect(message).toContain(`the folder couldn't be put back, and is at ${target}`);
    expect(message).not.toMatch(/manifest couldn't be restored/);
    expect(JSON.parse(readFileSync(join(target, MANIFEST), "utf8")).name).toBe("datavis"); // restored, whatever happened to the folder
    expect(JSON.parse(readFileSync(join(target, MANIFEST), "utf8"))).toEqual(JSON.parse(manifest));
  });

  test("the manifest can't be restored: it says so, and the folder is still put back", async () => {
    const s = await keptElsewhere();
    let manifestWrites = 0;
    write.mockImplementation(((p: unknown, data: unknown, options: unknown) => {
      if (String(p).includes("/.registry.json.")) return failsHalfWay(p, data, options);
      if (String(p).includes("/.workspace.json.") && ++manifestWrites > 1) throw new Error("input/output error"); // the first (the rename) is made; restoring it fails
      return realWrite(p as string, data as string, options as never);
    }) as never);
    const res = await s.move("Renamed");
    expect(res.status).toBe(422);
    const message = (await res.json()).error.message as string;
    expect(message).toContain("couldn't be fully put back");
    expect(message).toContain("its manifest couldn't be restored, so its recorded name is now 'Renamed' (input/output error)");
    expect(message).not.toMatch(/the folder couldn't be put back/);
    expect(existsSync(s.old)).toBe(true); // the folder was put back regardless
    expect(leftovers(s.old, ".workspace.json.")).toEqual([]);
  });
});
