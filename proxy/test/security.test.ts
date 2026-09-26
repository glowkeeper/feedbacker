/** Localhost hardening: Host, Origin and the session token; headers; and what is served. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CSP } from "../src/security.ts";
import { makeProxy, ORIGIN, PORT, tempDir } from "./helpers.ts";

describe("requests are refused", () => {
  const { call } = makeProxy();

  test.each([
    ["from another Host (DNS rebinding)", { host: "evil.example.com" }, 403],
    ["from the right host on another port", { host: `127.0.0.1:${PORT + 1}` }, 403],
    ["without an Origin", { origin: "" }, 403],
    ["from another Origin", { origin: "http://evil.example.com" }, 403],
    ["from a lookalike Origin", { origin: `${ORIGIN}.evil.example.com` }, 403],
    ["without the session token", { authorization: "" }, 401],
    ["with the wrong session token", { authorization: "Bearer not-the-token" }, 401],
    ["with the token in the wrong scheme", { authorization: "test-session-token-0123456789abcdef" }, 401],
  ])("%s", async (_, headers, status) => {
    const res = await call("/api/health", { headers });
    expect(res.status).toBe(status);
    expect(JSON.stringify(await res.json())).not.toContain("key_configured");
  });

  test("even the app is not served to another Host", async () => {
    expect((await call("/", { headers: { host: "evil.example.com" } })).status).toBe(403);
  });
});

describe("requests are allowed", () => {
  const { call } = makeProxy();

  test("from the app's origin with the token, on either localhost name", async () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`]) {
      const res = await call("/api/health", { headers: { host, origin: `http://${host}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, key_configured: true });
    }
  });

  test("the app's pages need no token (the token lives in the URL fragment)", async () => {
    const res = await call("/", { headers: { authorization: "", origin: "" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Feedbacker proxy is running");
  });
});

test("every response carries strict security headers", async () => {
  const { call } = makeProxy();
  for (const res of [await call("/"), await call("/api/health"), await call("/api/health", { headers: { authorization: "" } })]) {
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  }
  expect(CSP).toContain("connect-src 'self'");
  expect(CSP).toContain("script-src 'self'");
  expect(CSP).not.toMatch(/unsafe-(inline|eval)/);
  expect((await call("/api/health")).headers.get("cache-control")).toBe("no-store");
});

describe("serving the built app", () => {
  const dir = tempDir("proxy-app-");
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "main.js"), "console.log(1)");
  writeFileSync(join(dir, ".env"), "SECRET=1");
  writeFileSync(join(dir, "..", "outside.txt"), "outside");
  const { call } = makeProxy({ appDir: dir });

  test("serves files from the app folder", async () => {
    expect(await (await call("/")).text()).toContain("<title>app</title>");
    const js = await call("/assets/main.js");
    expect(js.headers.get("content-type")).toContain("text/javascript");
  });

  test.each(["/.env", "/../outside.txt", "/%2e%2e/outside.txt", "/assets/../../outside.txt", "/missing.js"])(
    "refuses %s",
    async (path) => {
      expect((await call(path)).status).toBe(404);
    },
  );

  test("unknown API paths are not served as files", async () => {
    expect((await call("/api/nothing")).status).toBe(404);
  });
});
