/** The per-run spend limit (ADR 0003) is enforced in the proxy. */

import { describe, expect, test } from "vitest";
import { cost, PRICES, worstCase } from "../src/pricing.ts";
import { ProviderError } from "../src/provider.ts";
import { FakeProvider, makeProxy, readRequest, type JsonResponse } from "./helpers.ts";

describe("opening a run", () => {
  const { call } = makeProxy({ maxRunUsd: 5 });
  const open = (body: unknown) => call("/api/runs", { body });

  test("needs the moderator's confirmation of the estimate", async () => {
    const res = await open({ limit_usd: 5, estimate_usd: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("confirmed");
  });

  test.each([
    [{ limit_usd: 5, estimate_usd: 6, confirmed: true }, "exceeds the run's spend limit"],
    [{ limit_usd: 0, estimate_usd: 0, confirmed: true }, "greater than 0"],
    [{ limit_usd: 50, estimate_usd: 1, confirmed: true }, "above this proxy's maximum of $5"],
  ])("refuses %j", async (body, message) => {
    const res = await open(body);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain(message);
  });

  test("returns the run with nothing spent", async () => {
    const res = await open({ limit_usd: 2, estimate_usd: 1.5, confirmed: true });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ limit_usd: 2, estimate_usd: 1.5, spent_usd: 0 });
  });

  test("a request needs an open run", async () => {
    const res = await call("/api/runs/run-nope/read", { body: readRequest() });
    expect(res.status).toBe(409);
  });
});

describe("during a run", () => {
  // Sonnet 5 at 16,000 output tokens is $0.16 worst case, plus the input.
  const worst = () => worstCase("claude-sonnet-5", 300, 16000);

  test("a request whose worst case would exceed the limit is refused before it is sent", async () => {
    const { call, openRun, provider, egress } = makeProxy();
    const run = await openRun(0.1, 0.05);
    const res = await call(`/api/runs/${run}/read`, { body: readRequest() });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ type: "spend" });
    expect((provider as FakeProvider).calls).toHaveLength(0);
    expect(egress.entries()).toMatchObject([{ outcome: "refused_by_proxy", refusal: "spend" }]);
  });

  test("actual costs accumulate until the limit stops the run", async () => {
    const { call, openRun, provider } = makeProxy();
    const run = await openRun(0.4, 0.4);
    const spent: number[] = [];
    let last: JsonResponse;
    for (;;) {
      last = await call(`/api/runs/${run}/read`, { body: readRequest() });
      if (last.status !== 200) break;
      spent.push((await last.json()).run.spent_usd);
    }
    const each = cost("claude-sonnet-5", { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 });
    expect(spent.length).toBeGreaterThan(1);
    expect(spent.at(-1)).toBeCloseTo(each * spent.length, 10);
    // The run stopped because one more worst case wouldn't fit, and never went over.
    expect(last.status).toBe(409);
    expect((await last.json()).error.type).toBe("spend");
    expect(spent.at(-1)! + worst()).toBeGreaterThan(0.4);
    expect(spent.at(-1)!).toBeLessThanOrEqual(0.4);
    expect((provider as FakeProvider).calls).toHaveLength(spent.length);
    expect((await (await call(`/api/runs/${run}`)).json()).spent_usd).toBeCloseTo(spent.at(-1)!, 10);
  });

  test("concurrent requests can't overrun the limit together", async () => {
    const { call, openRun, provider } = makeProxy();
    const run = await openRun(worst() * 1.5, worst());
    const results = await Promise.all([1, 2, 3].map(() => call(`/api/runs/${run}/read`, { body: readRequest() })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((provider as FakeProvider).calls).toHaveLength(1);
  });

  test("a failed call costs nothing and releases its reservation", async () => {
    const provider = new FakeProvider();
    provider.result = new ProviderError("the API key was rejected", true);
    const { call, openRun, egress } = makeProxy({ provider });
    const run = await openRun(worst() * 1.5, worst());
    const res = await call(`/api/runs/${run}/read`, { body: readRequest() });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ type: "provider", message: "the API key was rejected", fatal: true });
    provider.result = {};
    expect((await call(`/api/runs/${run}/read`, { body: readRequest() })).status).toBe(200);
    expect(egress.entries().map((e) => e.outcome)).toEqual(["provider_error", "complete"]);
  });
});

test("cache reads and writes are priced per model", () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000, cache_write_tokens: 0 };
  expect(cost("claude-fable-5-1", usage)).toBeCloseTo(0.25, 10);
  expect(cost("claude-opus-5-5", usage)).toBeCloseTo(0.2, 10);
  expect(cost("claude-sonnet-5", usage)).toBeCloseTo(0.2, 10);
  expect(cost("claude-sonnet-5", { ...usage, cache_read_tokens: 0, cache_write_tokens: 1_000_000 })).toBeCloseTo(2.5, 10);
  expect(Object.keys(PRICES)).toContain("claude-opus-5");
});
