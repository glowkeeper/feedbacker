/**
 * Start the local Feedbacker proxy: `npm start` (or `node src/main.ts`).
 *
 *   --port <n>               port on 127.0.0.1 (default 8765; 0 picks a free one)
 *   --app <dir>              the built app to serve (default: ../ui/dist if built)
 *   --data <dir>             registry and egress log (default ~/Feedbacker/proxy)
 *   --max-run-usd <n>        the highest spend limit a run may have (default 5)
 *   --egress-retention-days  how long egress entries are kept (default 90)
 *
 * It prints the app's address with a per-session token in the URL fragment.
 * Open that address; nothing else can use the proxy.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, DEFAULT_DATA_DIR, loadApiKey } from "./config.ts";
import { EgressLog } from "./egress.ts";
import { AnthropicProvider } from "./provider.ts";
import { Runs } from "./runs.ts";
import { Workspaces } from "./workspaces.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8765" },
    app: { type: "string" },
    data: { type: "string", default: DEFAULT_DATA_DIR },
    "max-run-usd": { type: "string", default: "5" },
    "egress-retention-days": { type: "string", default: "90" },
  },
});

let key: string | null;
try {
  key = loadApiKey();
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : "could not read the API key");
  process.exit(1);
}

const dataDir = values.data!;
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);
const egress = new EgressLog(join(dataDir, "egress.jsonl"), Number(values["egress-retention-days"]));
const pruneDaily = () => egress.prune(new Date());
pruneDaily();
setInterval(pruneDaily, 86_400_000).unref();

const defaultApp = new URL("../../ui/dist", import.meta.url).pathname;
const session = { token: randomBytes(32).toString("base64url"), port: 0 };
const app = createApp({
  session,
  provider: key ? new AnthropicProvider(key) : null,
  runs: new Runs(Number(values["max-run-usd"])),
  egress,
  workspaces: new Workspaces(join(dataDir, "registry.json")),
  appDir: values.app ?? (existsSync(defaultApp) ? defaultApp : null),
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(values.port) }, (info) => {
  session.port = info.port;
  console.log(`Feedbacker proxy running. Open: http://127.0.0.1:${info.port}/#token=${session.token}`);
  console.log(key ? "API key: configured" : "API key: not configured (model requests will be refused)");
  console.log(`Egress log: ${egress.path} (kept ${egress.retentionDays} days)`);
});
