/**
 * Localhost hardening (ADR 0004).
 *
 * - The server binds to 127.0.0.1 only (see main.ts).
 * - Every request must carry a Host of 127.0.0.1 or localhost on the proxy's
 *   own port, which defeats DNS rebinding.
 * - API requests must also come from the app's own origin and carry the
 *   per-session token, which the proxy prints at start-up in the app's URL
 *   fragment (the fragment is never sent to any server).
 * - Every response gets strict security headers, including a Content
 *   Security Policy that lets the app connect only to the proxy.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export interface Session {
  token: string;
  /** Filled in once the port is known. */
  port: number;
}

const allowedHosts = (s: Session) => [`127.0.0.1:${s.port}`, `localhost:${s.port}`];

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
};

export const hostCheck = (session: Session): MiddlewareHandler => async (c, next) => {
  if (!allowedHosts(session).includes(c.req.header("host") ?? "")) {
    return c.json({ error: { type: "forbidden", message: "wrong Host header" } }, 403);
  }
  await next();
};

export const apiGuard = (session: Session): MiddlewareHandler => async (c, next) => {
  const origin = c.req.header("origin");
  if (!origin || !allowedHosts(session).map((h) => `http://${h}`).includes(origin)) {
    return c.json({ error: { type: "forbidden", message: "requests must come from the Feedbacker app" } }, 403);
  }
  const auth = c.req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !sameToken(auth.slice(7), session.token)) {
    return c.json({ error: { type: "unauthorised", message: "missing or wrong session token" } }, 401);
  }
  await next();
  c.header("Cache-Control", "no-store");
};
