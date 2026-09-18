import type { FallbackReason } from "@jev-decision-gateway/core";
import type { LLMProvider } from "@jev-decision-gateway/providers";

import { controlDecisionCountFor, type BenchmarkTask } from "../tasks.js";

/**
 * Common result shape both scenarios return (declared here, the first of the two scenario files,
 * since the brief's file list has no separate shared-types module for it; `jevGated.ts`,
 * `metrics.ts`, and `report.ts` all import it from this file).
 *
 * `realJev*` fields are `0`/`null` for `runBaseline` (it makes no Jev calls at all -- expected and
 * correct, not a bug). `simulatedLlm*`/`llmCall*` fields are populated by both scenarios, since
 * both eventually invoke the (always simulated, in this benchmark) `LLMProvider`.
 */
export interface ScenarioRunResult {
  taskId: string;
  controlDecisionCount: number;
  llmCallCount: number;
  /** vs. a "naive" baseline of one strong-LLM call per control decision (see `controlDecisionCountFor`). */
  llmCallsAvoided: number;
  simulatedLlmLatencyMs: number;
  simulatedLlmCostUsd: number;
  realJevCallCount: number;
  realJevLatencyMs: number;
  realJevAvgConfidence: number | null;
  /**
   * ADDITIVE FIELD, not in the brief's original sketch: `realJevCallCount` counts *batched*
   * `evaluate()`/`chain()`-step calls, but `fallbackCount` below counts *individual decision*
   * fallbacks -- one batched call can carry several decisions (the main checkpoint alone is a
   * 4-question fan-out), so `fallbackCount` can legitimately exceed `realJevCallCount`. A
   * "fallback rate" computed as `fallbackCount / realJevCallCount` is therefore not a rate at all
   * (it can exceed 100%) -- it needs a same-unit (decision-level) denominator instead. This field
   * is that denominator: the total number of individual decisions actually asked of Jev (real
   * calls only; 0 for the baseline, which asks Jev nothing).
   */
  realJevDecisionCount: number;
  fallbackCount: number;
  fallbackReasons: FallbackReason[];
  completed: boolean;
}

/**
 * "Naive" baseline: every control decision (continue? which tool? verify?) is answered by a
 * dedicated call to `provider.complete()` at the strong tier -- no batching, no Jev. Makes exactly
 * `controlDecisionCountFor(task)` such calls, plus one more for the actual final-answer
 * generation. Requires zero API keys and zero network (the `provider` passed in is expected to be
 * a `MockProvider`, though nothing here assumes that beyond the `LLMProvider` interface), and is
 * fully deterministic given a deterministic provider.
 */
export async function runBaseline(
  task: BenchmarkTask,
  provider: LLMProvider
): Promise<ScenarioRunResult> {
  const controlDecisionCount = controlDecisionCountFor(task);

  let simulatedLlmLatencyMs = 0;
  let simulatedLlmCostUsd = 0;

  for (let i = 0; i < controlDecisionCount; i++) {
    const response = await provider.complete({
      system:
        "You are deciding one control-flow question for an AI agent loop (e.g. which tool to call next, whether to continue, whether output verification passes).",
      messages: [
        {
          role: "user",
          content: `Task: ${task.prompt}\n\nDecide control-decision #${i + 1} of ${controlDecisionCount} for this run.`,
        },
      ],
    });
    simulatedLlmLatencyMs += response.latencyMs;
    simulatedLlmCostUsd += response.costUsd;
  }

  // The final generation call, in addition to the per-control-decision calls above.
  const finalResponse = await provider.complete({
    system: "You are the final-answer generator for an AI agent loop. Answer the task concisely.",
    messages: [{ role: "user", content: `Task: ${task.prompt}` }],
  });
  simulatedLlmLatencyMs += finalResponse.latencyMs;
  simulatedLlmCostUsd += finalResponse.costUsd;

  return {
    taskId: task.id,
    controlDecisionCount,
    llmCallCount: controlDecisionCount + 1,
    llmCallsAvoided: 0, // baseline is the reference: it avoids nothing.
    simulatedLlmLatencyMs,
    simulatedLlmCostUsd,
    realJevCallCount: 0,
    realJevLatencyMs: 0,
    realJevAvgConfidence: null,
    realJevDecisionCount: 0,
    fallbackCount: 0,
    fallbackReasons: [],
    completed: true,
  };
}
