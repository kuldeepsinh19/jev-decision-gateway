import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MissingApiKeyError, type LLMRequest } from "../types.js";

const createMock = vi.fn();
const openAiConstructorMock = vi.fn();

// Zero real network calls: the real `openai` package is fully stubbed. The constructor mock lets
// tests assert whether/how the SDK client was actually constructed; `createMock` stands in for
// `client.chat.completions.create`. `vi.mock` is hoisted above the imports below by vitest, so
// the mock is in effect before `./provider.js` (which imports the real `openai` package) loads.
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: createMock } };
    constructor(...args: unknown[]) {
      openAiConstructorMock(...args);
    }
  }
  return { OpenAI };
});

const { OpenAIProvider } = await import("./provider.js");

const REQUEST: LLMRequest = {
  system: "Be concise.",
  messages: [{ role: "user", content: "Hello there" }],
  maxTokens: 256,
  temperature: 0.4,
};

describe("OpenAIProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
    openAiConstructorMock.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructing the provider never throws even with no key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => new OpenAIProvider({ model: "gpt-4o" })).not.toThrow();
  });

  it("complete() throws MissingApiKeyError (not a generic error) when no key is configured or in env, and never constructs the SDK client", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const provider = new OpenAIProvider({ model: "gpt-4o" });

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(openAiConstructorMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("resolves the key from process.env.OPENAI_API_KEY when no explicit apiKey is passed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key-123");
    createMock.mockResolvedValue({
      model: "gpt-4o-2026-01-01",
      choices: [{ message: { content: "Hi!" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = new OpenAIProvider({ model: "gpt-4o" });
    await provider.complete(REQUEST);

    expect(openAiConstructorMock).toHaveBeenCalledWith({ apiKey: "env-key-123" });
  });

  it("an explicit apiKey takes priority over the environment variable", async () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key-123");
    createMock.mockResolvedValue({
      model: "gpt-4o",
      choices: [{ message: { content: "Hi!" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const provider = new OpenAIProvider({ model: "gpt-4o", apiKey: "explicit-key" });
    await provider.complete(REQUEST);

    expect(openAiConstructorMock).toHaveBeenCalledWith({ apiKey: "explicit-key" });
  });

  it("maps request fields onto chat.completions.create, including a mapped system message", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "gpt-4o",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const provider = new OpenAIProvider({ model: "gpt-4o" });
    await provider.complete(REQUEST);

    expect(createMock).toHaveBeenCalledWith({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello there" },
      ],
      max_completion_tokens: 256,
      temperature: 0.4,
    });
  });

  it("omits the system message when LLMRequest.system is unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "gpt-4o",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const provider = new OpenAIProvider({ model: "gpt-4o" });
    await provider.complete({ messages: [{ role: "user", content: "hi" }] });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("maps the real response's usage/text/model fields onto LLMResponse, with simulated: false", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "gpt-4o-2026-01-01",
      choices: [{ message: { content: "The answer is 4." } }],
      usage: { prompt_tokens: 42, completion_tokens: 7 },
    });

    const provider = new OpenAIProvider({ model: "gpt-4o" });
    const response = await provider.complete(REQUEST);

    expect(response.text).toBe("The answer is 4.");
    expect(response.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(response.model).toBe("gpt-4o-2026-01-01");
    expect(response.simulated).toBe(false);
    expect(response.costUsd).toBeGreaterThan(0);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("normalizes a null message content and a missing usage to safe defaults", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    createMock.mockResolvedValue({
      model: "gpt-4o",
      choices: [{ message: { content: null } }],
      usage: undefined,
    });

    const provider = new OpenAIProvider({ model: "gpt-4o" });
    const response = await provider.complete(REQUEST);

    expect(response.text).toBe("");
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
