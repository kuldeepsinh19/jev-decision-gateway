import type { DecisionGateway, FallbackReason } from "@jev-decision-gateway/core";
import type { LLMProvider, SimulatedTier } from "@jev-decision-gateway/providers";
import { runLoop } from "@jev-decision-gateway/example-agent-runtime-optimizer";

import { controlDecisionCountFor, type BenchmarkTask } from "../tasks.js";
import type { ScenarioRunResult } from "./baseline.js";

/**
 * ADAPTATION FROM THE BRIEF: the brief sketches `runJevGated(task, gateway, provider:
 * LLMProvider)`, matching `runBaseline`'s single-provider signature. But this scenario reuses
 * `runLoop` from `examples/agent-runtime-optimizer` (per the brief's own explicit instruction not
 * to re-implement the agent loop), and `runLoop` needs a tier -> provider map
 * (`Record<SimulatedTier, LLMProvider>`), not a single `LLMProvider` -- see `loop.ts`'s own
 * doc comment for why (MockProvider fixes its tier at construction). Rather than silently
 * discarding tier fidelity (e.g. routing every tier through one shared instance, which would
 * mislabel `mock-fast` iterations with `mock-strong` pricing/latency), this function takes the
 * same `Record<SimulatedTier, LLMProvider>` shape `runLoop` requires. `index.ts` constructs one
 * `MockProvider` per tier, exactly as the flagship example's own `index.ts` does.
 */
export async function runJevGated(
  task: BenchmarkTask,
  gateway: DecisionGateway,
  providers: Record<SimulatedTier, LLMProvider>
): Promise<ScenarioRunResult> {
  const loopResult = await runLoop(gateway, providers, task.prompt, {
    maxIterations: Math.max(task.expectedIterations + 2, 6),
  });

  const controlDecisionCount = controlDecisionCountFor(task);

  const confidences = loopResult.trace
    .map((t) => t.confidence)
    .filter((c): c is number => c !== null);
  const realJevAvgConfidence =
    confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : null;

  const fallbackReasons = loopResult.trace
    .filter((t) => t.usedFallback && t.fallbackReason !== undefined)
    .map((t) => t.fallbackReason as FallbackReason);

  return {
    taskId: task.id,
    controlDecisionCount,
    llmCallCount: loopResult.llmCallCount,
    // Every control decision was routed to a single batched Jev call instead of a dedicated LLM
    // call -- none of them cost an LLM call in this scenario, so all of them are "avoided".
    llmCallsAvoided: controlDecisionCount,
    simulatedLlmLatencyMs: loopResult.llmTotalLatencyMs,
    simulatedLlmCostUsd: loopResult.llmTotalCostUsd,
    realJevCallCount: loopResult.jevCallCount,
    realJevLatencyMs: loopResult.jevTotalLatencyMs,
    realJevAvgConfidence,
    realJevDecisionCount: loopResult.trace.length,
    fallbackCount: loopResult.fallbackCount,
    fallbackReasons,
    completed: loopResult.finalState.done,
  };
}
