/**
 * Public entry point of `@jev-decision-gateway/core`.
 *
 * Deliberately does NOT export anything from `./jev/*` (`askJev`, `createJevClient`,
 * `toSdkQuestion`, etc.) -- that module is an internal implementation boundary (Global
 * Constraint 1). Everything a consumer needs is `DecisionGateway` plus the types in `./types.js`.
 */

export { DecisionGateway } from "./gateway.js";

// `SDK_VERSION` is the one deliberate exception to "nothing from `./jev/*` is exported": it's a
// plain string, not a Jev-adapter primitive, and exists so consumers (e.g.
// `benchmark/ai-agent-scenario/src/report.ts`) never need to import `@typesafe-ai/sdk` directly
// just to report which version is installed -- see `./jev/version.ts`.
export { SDK_VERSION } from "./jev/version.js";

export type {
  ChoiceDecisionDef,
  DecisionDef,
  DecisionOutcome,
  DecisionSet,
  DecisionState,
  DecisionTrace,
  EvaluationResult,
  FallbackReason,
  GatewayConfig,
  NoulDecisionDef,
  ScoreDecisionDef,
} from "./types.js";
