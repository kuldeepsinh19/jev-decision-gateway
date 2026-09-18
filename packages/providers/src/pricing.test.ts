import { describe, expect, it } from "vitest";

import {
  REAL_ANTHROPIC_PRICING,
  REAL_OPENAI_PRICING,
  SIMULATED_PRICING,
  estimateCostUsd,
  estimateRealCostUsd,
  estimateTokens,
} from "./pricing.js";

describe("estimateTokens", () => {
  it("rounds up length/4 (rough heuristic)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });

  it("always returns a non-negative integer", () => {
    const n = estimateTokens("hello world, this is a test string");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });
});

describe("estimateCostUsd", () => {
  it("is 0 for 0 tokens", () => {
    expect(estimateCostUsd("mock-strong", 0, 0)).toBe(0);
  });

  it("computes mock-strong cost from its documented per-1M rates", () => {
    // mock-strong: inputPer1M 2.50, outputPer1M 10.00
    const cost = estimateCostUsd("mock-strong", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.5 + 10.0, 10);
  });

  it("computes mock-fast cost from its documented per-1M rates", () => {
    // mock-fast: inputPer1M 0.15, outputPer1M 0.60
    const cost = estimateCostUsd("mock-fast", 500_000, 500_000);
    expect(cost).toBeCloseTo(0.075 + 0.3, 10);
  });

  it("is always positive for positive token counts", () => {
    for (const tier of Object.keys(SIMULATED_PRICING) as Array<keyof typeof SIMULATED_PRICING>) {
      expect(estimateCostUsd(tier, 100, 100)).toBeGreaterThan(0);
    }
  });

  it("scales linearly with output tokens", () => {
    const one = estimateCostUsd("mock-fast", 0, 1_000_000);
    const two = estimateCostUsd("mock-fast", 0, 2_000_000);
    expect(two).toBeCloseTo(one * 2, 10);
  });
});

describe("estimateRealCostUsd", () => {
  it("computes a real OpenAI model's cost from its documented per-1M rates", () => {
    const cost = estimateRealCostUsd("openai", "gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(
      REAL_OPENAI_PRICING["gpt-4o"].inputPer1M + REAL_OPENAI_PRICING["gpt-4o"].outputPer1M,
      10
    );
  });

  it("computes a real Anthropic model's cost from its documented per-1M rates", () => {
    const cost = estimateRealCostUsd("anthropic", "claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(
      REAL_ANTHROPIC_PRICING["claude-sonnet-4-5"].inputPer1M +
        REAL_ANTHROPIC_PRICING["claude-sonnet-4-5"].outputPer1M,
      10
    );
  });

  it("falls back to a positive estimate instead of throwing for an unrecognized model id", () => {
    expect(() => estimateRealCostUsd("openai", "not-a-real-model", 1000, 1000)).not.toThrow();
    expect(estimateRealCostUsd("openai", "not-a-real-model", 1000, 1000)).toBeGreaterThan(0);
  });

  it("is 0 for 0 tokens", () => {
    expect(estimateRealCostUsd("openai", "gpt-4o", 0, 0)).toBe(0);
  });
});

describe("SIMULATED_PRICING", () => {
  it("every tier has positive input/output rates and latency", () => {
    for (const entry of Object.values(SIMULATED_PRICING)) {
      expect(entry.inputPer1M).toBeGreaterThan(0);
      expect(entry.outputPer1M).toBeGreaterThan(0);
      expect(entry.avgLatencyMs).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});
