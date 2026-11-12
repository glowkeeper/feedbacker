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
/** Where the app's workspaces are made, by name (ADR 0008). */
export const DEFAULT_WORKSPACES_DIR = join(homedir(), "Feedbacker", "workspaces");

export class ConfigError extends Error {}

/** A setting from the environment, or else from the private env file (which must be readable only by its owner). */
export function loadSetting(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env[name]?.trim();
  if (fromEnv) return fromEnv;
  const path = env.FEEDBACKER_ENV || DEFAULT_ENV_FILE;
  if (!existsSync(path)) return null;
  if (statSync(path).mode & 0o077) throw new ConfigError(`${path} is readable by other users; run: chmod 600 ${path}`);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq).trim() === name) {
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (value) return value;
    }
  }
  return null;
}

export const loadApiKey = (env: NodeJS.ProcessEnv = process.env): string | null => loadSetting("ANTHROPIC_API_KEY", env);

/**
 * The highest spend limit any run may have, if one is set (`--max-run-usd`, or FEEDBACKER_MAX_RUN_USD in the environment or the private env file); none otherwise,
 * so the limit chosen in the app is the only one. A ceiling is for an institution running the proxy for others, or for anyone who wants one the app can't raise.
 */
export function loadMaxRunUsd(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  return flag ?? loadSetting("FEEDBACKER_MAX_RUN_USD", env);
}
