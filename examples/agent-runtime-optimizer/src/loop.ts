import type {
  DecisionGateway,
  DecisionState,
  DecisionTrace,
  EvaluationResult,
  FallbackReason,
} from "@jev-decision-gateway/core";
import type { LLMProvider, LLMResponse, SimulatedTier } from "@jev-decision-gateway/providers";

import {
  buildMainCheckpointDecisions,
  buildTaskCategoryDecision,
  buildToolSubsetDecision,
  type MainCheckpointDecisions,
  type NextToolAction,
} from "./decisions.js";
import { createInitialState, type AgentState } from "./state.js";
import { FINISH_SENTINEL, callTool, type ToolName } from "./tools.js";

/**
 * ADAPTATION FROM THE BRIEF: `packages/providers`' `MockProvider` fixes its simulated tier
 * (`"mock-fast"` | `"mock-strong"`) at *construction* time (`new MockProvider(tier)`) -- there is
 * no per-call tier parameter on `LLMProvider.complete()`. The brief's sketched `runLoop(gateway,
 * provider: LLMProvider, ...)` can't express "use provider.complete(...) with the chosen
 * modelTier" with a single `LLMProvider` instance, since switching tiers means switching *which*
 * provider instance you call. `runLoop` therefore takes a small tier -> provider map instead of a
 * single provider; `index.ts` supplies one `MockProvider` per tier. This is the only signature
 * deviation from the brief in this file.
 */
export type TieredProviders = Record<SimulatedTier, LLMProvider>;

export interface RunLoopOptions {
  maxIterations?: number;
  maxVerifyRetries?: number;
}

export interface IterationLog {
  iteration: number;
  jevLatencyMs: number;
  jevUsage: { inputTokens: number; outputTokens: number } | null;
  decisionActions: Array<{
    id: string;
    action: string;
    confidence: number | null;
    usedFallback: boolean;
    fallbackReason?: FallbackReason;
  }>;
  toolCall?: { tool: string; input: string; output: string };
  generation?: { tier: string; response: LLMResponse; forced?: boolean };
  note?: string;
}

export interface PreflightSummary {
  category: string;
  toolSubset: string;
  jevCallCount: number;
  jevTotalLatencyMs: number;
}

/**
 * EXTENSION OF THE BRIEF'S SKETCHED RETURN SHAPE: the brief specifies exactly `{ finalState,
 * trace, jevCallCount, jevTotalLatencyMs, llmCallCount }`. All five are present below, unchanged
 * in meaning. `print.ts`'s required transcript format (per-iteration decision/tool lines, total
 * simulated LLM $ and ms, fallback counts) needs more structure than those five fields alone can
 * provide, so this return type is a strict superset: `iterationLogs`, `preflight`,
 * `llmTotalLatencyMs`, `llmTotalCostUsd`, and `fallbackCount` are additive, not replacements.
 */
export interface RunLoopResult {
  finalState: AgentState;
  trace: DecisionTrace[];
  jevCallCount: number;
  jevTotalLatencyMs: number;
  llmCallCount: number;
  llmTotalLatencyMs: number;
  llmTotalCostUsd: number;
  fallbackCount: number;
  preflight: PreflightSummary;
  iterationLogs: IterationLog[];
}

function toolInputFor(state: AgentState): string {
  // Deterministic demo simplification: every tool call in this example is driven by the task
  // string itself (the canned lookup tables in tools.ts are keyed on exactly this kind of input).
  // A production agent would derive a fresh, iteration-specific query here instead.
  return state.task;
}

function buildDecisionState(state: AgentState, preflight: PreflightSummary): DecisionState {
  return {
    task: state.task,
    iteration: state.iteration,
    scratchpad: state.scratchpad,
    toolsUsedCount: state.toolsUsed.length,
    verifyRetries: state.verifyRetries,
    preflightCategory: preflight.category,
    preflightToolSubset: preflight.toolSubset,
  };
}

function collectDecisionActions(
  result: EvaluationResult<MainCheckpointDecisions>
): IterationLog["decisionActions"] {
  return Object.values(result.decisions).map((outcome) => ({
    id: outcome.id,
    action: outcome.action,
    confidence: outcome.confidence,
    usedFallback: outcome.usedFallback,
    fallbackReason: outcome.fallbackReason,
  }));
}

function countFallbacks(actions: IterationLog["decisionActions"]): number {
  return actions.filter((a) => a.usedFallback).length;
}

/**
 * Runs the full agent control loop for one `task`, gated by `gateway.evaluate()`/`gateway.chain()`
 * instead of ad-hoc LLM calls for every control decision. Never throws: every Jev failure mode
 * (including "no API key at all") resolves to a fallback `DecisionOutcome` per Global Constraint
 * 5, and this loop is written so that a run made entirely of fallbacks still reaches a normal,
 * finished `AgentState` -- degraded, but not crashed.
 *
 * Two hard caps are enforced purely in this function's own control flow, never read from -- and
 * therefore never overridable by -- any Jev answer: `maxIterations` (default 6) and
 * `maxVerifyRetries` (default 2). Both are fixed once, in `createInitialState`, before the first
 * decision is ever asked.
 */
export async function runLoop(
  gateway: DecisionGateway,
  providers: TieredProviders,
  task: string,
  opts: RunLoopOptions = {}
): Promise<RunLoopResult> {
  const state = createInitialState(task, opts);
  const trace: DecisionTrace[] = [];
  const iterationLogs: IterationLog[] = [];

  let jevCallCount = 0;
  let jevTotalLatencyMs = 0;
  let llmCallCount = 0;
  let llmTotalLatencyMs = 0;
  let llmTotalCostUsd = 0;
  let fallbackCount = 0;

  // --- (1) Pre-flight dependent decision pair, run once via gateway.chain() -------------------
  const chainResult = await gateway.chain({ task }, async ({ evaluate }) => {
    const categoryResult = await evaluate({
      decisions: { taskCategory: buildTaskCategoryDecision(task) },
    });
    const category = categoryResult.decisions.taskCategory.action;
    const subsetResult = await evaluate({
      state: { preflightCategory: category },
      decisions: { toolSubset: buildToolSubsetDecision(category) },
    });
    return { category, toolSubset: subsetResult.decisions.toolSubset.action };
  });
  trace.push(...chainResult.trace);
  jevCallCount += chainResult.steps.length;
  jevTotalLatencyMs += chainResult.totalLatencyMs;
  fallbackCount += chainResult.steps.reduce(
    (sum, step) => sum + Object.values(step.decisions).filter((d) => d.usedFallback).length,
    0
  );

  const preflight: PreflightSummary = {
    category: chainResult.value.category,
    toolSubset: chainResult.value.toolSubset,
    jevCallCount: chainResult.steps.length,
    jevTotalLatencyMs: chainResult.totalLatencyMs,
  };

  // `forced`-ness is tracked by each call site when it builds an `IterationLog` entry, not by
  // this helper itself -- it always does the same thing regardless of why it was called.
  async function generate(tier: SimulatedTier): Promise<LLMResponse> {
    const response = await providers[tier].complete({
      system:
        "You are the final-answer generator for a demo agent loop. Answer the task concisely using the research gathered so far.",
      messages: [
        {
          role: "user",
          content: `Task: ${state.task}\n\nResearch so far:\n${state.scratchpad || "(none)"}`,
        },
      ],
    });
    llmCallCount += 1;
    llmTotalLatencyMs += response.latencyMs;
    llmTotalCostUsd += response.costUsd;
    state.draftAnswer = response.text;
    return response;
  }

  // --- (2) Main loop, hard-capped at state.maxIterations (never overridable by a Jev answer) --
  for (let i = 1; i <= state.maxIterations; i++) {
    state.iteration = i;
    const decisions = buildMainCheckpointDecisions(state);
    const result = await gateway.evaluate({
      state: buildDecisionState(state, preflight),
      decisions,
    });

    trace.push(...result.trace);
    jevCallCount += 1;
    jevTotalLatencyMs += result.latencyMs;
    const decisionActions = collectDecisionActions(result);
    fallbackCount += countFallbacks(decisionActions);

    const nextToolAction = result.decisions.nextTool.action as NextToolAction;
    const shouldContinueAction = result.decisions.shouldContinue.action;
    const wantsToFinish = nextToolAction === FINISH_SENTINEL || shouldContinueAction === "stop";

    const log: IterationLog = {
      iteration: i,
      jevLatencyMs: result.latencyMs,
      jevUsage: result.usage,
      decisionActions,
    };

    if (!wantsToFinish) {
      const output = callTool(nextToolAction as ToolName, toolInputFor(state));
      state.toolsUsed.push({ tool: nextToolAction, input: toolInputFor(state), output });
      state.scratchpad += `\n[iteration ${i}] ${nextToolAction}("${toolInputFor(state)}") -> ${output}`;
      log.toolCall = { tool: nextToolAction, input: toolInputFor(state), output };
      iterationLogs.push(log);
      continue;
    }

    // Either nextTool resolved to "finish", or shouldContinue said "stop" even though a tool was
    // chosen -- in the latter case we skip calling that tool this iteration and go straight to
    // generation, treating "stop" as an independent, higher-priority safety signal.
    const tier = result.decisions.modelTier.action as SimulatedTier;
    const response = await generate(tier);
    log.generation = { tier, response };

    const verifyAction = result.decisions.verifyOutput.action;
    const verifyPassed = verifyAction === "pass";

    if (!verifyPassed && state.verifyRetries < state.maxVerifyRetries) {
      state.verifyRetries += 1;
      state.scratchpad += `\n[iteration ${i}] verification failed -- refinement attempt ${state.verifyRetries}/${state.maxVerifyRetries}`;
      log.note = `verification failed; retrying (${state.verifyRetries}/${state.maxVerifyRetries})`;
      iterationLogs.push(log);
      continue;
    }

    if (!verifyPassed) {
      log.note = `verification never passed; force-finalizing after exhausting ${state.maxVerifyRetries} retries (hard cap, not overridable by Jev)`;
    }
    state.done = true;
    iterationLogs.push(log);
    break;
  }

  // --- Hard-cap fallback: if maxIterations was exhausted without ever finishing, force a
  // finalization outside of Jev's control entirely, so the run always ends in a finished state
  // (per Global Constraint 5's fail-open spirit) rather than silently returning with no answer.
  if (!state.done) {
    const forcedTier: SimulatedTier = "mock-fast";
    const response = await generate(forcedTier);
    state.done = true;
    state.scratchpad += `\n[forced finalize] maxIterations (${state.maxIterations}) reached without a natural finish; generated a best-effort answer with the "${forcedTier}" tier (hard cap, not overridable by Jev).`;
    iterationLogs.push({
      iteration: state.iteration,
      jevLatencyMs: 0,
      jevUsage: null,
      decisionActions: [],
      generation: { tier: forcedTier, response, forced: true },
      note: `forced finalize: maxIterations (${state.maxIterations}) reached`,
    });
  }

  return {
    finalState: state,
    trace,
    jevCallCount,
    jevTotalLatencyMs,
    llmCallCount,
    llmTotalLatencyMs,
    llmTotalCostUsd,
    fallbackCount,
    preflight,
    iterationLogs,
  };
}
