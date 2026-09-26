/** The real proxy, in-process, reached through the core's HTTP client (for tests and scripts). */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../proxy/src/app.ts";
import { EgressLog } from "../../proxy/src/egress.ts";
import { Runs } from "../../proxy/src/runs.ts";
import { Workspaces } from "../../proxy/src/workspaces.ts";
import { HttpProxyClient } from "../src/core/index.ts";

export const tempDir = () => realpathSync(mkdtempSync(join(tmpdir(), "ws-test-")));

export function realProxy() {
  const data = tempDir();
  const app = createApp({
    session: { token: "t0ken", port: 8765 },
    provider: null,
    runs: new Runs(5),
    egress: new EgressLog(join(data, "egress.jsonl"), 90),
    workspaces: new Workspaces(join(data, "registry.json")),
    appDir: null,
    secrets: [],
  });
  const calls: string[] = [];
  const client = new HttpProxyClient("t0ken", {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push(`${JSON.parse(String(init.body)).action ?? "confirm"}`);
      return app.request(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), host: "127.0.0.1:8765", origin: "http://127.0.0.1:8765" },
      });
    }) as typeof fetch,
  });
  return { client, calls };
}

/** A fresh workspace, created and opened through the real proxy, on a real temporary folder. */
export async function newWorkspace(name = "mod-1") {
  const { createWorkspace, openWorkspace } = await import("../src/core/index.ts");
  const { NodeFileSystem } = await import("./nodeFileSystem.ts");
  const { client, calls } = realProxy();
  const registration = await createWorkspace(client, join(tempDir(), name));
  const ws = await openWorkspace(new NodeFileSystem(registration.path), client);
  return { ws, path: registration.path, client, calls };
}
