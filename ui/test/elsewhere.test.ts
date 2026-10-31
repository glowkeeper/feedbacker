/** A workspace kept outside the workspaces folder: what its card says, and moving it in through the real proxy (ADR 0013). */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { canMove, continueLabel, elsewhereNote, moveNameProblem, suggestName } from "../src/app/elsewhere.ts";
import { createWorkspace, openWorkspace, type ListedWorkspace } from "../src/core/index.ts";
import { NodeFileSystem } from "./nodeFileSystem.ts";
import { realProxy, tempDir } from "./proxyHarness.ts";

test("the card says what Continue will do, in the browser's own terms, and nothing when it will simply open", () => {
  expect(elsewhereNote("none")).toBe("Continue asks you to choose that folder, once on this computer.");
  expect(elsewhereNote("prompt")).toBe("Continue asks you to allow access to it again.");
  expect(elsewhereNote("granted")).toBe("");
  expect(elsewhereNote(undefined)).toBe(""); // until the browser's state is known, nothing wrong is said
});

test("the button says so when the folder picker will open", () => {
  expect(continueLabel("none")).toBe("Choose its folder to continue");
  for (const access of ["prompt", "granted", undefined] as const) expect(continueLabel(access)).toBe("Continue");
});

const listed = (extra: Partial<ListedWorkspace>): ListedWorkspace => ({
  registration_id: "ws-1",
  path: "/somewhere/datavis",
  folder: "datavis",
  in_workspaces_folder: false,
  name: "datavis",
  workspace_type: "moderation",
  module: null,
  created_at: "2026-09-29T09:00:00.000Z",
  retention_days: 90,
  retention_source: "default",
  problem: null,
  ...extra,
});

test("only a sound workspace of its own, kept elsewhere, is offered the move", () => {
  expect(canMove(listed({}))).toBe(true);
  expect(canMove(listed({ workspace_type: "marking" }))).toBe(true);
  expect(canMove(listed({ in_workspaces_folder: true }))).toBe(false);
  expect(canMove(listed({ workspace_type: "module" }))).toBe(false); // it holds its assessments
  expect(canMove(listed({ module: "CS101" }))).toBe(false); // it belongs in its module
  expect(canMove(listed({ problem: "the registered folder is no longer there" }))).toBe(false);
});

test("moving through the client renames the folder into the workspaces folder, and it opens there with its registration", async () => {
  const { client, folder } = realProxy();
  const kept = await createWorkspace(client, join(tempDir(), "datavis"), { workspace_type: "moderation" });
  expect((await client.listWorkspaces()).workspaces[0]).toMatchObject({ in_workspaces_folder: false });
  const moved = await client.moveWorkspace(kept.registration_id);
  expect(moved).toEqual({ registration_id: kept.registration_id, path: join(folder, "datavis") });
  expect(existsSync(kept.path)).toBe(false);
  expect((await client.listWorkspaces()).workspaces[0]).toMatchObject({ registration_id: kept.registration_id, in_workspaces_folder: true, problem: null });
  const ws = await openWorkspace(new NodeFileSystem(moved.path), client);
  expect(ws.registration.registration_id).toBe(kept.registration_id);
});

test("a refused move says why, and changes nothing", async () => {
  const { client } = realProxy();
  const kept = await createWorkspace(client, join(tempDir(), "datavis"), { workspace_type: "moderation" });
  await client.moveWorkspace(kept.registration_id);
  await expect(client.moveWorkspace(kept.registration_id)).rejects.toThrow("already in the workspaces folder"); // moved once already
  await expect(client.moveWorkspace("ws-nothing")).rejects.toThrow(/not registered/);
});

const inFolder = (folder: string, extra: Partial<ListedWorkspace> = {}) => listed({ registration_id: `ws-${folder}`, folder, name: folder, in_workspaces_folder: true, ...extra });

test("a workspace keeps its folder's name when it is free, and is told when it is used or can't be a name", () => {
  expect(moveNameProblem(listed({}), [inFolder("Other")])).toBeNull();
  expect(moveNameProblem(listed({}), [inFolder("datavis")])).toBe("A workspace called datavis is already in the workspaces folder. Give this one another name there.");
  expect(moveNameProblem(listed({}), [inFolder("DATAVIS")])).not.toBeNull(); // the same folder on a system that ignores case
  expect(moveNameProblem(listed({ folder: "data~vis" }), [])).toMatch(/^Its folder's name can't be used in the workspaces folder: a name can have only letters/);
});

test("only names directly in the workspaces folder count as used: an assessment is inside its module, and one kept elsewhere is not there", () => {
  expect(moveNameProblem(listed({}), [inFolder("datavis", { module: "CS101" })])).toBeNull();
  expect(moveNameProblem(listed({}), [listed({ registration_id: "ws-2", folder: "datavis" })])).toBeNull(); // itself, or another kept elsewhere
});

test("a name to offer is its own with a number, the first not in use, and always a name the proxy accepts", () => {
  expect(suggestName(listed({}), [inFolder("datavis")])).toBe("datavis 2");
  expect(suggestName(listed({}), [inFolder("datavis"), inFolder("datavis 2"), inFolder("datavis 3")])).toBe("datavis 4");
  expect(suggestName(listed({ folder: "data~vis" }), [])).toBe("datavis 2");
  expect(suggestName(listed({ folder: ".hidden" }), [])).toBe("hidden 2");
  expect(suggestName(listed({ folder: "~~~" }), [])).toBe("Workspace 2");
});

test("moving with a new name through the client gives the folder and its recorded name that name", async () => {
  const { client, folder } = realProxy();
  const made = await createWorkspace(client, join(tempDir(), "datavis"), { workspace_type: "moderation" });
  const moved = await client.moveWorkspace(made.registration_id, "datavis review");
  expect(moved.path).toBe(join(folder, "datavis review"));
  expect((await client.listWorkspaces()).workspaces[0]).toMatchObject({ name: "datavis review", folder: "datavis review", in_workspaces_folder: true });
  await expect(client.moveWorkspace(made.registration_id, "x")).rejects.toThrow("already in the workspaces folder");
});
