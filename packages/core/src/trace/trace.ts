import { randomUUID } from "node:crypto";

import type { FallbackReason } from "../jev/types.js";
import type { DecisionDef, DecisionOutcome } from "../policy/rules.js";

export interface DecisionTrace {
  traceId: string;
  decisionId: string;
  kind: "choice" | "score" | "noul";
  timestamp: string;
  question: { instructions?: string; criteriaSummary: string };
  rawAnswer: unknown | null;
  confidence: number | null;
  policyApplied: { minConfidence: number; matchedRule?: string };
  action: string;
  usedFallback: boolean;
  fallbackReason?: FallbackReason;
  latencyMs: number;
}

/** Short, human-readable summary of a decision's criteria — never the full state, per Global Constraint 4. */
function criteriaSummary(def: DecisionDef): string {
  switch (def.kind) {
    case "choice":
      return `choice: ${Object.keys(def.options).join("|")}`;
    case "score":
      return `score: ${def.levels.length} levels`;
    case "noul":
      return "noul";
    default: {
      const exhaustiveCheck: never = def;
      throw new Error(
        `criteriaSummary: unrecognized DecisionDef kind: ${JSON.stringify(exhaustiveCheck)}`
      );
    }
  }
}

/**
 * Builds a `DecisionTrace` from a `DecisionDef` and the `DecisionOutcome` produced for it (by
 * `policy/engine.ts#applyPolicy` or `fallback/engine.ts#fallbackOutcome`). Deliberately summarizes
 * the question's criteria (`criteriaSummary`) rather than dumping full option/level/description
 * text or any surrounding state into the trace.
 */
export function createTrace(
  def: DecisionDef,
  outcome: DecisionOutcome
): DecisionTrace {
  return {
    traceId: randomUUID(),
    decisionId: def.id,
    kind: def.kind,
    timestamp: new Date().toISOString(),
    question: {
      instructions: def.instructions,
      criteriaSummary: criteriaSummary(def),
    },
    rawAnswer: outcome.raw,
    confidence: outcome.confidence,
    policyApplied: {
      minConfidence: def.policy.minConfidence,
      matchedRule: outcome.matchedRule,
    },
    action: outcome.action,
    usedFallback: outcome.usedFallback,
    fallbackReason: outcome.fallbackReason,
    latencyMs: outcome.latencyMs,
  };
}

// Case-insensitive: catches `apiKey`, `TOKEN`, `userSecret`, `TYPESAFE_API_KEY`, etc.
const SECRET_KEY_PATTERN = /key|token|secret/i;

/**
 * Returns a shallow copy of `state` with any key matching `/key|token|secret/i` replaced with
 * `"[REDACTED]"`. Used defensively wherever `state` (or a fragment of it) might be logged or
 * embedded in a trace — per Global Constraint 4, no secrets in logs/traces/error messages, ever.
 * Does not mutate the input.
 */
export function redactState(
  state: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : value;
  }
  return result;
}
