/**
 * Configuration. The API key is read only from ANTHROPIC_API_KEY, or else
 * from the private ~/Feedbacker/.env (FEEDBACKER_ENV overrides the path),
 * exactly as the Python reading does, so one key file serves both. That file
 * must be readable only by its owner.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ENV_FILE = join(homedir(), "Feedbacker", ".env");
export const DEFAULT_DATA_DIR = join(homedir(), "Feedbacker", "proxy");

export class ConfigError extends Error {}

export function loadApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const path = env.FEEDBACKER_ENV || DEFAULT_ENV_FILE;
  if (!existsSync(path)) return null;
  if (statSync(path).mode & 0o077) throw new ConfigError(`${path} is readable by other users; run: chmod 600 ${path}`);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq).trim() === "ANTHROPIC_API_KEY") {
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (value) return value;
    }
  }
  return null;
}
