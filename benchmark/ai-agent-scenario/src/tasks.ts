/**
 * 12 synthetic, hand-written benchmark tasks (4 per complexity level), spanning the kinds of
 * control decisions the project brief calls out: doc lookups, config edits, running a test suite,
 * log inspection, asking a clarifying question, and a task that's already fully answered.
 *
 * `idealToolSequence`/`expectedIterations` are reference metadata describing a plausible run of
 * this task -- neither scenario in `scenarios/` is required to reproduce them exactly (the whole
 * point of `jevGated.ts` is that the *real* loop, gated by Jev, decides its own path). They exist
 * so `controlDecisionCountFor()` below has a single, deterministic, task-derived denominator that
 * both scenarios can be compared against on equal footing.
 */
export interface BenchmarkTask {
  id: string;
  prompt: string;
  complexity: "trivial" | "moderate" | "complex";
  idealToolSequence: string[];
  expectedIterations: number;
}

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  // ---- trivial (4) ----
  {
    id: "trivial-already-resolved",
    prompt:
      'The user writes: "Never mind — I already fixed it myself, thanks." Close out the request without doing any further work.',
    complexity: "trivial",
    idealToolSequence: [],
    expectedIterations: 1,
  },
  {
    id: "trivial-calculation",
    prompt: "What is 100 divided by 4?",
    complexity: "trivial",
    idealToolSequence: ["calculator"],
    expectedIterations: 2,
  },
  {
    id: "trivial-file-lookup",
    prompt: "Read package.json and report the project's version field.",
    complexity: "trivial",
    idealToolSequence: ["fileRead"],
    expectedIterations: 2,
  },
  {
    id: "trivial-doc-search",
    prompt: "Search the documentation to explain what TypeScript's strict mode enables.",
    complexity: "trivial",
    idealToolSequence: ["search"],
    expectedIterations: 2,
  },

  // ---- moderate (4) ----
  {
    id: "moderate-config-change",
    prompt: "Update the `retries` config value to 5 and confirm the new value is now in place.",
    complexity: "moderate",
    idealToolSequence: ["fileRead", "fileRead"],
    expectedIterations: 3,
  },
  {
    id: "moderate-log-inspection",
    prompt:
      "Inspect recent logs for an error and report a one-line summary of the most severe issue you find.",
    complexity: "moderate",
    idealToolSequence: ["search"],
    expectedIterations: 2,
  },
  {
    id: "moderate-test-run",
    prompt: "Run the test suite and report whether it passed, citing the relevant log output.",
    complexity: "moderate",
    idealToolSequence: ["search", "fileRead"],
    expectedIterations: 3,
  },
  {
    id: "moderate-clarify-ambiguous",
    prompt:
      'The user asks: "Can you fix the thing that\'s broken?" Ask a targeted clarifying question before doing anything else.',
    complexity: "moderate",
    idealToolSequence: [],
    expectedIterations: 1,
  },

  // ---- complex (4) ----
  {
    id: "complex-checkout-investigation",
    prompt:
      "Investigate why the checkout flow is failing: check recent logs for errors, look up the relevant config value, and compute whether the configured retry count is sufficient given the observed failure rate.",
    complexity: "complex",
    idealToolSequence: ["search", "fileRead", "calculator"],
    expectedIterations: 4,
  },
  {
    id: "complex-retry-backoff-math",
    prompt:
      "Determine how many retries are configured, then calculate the total worst-case wait time if each retry backs off by an additional 3 seconds.",
    complexity: "complex",
    idealToolSequence: ["calculator", "calculator"],
    expectedIterations: 3,
  },
  {
    id: "complex-cross-file-audit",
    prompt:
      "Cross-reference package.json and the app config to confirm the deployed version matches the feature-flag configuration, and summarize any mismatch.",
    complexity: "complex",
    idealToolSequence: ["fileRead", "fileRead"],
    expectedIterations: 3,
  },
  {
    id: "complex-ambiguous-then-research",
    prompt:
      'The user says: "Something\'s wrong with the numbers." Ask what specifically looks wrong, then, assuming they mean the retry count, look it up and verify it against documentation.',
    complexity: "complex",
    idealToolSequence: ["search", "calculator"],
    expectedIterations: 4,
  },
];

/**
 * The shared "naive" cost model this benchmark compares both scenarios against: one control
 * decision per iteration-checkpoint question (`modelTier`/`nextTool`/`shouldContinue`/
 * `verifyOutput` -- the same 4-question fan-out `examples/agent-runtime-optimizer/src/decisions.ts`
 * asks per iteration), times the task's `expectedIterations`. Both `scenarios/baseline.ts` and
 * `scenarios/jevGated.ts` use this exact same function so their `controlDecisionCount` fields are
 * directly comparable rather than each reflecting a different, scenario-specific actual count.
 */
export function controlDecisionCountFor(task: BenchmarkTask): number {
  const DECISIONS_PER_ITERATION = 4;
  return task.expectedIterations * DECISIONS_PER_ITERATION;
}
