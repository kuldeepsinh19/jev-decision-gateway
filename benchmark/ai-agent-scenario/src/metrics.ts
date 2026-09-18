import type { ScenarioRunResult } from "./scenarios/baseline.js";

/**
 * Every number that came from a real, timed `DecisionGateway` call is nested under `real`
 * (tagged `measurement: "real"`); every number that came from the (always simulated, in this
 * benchmark) `MockProvider` is nested under `simulated` (tagged `measurement: "simulated"`).
 * Nothing at the top level of `AggregateMetrics` is a measured-or-simulated number itself
 * (`taskCount`/`controlDecisionCount`/`completedCount`/`scenario` are benchmark bookkeeping, not
 * measurements) -- this is the "no untagged flat number that mixes real and simulated data"
 * requirement, enforced by the type shape itself.
 */
export interface RealJevAggregate {
  measurement: "real";
  callCount: number;
  /** total individual decisions actually asked of Jev across all real calls (see `ScenarioRunResult.realJevDecisionCount`) -- the correct denominator for `fallbackRate` below, since one `callCount` call can carry several decisions. */
  decisionCount: number;
  totalLatencyMs: number;
  avgConfidence: number | null;
  fallbackCount: number;
  /** fraction of real Jev *decisions* (not calls) that used a fallback outcome, 0..1 -- decision-level, so it can never exceed 1. */
  fallbackRate: number;
}

export interface SimulatedLlmAggregate {
  measurement: "simulated";
  callCount: number;
  callsAvoided: number;
  totalLatencyMs: number;
  totalCostUsd: number;
}

export interface AggregateMetrics {
  scenario: "baseline" | "jevGated";
  taskCount: number;
  controlDecisionCount: number;
  completedCount: number;
  real: RealJevAggregate;
  simulated: SimulatedLlmAggregate;
}

export function aggregate(results: ScenarioRunResult[]): AggregateMetrics {
  if (results.length === 0) {
    throw new Error("aggregate(): at least one ScenarioRunResult is required");
  }

  const taskCount = results.length;
  const controlDecisionCount = results.reduce((sum, r) => sum + r.controlDecisionCount, 0);
  const completedCount = results.filter((r) => r.completed).length;

  const realCallCount = results.reduce((sum, r) => sum + r.realJevCallCount, 0);
  const realDecisionCount = results.reduce((sum, r) => sum + r.realJevDecisionCount, 0);
  const realTotalLatencyMs = results.reduce((sum, r) => sum + r.realJevLatencyMs, 0);
  const realFallbackCount = results.reduce((sum, r) => sum + r.fallbackCount, 0);
  const confidencesWeighted = results
    .filter((r) => r.realJevAvgConfidence !== null && r.realJevCallCount > 0)
    .map((r) => ({ avg: r.realJevAvgConfidence as number, weight: r.realJevCallCount }));
  const totalWeight = confidencesWeighted.reduce((sum, c) => sum + c.weight, 0);
  const avgConfidence =
    totalWeight > 0
      ? confidencesWeighted.reduce((sum, c) => sum + c.avg * c.weight, 0) / totalWeight
      : null;

  const simulatedCallCount = results.reduce((sum, r) => sum + r.llmCallCount, 0);
  const simulatedCallsAvoided = results.reduce((sum, r) => sum + r.llmCallsAvoided, 0);
  const simulatedTotalLatencyMs = results.reduce((sum, r) => sum + r.simulatedLlmLatencyMs, 0);
  const simulatedTotalCostUsd = results.reduce((sum, r) => sum + r.simulatedLlmCostUsd, 0);

  // A ScenarioRunResult array is homogeneous by construction (either all-baseline or
  // all-jevGated) -- inferred here from whether any real Jev call was made at all, since baseline
  // results always report realJevCallCount === 0 for every task.
  const scenario: AggregateMetrics["scenario"] = realCallCount > 0 ? "jevGated" : "baseline";

  return {
    scenario,
    taskCount,
    controlDecisionCount,
    completedCount,
    real: {
      measurement: "real",
      callCount: realCallCount,
      decisionCount: realDecisionCount,
      totalLatencyMs: realTotalLatencyMs,
      avgConfidence,
      fallbackCount: realFallbackCount,
      fallbackRate: realDecisionCount > 0 ? realFallbackCount / realDecisionCount : 0,
    },
    simulated: {
      measurement: "simulated",
      callCount: simulatedCallCount,
      callsAvoided: simulatedCallsAvoided,
      totalLatencyMs: simulatedTotalLatencyMs,
      totalCostUsd: simulatedTotalCostUsd,
    },
  };
}

export interface SavingsSummary {
  measurement: "simulated";
  llmCallsAvoidedTotal: number;
  simulatedCostSavedUsd: number;
  simulatedLatencySavedMs: number;
}

/** One task's baseline vs. jevGated results, side by side -- what `report.ts`'s per-task table row needs. */
export interface PerTaskComparisonRow {
  taskId: string;
  baseline: ScenarioRunResult;
  jevGated: ScenarioRunResult;
}

export interface ComparisonResult {
  baseline: AggregateMetrics;
  jevGated: AggregateMetrics;
  perTask: PerTaskComparisonRow[];
  savings: SavingsSummary;
  /** Jev's own billing cost is deliberately never estimated -- see report.ts's footer. */
  jevBillingCost: "n/a — no public pricing found as of 2026-09";
}

/**
 * `perTask` is an ADDITIVE optional third parameter beyond the brief's sketched 2-argument
 * `compare(baseline, jevGated)` signature: the brief's `report.ts` wants a per-task table row
 * (Task | Baseline ... | JEV ... | Savings), which needs the raw per-task `ScenarioRunResult`
 * pairs that only the caller (`index.ts`, which ran both scenarios over each task) has -- two
 * `AggregateMetrics` alone can't reconstruct them. The documented 2-argument call shape still
 * works unchanged (`perTask` defaults to `[]`).
 */
export function compare(
  baseline: AggregateMetrics,
  jevGated: AggregateMetrics,
  perTask: PerTaskComparisonRow[] = []
): ComparisonResult {
  return {
    baseline,
    jevGated,
    perTask,
    savings: {
      measurement: "simulated",
      llmCallsAvoidedTotal: baseline.simulated.callCount - jevGated.simulated.callCount,
      simulatedCostSavedUsd: baseline.simulated.totalCostUsd - jevGated.simulated.totalCostUsd,
      simulatedLatencySavedMs: baseline.simulated.totalLatencyMs - jevGated.simulated.totalLatencyMs,
    },
    jevBillingCost: "n/a — no public pricing found as of 2026-09",
  };
}
