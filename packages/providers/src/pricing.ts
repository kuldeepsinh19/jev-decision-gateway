/**
 * All dollar figures in this file are either:
 *  - SIMULATED (the `SIMULATED_PRICING` table): made-up inputs for MockProvider demos/benchmarks,
 *    never live-fetched, never measured from a real call; or
 *  - REAL but STATIC list prices (the `REAL_*_PRICING` tables): the real, currently-published
 *    per-token prices for real OpenAI/Anthropic models, used only to ESTIMATE `costUsd` for a
 *    real completion from its real token usage. Neither the OpenAI nor the Anthropic API returns
 *    a dollar cost in its response, so this is a computed estimate against a static table, not a
 *    live price fetch or a measured invoice line.
 *
 * Every table here can go stale. Sources checked at write-time — UPDATE THE DATE below before
 * relying on any of these numbers for anything real:
 * https://openai.com/api/pricing , https://www.anthropic.com/pricing (checked 2026-09-17)
 */

export interface PricingEntry {
  inputPer1M: number;
  outputPer1M: number;
  label: string;
}

// ---- SIMULATED pricing — MockProvider only. Never presented as measured. ----
export const SIMULATED_PRICING = {
  "mock-strong": {
    inputPer1M: 2.5,
    outputPer1M: 10.0,
    avgLatencyMs: 1400,
    label: "gpt-4o-class (simulated)",
  },
  "mock-fast": {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    avgLatencyMs: 450,
    label: "gpt-4o-mini-class (simulated)",
  },
} as const;

export type SimulatedTier = keyof typeof SIMULATED_PRICING;

// ---- REAL pricing — OpenAIProvider cost estimation only. Real list prices, but a STATIC table,
// not a live fetch. Sources checked at write-time (checked 2026-09-17): https://openai.com/api/pricing
export const REAL_OPENAI_PRICING: Record<string, PricingEntry> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0, label: "gpt-4o" },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6, label: "gpt-4o-mini" },
  "gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0, label: "gpt-4.1" },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6, label: "gpt-4.1-mini" },
};

// ---- REAL pricing — AnthropicProvider cost estimation only. Real list prices, but a STATIC
// table, not a live fetch. Sources checked at write-time (checked 2026-09-17): https://www.anthropic.com/pricing
export const REAL_ANTHROPIC_PRICING: Record<string, PricingEntry> = {
  "claude-opus-4-5": { inputPer1M: 5.0, outputPer1M: 25.0, label: "claude-opus-4-5" },
  "claude-sonnet-4-5": { inputPer1M: 3.0, outputPer1M: 15.0, label: "claude-sonnet-4-5" },
  "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0, label: "claude-haiku-4-5" },
};

// Fallback used when a requested real model id isn't a recognized key in the tables above (e.g. a
// brand-new or unlisted model). Priced at the upper end of the current ranges so an unrecognized
// model is never silently UNDER-costed by this estimate.
const UNKNOWN_REAL_MODEL_PRICING: PricingEntry = {
  inputPer1M: 5.0,
  outputPer1M: 25.0,
  label: "unrecognized model (fallback pricing estimate)",
};

/** Rough, provider-agnostic heuristic (~4 chars/token for English text) — NOT a real tokenizer.
 * Good enough for demo/benchmark relative comparisons; never treat this as an exact token count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function costFromEntry(
  entry: PricingEntry,
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens / 1_000_000) * entry.inputPer1M +
    (outputTokens / 1_000_000) * entry.outputPer1M
  );
}

/** Cost estimate for a MockProvider response, from the SIMULATED_PRICING table above. */
export function estimateCostUsd(
  tier: SimulatedTier,
  inputTokens: number,
  outputTokens: number
): number {
  return costFromEntry(SIMULATED_PRICING[tier], inputTokens, outputTokens);
}

/** Cost estimate for a real OpenAIProvider/AnthropicProvider response, computed from real token
 * usage against the static REAL_*_PRICING table above (falls back to UNKNOWN_REAL_MODEL_PRICING
 * for an unrecognized model id rather than throwing). */
export function estimateRealCostUsd(
  provider: "openai" | "anthropic",
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const table = provider === "openai" ? REAL_OPENAI_PRICING : REAL_ANTHROPIC_PRICING;
  const entry = table[model] ?? UNKNOWN_REAL_MODEL_PRICING;
  return costFromEntry(entry, inputTokens, outputTokens);
}
