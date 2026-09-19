import { describe, expect, it } from "vitest";

import { isChoiceAnswer, isNoulAnswer, isScoreAnswer } from "./types.js";

describe("isChoiceAnswer", () => {
  it("accepts a well-formed choice answer", () => {
    expect(
      isChoiceAnswer({
        type: "choice",
        choice: "haiku",
        confidence: 0.8,
        probabilities: { haiku: 0.8, sonnet: 0.2 },
      })
    ).toBe(true);
  });

  it.each([
    ["wrong type", { type: "score", choice: "a", confidence: 0.5, probabilities: {} }],
    ["missing choice", { type: "choice", confidence: 0.5, probabilities: {} }],
    ["empty choice string", { type: "choice", choice: "", confidence: 0.5, probabilities: {} }],
    [
      "non-numeric confidence",
      { type: "choice", choice: "a", confidence: "high", probabilities: {} },
    ],
    [
      "confidence out of range",
      { type: "choice", choice: "a", confidence: 1.5, probabilities: {} },
    ],
    [
      "non-finite confidence",
      {
        type: "choice",
        choice: "a",
        confidence: Number.NaN,
        probabilities: {},
      },
    ],
    [
      "non-record probabilities",
      { type: "choice", choice: "a", confidence: 0.5, probabilities: "nope" },
    ],
    [
      "non-numeric probability value",
      {
        type: "choice",
        choice: "a",
        confidence: 0.5,
        probabilities: { a: "x" },
      },
    ],
    ["null", null],
    ["a string", "choice"],
  ])("rejects %s", (_label, value) => {
    expect(isChoiceAnswer(value)).toBe(false);
  });
});

describe("isScoreAnswer", () => {
  it("accepts a well-formed score answer", () => {
    expect(
      isScoreAnswer({
        type: "score",
        score: 2,
        confidence: 0.6,
        legend: ["bad", "ok", "good"],
        probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 },
      })
    ).toBe(true);
  });

  it("accepts any `legend` value, including null, as long as the key is present", () => {
    expect(
      isScoreAnswer({
        type: "score",
        score: 1,
        confidence: 0.5,
        legend: null,
        probabilities: {},
      })
    ).toBe(true);
  });

  it.each([
    [
      "wrong type",
      {
        type: "choice",
        score: 1,
        confidence: 0.5,
        legend: [],
        probabilities: {},
      },
    ],
    ["missing score", { type: "score", confidence: 0.5, legend: [], probabilities: {} }],
    [
      "non-numeric score",
      {
        type: "score",
        score: "high",
        confidence: 0.5,
        legend: [],
        probabilities: {},
      },
    ],
    [
      "confidence out of range",
      {
        type: "score",
        score: 1,
        confidence: -0.1,
        legend: [],
        probabilities: {},
      },
    ],
    [
      "missing legend key entirely",
      { type: "score", score: 1, confidence: 0.5, probabilities: {} },
    ],
    [
      "non-record probabilities",
      {
        type: "score",
        score: 1,
        confidence: 0.5,
        legend: [],
        probabilities: null,
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(isScoreAnswer(value)).toBe(false);
  });
});

describe("isNoulAnswer", () => {
  it("accepts a well-formed noul answer", () => {
    expect(isNoulAnswer({ type: "noul", noul: 0.73 })).toBe(true);
  });

  it.each([
    ["wrong type", { type: "choice", noul: 0.5 }],
    ["missing noul", { type: "noul" }],
    ["non-numeric noul", { type: "noul", noul: "yes" }],
    ["noul above 1", { type: "noul", noul: 1.2 }],
    ["noul below 0", { type: "noul", noul: -0.2 }],
    ["non-finite noul", { type: "noul", noul: Number.POSITIVE_INFINITY }],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isNoulAnswer(value)).toBe(false);
  });
});
