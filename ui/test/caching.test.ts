/** The estimate with prompt caching (#25): the shared prefix is written once, then read at the cache price; the worst case still bounds everything. */

import { expect, test } from "vitest";
import { cachedEstimate, estimate, estimatedCost, planReadings, type ProxyHealth } from "../src/core/index.ts";
import { setUpModeration } from "./moderation.ts";

const prices: ProxyHealth["prices"] = {
  "claude-sonnet-5": { input: 2, output: 10, cache_read: 0.1, cache_write: 1.25 },
  "claude-opus-5": { input: 5, output: 25, cache_read: 0.1, cache_write: 1.25 },
};
const proxy = { health: async (): Promise<ProxyHealth> => ({ key_configured: true, provider: "anthropic", prices }) } as unknown as Parameters<typeof planReadings>[1];

test("the worst case bills every input token as a cache write, as the proxy reserves it", async () => {
  const { ws } = await setUpModeration("mod-cache-1");
  const plan = await planReadings(ws, proxy, null, { replace: true, fallback: false });
  const [r] = plan.readings;
  expect(estimate(prices, r.request)[2]).toBeCloseTo((r.tokensIn * 2 * 1.25 + r.tokensOut * 10) / 1_000_000, 12);
});

test("with caching, the shared prefix costs a write once and a read after that, never more than the worst case", async () => {
  const { ws } = await setUpModeration("mod-cache-2");
  const plan = await planReadings(ws, proxy, null, { replace: true });
  expect(plan.readings).toHaveLength(2);
  const cached = cachedEstimate(prices, plan.readings);
  expect(cached).toBeLessThan(estimatedCost(plan));
  // By hand: the prefix is everything but the submission block and the output schema.
  const [a, b] = plan.readings;
  const prefixOf = (r: typeof a) =>
    Math.ceil(([...r.request.prompt.instructions].length + r.request.blocks.filter((x) => x.kind !== "submission").reduce((n, x) => n + [...`${x.heading}\n\n${x.text}`].length, 0)) / 3);
  const cost = (r: typeof a, rate: number) => (prefixOf(r) * 2 * rate + (r.tokensIn - prefixOf(r)) * 2 + r.tokensOut * 10) / 1_000_000 + r.fallbackCost;
  expect(cached).toBeCloseTo(cost(a, 1.25) + cost(b, 0.1), 12);
  // Without cache prices (a proxy that doesn't give them), nothing is assumed about caching.
  const plain = Object.fromEntries(Object.entries(prices).map(([m, p]) => [m, { input: p.input, output: p.output }]));
  expect(cachedEstimate(plain, plan.readings)).toBeGreaterThan(cached);
});
