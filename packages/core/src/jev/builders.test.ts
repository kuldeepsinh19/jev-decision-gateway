import { describe, expect, it, vi } from "vitest";

vi.mock("@typesafe-ai/sdk", () => ({
  choice: vi.fn((instructions: unknown, criteria: unknown) => ({
    type: "choice",
    instructions,
    criteria,
  })),
  score: vi.fn((instructions: unknown, criteria: unknown) => ({
    type: "score",
    instructions,
    criteria,
  })),
  noul: vi.fn((instructions: unknown, criteria: unknown) => ({
    type: "noul",
    instructions,
    criteria,
  })),
}));

import { choice, noul, score } from "@typesafe-ai/sdk";

import type { ChoiceDecisionDef, NoulDecisionDef, ScoreDecisionDef } from "./builders.js";
import { toSdkQuestion } from "./builders.js";

describe("toSdkQuestion", () => {
  it("maps a ChoiceDecisionDef to choice(instructions, options)", () => {
    const def: ChoiceDecisionDef = {
      kind: "choice",
      id: "model_tier",
      instructions: "which model tier?",
      options: { haiku: "cheap and fast", sonnet: "capable" },
      policy: { minConfidence: 0.7, fallbackAction: "sonnet" },
    };

    toSdkQuestion(def);

    expect(choice).toHaveBeenCalledTimes(1);
    expect(choice).toHaveBeenCalledWith("which model tier?", {
      haiku: "cheap and fast",
      sonnet: "capable",
    });
  });

  it("maps a ScoreDecisionDef to score(instructions, levels)", () => {
    const def: ScoreDecisionDef = {
      kind: "score",
      id: "quality",
      instructions: "rate the output",
      levels: ["poor", "acceptable", "excellent"],
      policy: {
        minConfidence: 0.6,
        thresholds: [{ atOrAbove: 2, action: "accept" }],
        fallbackAction: "reject",
      },
    };

    toSdkQuestion(def);

    expect(score).toHaveBeenCalledTimes(1);
    expect(score).toHaveBeenCalledWith("rate the output", ["poor", "acceptable", "excellent"]);
  });

  it("maps a NoulDecisionDef to noul(instructions, { true, false })", () => {
    const def: NoulDecisionDef = {
      kind: "noul",
      id: "should_continue",
      instructions: "should the agent continue?",
      trueDescription: "keep going",
      falseDescription: "stop now",
      policy: {
        minConfidence: 0.5,
        trueAction: "continue",
        falseAction: "halt",
        fallbackAction: "halt",
      },
    };

    toSdkQuestion(def);

    expect(noul).toHaveBeenCalledTimes(1);
    expect(noul).toHaveBeenCalledWith("should the agent continue?", {
      true: "keep going",
      false: "stop now",
    });
  });

  it("defaults missing instructions/descriptions to null rather than undefined", () => {
    const def: NoulDecisionDef = {
      kind: "noul",
      id: "x",
      policy: {
        minConfidence: 0.5,
        trueAction: "a",
        falseAction: "b",
        fallbackAction: "b",
      },
    };

    toSdkQuestion(def);

    expect(noul).toHaveBeenCalledWith(null, { true: null, false: null });
  });
});
