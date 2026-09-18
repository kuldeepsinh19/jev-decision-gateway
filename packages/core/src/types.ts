/**
 * Single re-export module for the package's public shapes, plus the gateway-local types that are
 * new to Task 5. Nothing here is redefined a second time: `DecisionDef`/`DecisionSet`/
 * `ChoiceDecisionDef`/`ScoreDecisionDef`/`NoulDecisionDef` are canonical in `policy/rules.ts`,
 * `DecisionOutcome` is re-exported (for import-path compatibility) from `policy/engine.ts`,
 * `DecisionTrace` lives in `trace/trace.ts`, and `FallbackReason` lives in `jev/types.ts`.
 */

import type { DecisionSet } from "./policy/rules.js";
import type { DecisionOutcome } from "./policy/engine.js";
import type { DecisionTrace } from "./trace/trace.js";

export type {
  ChoiceDecisionDef,
  DecisionDef,
  DecisionSet,
  NoulDecisionDef,
  ScoreDecisionDef,
} from "./policy/rules.js";
export type { DecisionOutcome } from "./policy/engine.js";
export type { DecisionTrace } from "./trace/trace.js";
export type { FallbackReason } from "./jev/types.js";

/** Arbitrary caller-supplied facts a decision batch is evaluated against. */
export interface DecisionState {
  [key: string]: unknown;
}

/** Result of a single `DecisionGateway.evaluate()` call over a `DecisionSet`. */
export interface EvaluationResult<TSet extends DecisionSet> {
  decisions: { [K in keyof TSet]: DecisionOutcome };
  usage: { inputTokens: number; outputTokens: number } | null;
  trace: DecisionTrace[];
  latencyMs: number;
}

/** Configuration for a `DecisionGateway` instance. */
export interface GatewayConfig {
  /** default: process.env.TYPESAFE_API_KEY */
  apiKey?: string;
  /** default 1500 — see `jev/client.ts#JevClientConfig.timeoutMs` for the underlying meaning. */
  timeoutMs?: number;
  retry?: {
    maxRetries: number;
    backoffInitialMs: number;
    backoffMaxMs: number;
  };
  /** default "warn" */
  logLevel?: "silent" | "warn" | "debug";
  /** Called once per decision, in addition to being collected in `EvaluationResult.trace`. */
  onTrace?: (trace: DecisionTrace) => void;
}
