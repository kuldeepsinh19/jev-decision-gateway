import type { EntryType, Questions } from "@typesafe-ai/sdk";

import { redactSecret } from "../errors.js";
import { createJevClient } from "./client.js";
import type { JevClientHandle } from "./client.js";
import { toSdkQuestion } from "./builders.js";
import type { DecisionDef } from "./builders.js";
import { isChoiceAnswer, isNoulAnswer, isScoreAnswer } from "./types.js";
import type { RawJevAnswer } from "./types.js";

export interface AskJevRequest {
  state: Record<string, unknown>;
  questions: Record<string, DecisionDef>;
}

export interface AskJevSuccess {
  answers: Record<string, RawJevAnswer>;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Pure boundary function: calls the real Jev SDK and returns a mapped answer, or `null`.
 *
 * Never applies policy/threshold/decision logic (that's `policy/`'s job in later tasks) and
 * never throws (every failure mode — missing key, network error, HTTP 401/422/429/529,
 * abort/timeout, or a structurally malformed response — is caught and mapped to `null`).
 */
export async function askJev(
  handle: ReturnType<typeof createJevClient>,
  request: AskJevRequest,
  opts?: { signal?: AbortSignal }
): Promise<AskJevSuccess | null> {
  // MISSING_KEY path: no handle means no resolvable API key. No network call. This function
  // never assigns a `FallbackReason` itself — that's the caller's (gateway/policy) job.
  if (handle === null) return null;

  try {
    const sdkQuestions: Record<string, unknown> = {};
    for (const [id, def] of Object.entries(request.questions)) {
      sdkQuestions[id] = toSdkQuestion(def);
    }

    // Our own hard deadline (`handle.timeoutMs`), independent of the SDK's own retry/timeout
    // config (see client.ts), merged with any deadline the caller supplied.
    const deadline = AbortSignal.timeout(handle.timeoutMs);
    const signal = mergeSignals(opts?.signal, deadline);

    const result = await handle.client.systemOne(
      {
        state: request.state as EntryType,
        questions: sdkQuestions as Questions,
      },
      { signal }
    );

    const answers: Record<string, RawJevAnswer> = {};
    for (const [id, raw] of Object.entries(result.answers)) {
      const normalized = normalizeAnswer(raw);
      // A structurally-invalid answer for one question is dropped rather than failing the whole
      // call: it's simply absent from `answers`, letting the caller detect the missing id and
      // apply its own `MALFORMED_RESPONSE` fallback for just that decision.
      if (normalized) answers[id] = normalized;
    }

    // CONFIRMED (dist/index.d.mts `Usage`/`SystemOneResult.usage`): `input_tokens`/`output_tokens`
    // are the real field names, and `usage` is typed as always present on a successful response.
    // We still check defensively (never trust a network boundary blindly) and fall back to
    // `null`, matching `AskJevSuccess.usage`'s `| null`.
    const usage =
      result.usage &&
      Number.isFinite(result.usage.input_tokens) &&
      Number.isFinite(result.usage.output_tokens)
        ? {
            inputTokens: result.usage.input_tokens,
            outputTokens: result.usage.output_tokens,
          }
        : null;

    return { answers, usage };
  } catch (err) {
    // Catches everything: HTTP errors the SDK throws as `APIError`/`AuthenticationError`/
    // `UnprocessableEntityError`/`RateLimitError`/`InternalServerError` (401/422/429/529 all
    // surface with a `.status`, confirmed in dist/index.mjs `APIError.fromResponse`), network
    // failures (`APIConnectionError`), timeouts (`APITimeoutError`), aborts
    // (`APIUserAbortError`), and anything else (e.g. a synchronous throw from `toSdkQuestion` on
    // a malformed `DecisionDef`). This function's contract is "answer or null" — never throw.
    logCaughtError(handle, "systemOne call failed", err);
    return null;
  }
}

function normalizeAnswer(raw: unknown): RawJevAnswer | null {
  if (isChoiceAnswer(raw)) {
    return {
      type: "choice",
      choice: raw.choice,
      confidence: raw.confidence,
      probabilities: { ...raw.probabilities },
    };
  }
  if (isScoreAnswer(raw)) {
    return {
      type: "score",
      score: raw.score,
      confidence: raw.confidence,
      legend: raw.legend,
      probabilities: { ...raw.probabilities },
    };
  }
  if (isNoulAnswer(raw)) {
    return { type: "noul", noul: raw.noul };
  }
  return null;
}

/** Combines two abort signals into one that fires when either does, without requiring Node 20.3's `AbortSignal.any`. */
function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  a.addEventListener("abort", () => controller.abort(a.reason), { once: true });
  b.addEventListener("abort", () => controller.abort(b.reason), { once: true });
  return controller.signal;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number"
      ? `${err.name} (status ${status}): ${err.message}`
      : `${err.name}: ${err.message}`;
  }
  return String(err);
}

/** Logs a caught failure at `handle.logLevel`, always redacting the configured API key first. */
function logCaughtError(handle: JevClientHandle, context: string, err: unknown): void {
  if (handle.logLevel === "silent") return;
  const message = redactSecret(`[jev/adapter] ${context}: ${describeError(err)}`, [handle.apiKey]);
  console.warn(message);
  if (handle.logLevel === "debug" && err instanceof Error && typeof err.stack === "string") {
    console.debug(
      redactSecret(`[jev/adapter] ${context} (stack)`, [handle.apiKey]),
      redactSecret(err.stack, [handle.apiKey])
    );
  }
}
