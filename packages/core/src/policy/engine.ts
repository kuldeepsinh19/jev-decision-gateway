import type { FallbackReason, RawJevAnswer } from "../jev/types.js";
import { fallbackOutcome } from "../fallback/engine.js";
import type { DecisionDef } from "./rules.js";
import type { DecisionOutcome } from "./rules.js";

// Re-exported so anything importing `DecisionOutcome` from `policy/engine.ts` (as the plan's
// brief sketches it) still finds it here, even though its canonical definition lives in
// `policy/rules.ts` — see the comment on `DecisionOutcome` there for why.
export type { DecisionOutcome } from "./rules.js";

/**
 * Resolves a raw Jev answer (or its absence) into a `DecisionOutcome`, applying confidence
 * thresholds and per-kind action-resolution rules. Never builds a fallback outcome by hand — every
 * fallback path here delegates to `fallback/engine.ts#fallbackOutcome`, the single source of truth
 * for that shape.
 *
 * @param nullReason - The plan's brief describes the `raw === null` fallback path as using "the
 * reason to be supplied by the caller", but the sketched 3-argument signature
 * (`applyPolicy(def, raw, latencyMs)`) has nowhere to put it. This function only ever sees a
 * caller-opaque `null` for `raw` — it cannot tell TIMEOUT/ERROR/MISSING_KEY apart on its own, only
 * the caller (e.g. `gateway.ts` in Task 5, which knows whether the whole call timed out, errored,
 * or had no resolvable API key) can. We resolve that gap with an optional 4th parameter, defaulted
 * to `"ERROR"` so the documented 3-argument call shape still works untouched; callers that know
 * the precise reason should pass it explicitly. Flagged here for Task 5's implementer.
 */
export function applyPolicy<TAction extends string = string>(
  def: DecisionDef,
  raw: RawJevAnswer | null,
  latencyMs: number,
  nullReason: FallbackReason = "ERROR"
): DecisionOutcome<TAction> {
  if (raw === null) {
    return fallbackOutcome<TAction>(def, latencyMs, nullReason);
  }

  // Defensive: a validated-but-wrong-kind answer (e.g. a `noul` answer routed to a `choice`
  // decision id) is treated the same as a malformed response rather than trusted blindly. This
  // isn't explicitly called out in the plan's brief, but matches the defensive posture already
  // established in `jev/types.ts`/`jev/adapter.ts` (Task 2) for anything crossing the SDK
  // boundary.
  if (raw.type !== def.kind) {
    return fallbackOutcome<TAction>(def, latencyMs, "MALFORMED_RESPONSE");
  }

  switch (def.kind) {
    case "choice": {
      const answer = raw as Extract<RawJevAnswer, { type: "choice" }>;
      const confidence = answer.confidence;
      if (confidence < def.policy.minConfidence) {
        return fallbackOutcome<TAction>(def, latencyMs, "LOW_CONFIDENCE");
      }
      return {
        id: def.id,
        raw: answer,
        confidence,
        action: answer.choice as TAction,
        usedFallback: false,
        matchedRule: "choice-direct",
        latencyMs,
      };
    }
    case "score": {
      const answer = raw as Extract<RawJevAnswer, { type: "score" }>;
      const confidence = answer.confidence;
      if (confidence < def.policy.minConfidence) {
        return fallbackOutcome<TAction>(def, latencyMs, "LOW_CONFIDENCE");
      }
      const sortedDescending = [...def.policy.thresholds].sort((a, b) => b.atOrAbove - a.atOrAbove);
      const matched = sortedDescending.find((t) => answer.score >= t.atOrAbove);
      const action = matched ? matched.action : def.policy.fallbackAction;
      const matchedRule = matched ? `score>=${matched.atOrAbove}` : "score-no-threshold-matched";
      return {
        id: def.id,
        raw: answer,
        confidence,
        action: action as TAction,
        usedFallback: false,
        matchedRule,
        latencyMs,
      };
    }
    case "noul": {
      const answer = raw as Extract<RawJevAnswer, { type: "noul" }>;
      // Noul has NO native confidence field in the Jev SDK's response (confirmed in
      // jev/types.ts's `RawNoulAnswer`). This is the FRAMEWORK'S OWN documented convention for
      // deriving one — not a Jev field — computed as the answer's distance from the undecided
      // midpoint (0.5), scaled to [0, 1]: confidence = |noul - 0.5| * 2.
      const confidence = Math.abs(answer.noul - 0.5) * 2;
      if (confidence < def.policy.minConfidence) {
        return fallbackOutcome<TAction>(def, latencyMs, "LOW_CONFIDENCE");
      }
      const isTrue = answer.noul >= 0.5;
      return {
        id: def.id,
        raw: answer,
        confidence,
        action: (isTrue ? def.policy.trueAction : def.policy.falseAction) as TAction,
        usedFallback: false,
        matchedRule: isTrue ? "noul-true" : "noul-false",
        latencyMs,
      };
    }
    default: {
      const exhaustiveCheck: never = def;
      throw new Error(
        `applyPolicy: unrecognized DecisionDef kind: ${JSON.stringify(exhaustiveCheck)}`
      );
    }
  }
}
