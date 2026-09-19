import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MissingApiKeyError, type LLMRequest } from "../types.js";

const createMock = vi.fn();
const anthropicConstructorMock = vi.fn();

// Zero real network calls: the real `@anthropic-ai/sdk` package is fully stubbed. The constructor
// mock lets tests assert whether/how the SDK client was actually constructed; `createMock` stands
// in for `client.messages.create`. `vi.mock` is hoisted above the imports below by vitest, so the
// mock is in effect before `./provider.js` (which imports the real SDK) loads.
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: createMock };
    constructor(...args: unknown[]) {
      anthropicConstructorMock(...args);
    }
  }
  return { Anthropic };
});

const { AnthropicProvider } = await import("./provider.js");

const REQUEST: LLMRequest = {
  system: "Be concise.",
  messages: [{ role: "user", content: "Hello there" }],
  maxTokens: 256,
  temperature: 0.4,
};

describe("AnthropicProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
    anthropicConstructorMock.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructing the provider never throws even with no key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => new AnthropicProvider({ model: "claude-sonnet-4-5" })).not.toThrow();
  });

  it("complete() throws MissingApiKeyError (not a generic error) when no key is configured or in env, and never constructs the SDK client", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5" });

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(anthropicConstructorMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("resolves the key from process.env.ANTHROPIC_API_KEY when no explicit apiKey is passed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key-123");
    createMock.mockResolvedValue({
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "Hi!" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5" });
    await provider.complete(REQUEST);

    expect(anthropicConstructorMock).toHaveBeenCalledWith({ apiKey: "env-key-123" });
  });

  it("an explicit apiKey takes priority over the environment variable", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key-123");
    createMock.mockResolvedValue({
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "Hi!" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5", apiKey: "explicit-key" });
    await provider.complete(REQUEST);

    expect(anthropicConstructorMock).toHaveBeenCalledWith({ apiKey: "explicit-key" });
  });

  it("maps request fields onto messages.create, including the top-level system field", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5" });
    await provider.complete(REQUEST);

    expect(createMock).toHaveBeenCalledWith({
      model: "claude-sonnet-4-5",
      system: "Be concise.",
      messages: [{ role: "user", content: "Hello there" }],
      max_tokens: 256,
      temperature: 0.4,
    });
  });

  it("defaults max_tokens when LLMRequest.maxTokens is unset (Anthropic requires it)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5" });
    await provider.complete({ messages: [{ role: "user", content: "hi" }] });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.max_tokens).toBeGreaterThan(0);
    expect(callArgs.system).toBeUndefined();
  });

  it("maps the real response's usage/text/model fields onto LLMResponse, with simulated: false", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "claude-sonnet-4-5-20260101",
      content: [
        { type: "text", text: "The answer is " },
        { type: "text", text: "4." },
      ],
      usage: { input_tokens: 42, output_tokens: 7 },
    });

    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5" });
    const response = await provider.complete(REQUEST);

    expect(response.text).toBe("The answer is 4.");
    expect(response.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(response.model).toBe("claude-sonnet-4-5-20260101");
    expect(response.simulated).toBe(false);
    expect(response.costUsd).toBeGreaterThan(0);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("ignores non-text content blocks (e.g. tool_use) when building `text`", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "claude-sonnet-4-5",
      content: [
        { type: "tool_use", id: "t1", name: "lookup", input: {} },
        { type: "text", text: "final answer" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider({ model: "claude-sonnet-4-5" });
    const response = await provider.complete(REQUEST);

    expect(response.text).toBe("final answer");
  });
});
