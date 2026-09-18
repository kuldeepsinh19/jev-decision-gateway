import { describe, expect, it } from "vitest";

import type { LLMRequest } from "../types.js";
import { MockProvider } from "./provider.js";

const REQUEST: LLMRequest = {
  system: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "What is the capital of France?" },
    { role: "assistant", content: "Paris." },
    { role: "user", content: "And of Germany?" },
  ],
};

describe("MockProvider", () => {
  it("is fully deterministic: same input twice -> identical output", async () => {
    const provider = new MockProvider("mock-strong");
    const first = await provider.complete(REQUEST);
    const second = await provider.complete(structuredClone(REQUEST));
    expect(second).toEqual(first);
  });

  it("always reports simulated: true", async () => {
    const provider = new MockProvider("mock-fast");
    const response = await provider.complete(REQUEST);
    expect(response.simulated).toBe(true);
  });

  it("templates the last user message into the response text", async () => {
    const provider = new MockProvider("mock-strong");
    const response = await provider.complete(REQUEST);
    expect(response.text).toContain("And of Germany?");
  });

  it("produces different text for different last-user-message input", async () => {
    const provider = new MockProvider("mock-strong");
    const a = await provider.complete(REQUEST);
    const b = await provider.complete({
      messages: [{ role: "user", content: "Completely different question." }],
    });
    expect(a.text).not.toBe(b.text);
  });

  it("uses the configured tier's simulated latency and a positive cost", async () => {
    const strong = await new MockProvider("mock-strong").complete(REQUEST);
    const fast = await new MockProvider("mock-fast").complete(REQUEST);
    expect(strong.latencyMs).toBe(1400);
    expect(fast.latencyMs).toBe(450);
    expect(strong.costUsd).toBeGreaterThan(0);
    expect(fast.costUsd).toBeGreaterThan(0);
  });

  it("reports the tier's own name in `name` and a labeled model", async () => {
    const provider = new MockProvider("mock-strong");
    expect(provider.name).toBe("mock");
    const response = await provider.complete(REQUEST);
    expect(response.model).toContain("simulated");
  });

  it("computes usage from estimateTokens on the request content", async () => {
    const provider = new MockProvider("mock-strong");
    const response = await provider.complete(REQUEST);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
  });

  it("never touches the network (no fetch/http usage) — sanity: resolves quickly with no globals patched", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      throw new Error("MockProvider must never call fetch");
    };
    try {
      const provider = new MockProvider("mock-fast");
      await provider.complete(REQUEST);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
