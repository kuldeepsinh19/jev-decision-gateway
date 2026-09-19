import { DecisionGateway } from "@jev-decision-gateway/core";
import { MockProvider } from "@jev-decision-gateway/providers";

import { runLoop, type TieredProviders } from "./loop.js";
import { formatTranscript } from "./print.js";

// Re-exported so `benchmark/ai-agent-scenario` (Task 8) can depend on this package as a workspace
// dependency and import `runLoop` directly, rather than re-implementing the agent loop a second
// time -- per the plan's explicit instruction not to duplicate loop logic between the example and
// the benchmark.
export { runLoop, type TieredProviders, type RunLoopOptions, type RunLoopResult } from "./loop.js";

export const DEFAULT_TASK =
  "Inspect recent logs for an error, and report a one-line summary of what you found.";

export interface RunAgentRuntimeOptimizerOptions {
  task?: string;
  maxIterations?: number;
  /** Only "mock" is supported in this MVP -- no real network provider is wired into this example. */
  provider?: "mock";
}

export interface RunAgentRuntimeOptimizerSummary {
  task: string;
  iterationsUsed: number;
  maxIterations: number;
  verifyRetries: number;
  maxVerifyRetries: number;
  jevCallCount: number;
  jevTotalLatencyMs: number;
  llmCallCount: number;
  llmTotalLatencyMs: number;
  llmTotalCostUsd: number;
  fallbackCount: number;
  finalAnswer: string | null;
  toolsUsed: Array<{ tool: string; input: string; output: string }>;
}

export interface RunAgentRuntimeOptimizerResult {
  transcript: string;
  summary: RunAgentRuntimeOptimizerSummary;
}

/**
 * Constructs a `DecisionGateway` (which itself picks up `TYPESAFE_API_KEY` from the environment
 * per `GatewayConfig`'s documented default) and a pair of tier-specific `MockProvider`s, runs the
 * agent loop, and formats the result. Returns both the printed transcript string (for a human) and
 * a structured summary object (for the CLI/tests to consume without re-parsing printed text).
 */
export async function runAgentRuntimeOptimizer(
  options: RunAgentRuntimeOptimizerOptions = {}
): Promise<RunAgentRuntimeOptimizerResult> {
  const task = options.task ?? DEFAULT_TASK;

  const gateway = new DecisionGateway();
  const jevKeyDetected = Boolean(
    process.env.TYPESAFE_API_KEY && process.env.TYPESAFE_API_KEY.length > 0
  );

  const providers: TieredProviders = {
    "mock-fast": new MockProvider("mock-fast"),
    "mock-strong": new MockProvider("mock-strong"),
  };

  const loopResult = await runLoop(gateway, providers, task, {
    maxIterations: options.maxIterations,
  });

  const transcript = formatTranscript({
    task,
    providerName: "mock",
    jevKeyDetected,
    loopResult,
  });

  const summary: RunAgentRuntimeOptimizerSummary = {
    task,
    iterationsUsed: loopResult.finalState.iteration,
    maxIterations: loopResult.finalState.maxIterations,
    verifyRetries: loopResult.finalState.verifyRetries,
    maxVerifyRetries: loopResult.finalState.maxVerifyRetries,
    jevCallCount: loopResult.jevCallCount,
    jevTotalLatencyMs: loopResult.jevTotalLatencyMs,
    llmCallCount: loopResult.llmCallCount,
    llmTotalLatencyMs: loopResult.llmTotalLatencyMs,
    llmTotalCostUsd: loopResult.llmTotalCostUsd,
    fallbackCount: loopResult.fallbackCount,
    finalAnswer: loopResult.finalState.draftAnswer,
    toolsUsed: loopResult.finalState.toolsUsed,
  };

  return { transcript, summary };
}
