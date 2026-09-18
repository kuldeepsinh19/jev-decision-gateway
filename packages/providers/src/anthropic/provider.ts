import { Anthropic } from "@anthropic-ai/sdk";

import { estimateRealCostUsd } from "../pricing.js";
import { MissingApiKeyError, type LLMProvider, type LLMRequest, type LLMResponse } from "../types.js";

export interface AnthropicProviderConfig {
  /** default: process.env.ANTHROPIC_API_KEY */
  apiKey?: string;
  /** Anthropic model id, e.g. "claude-sonnet-4-5". Used both for the real API call and for the
   * real-pricing lookup in pricing.ts (see estimateRealCostUsd). */
  model: string;
}

/**
 * Real Anthropic-backed LLMProvider. The real `Anthropic` client is deliberately constructed
 * lazily, inside `complete()`, never in the constructor — so `new AnthropicProvider({ model:
 * "claude-sonnet-4-5" })` with no key never throws. `complete()` resolves the API key itself
 * (explicit config, else `process.env.ANTHROPIC_API_KEY`) and throws `MissingApiKeyError`
 * immediately when neither is present, BEFORE the `Anthropic` client is ever constructed or
 * touched.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  constructor(private readonly config: AnthropicProviderConfig) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new MissingApiKeyError("AnthropicProvider");
    }

    // CONFIRMED (node_modules/@anthropic-ai/sdk/client.d.mts ClientOptions.apiKey): accepts a
    // plain string; defaults to process.env['ANTHROPIC_API_KEY'] itself, but we resolve it
    // ourselves above so we can throw MissingApiKeyError (not a generic AnthropicError) before
    // ever constructing the client.
    const client = new Anthropic({ apiKey });

    // CONFIRMED (resources/messages/messages.d.mts MessageCreateParamsBase.max_tokens): unlike
    // OpenAI's (deprecated) max_tokens, Anthropic's `max_tokens` is REQUIRED, not optional — we
    // fall back to a sane default when the caller didn't set LLMRequest.maxTokens.
    const maxTokens = req.maxTokens ?? 1024;

    const start = Date.now();
    const response = await client.messages.create({
      model: this.config.model,
      system: req.system,
      messages: req.messages,
      max_tokens: maxTokens,
      temperature: req.temperature,
    });
    const latencyMs = Date.now() - start;

    // CONFIRMED (resources/messages/messages.d.mts `Message.usage: Usage`, `Usage.input_tokens:
    // number` / `output_tokens: number`): both non-nullable on the real response type.
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    // CONFIRMED (`Message.content: Array<ContentBlock>`): a real response can mix content block
    // types (text, tool_use, thinking, ...); we join only the `text` blocks' text.
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      usage: { inputTokens, outputTokens },
      latencyMs,
      costUsd: estimateRealCostUsd("anthropic", this.config.model, inputTokens, outputTokens),
      simulated: false,
      model: response.model,
    };
  }
}
