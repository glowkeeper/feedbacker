/**
 * Prices and worst-case estimates, so the spend limit can be enforced before
 * a request is sent (ADR 0003).
 *
 * USD per million tokens, from Anthropic's published first-party rates.
 * Cache writes (5-minute TTL) cost 1.25x the input price; cache reads cost
 * 0.1x, except where a model's rate is lower. A model without a price is
 * refused, because its spend couldn't be bounded.
 */

export interface Price {
  input: number;
  output: number;
  cacheRead: number; // multiplier on the input price
}

export const CACHE_WRITE = 1.25;

export const PRICES: Record<string, Price> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.05 }, // $0.20/MTok
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.025 }, // $0.25/MTok
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export function cost(model: string, usage: Usage): number {
  const p = PRICES[model];
  const billedInput =
    usage.input_tokens + CACHE_WRITE * usage.cache_write_tokens + p.cacheRead * usage.cache_read_tokens;
  return (billedInput * p.input + usage.output_tokens * p.output) / 1_000_000;
}

/** Deliberately high: input at 3 characters a token (as the Python reading estimates), output at its maximum. */
export const CHARS_PER_TOKEN = 3;

export function worstCase(model: string, inputChars: number, maxOutputTokens: number): number {
  const p = PRICES[model];
  return (Math.ceil(inputChars / CHARS_PER_TOKEN) * p.input + maxOutputTokens * p.output) / 1_000_000;
}
