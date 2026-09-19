import type { ChoiceDecisionDef, NoulDecisionDef, ScoreDecisionDef } from "./rules.js";

/**
 * Small, documented set of sane defaults for `DecisionDef.policy`, for developers who don't want
 * to think about a confidence floor themselves. Deliberately minimal: a couple of constants and
 * one spread-friendly helper per kind, not a policy framework of its own. Every helper still
 * requires the kind-specific action fields (`fallbackAction`, `thresholds`,
 * `trueAction`/`falseAction`) — there's no sane cross-application default for what a decision
 * should fall back to, since that's inherently domain-specific.
 */

/** Reasonable default confidence floor: below this, a decision falls back rather than acting on a shaky answer. */
export const DEFAULT_MIN_CONFIDENCE = 0.7;

/** Fills in `minConfidence` with `DEFAULT_MIN_CONFIDENCE` unless the caller already specified one. */
export function withDefaultChoicePolicy<
  TOptions extends Record<string, string> = Record<string, string>,
>(
  partial: Partial<Pick<ChoiceDecisionDef<TOptions>["policy"], "minConfidence">> &
    Pick<ChoiceDecisionDef<TOptions>["policy"], "fallbackAction">
): ChoiceDecisionDef<TOptions>["policy"] {
  return { minConfidence: DEFAULT_MIN_CONFIDENCE, ...partial };
}

/** Fills in `minConfidence` with `DEFAULT_MIN_CONFIDENCE` unless the caller already specified one. */
export function withDefaultScorePolicy(
  partial: Partial<Pick<ScoreDecisionDef["policy"], "minConfidence">> &
    Pick<ScoreDecisionDef["policy"], "thresholds" | "fallbackAction">
): ScoreDecisionDef["policy"] {
  return { minConfidence: DEFAULT_MIN_CONFIDENCE, ...partial };
}

/** Fills in `minConfidence` with `DEFAULT_MIN_CONFIDENCE` unless the caller already specified one. */
export function withDefaultNoulPolicy(
  partial: Partial<Pick<NoulDecisionDef["policy"], "minConfidence">> &
    Pick<NoulDecisionDef["policy"], "trueAction" | "falseAction" | "fallbackAction">
): NoulDecisionDef["policy"] {
  return { minConfidence: DEFAULT_MIN_CONFIDENCE, ...partial };
}
