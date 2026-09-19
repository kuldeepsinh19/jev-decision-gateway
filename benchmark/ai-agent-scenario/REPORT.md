# AI Agent Benchmark — Real Run Report

This is a narrative write-up of a real, live-key run of `benchmark/ai-agent-scenario` (Task 11,
refreshed by the Task 11 review fix pass). Unlike every other number produced by this repository's
automated test suite, everything under "Real Jev numbers" below came from actual network calls to
`https://api.typesafe.ai`, made with a real `TYPESAFE_API_KEY`, on 2026-09-19 (UTC — stated
explicitly because an earlier version of this report mixed UTC and local time; every date in this
revision is UTC). Nothing here is fabricated, rounded up, or backfilled from a guess — where a
number could not be measured, that is stated explicitly instead of estimated.

**Task 11 review fix note:** a code review of the original Task 11 write-up found a real bug in the
per-task "LLM calls avoided" column (traced to `benchmark/ai-agent-scenario/src/scenarios/jevGated.ts`)
and some missing acceptance-criteria documentation. Both are fixed in this revision — see "Fixed:
per-task 'LLM calls avoided' bug" below and the new "Acceptance-criteria verification" section. The
benchmark was re-run for real (not just re-narrated) to produce every number in this file.

The raw JSON this report is drawn from is checked in at
[`results/example-run.json`](./results/example-run.json) (generated at
`2026-09-19T02:11:41.010Z` UTC, `@typesafe-ai/sdk@0.6.0`, Node `v20.20.2`, commit
`4d6407d66b5553114c4bbb7c6d3d8916f07ef68f` — the commit checked out at the moment this run
executed, i.e. the prior Task 11 commit; this fix's own commit necessarily comes after the run that
produced this JSON, the same chicken-and-egg reason the original report's JSON pointed at `d59a577`
instead of its own commit). Console output for this exact run is reproduced in full at the bottom of
this file.

## What was measured

Both scenarios ran all 12 synthetic tasks in `src/tasks.ts` (4 trivial, 4 moderate, 4 complex):

- **`baseline`** — the naive comparison point: one simulated LLM call per control-flow decision
  (`modelTier`, `nextTool`, `shouldContinue`, `verifyOutput`), `expectedIterations` times per task,
  plus one more simulated call for the final answer. Every number in this scenario is simulated by
  `packages/providers`' `MockProvider`, using pricing/latency constants dated 2026-09-17 —
  `baseline` never calls Jev at all (`realJevCallCount` is 0 for all 12 tasks), so it has nothing
  "real" to report.
- **`jevGated`** — the real thing: `examples/agent-runtime-optimizer`'s actual `runLoop()`, gated by
  a real `DecisionGateway`, run against the real Jev API for every control decision, with the same
  `MockProvider` standing in for the generation half (used only when the loop decides to finish an
  iteration, or needs to retry a failed verification — see the bug-fix note below for why this can
  be more than one call per task — Jev has no ability to write the final answer itself, see
  [`docs/jev-understanding.md`](../../docs/jev-understanding.md) section 10).

Every "real" field below is read straight from a live `EvaluationResult`/`DecisionTrace`. Every
"simulated" field is read straight from a live `LLMResponse` produced by the deterministic,
zero-network `MockProvider` — "simulated" describes the LLM side, not that the number is invented;
`MockProvider` really does return these exact cost/latency figures, they are just not measured
against a real LLM API.

## Fixed: per-task "LLM calls avoided" bug (Task 11 review finding #1)

**The bug.** `scenarios/jevGated.ts` used to set each task's `llmCallsAvoided` field to a flat
`controlDecisionCountFor(task)` — silently assuming `jevGated`'s own actual generation-call count
(`loopResult.llmCallCount`) was always exactly 1. That assumption was false: `runLoop`'s
verify-retry mechanism can, and regularly does, make more than one real generation call per task
(e.g. this run's own console output below shows every task making 3 generation calls, not 1). The
old per-task column summed to a number that did not match the true aggregate savings total —
in the prior checked-in run, the column summed to 120 while the true total
(`baseline.callCount [132] - jevGated.callCount [36]`) was 96, a silent 24-call overstatement.

**The fix.** `runBaseline`'s naive call-count formula (`controlDecisionCountFor(task) + 1`) is now
exported as `baselineLlmCallCountFor(task)` from `scenarios/baseline.ts`, and `runJevGated` uses it
directly: `llmCallsAvoided: baselineLlmCallCountFor(task) - loopResult.llmCallCount`. This is a true,
same-unit reconciliation for every task, not an assumption, and it can never silently drift out of
sync with `runBaseline`'s own formula again since both now call the same function. A regression test
(`report.test.ts`, "per-task 'LLM calls avoided' reconciliation") fixes jevGated call counts at 1, 3,
and 2 across three fixture tasks (deliberately not all 1) and asserts the per-task sum equals the
aggregate `savings.llmCallsAvoidedTotal` exactly, and that the printed table shows the reconciling
number. `scenarios/jevGated.test.ts` was updated the same way (it previously asserted the buggy
invariant `llmCallsAvoided === controlDecisionCount` directly).

**Confirmed fixed, in this run's real numbers**: the per-task "LLM calls avoided" column below sums
to exactly **96**, matching `baseline.callCount [132] - jevGated.callCount [36] = 96` exactly — see
the "Simulated LLM-call-avoidance comparison" section and the full console table at the bottom.

## Real Jev numbers (this run)

**Totals across all 12 tasks, `jevGated` scenario:**

| Metric                                                                                             | Value                                              |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Real Jev calls (`gateway.evaluate()`/chain steps)                                                  | 75                                                 |
| Real Jev decisions answered (Choice/Score/Noul, across those 75 calls)                             | 228                                                |
| Total real Jev latency (sum of `EvaluationResult.latencyMs`)                                       | 32,232.9 ms                                        |
| Average real Jev confidence (call-weighted mean of each task's own average, by `realJevCallCount`) | 0.81                                               |
| Real fallback count (decision-level)                                                               | 70                                                 |
| Real fallback rate (70 / 228 decisions)                                                            | 30.7%                                              |
| Fallback reason breakdown, this run                                                                | 70x `LOW_CONFIDENCE`, 0x `ERROR`, 0x `MISSING_KEY` |
| Tasks completed (both scenarios)                                                                   | 12 / 12                                            |

**Per-task breakdown** (from the console table, reproduced verbatim below): real Jev call counts
per task ranged from 5 to 8, real per-task Jev latency from 1,845.8 ms to 3,942.0 ms, real
confidence from 0.72 to 0.93, and per-task fallback rate from 7.7% to 57.1%.

## Real Jev latency distribution (this fix session)

`ComparisonResult` aggregates latency per task (`realJevLatencyMs`/`realJevCallCount`), not as a
flat list of individual call samples, so a true per-call min/avg/p95 across all 75 benchmark calls
still cannot be reconstructed from the checked-in JSON alone (unchanged limitation — see below).
Rather than repeat unverified figures from a separate, earlier session, this revision reports the
individual per-call latencies actually printed by one real, live-key run of
`examples/agent-runtime-optimizer/src/run.ts` performed during this fix's own verification (5
samples covering 6 calls — the pre-flight row combines 2 dependent calls into one reported total):

| Call                                           | Latency (real)                    |
| ---------------------------------------------- | --------------------------------- |
| Pre-flight chain (2 dependent calls, combined) | 2,750.2 ms total (~1,375 ms/call) |
| Iteration 1 fan-out                            | 411.8 ms                          |
| Iteration 2 fan-out                            | 425.8 ms                          |
| Iteration 3 fan-out                            | 350.5 ms                          |
| Iteration 4 fan-out                            | 333.8 ms                          |

The combined pre-flight-chain figure is markedly higher per call than every subsequent single-call
fan-out in the same run (~1,375 ms vs. 333.8-425.8 ms) — consistent with a cold-start pattern
(TLS/connection-establishment cost on a process's first outbound call, not a Jev model-latency
characteristic) already observed in the original Task 11 verification. This fix session's own live
integration test (`packages/core/test/live/jev.live.test.ts`) reproduced the same pattern directly:
it passed reliably every time it ran alone, but its first real call occasionally exceeded the
project's 1,500 ms client-side deadline and fell back with a real `ERROR`
(`APIUserAbortError: Request was aborted`) when run inside the full, default-parallel test suite —
see "Acceptance-criteria verification" below. This is the fail-open design working exactly as
documented, not a defect, and is the same, independently reconfirmed characteristic the original
report already called out.

Across the 75-call benchmark run itself (a single, longer-lived process making many calls back to
back), average real per-call latency was 32,232.9 ms / 75 ≈ 429.8 ms — squarely inside the
"warmed up" range above — and no individual call in that run fell back with `ERROR`; every one of
the 70 real fallbacks recorded was `LOW_CONFIDENCE`.

## Real confidence distribution and the `LOW_CONFIDENCE` fallback rate

The overall real average confidence (0.81) sits comfortably above the demo's own
`DEFAULT_MIN_CONFIDENCE = 0.6` policy threshold (`examples/agent-runtime-optimizer/src/decisions.ts`)
— and yet the decision-level fallback rate was still 30.7%. Both are real and both are consistent.
The overall 0.81 figure is **call-weighted, not decision-weighted**: `scenarios/jevGated.ts`
computes each task's own `realJevAvgConfidence` as a straight average over that task's individual
decisions with a non-null confidence, and `metrics.ts`'s `aggregate()` then combines those 12
per-task averages into the overall figure weighted by each task's `realJevCallCount` (not by its
decision count) — see `metrics.ts`'s `confidencesWeighted`/`avgConfidence`. So a high call-weighted
average among the decisions that succeeded does not contradict a meaningful fraction of decisions
falling below 0.6 individually. Two things drive this, both real, observed patterns in this run's
own trace data (not guesses):

1. **`nextTool`/`modelTier` are 4- and 2-option `Choice` decisions respectively**, and Jev's
   `Choice` confidence reflects how concentrated its probability mass is on the winning option.
   Several `nextTool`/`modelTier` calls in this session's transcripts resolved with the winning
   option well short of 0.6 confidence (e.g. `modelTier -> mock-fast (confidence n/a) [FALLBACK:
LOW_CONFIDENCE]`) — plausible given how repetitive and low-signal the demo's canned tool outputs
   were _at the time of this run_: `loop.ts` drove every tool call with the whole task string, but
   `tools.ts`'s lookup only ever did an exact string match against its (much shorter) canned keys,
   so every call in this run's transcripts fell through to the generic "no canned result" fallback
   string regardless of task (a real lookup-key mismatch bug, since fixed — see final-review Finding
   #4 — not a missing search backend; `tools.ts` did, and does, have real canned entries), which
   gave Jev genuinely little new information to distinguish "keep going" from "finish" as iterations
   accumulate.
2. **This benchmark deliberately raises `maxIterations`** to `task.expectedIterations + 2` (min 6,
   see `scenarios/jevGated.ts`) specifically so the real loop can run past its "ideal" length —
   which means several tasks' later iterations are asking Jev to make calls in a state space
   (repeated, near-identical scratchpad content) that a shorter, better-instrumented run would not
   reach at all. A production deployment with a real search/file backend and tighter, task-specific
   iteration caps would likely see a meaningfully lower `LOW_CONFIDENCE` rate than this synthetic
   benchmark does.

No decision in this run's 228 ever fell back for `ERROR` or `MISSING_KEY` — every fallback observed
in the actual benchmark run was the policy engine correctly declining a real, low-confidence Jev
answer, exactly as designed.

## Simulated LLM-call-avoidance comparison

| Metric                | `baseline` (all simulated) | `jevGated` (real Jev + simulated generation) |
| --------------------- | -------------------------- | -------------------------------------------- |
| LLM calls             | 132                        | 36                                           |
| Simulated LLM latency | 184,800.0 ms               | 23,800.0 ms                                  |
| Simulated LLM cost    | $0.060285                  | $0.010292                                    |

**Savings (simulated)**: 96 LLM calls avoided, $0.049993 saved, 161,000.0 ms saved — in this
12-task run, routing control decisions through Jev instead of a dedicated LLM call per decision
avoided 96 of the 132 simulated LLM calls the naive baseline makes. The 36 LLM calls `jevGated`
still makes are the "generate the final answer" calls the loop needed — 3 per task, not 1, because
of the verify-retry mechanism described above — after Jev decided a task's control flow; Jev is
never asked, and never able, to do that generation itself.

**Per-task reconciliation (post-fix)**: summing the per-task "LLM calls avoided" column in the
console table below gives 2+6+6+6+10+6+10+2+14+10+10+14 = **96**, exactly matching the aggregate
`96` above. Before the Task 11 review fix, this same sum would have read 120 (each task's naive
`controlDecisionCount`, ignoring that `jevGated` actually made 3 generation calls per task, not 1).

**`Jev's own billing cost`**: `n/a — no public pricing found as of 2026-09` (identical field,
unchanged, in every run of this benchmark) — see the limitations section below.

## Limitations — read this before trusting these numbers for a production estimate

- **12 synthetic tasks, not production traffic.** `src/tasks.ts`'s 12 tasks are hand-written to
  span trivial/moderate/complex control-flow shapes for demo purposes. They are not sampled from
  any real workload, and real agent traffic's distribution of how often the loop actually needs
  another tool call will differ, possibly substantially, from what is baked into these 12 prompts
  and the demo's canned tool outputs.
- **The LLM side of every number here is simulated, not measured**, per dated pricing/latency
  constants in `packages/providers/src/pricing.ts` (checked 2026-09-17). No real call was made to
  OpenAI, Anthropic, or any other generative LLM API anywhere in this repository's benchmark or
  example — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are not needed and were not used for this run. If
  real generative-LLM pricing or latency has changed since that date, every dollar/ms figure on the
  baseline/simulated side of every table above is stale by exactly that much; only the real Jev
  figures in this report were actually measured on 2026-09-19 (UTC).
- **Jev's own billing cost is not publicly known as of this writing.** This project found no public
  per-token or per-call pricing for Jev/TypeSafe AI (`docs/jev-understanding.md` section 9); the
  savings table above nets out simulated LLM cost avoided, but does not, and cannot, net that
  against what Jev itself would cost to run in production. Treat the dollar figures here as cost
  avoided on the LLM side, never as net savings.
- **The real Jev latency distribution above (5 samples covering 6 calls, this fix session)** is small and drawn
  from one flagship-example run rather than the full 75-call benchmark run itself (whose JSON report
  only carries per-task aggregates, not a flat list of every individual call's latency — see
  `metrics.ts`'s `RealJevAggregate` shape). The qualitative "cold first call is slower" pattern has
  now been observed independently in two separate sessions, but a rigorous p95 claim would need
  either a larger dedicated latency-sampling run or a `metrics.ts` change to preserve individual call
  latencies (out of scope for this fix — noted here as a possible improvement, same as before).
- **The 30.7% `LOW_CONFIDENCE` fallback rate is specific to this benchmark's synthetic setup**
  (repetitive canned tool outputs, an artificially extended `maxIterations`, and a demo-wide,
  untuned `minConfidence = 0.6`), not a general claim about how often real Jev calls fall below
  threshold on well-instrumented, real tool outputs. See the confidence-distribution section above.
- **This was one run, at one point in time** (2026-09-19, UTC). Jev's real latency/confidence
  behavior was not sampled repeatedly enough across different times of day, load conditions, or over
  a long window to make any claim about long-run stability — this report describes what was actually
  observed in this one run, not a statistically robust characterization of the live service.

## Fail-open re-check (same code, key removed) — benchmark

As a final sanity check, the same benchmark command was re-run in this fix session with
`TYPESAFE_API_KEY` explicitly unset (`env -u TYPESAFE_API_KEY`, no `--env-file`) rather than deleted
from disk. It completed cleanly with exit code 0: all 12 tasks completed, 60 Jev calls were made
(5 per task, fewer than the 75 real calls above, because with no key every decision falls back
immediately with near-zero latency rather than looping through as many real iterations before
finishing), every single one reported `MISSING_KEY`, real Jev latency for the whole run was 9.5 ms
total (calling a `null` client synchronously resolves to a fallback with no network I/O), and JEV
avg confidence was `n/a` for every task (every decision's confidence is `null` when it falls back).
No crash, no unhandled rejection, exit code 0.

Notably, `jevGated`'s own generation-call count was still 3 per task in this no-key run (identical
to the real-key run above), so the per-task "LLM calls avoided" reconciliation fix holds under
fallback conditions too: the column still sums to exactly 96, matching this run's own
`baseline.callCount [132] - jevGated.callCount [36] = 96`. Full console output for this re-check run
is not checked in alongside `results/example-run.json` (only the real, live-key run is the checked-in
reference artifact) — the figures above are the complete, verified summary of it.

## Fail-open re-check (same code, key removed) — flagship example

The original Task 11 report only documented the fail-open re-check for the benchmark, not for
`examples/agent-runtime-optimizer` directly — added here per Task 11 review finding #2(c). Ran
`node node_modules/tsx/dist/cli.mjs examples/agent-runtime-optimizer/src/run.ts` with no
`--env-file` and no `TYPESAFE_API_KEY` present in the environment at all. It completed cleanly with
exit code 0:

- Provider line printed `Jev: no key detected`.
- 3 iterations used (of a max of 6), 2/2 verify-retries exhausted before force-finalizing.
- 5 real "Jev calls" were made (1 pre-flight chain step that itself fans out to 2 dependent calls
  counted as such, plus 1 per iteration's 4-question fan-out), every one reporting
  `[FALLBACK: MISSING_KEY]` on every decision, confidence `n/a` throughout.
- Real Jev latency: 4.5 ms total (no network I/O — `createJevClient` returns `null` when no key is
  configured, and every decision resolves synchronously to its documented fallback).
- 3 simulated LLM calls still ran normally (`$0.000079` simulated, matching the benchmark's own
  observation that this run's loop makes 3 generation calls, not 1).
- A final answer was produced; no crash, no unhandled rejection.

This matches the documented `MISSING_KEY` fail-open path exactly, now confirmed for the flagship
example specifically, not just the benchmark. (Console output for this specific re-check was not
checked in separately; the bullet points above are its complete, verified summary.)

## Acceptance-criteria verification (Task 11 review finding #2)

### (a) `npm test` / `npm run typecheck` / `npm run lint`

- **`npm run typecheck`** (`tsc -b --noEmit`): clean, exit 0, no output. (This composite,
  project-references build needs the referenced projects' declaration outputs to already exist on
  disk before `--noEmit` can resolve them — a one-time `tsc -b`/`npm run build` first, same as any
  fresh checkout would need; not a code issue, and unrelated to this fix.)
- **`npm run lint`** (`eslint .`): clean, exit 0. The only output is a pre-existing, unrelated Node
  runtime warning (`MODULE_TYPELESS_PACKAGE_JSON`, about `eslint.config.js`'s module type) — not a
  lint finding.
- **`npm test` without a key** (normal dev/CI case): **20 test files, 160 tests — 159 passed, 1
  skipped** (the live test, `packages/core/test/live/jev.live.test.ts`, correctly skips via
  `describe.skipIf(!process.env.TYPESAFE_API_KEY)`).
- **`npm test` with the real key loaded**, run as
  `node --env-file=.env node_modules/vitest/vitest.mjs run` (per this task's key-loading
  instruction; `node_modules/.bin/vitest` is a POSIX shell wrapper `node` can't execute directly on
  this machine, so the underlying `.mjs` entry is invoked instead): the live test genuinely executes
  (not skipped) and, run cleanly, **all 20 test files pass, 160/160 tests**. As already documented in
  the original Task 11 report and independently reconfirmed in this session: running the live test
  _alone_ passes reliably every time; running the _full_ default-parallel suite occasionally hits the
  project's 1,500 ms client-side timeout on the live test's first real network call under worker-CPU
  contention, producing a real (not fabricated) `ERROR` fallback — 2 of 5 full-suite attempts in this
  session hit this, 3 of 5 (including one run with `--no-file-parallelism`) passed cleanly at
  160/160. This is the fail-open mechanism working correctly under real load, not a regression from
  this fix (no source file outside `benchmark/ai-agent-scenario/src/` was touched), and not something
  this fix's scope calls for changing (raising `timeoutMs` or isolating the live test into its own
  vitest pool would be a separate design decision).

### (b) Security check — no key committed or leaked

Exact commands run, and their real output, without ever reading or printing the key's actual value:

```
$ git ls-files | grep -c '^\.env$'
0
```

```
$ git grep -n "TYPESAFE_API_KEY=" -- . ':!.env' ':!.env.example'
README.md:75:TYPESAFE_API_KEY=
examples/agent-runtime-optimizer/src/tools.ts:38:  ".env.example": "TYPESAFE_API_KEY=\nOPENAI_API_KEY=\n",
```

Both matches are the bare variable name followed immediately by nothing (`README.md`'s env-var
documentation line) or by a canned demo string simulating an `.env.example` file's contents
(`tools.ts`) — neither contains, nor is followed by, any real key material. A broader sweep of the
whole working tree (tracked and untracked, excluding `node_modules`/`.git`/`dist`) for the same
`TYPESAFE_API_KEY=` pattern was also run and found only the same kind of placeholder/documentation
matches, in gitignored scratch files under `.superpowers/` and the two files above — no real value
anywhere. `.env` itself is confirmed gitignored (`.gitignore` line 3) and was never read for any
purpose beyond letting Node's own `--env-file` flag load it into `process.env` for the live
commands in this report.

### (c) Example fail-open re-check

See "Fail-open re-check (same code, key removed) — flagship example" above.

## Full console output (this run, real key)

```
=== jev-decision-gateway :: AI Agent Benchmark ===

Task                         | Baseline $ (sim) | Baseline ms (sim)  | Baseline LLM calls  | JEV real calls  | JEV real ms  | JEV avg confidence  | JEV fallback rate  | LLM calls avoided
-----------------------------|------------------|--------------------|---------------------|-----------------|--------------|---------------------|--------------------|-------------------
trivial-already-resolved     | $0.002252        | 7000.0ms           | 5                   | 5               | 3942.0ms     | 0.93                | 28.6%              | 2
trivial-calculation          | $0.003452        | 12600.0ms          | 9                   | 6               | 2427.7ms     | 0.86                | 33.3%              | 6
trivial-file-lookup          | $0.003712        | 12600.0ms          | 9                   | 7               | 2789.8ms     | 0.85                | 18.2%              | 6
trivial-doc-search           | $0.003842        | 12600.0ms          | 9                   | 8               | 3104.5ms     | 0.81                | 26.9%              | 6
moderate-config-change       | $0.005655        | 18200.0ms          | 13                  | 6               | 2570.2ms     | 0.76                | 50.0%              | 10
moderate-log-inspection      | $0.003977        | 12600.0ms          | 9                   | 6               | 2502.0ms     | 0.79                | 55.6%              | 6
moderate-test-run            | $0.005647        | 18200.0ms          | 13                  | 5               | 2036.4ms     | 0.82                | 57.1%              | 10
moderate-clarify-ambiguous   | $0.002240        | 7000.0ms           | 5                   | 5               | 1845.8ms     | 0.79                | 21.4%              | 2
complex-checkout-investigation | $0.008725        | 23800.0ms          | 17                  | 6               | 2333.7ms     | 0.89                | 22.2%              | 14
complex-retry-backoff-math   | $0.006135        | 18200.0ms          | 13                  | 5               | 1909.8ms     | 0.74                | 57.1%              | 10
complex-cross-file-audit     | $0.006200        | 18200.0ms          | 13                  | 8               | 3744.1ms     | 0.81                | 7.7%               | 10
complex-ambiguous-then-research | $0.008445        | 23800.0ms          | 17                  | 8               | 3027.0ms     | 0.72                | 19.2%              | 14

=== Totals ===
Tasks: 12
Baseline (all simulated): 132 LLM calls, 184800.0ms, $0.060285
JEV-gated -- real Jev: 75 calls, 32232.9ms, avg confidence 0.81, fallback rate 30.7%
JEV-gated -- simulated LLM (generation only): 36 calls, 23800.0ms, $0.010292
Savings (simulated): 96 LLM calls avoided, $0.049993 saved, 161000.0ms saved
Jev's own billing cost: n/a — no public pricing found as of 2026-09

* = simulated using pricing/latency constants dated 2026-09-17, not measured.
```

Raw JSON: [`results/example-run.json`](./results/example-run.json).
