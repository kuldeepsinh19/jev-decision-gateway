import { describe, expect, it } from "vitest";

import type {
  ChoiceDecisionDef,
  NoulDecisionDef,
  ScoreDecisionDef,
} from "../policy/rules.js";
import { fallbackOutcome } from "./engine.js";

const choiceDef: ChoiceDecisionDef = {
  kind: "choice",
  id: "route",
  options: { search: "look it up", finish: "done" },
  policy: { minConfidence: 0.7, fallbackAction: "finish" },
};

const scoreDef: ScoreDecisionDef = {
  kind: "score",
  id: "quality",
  levels: ["poor", "acceptable", "great"],
  policy: {
    minConfidence: 0.6,
    thresholds: [{ atOrAbove: 0.8, action: "accept" }],
    fallbackAction: "reject",
  },
};

const noulDef: NoulDecisionDef = {
  kind: "noul",
  id: "continue",
  policy: {
    minConfidence: 0.5,
    trueAction: "continue",
    falseAction: "halt",
    fallbackAction: "halt",
  },
};

describe("fallbackOutcome", () => {
  it("builds a fallback DecisionOutcome for a choice def, using policy.fallbackAction", () => {
    const outcome = fallbackOutcome(choiceDef, 42, "TIMEOUT");
    expect(outcome).toEqual({
      id: "route",
      raw: null,
      confidence: null,
      action: "finish",
      usedFallback: true,
      fallbackReason: "TIMEOUT",
      latencyMs: 42,
    });
  });

  it("builds a fallback DecisionOutcome for a score def, using policy.fallbackAction", () => {
    const outcome = fallbackOutcome(scoreDef, 7, "MALFORMED_RESPONSE");
    expect(outcome).toEqual({
      id: "quality",
      raw: null,
      confidence: null,
      action: "reject",
      usedFallback: true,
      fallbackReason: "MALFORMED_RESPONSE",
      latencyMs: 7,
    });
  });

  it("builds a fallback DecisionOutcome for a noul def, using policy.fallbackAction", () => {
    const outcome = fallbackOutcome(noulDef, 3, "LOW_CONFIDENCE");
    expect(outcome).toEqual({
      id: "continue",
      raw: null,
      confidence: null,
      action: "halt",
      usedFallback: true,
      fallbackReason: "LOW_CONFIDENCE",
      latencyMs: 3,
    });
  });

  it("passes through whatever FallbackReason the caller supplies", () => {
    expect(fallbackOutcome(choiceDef, 10, "MISSING_KEY").fallbackReason).toBe(
      "MISSING_KEY"
    );
    expect(fallbackOutcome(choiceDef, 10, "ERROR").fallbackReason).toBe(
      "ERROR"
    );
  });

  it("never sets matchedRule (a fallback is never resolved via a policy rule)", () => {
    const outcome = fallbackOutcome(noulDef, 5, "ERROR");
    expect(outcome.matchedRule).toBeUndefined();
  });
});
