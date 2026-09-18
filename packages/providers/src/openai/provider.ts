import { OpenAI } from "openai";

import { estimateRealCostUsd } from "../pricing.js";
import { MissingApiKeyError, type LLMProvider, type LLMRequest, type LLMResponse } from "../types.js";

export interface OpenAIProviderConfig {
  /** default: process.env.OPENAI_API_KEY */
  apiKey?: string;
  /** OpenAI model id, e.g. "gpt-4o" or "gpt-4o-mini". Used both for the real API call and for
   * the real-pricing lookup in pricing.ts (see estimateRealCostUsd). */
  model: string;
}

/**
 * Real OpenAI-backed LLMProvider. The real `OpenAI` client is deliberately constructed lazily,
 * inside `complete()`, never in the constructor — so `new OpenAIProvider({ model: "gpt-4o" })`
 * with no key never throws. `complete()` resolves the API key itself (explicit config, else
 * `process.env.OPENAI_API_KEY`) and throws `MissingApiKeyError` immediately when neither is
 * present, BEFORE the `OpenAI` client is ever constructed or touched.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  constructor(private readonly config: OpenAIProviderConfig) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new MissingApiKeyError("OpenAIProvider");
    }

    // CONFIRMED (node_modules/openai/client.d.mts ClientOptions.apiKey): accepts a plain string;
    // defaults to process.env['OPENAI_API_KEY'] itself, but we resolve it ourselves above so we
    // can throw MissingApiKeyError (not a generic OpenAIError) before ever constructing the client.
    const client = new OpenAI({ apiKey });

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
      ...req.messages,
    ];

    const start = Date.now();
    const response = await client.chat.completions.create({
      model: this.config.model,
      messages,
      // CONFIRMED (resources/chat/completions/completions.d.mts): `max_tokens` is deprecated in
      // favor of `max_completion_tokens`; we map LLMRequest.maxTokens onto the non-deprecated field.
      max_completion_tokens: req.maxTokens,
      temperature: req.temperature,
    });
    const latencyMs = Date.now() - start;

    // CONFIRMED (resources/chat/completions/completions.d.mts `ChatCompletion.usage?`): `usage`
    // is optional on the real response type, so we fall back to 0 rather than assume it is set.
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    // CONFIRMED (`ChatCompletionMessage.content: string | null`): a refusal or empty completion
    // can come back with `content: null`; we normalize that to an empty string.
    const text = response.choices[0]?.message.content ?? "";

    return {
      text,
      usage: { inputTokens, outputTokens },
      latencyMs,
      costUsd: estimateRealCostUsd("openai", this.config.model, inputTokens, outputTokens),
      simulated: false,
      model: response.model,
    };
  }
}
