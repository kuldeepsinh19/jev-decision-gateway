/**
 * Provider-agnostic LLM request/response types shared by every provider implementation in this
 * package (Mock, OpenAI, Anthropic). Deliberately minimal — see the plan's provider-agnostic
 * design goal: one shared interface, lean implementations behind it, nothing more.
 */

/** A single chat turn. Only "user"/"assistant" are accepted here; a system prompt is carried
 * separately on `LLMRequest.system` so each provider can map it onto its own SDK's convention
 * (OpenAI: a `system` message in the array; Anthropic: a top-level `system` param). */
export interface LLMRequest {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  text: string;
  usage: LLMUsage;
  latencyMs: number;
  costUsd: number;
  /** true for MockProvider (always), false for OpenAIProvider/AnthropicProvider (always) — a
   * real SDK call happened iff this is false. Never presented as measured/live when true. */
  simulated: boolean;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

/**
 * Thrown by `OpenAIProvider.complete()` / `AnthropicProvider.complete()` when no API key is
 * resolvable (neither an explicit `apiKey` in the provider's config nor the relevant
 * `*_API_KEY` environment variable). Thrown BEFORE the real SDK client is ever constructed or
 * touched, so callers can distinguish "misconfigured, no key" from a generic SDK/network error.
 */
export class MissingApiKeyError extends Error {
  constructor(providerName: string) {
    super(
      `${providerName}: no API key configured (set an explicit apiKey or the provider's API key environment variable)`
    );
    this.name = "MissingApiKeyError";
    // Restore the prototype chain — necessary when targeting ES2022 classes extending built-ins
    // through some transpilation/bundling paths so `instanceof MissingApiKeyError` keeps working.
    Object.setPrototypeOf(this, MissingApiKeyError.prototype);
  }
}
