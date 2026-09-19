/**
 * Raw shapes for Jev's typed answers, and the defensive type guards that back the
 * `MALFORMED_RESPONSE` fallback path used by later tasks (policy engine, gateway).
 *
 * These are deliberately NOT re-exports of the real SDK's `ChoiceResponse`/`ScoreResponse`/
 * `NoulResponse` types (see `node_modules/@typesafe-ai/sdk/dist/index.d.mts`), even though the
 * fields line up 1:1 for each kind (confirmed by reading that file directly). Keeping a local
 * copy means nothing outside `jev/` ever needs to import `@typesafe-ai/sdk` types just to talk
 * about a Jev answer — the SDK's real types stay confined to `client.ts`/`builders.ts`/`adapter.ts`.
 */

export type FallbackReason =
  "TIMEOUT" | "ERROR" | "LOW_CONFIDENCE" | "MISSING_KEY" | "MALFORMED_RESPONSE";

// Raw, un-policy'd answers as returned by the SDK for each question kind.
export type RawChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type RawScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: unknown;
  probabilities: Record<string, number>;
};
// CONFIRMED (real .d.mts `NoulResponse`): no `confidence` field on noul answers at all — the
// framework-level convention `confidence = Math.abs(noul - 0.5) * 2` is applied later, in the
// policy engine (Task 3+), not here. This module never derives it.
export type RawNoulAnswer = { type: "noul"; noul: number };
export type RawJevAnswer = RawChoiceAnswer | RawScoreAnswer | RawNoulAnswer;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isProbabilityMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((v) => isFiniteNumber(v));
}

/** Defensive check: required fields present, correctly typed, and in sensible ranges. */
export function isChoiceAnswer(a: unknown): a is RawChoiceAnswer {
  return (
    isRecord(a) &&
    a.type === "choice" &&
    typeof a.choice === "string" &&
    a.choice.length > 0 &&
    isUnitInterval(a.confidence) &&
    isProbabilityMap(a.probabilities)
  );
}

/** Defensive check: required fields present, correctly typed, and in sensible ranges. */
export function isScoreAnswer(a: unknown): a is RawScoreAnswer {
  return (
    isRecord(a) &&
    a.type === "score" &&
    isFiniteNumber(a.score) &&
    isUnitInterval(a.confidence) &&
    "legend" in a &&
    isProbabilityMap(a.probabilities)
  );
}

/** Defensive check: required fields present, correctly typed, and in sensible ranges. */
export function isNoulAnswer(a: unknown): a is RawNoulAnswer {
  return isRecord(a) && a.type === "noul" && isUnitInterval(a.noul);
}
