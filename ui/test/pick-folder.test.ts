/** Closing the folder picker is told apart from other failures that share the browser's AbortError name. */

import { afterEach, expect, test, vi } from "vitest";
import { NoFolderChosen } from "../src/core/index.ts";
import { pickWorkspaceFolder } from "../src/platform/browserFileSystem.ts";

afterEach(() => vi.unstubAllGlobals());

const withPicker = (picker: () => Promise<unknown>) => vi.stubGlobal("window", { showDirectoryPicker: picker });

test("a closed picker is NoFolderChosen", async () => {
  withPicker(() => Promise.reject(new DOMException("The user aborted a request.", "AbortError")));
  await expect(pickWorkspaceFolder()).rejects.toBeInstanceOf(NoFolderChosen);
});

test("other errors from the picker are left as they are", async () => {
  const denied = new DOMException("", "SecurityError");
  withPicker(() => Promise.reject(denied));
  await expect(pickWorkspaceFolder()).rejects.toBe(denied);
});

test("the workspaces folder and a workspace kept elsewhere each have their own picker, so the second doesn't open where the first was chosen", async () => {
  const ids: unknown[] = [];
  withPicker(((options: { id: string }) => (ids.push(options.id), Promise.resolve({}))) as never);
  await pickWorkspaceFolder();
  await pickWorkspaceFolder("workspaces");
  await pickWorkspaceFolder("elsewhere");
  expect(ids).toEqual(["feedbacker-workspace", "feedbacker-workspace", "feedbacker-elsewhere"]);
});
