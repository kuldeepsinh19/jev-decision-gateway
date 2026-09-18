import { describe, expect, it, vi } from "vitest";

import type { DecisionGateway, DecisionOutcome, EvaluationResult } from "@jev-decision-gateway/core";
import { MockProvider } from "@jev-decision-gateway/providers";

import { runLoop, type TieredProviders } from "./loop.js";

/**
 * A stub `DecisionGateway`-shaped object, per the brief: only `evaluate`/`chain` are mocked, the
 * real `DecisionGateway` class is never constructed. Cast to `DecisionGateway` at each call site
 * since `runLoop`'s parameter type is the real class.
 */
function makeStubGateway(opts: {
  evaluate: (...args: unknown[]) => Promise<EvaluationResult<never>>;
}): DecisionGateway {
  const chainImpl = async (
    _initialState: unknown,
    callback: (ctx: { evaluate: typeof opts.evaluate }) => Promise<unknown>
  ) => {
    const value = await callback({ evaluate: opts.evaluate });
    return { value, steps: [], trace: [], totalLatencyMs: 1 };
  };
  return {
    evaluate: opts.evaluate,
    chain: chainImpl,
  } as unknown as DecisionGateway;
}

function outcome(
  id: string,
  action: string,
  overrides: Partial<DecisionOutcome> = {}
): DecisionOutcome {
  return {
    id,
    raw: null,
    confidence: 0.9,
    action,
    usedFallback: false,
    latencyMs: 5,
    ...overrides,
  };
}

function makeProviders(): TieredProviders {
  return {
    "mock-fast": new MockProvider("mock-fast"),
    "mock-strong": new MockProvider("mock-strong"),
  };
}

// The pre-flight chain() step always resolves via the stub's `evaluate`, which every test below
// wires up to answer `taskCategory`/`toolSubset` alongside the main checkpoint's four decisions --
// simplest way to keep one `evaluate` mock driving both the chain() callback and the main loop.
function preflightAnswers(): Record<string, DecisionOutcome> {
  return {
    taskCategory: outcome("taskCategory", "lookup"),
    toolSubset: outcome("toolSubset", "searchOnly"),
  };
}

describe("runLoop", () => {
  it("terminates at maxIterations even when shouldContinue always resolves to continue", async () => {
    const evaluate = vi.fn(async (args: { decisions: Record<string, unknown> }) => {
      const ids = Object.keys(args.decisions);
      const answers: Record<string, DecisionOutcome> = { ...preflightAnswers() };
      if (ids.includes("nextTool")) {
        answers.modelTier = outcome("modelTier", "mock-fast");
        answers.nextTool = outcome("nextTool", "search");
        answers.shouldContinue = outcome("shouldContinue", "continue");
        answers.verifyOutput = outcome("verifyOutput", "pass");
      }
      const decisions: Record<string, DecisionOutcome> = {};
      for (const id of ids) decisions[id] = answers[id];
      return { decisions, usage: { inputTokens: 1, outputTokens: 1 }, trace: [], latencyMs: 2 };
    });

    const gateway = makeStubGateway({ evaluate: evaluate as never });
    const result = await runLoop(gateway, makeProviders(), "do something", {
      maxIterations: 3,
    });

    expect(result.finalState.iteration).toBe(3);
    expect(result.finalState.done).toBe(true);
    // Never naturally finished (nextTool never resolved to "finish"), so the hard cap's forced
    // finalize path must have produced an answer anyway.
    expect(result.finalState.draftAnswer).not.toBeNull();
    expect(result.llmCallCount).toBeGreaterThanOrEqual(1);
  });

  it("follows the mocked nextTool answer for tool routing", async () => {
    const toolSequence = ["search", "calculator", "finish"];
    let mainCallIndex = 0;

    const evaluate = vi.fn(async (args: { decisions: Record<string, unknown> }) => {
      const ids = Object.keys(args.decisions);
      const answers: Record<string, DecisionOutcome> = { ...preflightAnswers() };
      if (ids.includes("nextTool")) {
        const chosenTool = toolSequence[mainCallIndex];
        mainCallIndex += 1;
        answers.modelTier = outcome("modelTier", "mock-fast");
        answers.nextTool = outcome("nextTool", chosenTool);
        answers.shouldContinue = outcome("shouldContinue", "continue");
        answers.verifyOutput = outcome("verifyOutput", "pass");
      }
      const decisions: Record<string, DecisionOutcome> = {};
      for (const id of ids) decisions[id] = answers[id];
      return { decisions, usage: null, trace: [], latencyMs: 2 };
    });

    const gateway = makeStubGateway({ evaluate: evaluate as never });
    const result = await runLoop(gateway, makeProviders(), "look something up", {
      maxIterations: 6,
    });

    expect(result.finalState.toolsUsed.map((t) => t.tool)).toEqual(["search", "calculator"]);
    expect(result.finalState.done).toBe(true);
    expect(result.finalState.iteration).toBe(3);
    expect(result.llmCallCount).toBe(1);
  });

  it("never exceeds maxVerifyRetries iterations of refinement", async () => {
    const evaluate = vi.fn(async (args: { decisions: Record<string, unknown> }) => {
      const ids = Object.keys(args.decisions);
      const answers: Record<string, DecisionOutcome> = { ...preflightAnswers() };
      if (ids.includes("nextTool")) {
        answers.modelTier = outcome("modelTier", "mock-fast");
        answers.nextTool = outcome("nextTool", "finish");
        answers.shouldContinue = outcome("shouldContinue", "stop");
        answers.verifyOutput = outcome("verifyOutput", "fail");
      }
      const decisions: Record<string, DecisionOutcome> = {};
      for (const id of ids) decisions[id] = answers[id];
      return { decisions, usage: null, trace: [], latencyMs: 2 };
    });

    const gateway = makeStubGateway({ evaluate: evaluate as never });
    const result = await runLoop(gateway, makeProviders(), "compute something", {
      maxIterations: 10,
      maxVerifyRetries: 2,
    });

    expect(result.finalState.verifyRetries).toBe(2);
    expect(result.finalState.iteration).toBe(3); // 1 initial attempt + 2 refinements
    expect(result.finalState.done).toBe(true);
    expect(result.llmCallCount).toBe(3);
  });

  it("completes without throwing when every decision comes back as a MISSING_KEY fallback", async () => {
    const evaluate = vi.fn(async (args: { decisions: Record<string, unknown> }) => {
      const ids = Object.keys(args.decisions);
      const missingKeyAnswers: Record<string, DecisionOutcome> = {
        taskCategory: outcome("taskCategory", "lookup", {
          usedFallback: true,
          fallbackReason: "MISSING_KEY",
          confidence: null,
        }),
        toolSubset: outcome("toolSubset", "searchOnly", {
          usedFallback: true,
          fallbackReason: "MISSING_KEY",
          confidence: null,
        }),
        modelTier: outcome("modelTier", "mock-fast", {
          usedFallback: true,
          fallbackReason: "MISSING_KEY",
          confidence: null,
        }),
        nextTool: outcome("nextTool", "finish", {
          usedFallback: true,
          fallbackReason: "MISSING_KEY",
          confidence: null,
        }),
        shouldContinue: outcome("shouldContinue", "continue", {
          usedFallback: true,
          fallbackReason: "MISSING_KEY",
          confidence: null,
        }),
        verifyOutput: outcome("verifyOutput", "fail", {
          usedFallback: true,
          fallbackReason: "MISSING_KEY",
          confidence: null,
        }),
      };
      const decisions: Record<string, DecisionOutcome> = {};
      for (const id of ids) decisions[id] = missingKeyAnswers[id];
      return { decisions, usage: null, trace: [], latencyMs: 0 };
    });

    const gateway = makeStubGateway({ evaluate: evaluate as never });

    // Calling this at all, and awaiting it, is the throw-check: if runLoop threw, this `await`
    // would reject and the test would fail before reaching any assertion below.
    const result = await runLoop(gateway, makeProviders(), "a task with no Jev key available", {
      maxIterations: 6,
      maxVerifyRetries: 2,
    });

    expect(result.finalState.done).toBe(true);
    expect(result.finalState.draftAnswer).not.toBeNull();
    expect(result.fallbackCount).toBeGreaterThan(0);
  });
});
