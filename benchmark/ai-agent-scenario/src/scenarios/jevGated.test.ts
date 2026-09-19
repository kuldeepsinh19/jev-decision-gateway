import { describe, expect, it } from "vitest";

import { DecisionGateway } from "@jev-decision-gateway/core";
import { MockProvider } from "@jev-decision-gateway/providers";
import type { LLMProvider, SimulatedTier } from "@jev-decision-gateway/providers";

import { BENCHMARK_TASKS, controlDecisionCountFor } from "../tasks.js";
import { baselineLlmCallCountFor } from "./baseline.js";
import { runJevGated } from "./jevGated.js";

function makeProviders(): Record<SimulatedTier, LLMProvider> {
  return {
    "mock-fast": new MockProvider("mock-fast"),
    "mock-strong": new MockProvider("mock-strong"),
  };
}

describe("runJevGated", () => {
  it("exercises the MISSING_KEY fallback path deterministically when no API key is configured", async () => {
    // Explicit empty string, not just an absent option: `createJevClient` treats `config.apiKey`
    // as taking precedence over `process.env.TYPESAFE_API_KEY` when present (even as ""), so this
    // is deterministic regardless of whatever is in this machine's real environment/.env.
    const gateway = new DecisionGateway({ apiKey: "" });
    const task = BENCHMARK_TASKS[0];

    const result = await runJevGated(task, gateway, makeProviders());

    expect(result.taskId).toBe(task.id);
    expect(result.completed).toBe(true);
    expect(result.realJevCallCount).toBeGreaterThan(0);
    // Every real Jev call made no API key available, so every decision resolved via fallback --
    // and per gateway.ts, that fallback reason is specifically MISSING_KEY.
    expect(result.fallbackCount).toBe(result.fallbackReasons.length);
    expect(result.fallbackReasons.length).toBeGreaterThan(0);
    for (const reason of result.fallbackReasons) {
      expect(reason).toBe("MISSING_KEY");
    }
  });

  it("returns a ScenarioRunResult shape consistent with controlDecisionCountFor(task)", async () => {
    const gateway = new DecisionGateway({ apiKey: "" });
    const task = BENCHMARK_TASKS.find((t) => t.id === "moderate-test-run")!;

    const result = await runJevGated(task, gateway, makeProviders());

    expect(result.controlDecisionCount).toBe(controlDecisionCountFor(task));
    expect(result.llmCallCount).toBeGreaterThanOrEqual(0);
    // REGRESSION GUARD (Task 11 review finding #1): `llmCallsAvoided` must always be the true,
    // reconciling `(what the naive baseline spends on this task) - (what this scenario's own
    // actual llmCallCount was)`, NOT a hardcoded `controlDecisionCount` that silently assumes
    // `llmCallCount` is always exactly 1. Deliberately does not special-case this task's own
    // `llmCallCount` value -- this must hold whatever that actual count turns out to be.
    expect(result.llmCallsAvoided).toBe(baselineLlmCallCountFor(task) - result.llmCallCount);
  });

  it("never throws and always finishes, even across every task in the benchmark with no API key", async () => {
    const gateway = new DecisionGateway({ apiKey: "" });
    for (const task of BENCHMARK_TASKS) {
      const result = await runJevGated(task, gateway, makeProviders());
      expect(result.completed).toBe(true);
    }
  });
});
