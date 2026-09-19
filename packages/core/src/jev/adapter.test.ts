import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const systemOneMock = vi.fn();

vi.mock("@typesafe-ai/sdk", () => {
  class TypeSafeClient {
    constructor() {}
    systemOne(...args: unknown[]) {
      return systemOneMock(...args);
    }
  }
  return {
    TypeSafeClient,
    choice: vi.fn((instructions: unknown, criteria: unknown) => ({
      type: "choice",
      instructions,
      criteria,
    })),
    score: vi.fn((instructions: unknown, criteria: unknown) => ({
      type: "score",
      instructions,
      criteria,
    })),
    noul: vi.fn((instructions: unknown, criteria: unknown) => ({
      type: "noul",
      instructions,
      criteria,
    })),
  };
});

import { askJev } from "./adapter.js";
import { createJevClient } from "./client.js";
import type { NoulDecisionDef } from "./builders.js";

const FAKE_API_KEY = "sk-fake-test-key-do-not-use-1234567890";

const noulDef: NoulDecisionDef = {
  kind: "noul",
  id: "continue",
  instructions: "should the agent continue?",
  policy: {
    minConfidence: 0.5,
    trueAction: "continue",
    falseAction: "halt",
    fallbackAction: "halt",
  },
};

function makeHandle(overrides: Parameters<typeof createJevClient>[0] = {}) {
  const handle = createJevClient({
    apiKey: FAKE_API_KEY,
    timeoutMs: 200,
    ...overrides,
  });
  if (!handle) throw new Error("test setup: expected a non-null handle");
  return handle;
}

beforeEach(() => {
  systemOneMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("askJev", () => {
  it("returns null immediately when handle is null (MISSING_KEY path), without calling the SDK", async () => {
    const result = await askJev(null, {
      state: {},
      questions: { continue: noulDef },
    });
    expect(result).toBeNull();
    expect(systemOneMock).not.toHaveBeenCalled();
  });

  it("returns mapped answers and usage on a successful call", async () => {
    systemOneMock.mockResolvedValue({
      model: "jev-latest",
      answers: { continue: { type: "noul", noul: 0.92 } },
      usage: { input_tokens: 41, output_tokens: 7 },
    });

    const result = await askJev(makeHandle(), {
      state: { foo: "bar" },
      questions: { continue: noulDef },
    });

    expect(result).toEqual({
      answers: { continue: { type: "noul", noul: 0.92 } },
      usage: { inputTokens: 41, outputTokens: 7 },
    });
  });

  it("passes state and the built SDK question through to systemOne, with an AbortSignal", async () => {
    systemOneMock.mockResolvedValue({
      model: "jev-latest",
      answers: { continue: { type: "noul", noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await askJev(makeHandle(), {
      state: { step: 3 },
      questions: { continue: noulDef },
    });

    expect(systemOneMock).toHaveBeenCalledTimes(1);
    const [request, options] = systemOneMock.mock.calls[0] as [
      Record<string, unknown>,
      { signal?: AbortSignal },
    ];
    expect(request.state).toEqual({ step: 3 });
    expect(request.questions).toHaveProperty("continue");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a missing usage field defensively, returning usage: null", async () => {
    systemOneMock.mockResolvedValue({
      model: "jev-latest",
      answers: { continue: { type: "noul", noul: 0.5 } },
    });

    const result = await askJev(makeHandle(), {
      state: {},
      questions: { continue: noulDef },
    });

    expect(result).toEqual({
      answers: { continue: { type: "noul", noul: 0.5 } },
      usage: null,
    });
  });

  it("drops a structurally-malformed answer instead of failing the whole call", async () => {
    systemOneMock.mockResolvedValue({
      model: "jev-latest",
      answers: {
        continue: { type: "noul", noul: "not-a-number" },
        other: { type: "noul", noul: 0.4 },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await askJev(makeHandle(), {
      state: {},
      questions: { continue: noulDef, other: { ...noulDef, id: "other" } },
    });

    expect(result?.answers).toEqual({ other: { type: "noul", noul: 0.4 } });
    expect(result?.answers).not.toHaveProperty("continue");
  });

  it.each([401, 422, 429, 529])("returns null on an HTTP %i error", async (status) => {
    const err = Object.assign(new Error(`HTTP ${status}`), {
      status,
      name: "APIError",
    });
    systemOneMock.mockRejectedValue(err);

    const result = await askJev(makeHandle(), {
      state: {},
      questions: { continue: noulDef },
    });

    expect(result).toBeNull();
  });

  it("returns null on a hard network error", async () => {
    systemOneMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await askJev(makeHandle(), {
      state: {},
      questions: { continue: noulDef },
    });

    expect(result).toBeNull();
  });

  it("returns null when the caller's own AbortSignal fires", async () => {
    const controller = new AbortController();
    systemOneMock.mockImplementation(
      (_req: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );

    const promise = askJev(
      makeHandle(),
      { state: {}, questions: { continue: noulDef } },
      { signal: controller.signal }
    );
    controller.abort();

    await expect(promise).resolves.toBeNull();
  });

  it("returns null when our own timeoutMs deadline elapses", async () => {
    systemOneMock.mockImplementation(
      (_req: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("TimedOut", "TimeoutError"))
          );
        })
    );

    const result = await askJev(makeHandle({ timeoutMs: 20 }), {
      state: {},
      questions: { continue: noulDef },
    });

    expect(result).toBeNull();
  });

  it("never logs the configured API key across any failure path (console.warn/debug/error/log)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Worst case: the underlying error's own message happens to embed the key (e.g. an
    // upstream library echoing request details back in an error string).
    const err = Object.assign(new Error(`Unauthorized using key ${FAKE_API_KEY}`), { status: 401 });
    systemOneMock.mockRejectedValue(err);

    const handle = makeHandle({ logLevel: "debug" });
    const result = await askJev(handle, {
      state: {},
      questions: { continue: noulDef },
    });

    expect(result).toBeNull();
    for (const spy of [warnSpy, debugSpy, errorSpy, logSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(JSON.stringify(arg)).not.toContain(FAKE_API_KEY);
        }
      }
    }
  });

  it("logs nothing at all when logLevel is silent", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    systemOneMock.mockRejectedValue(new Error("boom"));
    const handle = makeHandle({ logLevel: "silent" });
    const result = await askJev(handle, {
      state: {},
      questions: { continue: noulDef },
    });

    expect(result).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });
});
