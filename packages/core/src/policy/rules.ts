import type { FallbackReason, RawJevAnswer } from "../jev/types.js";

/**
 * Canonical `DecisionDef` / `DecisionSet` / `DecisionOutcome` shapes for the whole package.
 *
 * Task 2's `jev/builders.ts` originally sketched a local, byte-identical copy of the three
 * `*DecisionDef` interfaces (see the comment there) with a note that this module — Task 3's
 * `policy/rules.ts` — would become the single source of truth going forward. That move happened
 * here: `jev/builders.ts` now imports and re-exports these types instead of redefining them.
 * Field names are unchanged from Task 2's version on purpose, so nothing downstream needed to be
 * renamed.
 */

export interface ChoiceDecisionDef<
  TOptions extends Record<string, string> = Record<string, string>,
> {
  kind: "choice";
  id: string;
  instructions?: string;
  options: TOptions;
  policy: { minConfidence: number; fallbackAction: keyof TOptions & string };
}

export interface ScoreDecisionDef {
  kind: "score";
  id: string;
  instructions?: string;
  levels: string[];
  policy: {
    minConfidence: number;
    thresholds: Array<{ atOrAbove: number; action: string }>;
    fallbackAction: string;
  };
}

export interface NoulDecisionDef {
  kind: "noul";
  id: string;
  instructions?: string;
  trueDescription?: string;
  falseDescription?: string;
  policy: {
    minConfidence: number;
    trueAction: string;
    falseAction: string;
    fallbackAction: string;
  };
}

export type DecisionDef =
  ChoiceDecisionDef | ScoreDecisionDef | NoulDecisionDef;

export interface DecisionSet {
  [id: string]: DecisionDef;
}

/**
 * Result of running a `DecisionDef` through the policy engine (`policy/engine.ts#applyPolicy`) or
 * the fallback engine (`fallback/engine.ts#fallbackOutcome`) — the only two places a
 * `DecisionOutcome` is ever constructed anywhere in this codebase. Defined here (rather than in
 * `policy/engine.ts`, where the plan's brief text originally sketched it) so that both
 * `policy/engine.ts` and `fallback/engine.ts` can import it from a common, dependency-free module
 * without creating a circular import between the two engines (`policy/engine.ts` imports
 * `fallbackOutcome` from `fallback/engine.ts`, so `fallback/engine.ts` cannot import types back
 * from `policy/engine.ts`). `policy/engine.ts` re-exports this type so existing import paths that
 * expect to find it there still work.
 */
export interface DecisionOutcome<TAction extends string = string> {
  id: string;
  raw: RawJevAnswer | null;
  confidence: number | null;
  action: TAction;
  usedFallback: boolean;
  fallbackReason?: FallbackReason;
  matchedRule?: string;
  latencyMs: number;
}
