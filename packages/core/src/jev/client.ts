import { TypeSafeClient } from "@typesafe-ai/sdk";

/**
 * Config for our own Jev client wrapper. Deliberately smaller than the real SDK's
 * `TypeSafeClientConfig` (confirmed shape: `apiKey`, `baseURL`, `defaultModel`, `logLevel`,
 * `logger`, `retry`, `timeout`, `defaultHeaders`, `dangerouslyAllowBrowser`, `fetch` — see
 * node_modules/@typesafe-ai/sdk/dist/index.d.mts) — we only expose what this project needs.
 */
export interface JevClientConfig {
  /** default: process.env.TYPESAFE_API_KEY */
  apiKey?: string;
  /** default 1500 — our own deadline, independent of the SDK's own retry/timeout config. */
  timeoutMs?: number;
  /** default { maxRetries: 1, backoffInitialMs: 150, backoffMaxMs: 400 } */
  retry?: {
    maxRetries: number;
    backoffInitialMs: number;
    backoffMaxMs: number;
  };
  /** default "warn" */
  logLevel?: "silent" | "warn" | "debug";
}

export interface JevClientHandle {
  client: TypeSafeClient;
  timeoutMs: number;
  logLevel: "silent" | "warn" | "debug";
  /**
   * Retained ONLY so `adapter.ts` can redact it out of log/error messages before they're
   * surfaced anywhere. Necessary adaptation: the real `TypeSafeClient` stores the API key in a
   * private class field (`#apiKey` — confirmed in dist/index.mjs) with no public getter, so once
   * we hand the key to `new TypeSafeClient(...)` we cannot read it back off the client instance.
   * Never pass this value to `console.*`/a logger without redacting it first.
   */
  apiKey: string;
}

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_RETRY = {
  maxRetries: 1,
  backoffInitialMs: 150,
  backoffMaxMs: 400,
};
const DEFAULT_LOG_LEVEL = "warn" as const;

/**
 * Builds a real `TypeSafeClient`, or returns `null` (never throws) when no API key is
 * resolvable. This is the `MISSING_KEY` fail-open path: callers get `null` and are expected to
 * treat it as "Jev unavailable", never crash.
 */
export function createJevClient(
  config: JevClientConfig = {}
): JevClientHandle | null {
  // CONFIRMED (README): "Set TYPESAFE_API_KEY in your environment" / the SDK's own doc says
  // "Empty or whitespace-only environment values are ignored." We apply the same trimming rule
  // to an explicitly-passed `config.apiKey` too, for the same reason: a blank string is not a key.
  const resolvedKey = (
    config.apiKey ??
    process.env.TYPESAFE_API_KEY ??
    ""
  ).trim();
  if (!resolvedKey) return null;

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retry = config.retry ?? DEFAULT_RETRY;
  const logLevel = config.logLevel ?? DEFAULT_LOG_LEVEL;

  try {
    const client = new TypeSafeClient({
      apiKey: resolvedKey,
      // CONFIRMED (dist/index.d.mts `TypeSafeClientConfig.retry?: Partial<RetryPolicy>`):
      // `maxRetries`/`backoffInitialMs`/`backoffMaxMs` are real `RetryPolicy` field names: our
      // config's `retry` shape forwards straight through, letting the SDK default the rest
      // (`backoffJitter`, `httpStatuses`, `respectRetryAfter`, `maxRetryAfterMs`,
      // `apiConnectionError`, `apiTimeoutError`).
      retry,
      // ADAPTED: we deliberately do NOT set the SDK's own `timeout` (per-attempt HTTP timeout,
      // default 10000ms) here. `timeoutMs` above is a separate, independent hard deadline that
      // `askJev()` enforces itself via an `AbortSignal` passed to `systemOne(...)` — confirmed
      // (dist/index.mjs `attempt()`) that the SDK honors and promptly aborts on a caller-supplied
      // signal regardless of its own internal timeout, so this is sufficient without touching the
      // SDK's own timeout/retry knobs.
      //
      // We also deliberately do NOT forward `logLevel` to the SDK's own `TypeSafeClientConfig`:
      // the SDK's `LogLevel` ("debug"|"info"|"warn"|"error"|"off") doesn't map 1:1 onto ours
      // ("silent"|"warn"|"debug"), and our `logLevel` here governs only this package's own
      // adapter-level logging (see adapter.ts). Leaving the SDK's logger at its own default keeps
      // its behavior (e.g. what it dumps at "debug") independent of this project's setting.
    });
    return { client, timeoutMs, logLevel, apiKey: resolvedKey };
  } catch {
    // CONFIRMED (dist/index.d.mts JSDoc on the constructor): "@throws {TypeSafeError} The API
    // key is missing, configuration is invalid, or the runtime is unsupported." We already
    // guaranteed a non-empty key above, but stay defensive against any other construction
    // failure — createJevClient must never throw. There's no handle/logger yet to log through,
    // so we fail closed silently here; the caller (gateway/policy, later tasks) treats `null` as
    // "Jev unavailable".
    return null;
  }
}
