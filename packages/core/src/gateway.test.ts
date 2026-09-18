import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const askJevMock = vi.fn();

// Mocked at the `askJev` boundary itself (not the underlying `@typesafe-ai/sdk` package): this
// lets every test assert call count / call args directly against the exact function
// `gateway.ts` is contracted to call, and keeps `createJevClient` (Task 2, already tested in
// `jev/client.test.ts`) real -- so the MISSING_KEY fail-open path below exercises its actual
// env-fallback logic, not a stand-in for it. `TypeSafeClient`'s own constructor is confirmed
// side-effect-free (see dist/index.mjs), so building a real handle with a fake key is safe: since
// `askJev` is mocked, the handle's `.client` is never actually invoked.
vi.mock("./jev/adapter.js", () => ({
  askJev: (...args: unknown[]) => askJevMock(...args),
}));

import { DecisionGateway } from "./gateway.js";
import type {
  ChoiceDecisionDef,
  NoulDecisionDef,
  ScoreDecisionDef,
} from "./types.js";

const choiceDef: ChoiceDecisionDef = {
  kind: "choice",
  id: "route",
  options: { search: "look it up", finish: "done" },
  policy: { minConfidence: 0.5, fallbackAction: "finish" },
};

const scoreDef: ScoreDecisionDef = {
  kind: "score",
  id: "quality",
  levels: ["poor", "good"],
  policy: {
    minConfidence: 0.5,
    thresholds: [{ atOrAbove: 0.5, action: "good" }],
    fallbackAction: "poor",
  },
};

const noulDef: NoulDecisionDef = {
  kind: "noul",
  id: "continue",
  policy: {
    minConfidence: 0.3,
    trueAction: "continue",
    falseAction: "halt",
    fallbackAction: "halt",
  },
};

beforeEach(() => {
  askJevMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("DecisionGateway.evaluate", () => {
  it("batches a 3-entry decisions map into exactly one askJev call (Global Constraint 3)", async () => {
    askJevMock.mockResolvedValue({
      answers: {
        route: {
          type: "choice",
          choice: "search",
          confidence: 0.9,
          probabilities: { search: 0.9, finish: 0.1 },
        },
        quality: {
          type: "score",
          score: 0.9,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        },
        continue: { type: "noul", noul: 0.9 },
      },
      usage: { inputTokens: 12, outputTokens: 4 },
    });

    const gateway = new DecisionGateway({ apiKey: "test-key" });
    const result = await gateway.evaluate({
      state: { text: "hello" },
      decisions: { route: choiceDef, quality: scoreDef, continue: noulDef },
    });

    expect(askJevMock).toHaveBeenCalledTimes(1);
    const [, request] = askJevMock.mock.calls[0] as [
      unknown,
      { state: unknown; questions: unknown },
    ];
    expect(request.state).toEqual({ text: "hello" });
    expect(Object.keys(request.questions as object).sort()).toEqual([
      "continue",
      "quality",
      "route",
    ]);

    expect(result.decisions.route).toMatchObject({
      action: "search",
      usedFallback: false,
    });
    expect(result.decisions.quality).toMatchObject({
      action: "good",
      usedFallback: false,
    });
    expect(result.decisions.continue).toMatchObject({
      action: "continue",
      usedFallback: false,
    });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(result.trace).toHaveLength(3);
  });

  it("fails open with zero network calls when no API key is configured or present in env (Global Constraint 5)", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");

    const gateway = new DecisionGateway();
    const result = await gateway.evaluate({
      state: {},
      decisions: { route: choiceDef, quality: scoreDef, continue: noulDef },
    });

    expect(askJevMock).not.toHaveBeenCalled();

    for (const id of ["route", "quality", "continue"] as const) {
      expect(result.decisions[id]).toMatchObject({
        usedFallback: true,
        fallbackReason: "MISSING_KEY",
      });
    }
    expect(result.usage).toBeNull();
    // "near 0": no network call was made, so this should be a synchronous, sub-millisecond
    // computation -- a generous bound avoids flaking on a slow CI machine.
    expect(result.latencyMs).toBeLessThan(50);
  });

  it("invokes onTrace once per decision id per evaluate() call", async () => {
    askJevMock.mockResolvedValue({
      answers: {
        route: {
          type: "choice",
          choice: "search",
          confidence: 0.9,
          probabilities: { search: 0.9 },
        },
        quality: {
          type: "score",
          score: 0.9,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        },
        continue: { type: "noul", noul: 0.9 },
      },
      usage: null,
    });

    const onTrace = vi.fn();
    const gateway = new DecisionGateway({ apiKey: "test-key", onTrace });
    await gateway.evaluate({
      state: {},
      decisions: { route: choiceDef, quality: scoreDef, continue: noulDef },
    });

    expect(onTrace).toHaveBeenCalledTimes(3);
    const decisionIds = onTrace.mock.calls.map(
      (call) => (call[0] as { decisionId: string }).decisionId
    );
    expect(decisionIds.sort()).toEqual(["continue", "quality", "route"]);
  });

  it("resolves with fallback outcomes once askJev's own deadline elapses, rather than hanging forever", async () => {
    vi.useFakeTimers();

    // Simulates `askJev`'s documented "answer or null, never throws, never hangs" contract
    // (jev/adapter.ts, Task 2): its own internal `handle.timeoutMs` deadline eventually fires and
    // it resolves to `null`. `gateway.ts` must not add any further wrapping/stalling on top of
    // that single awaited call -- it should simply convert the eventual `null` into fallback
    // outcomes as soon as it arrives.
    askJevMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(null), 500);
        })
    );

    const gateway = new DecisionGateway({ apiKey: "test-key", timeoutMs: 500 });
    const pending = gateway.evaluate({
      state: {},
      decisions: { continue: noulDef },
    });

    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(askJevMock).toHaveBeenCalledTimes(1);
    expect(result.decisions.continue).toMatchObject({
      usedFallback: true,
      fallbackReason: "ERROR",
    });
    expect(result.usage).toBeNull();
  });
});

describe("DecisionGateway.chain", () => {
  it("calls askJev exactly twice for two dependent steps, threading the first step's answer into the second call's state", async () => {
    askJevMock
      .mockResolvedValueOnce({
        answers: { continue: { type: "noul", noul: 0.9 } },
        usage: null,
      })
      .mockResolvedValueOnce({
        answers: {
          route: {
            type: "choice",
            choice: "search",
            confidence: 0.9,
            probabilities: { search: 0.9 },
          },
        },
        usage: null,
      });

    const gateway = new DecisionGateway({ apiKey: "test-key" });
    const chained = await gateway.chain(
      { text: "hello" },
      async ({ evaluate }) => {
        const step1 = await evaluate({ decisions: { continue: noulDef } });
        const step2 = await evaluate({
          state: { previousAction: step1.decisions.continue.action },
          decisions: { route: choiceDef },
        });
        return step2.decisions.route.action;
      }
    );

    expect(askJevMock).toHaveBeenCalledTimes(2);

    const [, firstRequest] = askJevMock.mock.calls[0] as [
      unknown,
      { state: unknown },
    ];
    expect(firstRequest.state).toEqual({ text: "hello" });

    const [, secondRequest] = askJevMock.mock.calls[1] as [
      unknown,
      { state: unknown },
    ];
    expect(secondRequest.state).toEqual({
      text: "hello",
      previousAction: "continue",
    });

    expect(chained.value).toBe("search");
    expect(chained.steps).toHaveLength(2);
    expect(chained.trace).toHaveLength(2);
    expect(typeof chained.totalLatencyMs).toBe("number");
  });
});
