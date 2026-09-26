/**
 * The local Feedbacker proxy (ADR 0004): the only way anything leaves the
 * machine, and the only holder of the API key.
 *
 * API (all under /api, same-origin with the session token):
 *   GET  /api/health                  whether a key is configured
 *   POST /api/runs                    open a run: { limit_usd, estimate_usd, confirmed: true }
 *   GET  /api/runs/:id                a run's limit and spend
 *   POST /api/runs/:id/read           send one reading request (see boundary.ts)
 *   POST /api/workspaces              { action: "create" | "register", path }
 *   POST /api/workspaces/confirm      { registration_id }
 * Everything else serves the app.
 */

import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import * as z from "zod";
import { checkBoundary, checkLeaks, ReadRequest, Refusal, renderBlock } from "./boundary.ts";
import type { EgressLog } from "./egress.ts";
import { cost, PRICES, worstCase } from "./pricing.ts";
import { ProviderError, type Provider, type ProviderRequest } from "./provider.ts";
import type { Runs } from "./runs.ts";
import { apiGuard, hostCheck, securityHeaders, type Session } from "./security.ts";
import { serveApp } from "./static.ts";
import type { Workspaces } from "./workspaces.ts";

export interface Deps {
  session: Session;
  /** Null when no key is configured: workspaces still work, model requests are refused. */
  provider: Provider | null;
  runs: Runs;
  egress: EgressLog;
  workspaces: Workspaces;
  appDir: string | null;
  now?: () => Date;
}

const OpenRun = z.strictObject({
  limit_usd: z.number(),
  estimate_usd: z.number(),
  confirmed: z.literal(true, { message: "the moderator must confirm the estimate before a run opens" }),
});
const WorkspaceAction = z.strictObject({ action: z.enum(["create", "register"]), path: z.string().min(1) });
const Confirm = z.strictObject({ registration_id: z.string().min(1).max(100) });

const STATUS: Record<Refusal["type"], 409 | 422 | 503> = {
  boundary: 422,
  leak: 422,
  model: 422,
  run: 409,
  spend: 409,
  key: 503,
};

const refused = (c: Context, r: Refusal) => c.json({ error: { type: r.type, message: r.message } }, STATUS[r.type]);

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw new Refusal("boundary", "the request body is not JSON");
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    throw new Refusal("boundary", `the request is not allowed: ${issues.join("; ")}`);
  }
  return result.data;
}

const sha256Json = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const codePoints = (s: string) => [...s].length;

export function createApp(deps: Deps): Hono {
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.use("*", securityHeaders, hostCheck(deps.session));
  app.use("/api/*", apiGuard(deps.session));

  app.onError((err, c) => {
    if (err instanceof Refusal) return refused(c, err);
    // Never echo internals: they could carry request content.
    return c.json({ error: { type: "internal", message: "the proxy failed to handle the request" } }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, key_configured: deps.provider !== null, models: Object.keys(PRICES) }));

  app.post("/api/runs", async (c) => {
    const { limit_usd, estimate_usd } = await body(c, OpenRun);
    const run = deps.runs.open(limit_usd, estimate_usd, now());
    return c.json(run, 201);
  });

  app.get("/api/runs/:id", (c) => c.json(deps.runs.get(c.req.param("id"))));

  app.post("/api/runs/:id/read", async (c) => {
    const time = now();
    const run = deps.runs.get(c.req.param("id"));
    let request: ReadRequest | null = null;
    const refuse = (r: Refusal) => {
      deps.egress.record({
        time: time.toISOString(),
        run_id: run.id,
        model: request?.model ?? null,
        prompt_version: request?.prompt.version ?? null,
        request_sha256: null,
        outcome: "refused_by_proxy",
        refusal: r.type,
        usage: null,
        cost_usd: null,
      });
      return refused(c, r);
    };

    try {
      request = await body(c, ReadRequest);
      if (!deps.provider) throw new Refusal("key", "no API key is configured: set ANTHROPIC_API_KEY or put it in ~/Feedbacker/.env");
      if (!(request.model in PRICES)) {
        throw new Refusal("model", `no price is known for model '${request.model}', so its spend can't be bounded; known: ${Object.keys(PRICES).join(", ")}`);
      }
      checkBoundary(request);
      checkLeaks(request);
    } catch (err) {
      if (err instanceof Refusal) return refuse(err);
      throw err;
    }

    const outgoing: ProviderRequest = {
      model: request.model,
      max_output_tokens: request.max_output_tokens,
      instructions: request.prompt.instructions,
      blocks: request.blocks.map(renderBlock),
      output_schema: request.output_schema,
    };
    const requestSha256 = sha256Json(outgoing);
    const chars = codePoints(outgoing.instructions) + outgoing.blocks.reduce((n, b) => n + codePoints(b), 0);
    const worst = worstCase(request.model, chars, request.max_output_tokens);
    try {
      deps.runs.reserve(run, worst);
    } catch (err) {
      if (err instanceof Refusal) return refuse(err);
      throw err;
    }

    try {
      const result = await deps.provider!.read(outgoing);
      const spent = cost(request.model, result.usage);
      deps.runs.settle(run, worst, spent);
      deps.egress.record({
        time: time.toISOString(),
        run_id: run.id,
        model: request.model,
        prompt_version: request.prompt.version,
        request_sha256: requestSha256,
        outcome: result.outcome,
        refusal: null,
        usage: result.usage,
        cost_usd: spent,
      });
      return c.json({
        ...result,
        provider: deps.provider!.name,
        request_sha256: requestSha256,
        cost_usd: spent,
        run: { id: run.id, limit_usd: run.limit_usd, spent_usd: run.spent_usd },
      });
    } catch (err) {
      deps.runs.settle(run, worst, 0);
      const message = err instanceof ProviderError ? err.message : "the request to the provider failed";
      const fatal = err instanceof ProviderError ? err.fatal : false;
      deps.egress.record({
        time: time.toISOString(),
        run_id: run.id,
        model: request.model,
        prompt_version: request.prompt.version,
        request_sha256: requestSha256,
        outcome: "provider_error",
        refusal: null,
        usage: null,
        cost_usd: 0,
      });
      return c.json({ error: { type: "provider", message, fatal } }, 502);
    }
  });

  app.post("/api/workspaces", async (c) => {
    const { action, path } = await body(c, WorkspaceAction);
    const registration = action === "create" ? deps.workspaces.create(path, now()) : deps.workspaces.register(path, now());
    return c.json({ registration_id: registration.id, path: registration.path }, 201);
  });

  app.post("/api/workspaces/confirm", async (c) => {
    const { registration_id } = await body(c, Confirm);
    return c.json(deps.workspaces.confirm(registration_id));
  });

  app.all("/api/*", (c) => c.json({ error: { type: "not_found", message: "no such endpoint" } }, 404));
  app.get("*", serveApp(deps.appDir));
  return app;
}
