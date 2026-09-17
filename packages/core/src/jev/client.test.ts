import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructedConfigs: unknown[] = [];
let nextConstructorShouldThrow = false;

vi.mock("@typesafe-ai/sdk", () => {
  class TypeSafeClient {
    config: unknown;
    constructor(config: unknown) {
      constructedConfigs.push(config);
      if (nextConstructorShouldThrow) {
        throw new Error(
          "TypeSafeError: the API key is missing, configuration is invalid, or the runtime is unsupported."
        );
      }
      this.config = config;
    }
  }
  return { TypeSafeClient };
});

import { createJevClient } from "./client.js";

describe("createJevClient", () => {
  beforeEach(() => {
    constructedConfigs.length = 0;
    nextConstructorShouldThrow = false;
    vi.stubEnv("TYPESAFE_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null (never throws) when no API key is resolvable from config or env", () => {
    expect(createJevClient()).toBeNull();
    expect(createJevClient({})).toBeNull();
    expect(constructedConfigs).toHaveLength(0);
  });

  it("returns null when apiKey is whitespace-only", () => {
    expect(createJevClient({ apiKey: "   " })).toBeNull();
  });

  it("falls back to process.env.TYPESAFE_API_KEY when config.apiKey is omitted", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "env-key-123");
    const handle = createJevClient();
    expect(handle).not.toBeNull();
    expect(handle?.apiKey).toBe("env-key-123");
  });

  it("prefers an explicit config.apiKey over the environment variable", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "env-key-123");
    const handle = createJevClient({ apiKey: "explicit-key" });
    expect(handle?.apiKey).toBe("explicit-key");
  });

  it("applies documented defaults", () => {
    const handle = createJevClient({ apiKey: "k" });
    expect(handle?.timeoutMs).toBe(1500);
    expect(handle?.logLevel).toBe("warn");
  });

  it("honors explicit overrides", () => {
    const handle = createJevClient({
      apiKey: "k",
      timeoutMs: 500,
      logLevel: "debug",
      retry: { maxRetries: 3, backoffInitialMs: 10, backoffMaxMs: 20 },
    });
    expect(handle?.timeoutMs).toBe(500);
    expect(handle?.logLevel).toBe("debug");
  });

  it("constructs the real TypeSafeClient with the resolved apiKey and retry config, without forwarding timeoutMs or logLevel", () => {
    createJevClient({
      apiKey: "k",
      timeoutMs: 999,
      logLevel: "debug",
      retry: { maxRetries: 2, backoffInitialMs: 1, backoffMaxMs: 2 },
    });
    expect(constructedConfigs).toHaveLength(1);
    const config = constructedConfigs[0] as Record<string, unknown>;
    expect(config.apiKey).toBe("k");
    expect(config.retry).toEqual({
      maxRetries: 2,
      backoffInitialMs: 1,
      backoffMaxMs: 2,
    });
    expect(config).not.toHaveProperty("timeout");
    expect(config).not.toHaveProperty("logLevel");
  });

  it("returns null (never throws) if the underlying TypeSafeClient constructor throws", () => {
    nextConstructorShouldThrow = true;
    expect(() => createJevClient({ apiKey: "k" })).not.toThrow();
    expect(createJevClient({ apiKey: "k" })).toBeNull();
  });
});
