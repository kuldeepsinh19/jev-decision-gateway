import type { ChoiceDecisionDef, DecisionSet, NoulDecisionDef } from "@jev-decision-gateway/core";

import type { AgentState } from "./state.js";
import type { ToolName } from "./tools.js";
import { FINISH_SENTINEL } from "./tools.js";

/**
 * `policy.minConfidence` for every decision in this file is `0.6` -- a reasonable, demo-wide
 * default (not derived from anything in `packages/core`), documented here once rather than
 * repeated as a magic number at each call site. A real deployment would tune this per decision.
 */
const DEFAULT_MIN_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------------------------
// Pre-flight dependent decision pair (used once, before the main loop, via `gateway.chain()`).
// ---------------------------------------------------------------------------------------------

export type TaskCategory = "lookup" | "calculation" | "multi-step";

/** First step of the pre-flight chain: classify the task into a coarse category. */
export function buildTaskCategoryDecision(task: string): ChoiceDecisionDef {
  return {
    kind: "choice",
    id: "taskCategory",
    instructions: `Classify this task into a category to guide which tools the agent should prefer: "${task}"`,
    options: {
      lookup: "The task is primarily about looking up or retrieving existing information.",
      calculation: "The task is primarily a numeric/arithmetic computation.",
      "multi-step": "The task requires multiple different steps and/or tools to complete.",
    },
    // Falls back to the least tool-restrictive, safest category when Jev is unavailable.
    policy: { minConfidence: DEFAULT_MIN_CONFIDENCE, fallbackAction: "lookup" },
  };
}

interface ToolSubsetConfig {
  options: Record<string, string>;
  fallback: string;
}

/**
 * The second step's options/instructions are literally computed FROM the first step's resolved
 * `category` -- this is the dependent decision pair `gateway.chain()` exists for (Global
 * Constraint 3 / the plan's flagship-example requirement), not just two unrelated decisions asked
 * back-to-back.
 */
const TOOL_SUBSETS_BY_CATEGORY: Record<TaskCategory, ToolSubsetConfig> = {
  lookup: {
    options: {
      searchOnly: "Use only the search tool to look up information.",
      searchAndFile: "Use both the search and fileRead tools, since the answer may live in a file.",
    },
    fallback: "searchOnly",
  },
  calculation: {
    options: {
      calculatorOnly: "Use only the calculator tool.",
      calculatorAndSearch: "Use the calculator tool, consulting search for any reference values first.",
    },
    fallback: "calculatorOnly",
  },
  "multi-step": {
    options: {
      allTools: "Use any of search, calculator, and fileRead as needed across multiple steps.",
      coreToolsOnly: "Prefer search and calculator; only reach for fileRead if strictly necessary.",
    },
    fallback: "allTools",
  },
};

/** Second step of the pre-flight chain: depends on `category`, the first step's resolved action. */
export function buildToolSubsetDecision(category: string): ChoiceDecisionDef {
  const config =
    TOOL_SUBSETS_BY_CATEGORY[category as TaskCategory] ?? TOOL_SUBSETS_BY_CATEGORY.lookup;
  return {
    kind: "choice",
    id: "toolSubset",
    instructions: `Given the task category "${category}", pick which subset of tools the agent should prefer for this run.`,
    options: config.options,
    policy: { minConfidence: DEFAULT_MIN_CONFIDENCE, fallbackAction: config.fallback },
  };
}

// ---------------------------------------------------------------------------------------------
// Main per-iteration checkpoint: one 4-question fan-out `DecisionSet`, answered in a single
// `gateway.evaluate()` call (Global Constraint 3's batching).
// ---------------------------------------------------------------------------------------------

export type ModelTier = "mock-fast" | "mock-strong";

export interface MainCheckpointDecisions extends DecisionSet {
  modelTier: ChoiceDecisionDef;
  nextTool: ChoiceDecisionDef;
  shouldContinue: NoulDecisionDef;
  verifyOutput: NoulDecisionDef;
}

/** Action names used by the loop when reading back `nextTool`'s resolved choice. */
export type NextToolAction = ToolName | typeof FINISH_SENTINEL;

export function buildMainCheckpointDecisions(state: AgentState): MainCheckpointDecisions {
  return {
    modelTier: {
      kind: "choice",
      id: "modelTier",
      instructions:
        "Pick which simulated model tier should generate the final answer once the agent is ready to finish: a fast/cheap tier for simple tasks, a strong/expensive tier for anything that needs careful reasoning.",
      options: {
        "mock-fast": "Fast, cheap simulated tier -- good enough for simple/well-understood tasks.",
        "mock-strong": "Slower, more expensive simulated tier -- for tasks needing careful reasoning.",
      },
      // Falls back to the cheap tier: if Jev is unavailable we should not assume the expensive
      // tier is warranted.
      policy: { minConfidence: DEFAULT_MIN_CONFIDENCE, fallbackAction: "mock-fast" },
    },
    nextTool: {
      kind: "choice",
      id: "nextTool",
      instructions: `Given the task and progress so far, pick the next tool to call, or "finish" if enough information has been gathered to answer.\nTask: "${state.task}"\nProgress so far: ${state.scratchpad || "(nothing yet)"}`,
      options: {
        search: "Search for information relevant to the task.",
        calculator: "Perform a calculation relevant to the task.",
        fileRead: "Read a file relevant to the task.",
        [FINISH_SENTINEL]: "Enough information has been gathered; generate the final answer now.",
      },
      // This fallback matters more than any other in this file: if Jev is down, a naive fallback
      // to "keep using a tool" could spin the loop until the hard iteration cap. Falling back to
      // "finish" instead means an outage degrades to "answer now, possibly with less research"
      // rather than "loop uselessly until the cap".
      policy: { minConfidence: DEFAULT_MIN_CONFIDENCE, fallbackAction: FINISH_SENTINEL },
    },
    shouldContinue: {
      kind: "noul",
      id: "shouldContinue",
      instructions:
        "Should the agent keep gathering information (true), or is it time to move to finalizing an answer (false)?",
      trueDescription: "Keep gathering information.",
      falseDescription: "Move to finalizing an answer now.",
      policy: {
        minConfidence: DEFAULT_MIN_CONFIDENCE,
        trueAction: "continue",
        falseAction: "stop",
        // Safe default: the hard iteration cap in loop.ts bounds total spend regardless, so
        // falling back to "continue" simply lets the (code-enforced) cap be the deciding factor.
        fallbackAction: "continue",
      },
    },
    verifyOutput: {
      kind: "noul",
      id: "verifyOutput",
      instructions:
        "Does the draft answer adequately address the task (true = pass), or does it need another refinement pass (false = fail)?",
      trueDescription: "The draft answer passes verification.",
      falseDescription: "The draft answer needs another refinement pass.",
      policy: {
        minConfidence: DEFAULT_MIN_CONFIDENCE,
        trueAction: "pass",
        falseAction: "fail",
        // Safe default: treat an unverifiable answer as unverified rather than blindly trusting
        // it -- this is bounded by `maxVerifyRetries` (a hard cap Jev cannot override), so it can
        // never loop forever even though it "fails safe" toward more scrutiny.
        fallbackAction: "fail",
      },
    },
  };
}
