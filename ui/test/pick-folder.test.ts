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
