import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScenarioRunResult } from "./scenarios/baseline.js";
import { aggregate, compare } from "./metrics.js";
import { printReport, writeReportJson } from "./report.js";

function baselineFixture(
  taskId: string,
  llmCallCount: number,
  costUsd: number,
  ms: number
): ScenarioRunResult {
  return {
    taskId,
    controlDecisionCount: llmCallCount - 1,
    llmCallCount,
    llmCallsAvoided: 0,
    simulatedLlmLatencyMs: ms,
    simulatedLlmCostUsd: costUsd,
    realJevCallCount: 0,
    realJevLatencyMs: 0,
    realJevAvgConfidence: null,
    realJevDecisionCount: 0,
    fallbackCount: 0,
    fallbackReasons: [],
    completed: true,
  };
}

function jevGatedFixture(
  taskId: string,
  controlDecisionCount: number,
  realJevCallCount: number,
  realJevDecisionCount: number,
  realJevLatencyMs: number,
  avgConfidence: number | null,
  fallbackCount: number
): ScenarioRunResult {
  return {
    taskId,
    controlDecisionCount,
    llmCallCount: 1,
    llmCallsAvoided: controlDecisionCount,
    simulatedLlmLatencyMs: 450,
    simulatedLlmCostUsd: 0.00002,
    realJevCallCount,
    realJevLatencyMs,
    realJevAvgConfidence: avgConfidence,
    realJevDecisionCount,
    fallbackCount,
    fallbackReasons: fallbackCount > 0 ? Array(fallbackCount).fill("MISSING_KEY") : [],
    completed: true,
  };
}

const baselineResults: ScenarioRunResult[] = [
  baselineFixture("task-a", 9, 0.001, 3600),
  baselineFixture("task-b", 5, 0.0005, 2000),
];

// realJevDecisionCount (8, 4) is deliberately different in magnitude from realJevCallCount (2, 2)
// to exercise the call-count-vs-decision-count distinction: fallbackRate must be computed against
// decisionCount, never callCount (see ScenarioRunResult.realJevDecisionCount's doc comment).
const jevGatedResults: ScenarioRunResult[] = [
  jevGatedFixture("task-a", 8, 2, 8, 3.5, 0.9, 0),
  jevGatedFixture("task-b", 4, 2, 4, 2.1, 0.85, 1),
];

describe("aggregate", () => {
  it("sums counts and tags real/simulated groups separately", () => {
    const baselineAgg = aggregate(baselineResults);
    expect(baselineAgg.scenario).toBe("baseline");
    expect(baselineAgg.taskCount).toBe(2);
    expect(baselineAgg.controlDecisionCount).toBe(8 + 4);
    expect(baselineAgg.real.measurement).toBe("real");
    expect(baselineAgg.real.callCount).toBe(0);
    expect(baselineAgg.simulated.measurement).toBe("simulated");
    expect(baselineAgg.simulated.callCount).toBe(9 + 5);
    expect(baselineAgg.simulated.totalCostUsd).toBeCloseTo(0.0015, 10);

    const jevAgg = aggregate(jevGatedResults);
    expect(jevAgg.scenario).toBe("jevGated");
    expect(jevAgg.real.callCount).toBe(4);
    expect(jevAgg.real.totalLatencyMs).toBeCloseTo(5.6, 10);
    expect(jevAgg.real.fallbackCount).toBe(1);
    expect(jevAgg.real.decisionCount).toBe(12);
    // Deliberately NOT fallbackCount / callCount (1/4 = 0.25, which would be wrong here): the
    // correct, decision-level rate is fallbackCount / decisionCount (1/12).
    expect(jevAgg.real.fallbackRate).toBeCloseTo(1 / 12, 10);
    // weighted average: (0.9*2 + 0.85*2) / 4
    expect(jevAgg.real.avgConfidence).toBeCloseTo(0.875, 10);
  });

  it("throws on an empty results array rather than silently returning a nonsensical average", () => {
    expect(() => aggregate([])).toThrow();
  });
});

describe("compare", () => {
  it("computes simulated savings tagged as such, and never fabricates a Jev billing number", () => {
    const baselineAgg = aggregate(baselineResults);
    const jevAgg = aggregate(jevGatedResults);
    const comparison = compare(baselineAgg, jevAgg);

    expect(comparison.savings.measurement).toBe("simulated");
    expect(comparison.savings.llmCallsAvoidedTotal).toBe(14 - 2);
    expect(comparison.savings.simulatedCostSavedUsd).toBeCloseTo(0.0015 - 0.00004, 10);
    expect(comparison.jevBillingCost).toBe("n/a — no public pricing found as of 2026-09");
    expect(comparison.perTask).toEqual([]);
  });

  it("accepts an optional perTask array for report.ts's per-task table", () => {
    const baselineAgg = aggregate(baselineResults);
    const jevAgg = aggregate(jevGatedResults);
    const perTask = [
      { taskId: "task-a", baseline: baselineResults[0], jevGated: jevGatedResults[0] },
    ];

    const comparison = compare(baselineAgg, jevAgg, perTask);

    expect(comparison.perTask).toHaveLength(1);
    expect(comparison.perTask[0].taskId).toBe("task-a");
  });
});

describe("per-task 'LLM calls avoided' reconciliation (Task 11 review fix #1 regression guard)", () => {
  // REGRESSION GUARD: before the fix, jevGated.ts's `llmCallsAvoided` field was hardcoded to
  // `controlDecisionCount`, which silently assumed every task's actual jevGated `llmCallCount` was
  // exactly 1. That assumption happened to be invisible whenever every fixture's llmCallCount really
  // was 1 (the old bug and the correct formula agree in that special case) -- which is exactly why
  // it shipped unnoticed. This fixture deliberately varies jevGated's per-task llmCallCount (1, 3,
  // 2 -- not all 1) so the two formulas diverge, and asserts the per-task column now reconciles
  // exactly with the aggregate total, both as a sum and via the printed table.
  function jevFixtureWithLlmCallCount(
    taskId: string,
    controlDecisionCount: number,
    llmCallCount: number
  ): ScenarioRunResult {
    return {
      taskId,
      controlDecisionCount,
      llmCallCount,
      llmCallsAvoided: controlDecisionCount + 1 - llmCallCount, // mirrors baselineLlmCallCountFor(task) - llmCallCount
      simulatedLlmLatencyMs: 450 * llmCallCount,
      simulatedLlmCostUsd: 0.00002 * llmCallCount,
      realJevCallCount: 5,
      realJevLatencyMs: 2000,
      realJevAvgConfidence: 0.8,
      realJevDecisionCount: 5,
      fallbackCount: 1,
      fallbackReasons: ["LOW_CONFIDENCE"],
      completed: true,
    };
  }

  it("sums per-task to the same total as the aggregate savings, with jevGated call counts of 1, 3, and 2", () => {
    const baselines: ScenarioRunResult[] = [
      baselineFixture("task-a", 5, 0.001, 1000), // controlDecisionCount = 4
      baselineFixture("task-b", 9, 0.002, 2000), // controlDecisionCount = 8
      baselineFixture("task-c", 13, 0.003, 3000), // controlDecisionCount = 12
    ];
    const jevGated: ScenarioRunResult[] = [
      jevFixtureWithLlmCallCount("task-a", 4, 1), // 1 real generation call -> avoided 4
      jevFixtureWithLlmCallCount("task-b", 8, 3), // verify-retry loop, 3 real generation calls -> avoided 6, not 8
      jevFixtureWithLlmCallCount("task-c", 12, 2), // 2 real generation calls -> avoided 11, not 12
    ];
    const perTask = baselines.map((b, i) => ({
      taskId: b.taskId,
      baseline: b,
      jevGated: jevGated[i],
    }));

    const baselineAgg = aggregate(baselines);
    const jevAgg = aggregate(jevGated);
    const comparison = compare(baselineAgg, jevAgg, perTask);

    const perTaskSum = comparison.perTask.reduce(
      (sum, row) => sum + row.jevGated.llmCallsAvoided,
      0
    );

    // Concrete numbers, not just self-consistency: (5-1) + (9-3) + (13-2) = 4 + 6 + 11 = 21.
    expect(perTaskSum).toBe(21);
    expect(comparison.savings.llmCallsAvoidedTotal).toBe(21);
    expect(perTaskSum).toBe(comparison.savings.llmCallsAvoidedTotal);

    // And the printed per-task table must show the reconciling number (6 for task-b), never the
    // pre-fix value that assumed llmCallCount === 1 (which would have printed 8).
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    printReport(comparison);
    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    logSpy.mockRestore();

    const taskBLine = lines.find((line) => line.startsWith("task-b"));
    expect(taskBLine).toBeDefined();
    const cells = taskBLine!.split("|").map((c) => c.trim());
    expect(cells[cells.length - 1]).toBe("6");
  });
});

describe("printReport", () => {
  it("prints a table without throwing, including the required footer lines", () => {
    const baselineAgg = aggregate(baselineResults);
    const jevAgg = aggregate(jevGatedResults);
    const perTask = baselineResults.map((b, i) => ({
      taskId: b.taskId,
      baseline: b,
      jevGated: jevGatedResults[i],
    }));
    const comparison = compare(baselineAgg, jevAgg, perTask);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    printReport(comparison);
    // Read the recorded calls BEFORE mockRestore(), since mockRestore() also clears call history
    // (equivalent to mockReset()), not just the implementation.
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("* = simulated using pricing/latency constants dated");
    expect(output).toContain("n/a — no public pricing found as of 2026-09");
    expect(output).toContain("task-a");
    expect(output).toContain("task-b");
  });
});

describe("writeReportJson", () => {
  const writtenPaths: string[] = [];

  afterEach(() => {
    for (const p of writtenPaths.splice(0)) {
      if (existsSync(p)) rmSync(p);
    }
  });

  it("writes the expected JSON shape to a temp path and cleans up after itself", () => {
    const baselineAgg = aggregate(baselineResults);
    const jevAgg = aggregate(jevGatedResults);
    const comparison = compare(baselineAgg, jevAgg);

    const outPath = join(tmpdir(), `jev-benchmark-report-test-${randomUUID()}.json`);
    writtenPaths.push(outPath);

    writeReportJson(comparison, outPath);

    expect(existsSync(outPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(parsed.header).toBeDefined();
    expect(typeof parsed.header.generatedAt).toBe("string");
    expect(typeof parsed.header.sdkVersion).toBe("string");
    expect(typeof parsed.header.nodeVersion).toBe("string");
    expect(parsed.comparison.savings.measurement).toBe("simulated");
    expect(parsed.comparison.jevBillingCost).toBe("n/a — no public pricing found as of 2026-09");
  });
});
