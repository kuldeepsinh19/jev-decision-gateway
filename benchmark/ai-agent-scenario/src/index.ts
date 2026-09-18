import { join } from "node:path";
import { tmpdir } from "node:os";

import { DecisionGateway } from "@jev-decision-gateway/core";
import { MockProvider } from "@jev-decision-gateway/providers";
import type { SimulatedTier, LLMProvider } from "@jev-decision-gateway/providers";

import { BENCHMARK_TASKS } from "./tasks.js";
import { runBaseline } from "./scenarios/baseline.js";
import { runJevGated } from "./scenarios/jevGated.js";
import { aggregate, compare, type ComparisonResult, type PerTaskComparisonRow } from "./metrics.js";
import { printReport, writeReportJson } from "./report.js";

export interface RunAiAgentBenchmarkOptions {
  tasksLimit?: number;
  outPath?: string;
  /** Only "mock" is supported in this MVP -- no real network provider is wired into this benchmark. */
  provider?: "mock";
}

const DEFAULT_OUT_PATH = () => join(tmpdir(), "jev-decision-gateway-benchmark-report.json");

/**
 * Orchestrates the full benchmark: constructs a `DecisionGateway` (which itself picks up
 * `TYPESAFE_API_KEY` from the environment) and a set of `MockProvider`s, runs both scenarios over
 * all (or `tasksLimit`) tasks, aggregates, prints the report, writes the JSON report, and returns
 * the comparison.
 */
export async function runAiAgentBenchmark(
  options: RunAiAgentBenchmarkOptions = {}
): Promise<ComparisonResult> {
  const tasks = options.tasksLimit ? BENCHMARK_TASKS.slice(0, options.tasksLimit) : BENCHMARK_TASKS;
  const outPath = options.outPath ?? DEFAULT_OUT_PATH();

  const gateway = new DecisionGateway();
  const strongProvider: LLMProvider = new MockProvider("mock-strong");
  const tieredProviders: Record<SimulatedTier, LLMProvider> = {
    "mock-fast": new MockProvider("mock-fast"),
    "mock-strong": strongProvider,
  };

  const perTask: PerTaskComparisonRow[] = [];
  for (const task of tasks) {
    const baselineResult = await runBaseline(task, strongProvider);
    const jevGatedResult = await runJevGated(task, gateway, tieredProviders);
    perTask.push({ taskId: task.id, baseline: baselineResult, jevGated: jevGatedResult });
  }

  const baselineAgg = aggregate(perTask.map((r) => r.baseline));
  const jevGatedAgg = aggregate(perTask.map((r) => r.jevGated));
  const comparison = compare(baselineAgg, jevGatedAgg, perTask);

  printReport(comparison);
  writeReportJson(comparison, outPath);

  return comparison;
}
