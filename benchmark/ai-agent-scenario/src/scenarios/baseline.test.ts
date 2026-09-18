import { describe, expect, it } from "vitest";

import { MockProvider } from "@jev-decision-gateway/providers";

import { BENCHMARK_TASKS, controlDecisionCountFor } from "../tasks.js";
import { runBaseline } from "./baseline.js";

describe("runBaseline", () => {
  it("returns a ScenarioRunResult with realJev* fields zeroed out (no Jev calls at all)", async () => {
    const task = BENCHMARK_TASKS[0];
    const provider = new MockProvider("mock-strong");

    const result = await runBaseline(task, provider);

    expect(result.taskId).toBe(task.id);
    expect(result.realJevCallCount).toBe(0);
    expect(result.realJevLatencyMs).toBe(0);
    expect(result.realJevAvgConfidence).toBeNull();
    expect(result.fallbackCount).toBe(0);
    expect(result.fallbackReasons).toEqual([]);
    expect(result.completed).toBe(true);
  });

  it("makes exactly one strong-LLM call per control decision, plus one for the final answer", async () => {
    const task = BENCHMARK_TASKS.find((t) => t.id === "complex-checkout-investigation")!;
    const provider = new MockProvider("mock-strong");

    const result = await runBaseline(task, provider);

    const expectedControlDecisions = controlDecisionCountFor(task);
    expect(result.controlDecisionCount).toBe(expectedControlDecisions);
    expect(result.llmCallCount).toBe(expectedControlDecisions + 1);
    expect(result.llmCallsAvoided).toBe(0);
    expect(result.llmCallCount).toBeGreaterThan(0);
  });

  it("is fully deterministic given a deterministic (Mock) provider", async () => {
    const task = BENCHMARK_TASKS[1];
    const provider1 = new MockProvider("mock-strong");
    const provider2 = new MockProvider("mock-strong");

    const [result1, result2] = await Promise.all([
      runBaseline(task, provider1),
      runBaseline(task, provider2),
    ]);

    expect(result1).toEqual(result2);
  });

  it("produces internally consistent, non-negative counts for every task", async () => {
    const provider = new MockProvider("mock-strong");
    for (const task of BENCHMARK_TASKS) {
      const result = await runBaseline(task, provider);
      expect(result.llmCallCount).toBeGreaterThanOrEqual(0);
      expect(result.simulatedLlmLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.simulatedLlmCostUsd).toBeGreaterThanOrEqual(0);
    }
  });
});
