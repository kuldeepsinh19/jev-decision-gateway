# AI Agent Benchmark — Real Run Report

This is a narrative write-up of one real, live-key run of `benchmark/ai-agent-scenario` (Task 11).
Unlike every other number produced by this repository's automated test suite, everything under
"Real Jev numbers" below came from actual network calls to `https://api.typesafe.ai`, made with a
real `TYPESAFE_API_KEY`, on 2026-09-19. Nothing here is fabricated, rounded up, or backfilled from
a guess — where a number could not be measured, that is stated explicitly instead of estimated.

The raw JSON this report is drawn from is checked in at
[`results/example-run.json`](./results/example-run.json) (generated at
`2026-09-18T20:26:31.211Z`, `@typesafe-ai/sdk@0.6.0`, Node `v20.20.2`, commit `d59a577`). Console
output for this exact run is reproduced in full at the bottom of this file.

## What was measured

Both scenarios ran all 12 synthetic tasks in `src/tasks.ts` (4 trivial, 4 moderate, 4 complex):

- **`baseline`** — the naive comparison point: one simulated LLM call per control-flow decision
  (`modelTier`, `nextTool`, `shouldContinue`, `verifyOutput`), `expectedIterations` times per task.
  Every number in this scenario is simulated by `packages/providers`' `MockProvider`, using pricing/
  latency constants dated 2026-09-17 — `baseline` never calls Jev at all (`realJevCallCount` is 0
  for all 12 tasks), so it has nothing "real" to report.
- **`jevGated`** — the real thing: `examples/agent-runtime-optimizer`'s actual `runLoop()`, gated by
  a real `DecisionGateway`, run against the real Jev API for every control decision, with the same
  `MockProvider` standing in for the generation half (used only when the loop decides to finish an
  iteration — Jev has no ability to write the final answer itself, see
  [`docs/jev-understanding.md`](../../docs/jev-understanding.md) section 10).

Every "real" field below is read straight from a live `EvaluationResult`/`DecisionTrace`. Every
"simulated" field is read straight from a live `LLMResponse` produced by the deterministic,
zero-network `MockProvider` — "simulated" describes the LLM side, not that the number is invented;
`MockProvider` really does return these exact cost/latency figures, they are just not measured
against a real LLM API.

## Real Jev numbers (this run)

**Totals across all 12 tasks, `jevGated` scenario:**

| Metric | Value |
|---|---|
| Real Jev calls (`gateway.evaluate()`/chain steps) | 75 |
| Real Jev decisions answered (Choice/Score/Noul, across those 75 calls) | 228 |
| Total real Jev latency (sum of `EvaluationResult.latencyMs`) | 31,660.6 ms |
| Average real Jev confidence (weighted across decisions with a non-null confidence) | 0.82 |
| Real fallback count (decision-level) | 73 |
| Real fallback rate (73 / 228 decisions) | 32.0% |
| Fallback reason breakdown, this run | 73x `LOW_CONFIDENCE`, 0x `ERROR`, 0x `MISSING_KEY` |
| Tasks completed (both scenarios) | 12 / 12 |

**Per-task breakdown** (from the console table, reproduced verbatim below): real Jev call counts
per task ranged from 5 to 8, real per-task Jev latency from 1,946.5 ms to 3,850.1 ms, real
confidence from 0.74 to 0.93, and per-task fallback rate from 7.7% to 57.1%.

**Real Jev latency distribution** — `ComparisonResult` aggregates latency per task
(`realJevLatencyMs`/`realJevCallCount`), not as a flat list of individual call samples, so a true
per-call min/avg/p95 across all 75 benchmark calls could not be reconstructed from the checked-in
JSON alone. To still report a real, non-fabricated per-call distribution, this section instead uses
the individual per-call latencies actually observed and printed during this same Task 11 session,
across the three flagship-example transcripts (the README excerpt and the two others run alongside
it) plus a small standalone capture script that issued the same 3-decision batch as
`packages/core/test/live/jev.live.test.ts` three times in a row:

| Stat | Value (n = 16 successful single-call samples) |
|---|---|
| Min | 350.5 ms |
| Median | 404.3 ms |
| Mean | 490.5 ms |
| p95 | 1,284.5 ms |
| Max | 1,284.5 ms |

These 16 samples exclude one call that did not succeed at all: the very first call issued by the
capture script's fresh process hit this project's own 1,500 ms client-side deadline
(`JevClientConfig.timeoutMs`, see `docs/jev-understanding.md` section 8) and resolved as a real
`ERROR` fallback (`APIUserAbortError: Request was aborted`, logged by `jev/adapter.ts`'s own
warning line) rather than a real answer. This pattern showed up more than once: every fresh
process's first Jev call (the pre-flight chain's first step, or the capture script's first batch)
consistently took noticeably longer — 1,946–2,826 ms observed per-2-call chain total across the
three example runs — than every subsequent call in the same process (350–700 ms once warmed up).
This reads as TLS/connection-establishment cold-start cost on the very first request of a process,
not a Jev model-latency characteristic; it is a genuine, reproducible observation from this run,
not a synthetic scenario. It also means the project's own 1,500 ms deadline is tight relative to
real observed cold-start latency — tight enough that a cold first call can, and in this session's
own capture script did once, genuinely fall back. This is the fail-open design working exactly as
documented, not a defect, but it is worth calling out plainly: expect occasional real `ERROR`
fallbacks on the very first Jev call of a freshly started process.

In the 75-call benchmark run itself (a single, longer-lived process making many calls back to
back), no individual call ever fell back with `ERROR` — every one of the 73 real fallbacks
recorded was `LOW_CONFIDENCE`, and average per-call latency across all 75 calls (31,660.6 ms / 75 =
approximately 422 ms) sits squarely inside the "warmed up" range above.

## Real confidence distribution and the `LOW_CONFIDENCE` fallback rate

The overall real average confidence (0.82) sits comfortably above the demo's own
`DEFAULT_MIN_CONFIDENCE = 0.6` policy threshold (`examples/agent-runtime-optimizer/src/decisions.ts`)
— and yet the decision-level fallback rate was still 32.0%. Both are real and both are consistent:
`avgConfidence` averages over every decision that did return a non-null confidence (i.e. every
decision that did not fall back), so a high average among the decisions that succeeded does not
contradict a meaningful fraction of decisions falling below 0.6 individually. Two things drive
this, both real, observed patterns in this run's own trace data (not guesses):

1. **`nextTool`/`modelTier` are 4- and 2-option `Choice` decisions respectively**, and Jev's
   `Choice` confidence reflects how concentrated its probability mass is on the winning option.
   Several `nextTool`/`modelTier` calls in the example transcripts below resolved with the winning
   option well short of 0.6 confidence (e.g. `modelTier -> mock-fast (confidence n/a) [FALLBACK:
   LOW_CONFIDENCE]`) — plausible given how repetitive and low-signal the demo's canned tool
   outputs are (the `search` tool's canned response is a generic "no result found" string for every
   task in this repo, since no real search backend is wired in), which gives Jev genuinely little
   new information to distinguish "keep going" from "finish" as iterations accumulate.
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

| Metric | `baseline` (all simulated) | `jevGated` (real Jev + simulated generation) |
|---|---|---|
| LLM calls | 132 | 36 |
| Simulated LLM latency | 184,800.0 ms | 24,750.0 ms |
| Simulated LLM cost | $0.060285 | $0.011075 |

**Savings (simulated)**: 96 LLM calls avoided, $0.049210 saved, 160,050.0 ms saved — in this
12-task run, routing control decisions through Jev instead of a dedicated LLM call per decision
avoided 96 of the 132 simulated LLM calls the naive baseline makes (structurally: every control
decision `jevGated` answers via a real, batched Jev call is a decision `baseline` would instead
have spent one full simulated LLM call on). The 36 LLM calls `jevGated` still makes are exactly the
"generate the final answer" calls the loop needed after Jev decided a task was ready to finish —
Jev is never asked, and never able, to do that generation itself.

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
  figures in this report were actually measured on 2026-09-19.
- **Jev's own billing cost is not publicly known as of this writing.** This project found no public
  per-token or per-call pricing for Jev/TypeSafe AI (`docs/jev-understanding.md` section 9); the
  savings table above nets out simulated LLM cost avoided, but does not, and cannot, net that
  against what Jev itself would cost to run in production. Treat the dollar figures here as cost
  avoided on the LLM side, never as net savings.
- **The real Jev latency distribution above (n=16) is small** and drawn from this project's own
  Task 11 verification session rather than the full 75-call benchmark run itself (whose JSON report
  only carries per-task aggregates, not a flat list of every individual call's latency — see
  `metrics.ts`'s `RealJevAggregate` shape). The qualitative "cold first call is slower" pattern was
  consistent across every fresh process observed in this session, but a rigorous p95 claim would
  need either a larger dedicated latency-sampling run or a `metrics.ts` change to preserve
  individual call latencies (out of scope for this task — noted here as a possible improvement).
- **The 32.0% `LOW_CONFIDENCE` fallback rate is specific to this benchmark's synthetic setup**
  (repetitive canned tool outputs, an artificially extended `maxIterations`, and a demo-wide,
  untuned `minConfidence = 0.6`), not a general claim about how often real Jev calls fall below
  threshold on well-instrumented, real tool outputs. See the confidence-distribution section above.
- **This was one run, at one point in time** (2026-09-19). Jev's real latency/confidence behavior
  was not sampled repeatedly enough across different times of day, load conditions, or over a long
  window to make any claim about long-run stability — this report describes what was actually
  observed in this one run, not a statistically robust characterization of the live service.

## Fail-open re-check (same code, key removed)

As a final sanity check (Task 11 step 9), the same benchmark command was re-run with
`TYPESAFE_API_KEY` unset (`env -u TYPESAFE_API_KEY`, no `--env-file`) rather than deleted from disk.
It completed cleanly with exit code 0: all 12 tasks completed, 60 Jev calls were made (5 per task,
fewer than the 75 real calls above, because with no key every decision falls back immediately with
near-zero latency rather than looping through as many real iterations before finishing), every
single one reported `MISSING_KEY`, real Jev latency for the whole run was 5.9 ms total (calling a
`null` client synchronously resolves to a fallback with no network I/O), and JEV avg confidence was
`n/a` for every task (every decision's confidence is `null` when it falls back). No crash, no
unhandled rejection, exit code 0. Full console output for this re-check run is not checked in
alongside `results/example-run.json` (only the real, live-key run is the checked-in reference
artifact) but was captured during Task 11's verification and is described in this project's
Task 11 implementation notes for the record.

## Full console output (this run, real key)

```
=== jev-decision-gateway :: AI Agent Benchmark ===

Task                         | Baseline $ (sim) | Baseline ms (sim)  | Baseline LLM calls  | JEV real calls  | JEV real ms  | JEV avg confidence  | JEV fallback rate  | LLM calls avoided
-----------------------------|------------------|--------------------|---------------------|-----------------|--------------|---------------------|--------------------|-------------------
trivial-already-resolved     | $0.002252        | 7000.0ms           | 5                   | 5               | 3850.1ms     | 0.93                | 28.6%              | 4
trivial-calculation          | $0.003452        | 12600.0ms          | 9                   | 6               | 2682.0ms     | 0.87                | 33.3%              | 8
trivial-file-lookup          | $0.003712        | 12600.0ms          | 9                   | 7               | 2813.6ms     | 0.85                | 18.2%              | 8
trivial-doc-search           | $0.003842        | 12600.0ms          | 9                   | 8               | 2878.6ms     | 0.81                | 30.8%              | 8
moderate-config-change       | $0.005655        | 18200.0ms          | 13                  | 5               | 2035.1ms     | 0.77                | 50.0%              | 12
moderate-log-inspection      | $0.003977        | 12600.0ms          | 9                   | 6               | 2312.3ms     | 0.79                | 55.6%              | 8
moderate-test-run            | $0.005647        | 18200.0ms          | 13                  | 5               | 2115.8ms     | 0.82                | 57.1%              | 12
moderate-clarify-ambiguous   | $0.002240        | 7000.0ms           | 5                   | 5               | 1946.5ms     | 0.79                | 21.4%              | 4
complex-checkout-investigation | $0.008725        | 23800.0ms          | 17                  | 7               | 2667.8ms     | 0.88                | 22.7%              | 16
complex-retry-backoff-math   | $0.006135        | 18200.0ms          | 13                  | 5               | 1956.1ms     | 0.75                | 57.1%              | 12
complex-cross-file-audit     | $0.006200        | 18200.0ms          | 13                  | 8               | 2936.2ms     | 0.81                | 7.7%               | 12
complex-ambiguous-then-research | $0.008445        | 23800.0ms          | 17                  | 8               | 3466.4ms     | 0.74                | 30.8%              | 16

=== Totals ===
Tasks: 12
Baseline (all simulated): 132 LLM calls, 184800.0ms, $0.060285
JEV-gated -- real Jev: 75 calls, 31660.6ms, avg confidence 0.82, fallback rate 32.0%
JEV-gated -- simulated LLM (generation only): 36 calls, 24750.0ms, $0.011075
Savings (simulated): 96 LLM calls avoided, $0.049210 saved, 160050.0ms saved
Jev's own billing cost: n/a — no public pricing found as of 2026-09

* = simulated using pricing/latency constants dated 2026-09-17, not measured.
```

Raw JSON: [`results/example-run.json`](./results/example-run.json).
