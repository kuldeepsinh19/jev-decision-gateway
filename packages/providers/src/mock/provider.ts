import {
  SIMULATED_PRICING,
  estimateCostUsd,
  estimateTokens,
  type SimulatedTier,
} from "../pricing.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../types.js";

/**
 * Fully deterministic, network-free LLMProvider used for demos/benchmarks that don't need (or
 * can't afford, in CI) a real API key. Given the same `LLMRequest.messages`, `complete()` always
 * returns the same `text`/`usage`/`latencyMs`/`costUsd` — no randomness, no clock reads, no I/O
 * of any kind. `simulated` is always `true`.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";

  constructor(private readonly tier: SimulatedTier) {}

  // Implements the async LLMProvider interface; deliberately synchronous under the hood since it
  // never does real I/O (no await inside — the `async` keyword just satisfies the interface).
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const lastUserMessage =
      [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const text = `Simulated response to: ${lastUserMessage.slice(0, 80)}`;

    const promptText = [req.system ?? "", ...req.messages.map((m) => m.content)].join("\n");
    const inputTokens = estimateTokens(promptText);
    const outputTokens = estimateTokens(text);

    const pricing = SIMULATED_PRICING[this.tier];

    return {
      text,
      usage: { inputTokens, outputTokens },
      latencyMs: pricing.avgLatencyMs,
      costUsd: estimateCostUsd(this.tier, inputTokens, outputTokens),
      simulated: true,
      model: pricing.label,
    };
  }
}
