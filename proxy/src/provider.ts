/**
 * The model provider behind the proxy. Only `AnthropicProvider` knows the
 * Anthropic SDK; outcomes and errors mirror the Python adapter
 * (`core/src/feedbacker_core/providers/anthropic.py`).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./pricing.ts";

export type Outcome = "complete" | "refused" | "truncated" | "unparsed";

/** The request as it will be sent: instructions, then ordered text blocks for one user turn. */
export interface ProviderRequest {
  model: string;
  max_output_tokens: number;
  instructions: string;
  blocks: string[];
  output_schema: Record<string, unknown>;
}

export interface ProviderResult {
  outcome: Outcome;
  parsed: unknown;
  model_reported: string | null;
  request_id: string | null;
  stop_reason: string | null;
  usage: Usage;
  raw_json: string;
}

/** A call failed. `fatal` errors (a rejected key, an unknown model) should stop the run. */
export class ProviderError extends Error {
  readonly fatal: boolean;

  constructor(message: string, fatal = false) {
    super(message);
    this.name = "ProviderError";
    this.fatal = fatal;
  }
}

export interface Provider {
  readonly name: string;
  read(request: ProviderRequest): Promise<ProviderResult>;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly #client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.#client = client ?? new Anthropic({ apiKey });
  }

  async read(request: ProviderRequest): Promise<ProviderResult> {
    let response: Anthropic.Message;
    try {
      response = await this.#client.messages.create({
        model: request.model,
        max_tokens: request.max_output_tokens,
        system: request.instructions,
        messages: [{ role: "user", content: request.blocks.map((text) => ({ type: "text" as const, text })) }],
        output_config: { format: { type: "json_schema", schema: request.output_schema } },
      });
    } catch (error) {
      // Messages are Feedbacker's own; the SDK's are never passed on, so nothing
      // from the request or the key can appear in them.
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError(
          "the API key was rejected (expired, revoked, or without access); create a new key and update ~/Feedbacker/.env",
          true,
        );
      }
      if (error instanceof Anthropic.NotFoundError) throw new ProviderError(`model '${request.model}' was not found`, true);
      if (error instanceof Anthropic.APIConnectionError) throw new ProviderError(`network error (${error.name})`);
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError(`the API returned an error (${error.name}, HTTP ${error.status})`);
      }
      throw new ProviderError("the request to the provider failed");
    }

    const u = response.usage;
    const usage: Usage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_tokens: u.cache_read_input_tokens ?? 0,
      cache_write_tokens: u.cache_creation_input_tokens ?? 0,
    };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed: unknown = null;
    let outcome: Outcome;
    if (response.stop_reason === "refusal") outcome = "refused";
    else if (response.stop_reason === "max_tokens") outcome = "truncated";
    else {
      try {
        parsed = JSON.parse(text);
        outcome = "complete";
      } catch {
        outcome = "unparsed";
      }
    }
    return {
      outcome,
      parsed,
      model_reported: response.model ?? null,
      request_id: (response as { _request_id?: string | null })._request_id ?? null,
      stop_reason: response.stop_reason ?? null,
      usage,
      raw_json: JSON.stringify(response),
    };
  }
}
