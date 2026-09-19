import { describe, expect, it } from "vitest";

import { DecisionGateway } from "../../src/index.js";
import type { ChoiceDecisionDef, NoulDecisionDef, ScoreDecisionDef } from "../../src/index.js";

/**
 * Real, gated live test: talks to the actual Jev API (no mocking anywhere in this file). Skips
 * cleanly whenever `TYPESAFE_API_KEY` isn't set in the environment -- which is the case in normal
 * dev/CI runs. This test is meant to be run for real, with a live key, in Task 11; until then it
 * only needs to exist and skip correctly.
 */
describe.skipIf(!process.env.TYPESAFE_API_KEY)("DecisionGateway (live)", () => {
  it("classifies a short piece of text with a Choice, a Score, and a Noul decision in one batched call", async () => {
    const gateway = new DecisionGateway();

    const sentiment: ChoiceDecisionDef = {
      kind: "choice",
      id: "sentiment",
      instructions: "Classify the sentiment of the text.",
      options: {
        positive: "the text expresses a positive sentiment",
        negative: "the text expresses a negative sentiment",
        neutral: "the text is neutral in tone",
      },
      policy: { minConfidence: 0, fallbackAction: "neutral" },
    };

    const quality: ScoreDecisionDef = {
      kind: "score",
      id: "quality",
      instructions:
        "Rate how clearly the text is written, from 0 (very unclear) to 1 (very clear).",
      levels: ["unclear", "somewhat clear", "clear", "very clear"],
      policy: {
        minConfidence: 0,
        thresholds: [
          { atOrAbove: 0.75, action: "very clear" },
          { atOrAbove: 0.5, action: "clear" },
          { atOrAbove: 0.25, action: "somewhat clear" },
        ],
        fallbackAction: "unclear",
      },
    };

    const isQuestion: NoulDecisionDef = {
      kind: "noul",
      id: "isQuestion",
      instructions: "Is the text phrased as a question?",
      trueDescription: "the text is a question",
      falseDescription: "the text is not a question",
      policy: {
        minConfidence: 0,
        trueAction: "question",
        falseAction: "statement",
        fallbackAction: "statement",
      },
    };

    const startedAt = Date.now();
    const result = await gateway.evaluate({
      state: { text: "I absolutely love how simple this API is to use!" },
      decisions: { sentiment, quality, isQuestion },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(5000);

    expect(result.decisions.sentiment.usedFallback).toBe(false);
    expect(result.decisions.quality.usedFallback).toBe(false);
    expect(result.decisions.isQuestion.usedFallback).toBe(false);

    for (const id of ["sentiment", "quality", "isQuestion"] as const) {
      const confidence = result.decisions[id].confidence;
      expect(Number.isFinite(confidence)).toBe(true);
      expect(confidence as number).toBeGreaterThanOrEqual(0);
      expect(confidence as number).toBeLessThanOrEqual(1);
    }

    expect(result.usage).not.toBeNull();
    expect(Number.isInteger(result.usage?.inputTokens)).toBe(true);
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(Number.isInteger(result.usage?.outputTokens)).toBe(true);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
  }, 10000);
});
