import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

import type { ComparisonResult } from "./metrics.js";

// Mirrors the "checked" date in packages/providers/src/pricing.ts's file-level comment. pricing.ts
// doesn't export this as a runtime constant, so this is kept in sync by hand -- update it if that
// file's checked date ever changes.
const PRICING_CHECKED_DATE = "2026-09-17";

function fmtUsd(usd: number): string {
  return `$${usd.toFixed(6)}`;
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Console table: one row per task (Task | Baseline sim-$/sim-ms/LLM-calls | JEV real-calls/
 * real-ms/real-confidence/fallback-rate | Savings), followed by a TOTAL row and the required
 * footer lines. Every dollar/latency figure printed for the baseline side, and every LLM-call
 * figure on the JEV side, is simulated; every "real Jev" figure on the JEV side comes straight
 * from measured `EvaluationResult`/`DecisionTrace` data -- see `metrics.ts`'s `real`/`simulated`
 * tagging for where each number in this table originates.
 */
export function printReport(comparison: ComparisonResult): void {
  const columns = [
    "Task",
    "Baseline $ (sim)",
    "Baseline ms (sim)",
    "Baseline LLM calls",
    "JEV real calls",
    "JEV real ms",
    "JEV avg confidence",
    "JEV fallback rate",
    "LLM calls avoided",
  ];
  const widths = [28, 16, 18, 19, 15, 12, 19, 18, 18];

  console.log("=== jev-decision-gateway :: AI Agent Benchmark ===");
  console.log("");
  console.log(columns.map((c, i) => padRight(c, widths[i])).join(" | "));
  console.log(widths.map((w) => "-".repeat(w)).join("-|-"));

  for (const row of comparison.perTask) {
    const b = row.baseline;
    const j = row.jevGated;
    // Decision-level rate (fallbackCount and realJevDecisionCount are both counted per individual
    // decision) -- NOT divided by realJevCallCount, which counts batched calls and would make this
    // exceed 100% whenever a call batches more than one decision (see ScenarioRunResult's doc
    // comment on realJevDecisionCount).
    const fallbackRate = j.realJevDecisionCount > 0 ? j.fallbackCount / j.realJevDecisionCount : 0;
    const cells = [
      row.taskId,
      fmtUsd(b.simulatedLlmCostUsd),
      fmtMs(b.simulatedLlmLatencyMs),
      String(b.llmCallCount),
      String(j.realJevCallCount),
      fmtMs(j.realJevLatencyMs),
      j.realJevAvgConfidence === null ? "n/a" : j.realJevAvgConfidence.toFixed(2),
      fmtPct(fallbackRate),
      String(j.llmCallsAvoided),
    ];
    console.log(cells.map((c, i) => padRight(c, widths[i])).join(" | "));
  }

  console.log("");
  console.log("=== Totals ===");
  console.log(`Tasks: ${comparison.baseline.taskCount}`);
  console.log(
    `Baseline (all simulated): ${comparison.baseline.simulated.callCount} LLM calls, ${fmtMs(comparison.baseline.simulated.totalLatencyMs)}, ${fmtUsd(comparison.baseline.simulated.totalCostUsd)}`
  );
  console.log(
    `JEV-gated -- real Jev: ${comparison.jevGated.real.callCount} calls, ${fmtMs(comparison.jevGated.real.totalLatencyMs)}, avg confidence ${comparison.jevGated.real.avgConfidence === null ? "n/a" : comparison.jevGated.real.avgConfidence.toFixed(2)}, fallback rate ${fmtPct(comparison.jevGated.real.fallbackRate)}`
  );
  console.log(
    `JEV-gated -- simulated LLM (generation only): ${comparison.jevGated.simulated.callCount} calls, ${fmtMs(comparison.jevGated.simulated.totalLatencyMs)}, ${fmtUsd(comparison.jevGated.simulated.totalCostUsd)}`
  );
  console.log(
    `Savings (simulated): ${comparison.savings.llmCallsAvoidedTotal} LLM calls avoided, ${fmtUsd(comparison.savings.simulatedCostSavedUsd)} saved, ${fmtMs(comparison.savings.simulatedLatencySavedMs)} saved`
  );
  console.log(`Jev's own billing cost: ${comparison.jevBillingCost}`);
  console.log("");
  console.log(
    `* = simulated using pricing/latency constants dated ${PRICING_CHECKED_DATE}, not measured.`
  );
}

function resolveSdkVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@typesafe-ai/sdk/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function tryGetGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export interface ReportJsonHeader {
  generatedAt: string;
  sdkVersion: string;
  nodeVersion: string;
  gitCommit?: string;
}

export interface ReportJson {
  header: ReportJsonHeader;
  comparison: ComparisonResult;
}

/** Writes `comparison`, plus header metadata, to `outPath` as JSON. */
export function writeReportJson(comparison: ComparisonResult, outPath: string): void {
  const header: ReportJsonHeader = {
    generatedAt: new Date().toISOString(),
    sdkVersion: resolveSdkVersion(),
    nodeVersion: process.version,
  };
  const gitCommit = tryGetGitCommit();
  if (gitCommit !== undefined) {
    header.gitCommit = gitCommit;
  }

  const payload: ReportJson = { header, comparison };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
}
