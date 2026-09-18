import { describe, expect, it } from "vitest";

import type {
  ChoiceDecisionDef,
  DecisionOutcome,
  NoulDecisionDef,
  ScoreDecisionDef,
} from "../policy/rules.js";
import { createTrace, redactState } from "./trace.js";

const choiceDef: ChoiceDecisionDef = {
  kind: "choice",
  id: "route",
  instructions: "pick a tool",
  options: { search: "look it up", calculator: "do math", finish: "done" },
  policy: { minConfidence: 0.7, fallbackAction: "finish" },
};

const scoreDef: ScoreDecisionDef = {
  kind: "score",
  id: "quality",
  levels: ["poor", "acceptable", "good", "excellent"],
  policy: {
    minConfidence: 0.5,
    thresholds: [{ atOrAbove: 0.7, action: "good" }],
    fallbackAction: "poor",
  },
};

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

describe("createTrace", () => {
  it("builds a trace for a choice decision with a pipe-joined criteriaSummary", () => {
    const outcome: DecisionOutcome = {
      id: "route",
      raw: {
        type: "choice",
        choice: "search",
        confidence: 0.8,
        probabilities: { search: 0.8 },
      },
      confidence: 0.8,
      action: "search",
      usedFallback: false,
      matchedRule: "choice-direct",
      latencyMs: 15,
    };

    const trace = createTrace(choiceDef, outcome);

    expect(trace.decisionId).toBe("route");
    expect(trace.kind).toBe("choice");
    expect(trace.question).toEqual({
      instructions: "pick a tool",
      criteriaSummary: "choice: search|calculator|finish",
    });
    expect(trace.rawAnswer).toEqual(outcome.raw);
    expect(trace.confidence).toBe(0.8);
    expect(trace.policyApplied).toEqual({
      minConfidence: 0.7,
      matchedRule: "choice-direct",
    });
    expect(trace.action).toBe("search");
    expect(trace.usedFallback).toBe(false);
    expect(trace.fallbackReason).toBeUndefined();
    expect(trace.latencyMs).toBe(15);
    expect(typeof trace.traceId).toBe("string");
    expect(trace.traceId.length).toBeGreaterThan(0);
    expect(new Date(trace.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("builds a trace for a score decision, summarizing the level count (not the levels themselves)", () => {
    const outcome: DecisionOutcome = {
      id: "quality",
      raw: {
        type: "score",
        score: 0.9,
        confidence: 0.9,
        legend: {},
        probabilities: {},
      },
      confidence: 0.9,
      action: "good",
      usedFallback: false,
      matchedRule: "score>=0.7",
      latencyMs: 20,
    };

    const trace = createTrace(scoreDef, outcome);

    expect(trace.kind).toBe("score");
    expect(trace.question.criteriaSummary).toBe("score: 4 levels");
    expect(trace.policyApplied).toEqual({
      minConfidence: 0.5,
      matchedRule: "score>=0.7",
    });
  });

  it("builds a trace for a noul decision with a fixed criteriaSummary", () => {
    const outcome: DecisionOutcome = {
      id: "continue",
      raw: { type: "noul", noul: 0.9 },
      confidence: 0.8,
      action: "continue",
      usedFallback: false,
      matchedRule: "noul-true",
      latencyMs: 3,
    };

    const trace = createTrace(noulDef, outcome);

    expect(trace.kind).toBe("noul");
    expect(trace.question.criteriaSummary).toBe("noul");
  });

  it("carries a fallback outcome's raw:null/confidence:null/fallbackReason through unchanged", () => {
    const outcome: DecisionOutcome = {
      id: "continue",
      raw: null,
      confidence: null,
      action: "halt",
      usedFallback: true,
      fallbackReason: "TIMEOUT",
      latencyMs: 2,
    };

    const trace = createTrace(noulDef, outcome);

    expect(trace.rawAnswer).toBeNull();
    expect(trace.confidence).toBeNull();
    expect(trace.usedFallback).toBe(true);
    expect(trace.fallbackReason).toBe("TIMEOUT");
    expect(trace.policyApplied.matchedRule).toBeUndefined();
  });

  it("generates a distinct traceId on every call", () => {
    const outcome: DecisionOutcome = {
      id: "continue",
      raw: { type: "noul", noul: 0.9 },
      confidence: 0.8,
      action: "continue",
      usedFallback: false,
      latencyMs: 1,
    };

    const first = createTrace(noulDef, outcome);
    const second = createTrace(noulDef, outcome);

    expect(first.traceId).not.toBe(second.traceId);
  });
});

describe("redactState", () => {
  const SECRET = "sk-super-secret-fake-value-should-never-leak-9f3c1a";

  it("redacts keys matching /key|token|secret|password|credential|pwd/i case-insensitively", () => {
    const state = {
      apiKey: SECRET,
      TOKEN: SECRET,
      userSecret: SECRET,
      TYPESAFE_API_KEY: SECRET,
      password: SECRET,
      userPassword: SECRET,
      pwd: SECRET,
      credential: SECRET,
      apiCredential: SECRET,
      username: "not-a-secret",
      count: 3,
    };

    const result = redactState(state);

    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.TOKEN).toBe("[REDACTED]");
    expect(result.userSecret).toBe("[REDACTED]");
    expect(result.TYPESAFE_API_KEY).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
    expect(result.userPassword).toBe("[REDACTED]");
    expect(result.pwd).toBe("[REDACTED]");
    expect(result.credential).toBe("[REDACTED]");
    expect(result.apiCredential).toBe("[REDACTED]");
    expect(result.username).toBe("not-a-secret");
    expect(result.count).toBe(3);
  });

  it("never lets the literal secret value survive anywhere in the serialized output, across varied key spellings", () => {
    // Deliberately not just the exact key names spelled out above: mixed case, a key that merely
    // contains "secret" as a substring, and the real env var name this project actually uses.
    const state = {
      apiKey: SECRET,
      Token: SECRET,
      mySecretValue: SECRET,
      TYPESAFE_API_KEY: SECRET,
    };

    const result = redactState(state);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(SECRET);
  });

  it("redacts password-style keys and never lets the literal secret value survive in serialized output", () => {
    // Tests password, pwd, and credential patterns to ensure coverage per Global Constraint 4
    const state = {
      password: SECRET,
      myPassword: SECRET,
      pwd: SECRET,
      credential: SECRET,
      apiCredential: SECRET,
    };

    const result = redactState(state);
    const serialized = JSON.stringify(result);

    expect(result.password).toBe("[REDACTED]");
    expect(result.myPassword).toBe("[REDACTED]");
    expect(result.pwd).toBe("[REDACTED]");
    expect(result.credential).toBe("[REDACTED]");
    expect(result.apiCredential).toBe("[REDACTED]");
    expect(serialized).not.toContain(SECRET);
  });

  it("leaves non-matching keys and their values untouched", () => {
    const state = { username: "alice", retryCount: 2, nested: { a: 1 } };
    expect(redactState(state)).toEqual(state);
  });

  it("does not mutate the input object and returns a shallow copy", () => {
    const state = { apiKey: "abc123" };
    const result = redactState(state);

    expect(state.apiKey).toBe("abc123");
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result).not.toBe(state);
  });
});
