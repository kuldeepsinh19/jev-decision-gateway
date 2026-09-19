import type { DecisionGateway, FallbackReason } from "@jev-decision-gateway/core";
import type { LLMProvider, SimulatedTier } from "@jev-decision-gateway/providers";
import { runLoop } from "@jev-decision-gateway/example-agent-runtime-optimizer";

import { controlDecisionCountFor, type BenchmarkTask } from "../tasks.js";
import { baselineLlmCallCountFor, type ScenarioRunResult } from "./baseline.js";

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
    // BUG FIX (Task 11 review finding #1): this used to be hardcoded to `controlDecisionCount`,
    // which silently assumed `loopResult.llmCallCount` (this scenario's own actual generation-call
    // count) was always exactly 1. That assumption is false in general -- `runLoop` can make more
    // than one real generation call per task (e.g. a verify-retry loop re-generating an answer
    // after a failed verification step), and in the Task 11 live run it was, uniformly, 3 per task,
    // not 1. The true, reconciling number is always `(what the naive baseline would have spent on
    // this exact task) - (what this scenario actually spent on this exact task)`, using the same
    // `baselineLlmCallCountFor()` formula `runBaseline` itself uses (so this can never drift out of
    // sync with it again) rather than re-deriving a baseline call count from `controlDecisionCount`
    // here. Summed across every task, this now reconciles exactly with the aggregate
    // `baseline.simulated.callCount - jevGated.simulated.callCount` total -- see
    // `report.test.ts`'s "per-task LLM calls avoided reconciles with the aggregate total" test.
    llmCallsAvoided: baselineLlmCallCountFor(task) - loopResult.llmCallCount,
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
