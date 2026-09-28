/**
 * The model provider behind the proxy. Only `AnthropicProvider` knows the
 * Anthropic SDK; outcomes and errors mirror the Python adapter
 * (`core/src/feedbacker_core/providers/anthropic.py`).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./pricing.ts";

export type Outcome = "complete" | "refused" | "truncated" | "unparsed";

/**
 * The request as it will be sent: instructions, then ordered text blocks for
 * one user turn. The first `shared_blocks` blocks (the rubric and the brief)
 * are the same for every submission of a run, so, with the instructions, they
 * form a prefix the provider may cache; only the submission differs (#25).
 */
export interface ProviderRequest {
  model: string;
  max_output_tokens: number;
  instructions: string;
  blocks: string[];
  shared_blocks: number;
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

/** How far a batch has got, as the provider reports it. */
export interface BatchStatus {
  id: string;
  status: "in_progress" | "canceling" | "ended";
  counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
  created_at: string;
  expires_at: string;
  ended_at: string | null;
}

/** One request of a batch: a result, or why there is none. */
export type BatchItemResult =
  | { custom_id: string; result: ProviderResult }
  | { custom_id: string; failed: "errored" | "canceled" | "expired"; message: string };

/**
 * The provider's model API. The batch methods are optional: a provider without
 * a discounted batch API leaves them out, and batches are refused (#25).
 */
export interface Provider {
  readonly name: string;
  read(request: ProviderRequest): Promise<ProviderResult>;
  createBatch?(items: { custom_id: string; request: ProviderRequest }[]): Promise<BatchStatus>;
  batchStatus?(id: string): Promise<BatchStatus>;
  batchResults?(id: string): Promise<BatchItemResult[]>;
  cancelBatch?(id: string): Promise<BatchStatus>;
}

/**
 * The provider's error as Feedbacker's own message: the SDK's are never passed
 * on, so nothing from the request or the key can appear in them.
 */
function providerError(error: unknown, model: string | null): ProviderError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(
      "the API key was rejected (expired, revoked, or without access); create a new key and update ~/Feedbacker/.env",
      true,
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError(model ? `model '${model}' was not found` : "the provider does not know this batch", model !== null);
  }
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError(`network error (${error.name})`);
  if (error instanceof Anthropic.APIError) return new ProviderError(`the API returned an error (${error.name}, HTTP ${error.status})`);
  return new ProviderError("the request to the provider failed");
}

function params(request: ProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: request.model,
    max_tokens: request.max_output_tokens,
    system: request.instructions,
    // The cache breakpoint ends the shared prefix (instructions, rubric, brief): each later submission reads it from the
    // provider's cache instead of paying for it in full. It sends nothing more; the provider keeps it for five minutes.
    messages: [
      {
        role: "user",
        content: request.blocks.map((text, i) =>
          i === request.shared_blocks - 1 ? { type: "text" as const, text, cache_control: { type: "ephemeral" as const } } : { type: "text" as const, text },
        ),
      },
    ],
    output_config: { format: { type: "json_schema", schema: request.output_schema } },
  };
}

function toResult(response: Anthropic.Message, requestId: string | null): ProviderResult {
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
    request_id: requestId,
    stop_reason: response.stop_reason ?? null,
    usage,
    raw_json: JSON.stringify(response),
  };
}

function toStatus(batch: Anthropic.Messages.MessageBatch): BatchStatus {
  const c = batch.request_counts;
  return {
    id: batch.id,
    status: batch.processing_status,
    counts: { processing: c.processing, succeeded: c.succeeded, errored: c.errored, canceled: c.canceled, expired: c.expired },
    created_at: batch.created_at,
    expires_at: batch.expires_at,
    ended_at: batch.ended_at,
  };
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
      response = await this.#client.messages.create(params(request));
    } catch (error) {
      throw providerError(error, request.model);
    }
    return toResult(response, (response as { _request_id?: string | null })._request_id ?? null);
  }

  async createBatch(items: { custom_id: string; request: ProviderRequest }[]): Promise<BatchStatus> {
    try {
      return toStatus(await this.#client.messages.batches.create({ requests: items.map((i) => ({ custom_id: i.custom_id, params: params(i.request) })) }));
    } catch (error) {
      throw providerError(error, items.length ? items[0].request.model : null);
    }
  }

  async batchStatus(id: string): Promise<BatchStatus> {
    try {
      return toStatus(await this.#client.messages.batches.retrieve(id));
    } catch (error) {
      throw providerError(error, null);
    }
  }

  async cancelBatch(id: string): Promise<BatchStatus> {
    try {
      return toStatus(await this.#client.messages.batches.cancel(id));
    } catch (error) {
      throw providerError(error, null);
    }
  }

  async batchResults(id: string): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = [];
    try {
      for await (const item of await this.#client.messages.batches.results(id)) {
        const r = item.result;
        // A batched message has no HTTP request of its own, so its message id is the reference to it.
        if (r.type === "succeeded") results.push({ custom_id: item.custom_id, result: toResult(r.message, r.message.id ?? null) });
        else if (r.type === "errored") results.push({ custom_id: item.custom_id, failed: "errored", message: `the provider could not process this request (${r.error.error?.type ?? "error"})` });
        else results.push({ custom_id: item.custom_id, failed: r.type, message: r.type === "expired" ? "the batch expired before this request was processed" : "the batch was cancelled before this request was processed" });
      }
    } catch (error) {
      throw providerError(error, null);
    }
    return results;
  }
}
