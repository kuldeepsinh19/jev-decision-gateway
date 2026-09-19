import type { RunLoopResult } from "./loop.js";

export interface FormatTranscriptInput {
  task: string;
  providerName: string;
  jevKeyDetected: boolean;
  loopResult: RunLoopResult;
}

function pad(label: string, width = 16): string {
  return label.length >= width ? label : label + " ".repeat(width - label.length);
}

function fmtMs(ms: number): string {
  return ms.toFixed(1);
}

function fmtUsd(usd: number): string {
  return usd.toFixed(6);
}

function avgConfidence(loopResult: RunLoopResult): number | null {
  const withConfidence = loopResult.iterationLogs
    .flatMap((log) => log.decisionActions)
    .filter((a) => a.confidence !== null) as Array<{ confidence: number }>;
  if (withConfidence.length === 0) return null;
  const sum = withConfidence.reduce((acc, a) => acc + a.confidence, 0);
  return sum / withConfidence.length;
}

/**
 * Formats a console transcript following the brief's template. Every Jev number here
 * (`latencyMs`, `usage`, `confidence`) is read straight from the real `EvaluationResult`/
 * `DecisionOutcome` fields produced by `DecisionGateway`; every LLM number (`latencyMs`,
 * `costUsd`) comes from the real `LLMResponse` shape returned by the (always simulated, in this
 * example) `MockProvider`, and is explicitly labeled "(SIMULATED, not measured)" wherever printed
 * so nobody mistakes a made-up cost/latency figure for a measured one.
 */
export function formatTranscript(input: FormatTranscriptInput): string {
  const { task, providerName, jevKeyDetected, loopResult } = input;
  const lines: string[] = [];

  lines.push("=== jev-decision-gateway :: Agent Runtime Optimizer ===");
  lines.push(`Task: "${task}"`);
  lines.push(
    `Provider: ${providerName} (simulated LLM)  |  Jev: ${jevKeyDetected ? "live" : "no key detected"}`
  );
  lines.push("");
  lines.push(
    `[Pre-flight chain: 2 dependent Jev calls, category="${loopResult.preflight.category}", toolSubset="${loopResult.preflight.toolSubset}", ${fmtMs(loopResult.preflight.jevTotalLatencyMs)}ms real]`
  );

  for (const log of loopResult.iterationLogs) {
    lines.push("");
    lines.push(`--- Iteration ${log.iteration}/${loopResult.finalState.maxIterations} ---`);
    if (log.decisionActions.length > 0) {
      const tokensIn = log.jevUsage?.inputTokens ?? 0;
      const tokensOut = log.jevUsage?.outputTokens ?? 0;
      lines.push(
        `[Jev fan-out: 1 systemOne call, ${log.decisionActions.length} questions, ${fmtMs(log.jevLatencyMs)}ms real, tokens in=${tokensIn} out=${tokensOut}]`
      );
      for (const action of log.decisionActions) {
        const confidenceStr = action.confidence === null ? "n/a" : action.confidence.toFixed(2);
        const fallbackSuffix = action.usedFallback ? ` [FALLBACK: ${action.fallbackReason}]` : "";
        lines.push(
          `  ${pad(action.id)} -> ${pad(action.action, 12)} (confidence ${confidenceStr})${fallbackSuffix}`
        );
      }
    }
    if (log.toolCall) {
      lines.push(
        `> tool:${log.toolCall.tool}("${log.toolCall.input}") -> "${log.toolCall.output}"`
      );
    }
    if (log.generation) {
      const forcedNote = log.generation.forced ? " [forced finalize]" : "";
      lines.push(
        `> generate(tier=${log.generation.tier}, SIMULATED, not measured): ${fmtMs(log.generation.response.latencyMs)}ms, $${fmtUsd(log.generation.response.costUsd)}${forcedNote}`
      );
      lines.push(`  draft answer: "${log.generation.response.text}"`);
    }
    if (log.note) {
      lines.push(`  note: ${log.note}`);
    }
  }

  const confidence = avgConfidence(loopResult);
  lines.push("");
  lines.push("=== Summary ===");
  lines.push(
    `Iterations used: ${loopResult.finalState.iteration}/${loopResult.finalState.maxIterations} | Verify retries: ${loopResult.finalState.verifyRetries}/${loopResult.finalState.maxVerifyRetries}`
  );
  lines.push(
    `Real Jev calls: ${loopResult.jevCallCount} (${fmtMs(loopResult.jevTotalLatencyMs)}ms total measured, avg confidence ${confidence === null ? "n/a" : confidence.toFixed(2)})`
  );
  lines.push(
    `Simulated LLM calls: ${loopResult.llmCallCount} (${fmtMs(loopResult.llmTotalLatencyMs)}ms simulated, $${fmtUsd(loopResult.llmTotalCostUsd)} simulated)`
  );
  lines.push(`Fallbacks triggered: ${loopResult.fallbackCount}`);
  lines.push(`Final answer: "${loopResult.finalState.draftAnswer ?? "(none)"}"`);

  return lines.join("\n");
}
