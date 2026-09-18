import type { FallbackReason } from "../jev/types.js";
import type { DecisionDef, DecisionOutcome } from "../policy/rules.js";

/**
 * Single source of truth for constructing a fallback `DecisionOutcome` anywhere in this codebase.
 *
 * Every fallback path — total transport failure (`gateway.ts`, Task 5), low confidence, a
 * mismatched/malformed raw answer, or a missing API key (`policy/engine.ts`, Task 3) — must call
 * this function rather than hand-building a `DecisionOutcome` with `usedFallback: true` itself.
 * Centralizing it here means the shape of a fallback outcome only needs to be right in one place.
 */
export function fallbackOutcome<TAction extends string = string>(
  def: DecisionDef,
  latencyMs: number,
  reason: FallbackReason
): DecisionOutcome<TAction> {
  return {
    id: def.id,
    raw: null,
    confidence: null,
    // Choice/Score/Noul all declare a `policy.fallbackAction: string` (Choice's is narrowed to
    // `keyof TOptions & string`, itself a subtype of `string`), so this is safe across the whole
    // `DecisionDef` union without a per-kind switch.
    action: def.policy.fallbackAction as TAction,
    usedFallback: true,
    fallbackReason: reason,
    latencyMs,
  };
}
