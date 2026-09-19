import { describe, expect, it } from "vitest";

import type { ChoiceDecisionDef, NoulDecisionDef, ScoreDecisionDef } from "./rules.js";
import { applyPolicy } from "./engine.js";

const choiceDef: ChoiceDecisionDef = {
  kind: "choice",
  id: "route",
  options: { search: "look it up", calculator: "do math", finish: "done" },
  policy: { minConfidence: 0.7, fallbackAction: "finish" },
};

const scoreDef: ScoreDecisionDef = {
  kind: "score",
  id: "quality",
  levels: ["poor", "acceptable", "good", "excellent"],
  policy: {
    minConfidence: 0.5,
    thresholds: [
      { atOrAbove: 0.9, action: "excellent" },
      { atOrAbove: 0.7, action: "good" },
      { atOrAbove: 0.4, action: "acceptable" },
    ],
    fallbackAction: "poor",
  },
};

// minConfidence low enough that action-selection tests below aren't accidentally short-circuited
// by a LOW_CONFIDENCE fallback.
const noulDef: NoulDecisionDef = {
  kind: "noul",
  id: "continue",
  policy: {
    minConfidence: 0.3,
    trueAction: "continue",
    falseAction: "halt",
    fallbackAction: "halt",
  },
};

// minConfidence: 0 so every noul value passes through, isolating the confidence-math check itself
// from the LOW_CONFIDENCE fallback path.
const noulMathDef: NoulDecisionDef = {
  kind: "noul",
  id: "math-check",
  policy: {
    minConfidence: 0,
    trueAction: "t",
    falseAction: "f",
    fallbackAction: "f",
  },
};

describe("applyPolicy", () => {
  describe("choice", () => {
    it("resolves the raw choice directly when confidence meets minConfidence", () => {
      const outcome = applyPolicy(
        choiceDef,
        {
          type: "choice",
          choice: "search",
          confidence: 0.7,
          probabilities: { search: 0.7 },
        },
        12
      );
      expect(outcome).toMatchObject({
        id: "route",
        action: "search",
        confidence: 0.7,
        usedFallback: false,
        matchedRule: "choice-direct",
        latencyMs: 12,
      });
    });

    it("falls back with LOW_CONFIDENCE when confidence is below minConfidence", () => {
      const outcome = applyPolicy(
        choiceDef,
        {
          type: "choice",
          choice: "search",
          confidence: 0.69,
          probabilities: { search: 0.69 },
        },
        8
      );
      expect(outcome).toEqual({
        id: "route",
        raw: null,
        confidence: null,
        action: "finish",
        usedFallback: true,
        fallbackReason: "LOW_CONFIDENCE",
        latencyMs: 8,
      });
    });
  });

  describe("score", () => {
    it("matches exactly at a threshold boundary (>=, not >)", () => {
      const outcome = applyPolicy(
        scoreDef,
        {
          type: "score",
          score: 0.7,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        },
        5
      );
      expect(outcome.action).toBe("good");
      expect(outcome.matchedRule).toBe("score>=0.7");
      expect(outcome.usedFallback).toBe(false);
    });

    it("picks the highest matching threshold when the score falls between two thresholds", () => {
      const outcome = applyPolicy(
        scoreDef,
        {
          type: "score",
          score: 0.8,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        },
        5
      );
      expect(outcome.action).toBe("good");
      expect(outcome.matchedRule).toBe("score>=0.7");
    });

    it("resolves to policy.fallbackAction (without treating it as usedFallback) when below all thresholds", () => {
      const outcome = applyPolicy(
        scoreDef,
        {
          type: "score",
          score: 0.1,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        },
        5
      );
      expect(outcome.action).toBe("poor");
      expect(outcome.matchedRule).toBe("score-no-threshold-matched");
      expect(outcome.usedFallback).toBe(false);
      expect(outcome.raw).not.toBeNull();
      expect(outcome.fallbackReason).toBeUndefined();
    });

    it("falls back with LOW_CONFIDENCE below minConfidence regardless of how high the score is", () => {
      const outcome = applyPolicy(
        scoreDef,
        {
          type: "score",
          score: 0.99,
          confidence: 0.2,
          legend: {},
          probabilities: {},
        },
        5
      );
      expect(outcome.usedFallback).toBe(true);
      expect(outcome.fallbackReason).toBe("LOW_CONFIDENCE");
      expect(outcome.action).toBe("poor");
      expect(outcome.raw).toBeNull();
    });
  });

  describe("noul", () => {
    it.each([
      [0.5, 0],
      [0.95, 0.9],
      [0.1, 0.8],
    ])(
      "computes confidence = |noul - 0.5| * 2 (own framework convention, not a Jev field) for noul=%f",
      (noulValue, expectedConfidence) => {
        const outcome = applyPolicy(noulMathDef, { type: "noul", noul: noulValue }, 3);
        expect(outcome.confidence).toBeCloseTo(expectedConfidence, 10);
      }
    );

    it("resolves trueAction when noul >= 0.5 and derived confidence clears minConfidence", () => {
      const outcome = applyPolicy(noulDef, { type: "noul", noul: 0.9 }, 3);
      expect(outcome.action).toBe("continue");
      expect(outcome.matchedRule).toBe("noul-true");
      expect(outcome.usedFallback).toBe(false);
    });

    it("resolves falseAction when noul < 0.5 and derived confidence clears minConfidence", () => {
      const outcome = applyPolicy(noulDef, { type: "noul", noul: 0.05 }, 3);
      expect(outcome.action).toBe("halt");
      expect(outcome.matchedRule).toBe("noul-false");
      expect(outcome.usedFallback).toBe(false);
    });

    it("falls back with LOW_CONFIDENCE when the derived confidence is below minConfidence", () => {
      // noul=0.55 -> confidence = |0.05| * 2 = 0.1, below noulDef's minConfidence of 0.3.
      const outcome = applyPolicy(noulDef, { type: "noul", noul: 0.55 }, 3);
      expect(outcome.usedFallback).toBe(true);
      expect(outcome.fallbackReason).toBe("LOW_CONFIDENCE");
      expect(outcome.action).toBe("halt");
      expect(outcome.raw).toBeNull();
      expect(outcome.confidence).toBeNull();
    });
  });

  describe("raw === null", () => {
    it("returns a fallback outcome defaulting the reason to ERROR when the caller doesn't specify one", () => {
      const outcome = applyPolicy(choiceDef, null, 1);
      expect(outcome.usedFallback).toBe(true);
      expect(outcome.fallbackReason).toBe("ERROR");
      expect(outcome.action).toBe("finish");
      expect(outcome.raw).toBeNull();
      expect(outcome.confidence).toBeNull();
    });

    it.each(["TIMEOUT", "MISSING_KEY", "ERROR", "MALFORMED_RESPONSE"] as const)(
      "passes the caller-supplied reason %s through to the fallback outcome",
      (reason) => {
        const outcome = applyPolicy(choiceDef, null, 1, reason);
        expect(outcome.fallbackReason).toBe(reason);
        expect(outcome.usedFallback).toBe(true);
      }
    );
  });

  it("falls back with MALFORMED_RESPONSE when raw.type doesn't match def.kind", () => {
    const outcome = applyPolicy(choiceDef, { type: "noul", noul: 0.9 }, 4);
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.fallbackReason).toBe("MALFORMED_RESPONSE");
    expect(outcome.action).toBe("finish");
  });
});
