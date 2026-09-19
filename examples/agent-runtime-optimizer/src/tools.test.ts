import { describe, expect, it } from "vitest";

import { calculator, callTool, fileRead, search } from "./tools.js";

/** True for the generic "nothing matched" string, false for a real canned response. */
function isFallback(output: string): boolean {
  return output.includes("generic demo fallback");
}

describe("search / calculator / fileRead exact-match lookups (unchanged behavior)", () => {
  it("still resolves the exact canned keys verbatim", () => {
    expect(search("search documentation for typescript strict mode")).toContain("strictNullChecks");
    expect(calculator("100 / 4")).toBe("25");
    expect(fileRead("package.json")).toContain("demo-project");
  });

  it("is still case/whitespace-insensitive for an exact match", () => {
    expect(calculator("  100   /   4  ")).toBe("25");
    expect(fileRead("PACKAGE.JSON")).toContain("demo-project");
  });
});

describe("fuzzy keyword-overlap matching (final-review Finding #4 fix)", () => {
  // REGRESSION GUARD: before this fix, `lookup()` only ever did an exact normalized-string match,
  // so every one of these full-sentence, real task-style prompts (which restate a canned key's
  // topic rather than quoting it) fell through to the generic fallback -- verified 0/39 hits
  // across the flagship example's default task and the 12 `benchmark/ai-agent-scenario` tasks.
  it("matches a paraphrased search prompt to its canned doc entry", () => {
    const output = search(
      "Search the documentation to explain what TypeScript's strict mode enables."
    );
    expect(isFallback(output)).toBe(false);
    expect(output).toContain("strictNullChecks");
  });

  it("matches the flagship example's own DEFAULT_TASK wording to the log-inspection entry", () => {
    const output = search(
      "Inspect recent logs for an error, and report a one-line summary of what you found."
    );
    expect(isFallback(output)).toBe(false);
    expect(output).toContain("/var/log/app");
  });

  it("matches a verbal arithmetic phrase ('divided by') to its symbolic canned key", () => {
    const output = calculator("What is 100 divided by 4?");
    expect(isFallback(output)).toBe(false);
    expect(output).toBe("25");
  });

  it("matches a filename mentioned mid-sentence to its canned fileRead entry", () => {
    const output = fileRead("Read package.json and report the project's version field.");
    expect(isFallback(output)).toBe(false);
    expect(output).toContain("demo-project");
  });

  it("matches a near-verbatim embedded phrase ('how many retries are configured')", () => {
    const output = calculator(
      "Determine how many retries are configured, then calculate the total worst-case wait time."
    );
    expect(isFallback(output)).toBe(false);
    expect(output).toBe("2");
  });

  it("still falls through to the honest fallback for genuinely unrelated input", () => {
    const output = search("What color is the sky on a clear day?");
    expect(isFallback(output)).toBe(true);
  });

  it("does not let one generic shared word alone trigger a confident (mis)match", () => {
    // Shares only "config" with the 3-word key "config/app.json" -- below MATCH_THRESHOLD, so
    // this must NOT resolve to that file's contents (which would be a wrong answer, not a
    // fallback -- worse than the honest "no canned result" string).
    const output = fileRead("Something about config somewhere.");
    expect(isFallback(output)).toBe(true);
  });
});

describe("real task-prompt hit rate (default task + all 12 benchmark tasks)", () => {
  // Literal copies of `benchmark/ai-agent-scenario/src/tasks.ts`'s 12 prompts and
  // `examples/agent-runtime-optimizer/src/index.ts`'s DEFAULT_TASK (duplicated here rather than
  // imported, since `examples/*` does not depend on `benchmark/*` -- it's the other way around).
  // This is the empirical version of the final-review Finding #4 verification: for each task,
  // does calling search/calculator/fileRead with the raw task prompt resolve at least one of them
  // to a real canned response instead of the generic fallback?
  const DEFAULT_TASK =
    "Inspect recent logs for an error, and report a one-line summary of what you found.";

  const TASK_PROMPTS: Record<string, string> = {
    "default-task": DEFAULT_TASK,
    "trivial-already-resolved":
      'The user writes: "Never mind — I already fixed it myself, thanks." Close out the request without doing any further work.',
    "trivial-calculation": "What is 100 divided by 4?",
    "trivial-file-lookup": "Read package.json and report the project's version field.",
    "trivial-doc-search":
      "Search the documentation to explain what TypeScript's strict mode enables.",
    "moderate-config-change":
      "Update the `retries` config value to 5 and confirm the new value is now in place.",
    "moderate-log-inspection":
      "Inspect recent logs for an error and report a one-line summary of the most severe issue you find.",
    "moderate-test-run":
      "Run the test suite and report whether it passed, citing the relevant log output.",
    "moderate-clarify-ambiguous":
      'The user asks: "Can you fix the thing that\'s broken?" Ask a targeted clarifying question before doing anything else.',
    "complex-checkout-investigation":
      "Investigate why the checkout flow is failing: check recent logs for errors, look up the relevant config value, and compute whether the configured retry count is sufficient given the observed failure rate.",
    "complex-retry-backoff-math":
      "Determine how many retries are configured, then calculate the total worst-case wait time if each retry backs off by an additional 3 seconds.",
    "complex-cross-file-audit":
      "Cross-reference package.json and the app config to confirm the deployed version matches the feature-flag configuration, and summarize any mismatch.",
    "complex-ambiguous-then-research":
      'The user says: "Something\'s wrong with the numbers." Ask what specifically looks wrong, then, assuming they mean the retry count, look it up and verify it against documentation.',
  };

  // Two of the 13 are expected misses, both for legitimate reasons rather than a matching gap:
  // "trivial-already-resolved" needs no tool call at all (idealToolSequence is empty), and
  // "complex-ambiguous-then-research" is deliberately vague ("Something's wrong with the
  // numbers.") -- neither should be forced into a confidently-wrong canned match.
  const EXPECTED_MISSES = new Set(["trivial-already-resolved", "complex-ambiguous-then-research"]);

  it("resolves most tasks (>= 10/13) to at least one real canned tool response", () => {
    const misses: string[] = [];

    for (const [id, prompt] of Object.entries(TASK_PROMPTS)) {
      const hitsSomething = [search(prompt), calculator(prompt), fileRead(prompt)].some(
        (output) => !isFallback(output)
      );
      if (!hitsSomething) misses.push(id);
    }

    expect(misses.sort()).toEqual([...EXPECTED_MISSES].sort());
    const hitCount = Object.keys(TASK_PROMPTS).length - misses.length;
    expect(hitCount).toBeGreaterThanOrEqual(10);
  });
});

describe("callTool", () => {
  it("dispatches to the right underlying tool by name", () => {
    expect(callTool("calculator", "2 + 2")).toBe("4");
    expect(callTool("fileRead", "readme.md")).toContain("Demo Project");
  });
});
