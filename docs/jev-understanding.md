# Understanding Jev / System One

This document explains what Jev is, what it actually returns, and how this project's `packages/core`
uses it. Every claim below is either read directly from the installed `@typesafe-ai/sdk` package or
labeled as this framework's own convention. Facts specific to the SDK were verified against
**`@typesafe-ai/sdk@0.6.0`** (the version resolved by `npm install` into this monorepo and still the
installed version as of this writing), primarily during Task 2 of this project's build
(**verified 2026-09-17**, commit `89bb767`), and spot-checked again while writing this document
(**2026-09-19**). See section 11 for the full verification log.

## 1. What is Jev / System One

Jev ("System One") is a hosted model from TypeSafe AI (`@typesafe-ai/sdk@0.6.0`, package
`https://www.npmjs.com/package/@typesafe-ai/sdk`, base URL `https://api.typesafe.ai`, endpoint
`POST /v1/systemone`) purpose-built for bounded, structured decisions rather than open-ended text
generation. Instead of prompting a generative LLM and parsing free text back into an enum or a
number, you ask Jev a typed question — a `Choice` between named options, a `Score` on an ordered
scale, or a `Noul` (a yes/no probability) — and it returns a typed, calibrated answer object, not
prose to parse. The SDK's client class is `TypeSafeClient`, and a single request is made via
`client.systemOne({ state, questions })`.

## 2. Why "System One" thinking — bounded structured decisions vs. generative calls

Modern AI applications and agents make a huge number of small, frequent, _structured_ decisions
that don't actually require generation: "should the agent keep going?", "which tool next?", "is
this document relevant?", "does this output pass verification?", "should we escalate?". Routing
every one of these through an expensive generative LLM call means paying generation-level latency
and cost for what is really a bounded classification or a boolean gate — and then still having to
defensively parse whatever text came back into a usable enum.

This project's core thesis is that these two kinds of work should be handled by two different
kinds of model, deliberately kept apart: Jev answers the small, bounded, enumerable-outcome
questions that gate what happens next, and a real generative LLM (via `packages/providers`) is
invoked only when the policy layer decides actual generation is needed — drafting an answer,
synthesizing a summary, writing code. `DecisionGateway` (`packages/core`) is the seam between the
two: application code asks Jev the small questions, a deterministic policy layer turns Jev's
typed, confidence-scored answers into an action, and the expensive LLM is called only when that
policy says so.

## 3. The three question types: Choice / Score / Noul

Confirmed directly from the installed SDK's type declarations
(`node_modules/@typesafe-ai/sdk/dist/index.d.mts`) and README, and reflected unchanged in
`packages/core/src/jev/builders.ts`'s `toSdkQuestion()`:

```ts
declare const choice: <const T extends ChoiceCriteria>(
  instructions: EntryType,
  criteria: T
) => ChoiceQuestion<T>;
declare const score$1: <const T extends ScoreCriteria>(
  instructions: EntryType,
  criteria: T
) => ScoreQuestion<T>; // exported as `score`
declare const noul: (instructions?: EntryType, criteria?: NoulQuestion["criteria"]) => NoulQuestion;
```

All three builders take **`(instructions, criteria)`** — instructions first. This does not match a
naive guess of `choice(criteria, options)`; the SDK's own README confirms the real order with
`choice("What is this ticket about?", { billing: null, technical: null, other: null })`.

- **`Choice`** — pick one of a fixed set of labeled options. `criteria` is a `ChoiceCriteria`:
  a record of `label -> description` (a `Description` is an `EntryType`, so a plain string works).
  The response shape is `{ type: "choice", choice: string, confidence: number, probabilities: Record<string, number> }`
  (mirrored locally as `RawChoiceAnswer` in `packages/core/src/jev/types.ts`).
- **`Score`** — position on an ordered scale. `criteria` is confirmed to be
  `ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]]` (at least two entries) — **an
  ordered rubric of descriptions indexed by score position (0, 1, 2, …), not a flat array of
  labels**. The response is `{ type: "score", score: number, confidence: number, legend: unknown, probabilities: Record<string, number> }`,
  where `legend` is typed as `{ [score]: criteria[score] }` — whatever richer value (string,
  object, or array) each rubric position was given. `packages/core/src/policy/rules.ts`'s
  `ScoreDecisionDef.levels: string[]` is cast to this tuple shape in `builders.ts`, since a plain
  `string[]` isn't structurally a fixed-length tuple even though each string is a valid `EntryType`.
- **`Noul`** — the probability that a stated proposition is true. `criteria` is confirmed as
  `{ true?: EntryType; false?: EntryType } | null`, matching this project's original assumption
  exactly. The response is just `{ type: "noul", noul: number }` — a single number in `[0, 1]`,
  **with no separate confidence field** (see section 4).

`EntryType` (used for `instructions` and for description values throughout) is confirmed as
`string | { [key: string]: JsonValue } | JsonValue[] | null`.

## 4. Confidence semantics

`Choice` and `Score` answers carry a native `confidence: number` field straight from the SDK — the
policy engine (`packages/core/src/policy/engine.ts`) reads `answer.confidence` directly and compares
it against `def.policy.minConfidence` before trusting the answer.

**`Noul` has no native confidence field at all** — confirmed directly in the SDK's type
declarations (`NoulResponse` is just `{ type: "noul"; noul: number }`). This project derives its
own confidence for Noul answers as a documented **framework convention, not a Jev field**:

```ts
// packages/core/src/policy/engine.ts
const confidence = Math.abs(answer.noul - 0.5) * 2;
```

The reasoning: `noul` is a probability in `[0, 1]` where `0.5` is maximally undecided and `0`/`1`
are maximally decided in either direction. Distance from `0.5`, scaled by `2`, turns that
probability into a `[0, 1]` confidence value with the same shape and threshold semantics as
`Choice`/`Score`'s native confidence — `noul=0.5` → `confidence=0`; `noul=0.95` or `noul=0.05` →
`confidence=0.9`. This formula is applied in exactly one place (`policy/engine.ts`) and is called
out as a convention everywhere it matters — the raw SDK response (`RawNoulAnswer` in
`packages/core/src/jev/types.ts`) is never given a synthetic `confidence` field itself; the
derivation happens only at policy-evaluation time.

## 5. Structured `state`

Every `DecisionGateway.evaluate()`/`chain()` call takes a `state: DecisionState`
(`packages/core/src/types.ts`: `interface DecisionState { [key: string]: unknown }`) — an arbitrary
bag of caller-supplied facts the questions are evaluated against (e.g. the task text, iteration
count, tools used so far, a pre-flight-resolved category). This is passed straight through to the
SDK's own `systemOne({ state, questions })` call. Because `state` can contain anything the caller
puts in it — including, accidentally, something that looks like a credential — the trace layer
provides `redactState()` (`packages/core/src/trace/trace.ts`), which returns a shallow copy with any
key matching `/key|token|secret|password|credential|pwd/i` replaced with `"[REDACTED]"`, for
defensive use anywhere a fragment of `state` might be logged or embedded in a trace.

## 6. Parallel fan-out (one call, many questions, speculative questions)

The SDK's documented, encouraged pattern is a single `client.systemOne({ state, questions: {...} })`
call answering multiple independent questions in one round trip — "speculative fan-out." This
project's concrete implementation of that pattern is `DecisionGateway.evaluate()`'s **one-call
guarantee**: no matter how many decisions are in the `decisions` map passed to `evaluate()`, exactly
one `askJev`/`systemOne` call is made. `packages/core/src/gateway.ts` states this explicitly:

```ts
// Batching (Global Constraint 3): exactly one `askJev` call no matter how many decisions are
// in `args.decisions` -- every id is sent (and answered) in this single request.
const result = await askJev(
  this.handle,
  { state: args.state, questions: args.decisions },
  { signal: args.signal }
);
```

The flagship example (`examples/agent-runtime-optimizer`) uses this for its main per-iteration
checkpoint: `buildMainCheckpointDecisions()` builds a 4-question `DecisionSet` (`modelTier`,
`nextTool`, `shouldContinue`, `verifyOutput`), and `loop.ts` answers all four in a single
`gateway.evaluate()` call per iteration.

`verifyOutput` is the clearest example of why this pattern is called _speculative_: it is asked in
the same fan-out as `nextTool`/`shouldContinue`/`modelTier`, before that iteration's generation
step has run at all, so the very first time it's asked in a given generation cycle there is no
draft answer yet for it to judge -- it is a speculative pre-check, not unconditional "output
verification." Only on a verify-retry iteration (a prior iteration's `generate()` already ran) does
`loop.ts`'s `buildDecisionState()` include the real `draftAnswer` text in `state`, at which point
`verifyOutput`'s answer is actually informed by the content it's judging. See
`examples/agent-runtime-optimizer/src/loop.ts`'s `buildDecisionState()`.

## 7. Dependent/sequential decisions

The SDK has **no native chaining primitive** — there is no way to tell `systemOne` "answer this
question, then use that answer to shape a second question, in the same call." The SDK's own
recommended pattern for dependent questions is app-level orchestration: call `systemOne` once, use
the answer to build new state, call `systemOne` again.

This project's concrete implementation of that pattern is `DecisionGateway.chain()`
(`packages/core/src/gateway.ts`), which runs a callback that receives an `evaluate` closure; each
call to that closure shallow-merges its own `state` over the chain's `initialState` and internally
calls `this.evaluate(...)`, recording every step's full `EvaluationResult` and accumulating traces.
The flagship example's pre-flight step is a real instance of this, not a toy: `loop.ts`'s
`runLoop()` opens with

```ts
// examples/agent-runtime-optimizer/src/loop.ts
const chainResult = await gateway.chain({ task }, async ({ evaluate }) => {
  const categoryResult = await evaluate({
    decisions: { taskCategory: buildTaskCategoryDecision(task) },
  });
  const category = categoryResult.decisions.taskCategory.action;
  const subsetResult = await evaluate({
    state: { preflightCategory: category },
    decisions: { toolSubset: buildToolSubsetDecision(category) },
  });
  return { category, toolSubset: subsetResult.decisions.toolSubset.action };
});
```

The first step classifies the task into a coarse category (`lookup` / `calculation` /
`multi-step`); the second step's `options`/`instructions` are computed _from_ the first step's
resolved category (`buildToolSubsetDecision(category)` in `examples/agent-runtime-optimizer/src/decisions.ts`
picks a genuinely different tool-subset question depending on which category was resolved) — a real
dependent pair, not two independent questions asked back to back.

## 8. Auth, transport, error codes, timeouts/retries

**Auth**: `TYPESAFE_API_KEY` environment variable, or an explicit `apiKey` in config
(`createJevClient`/`DecisionGateway`'s `GatewayConfig.apiKey` resolve in that order, trimmed, and
treat an empty/whitespace-only value as absent). No key resolvable → `createJevClient` returns
`null` (never throws) and the gateway takes its `MISSING_KEY` fail-open path with zero network
calls.

**Transport**: `TypeSafeClient.systemOne(request, { signal })`, one HTTP call per invocation.

**Error codes**, confirmed by reading `dist/index.mjs`'s `APIError.fromResponse`:

- `401` → `AuthenticationError`
- `422` → `UnprocessableEntityError`
- `429` → `RateLimitError` (carries `retryAfterMs`)
- `>= 500` → `InternalServerError` — so a `529` (overloaded) is **not** a dedicated subclass, it
  surfaces as an `InternalServerError` with `.status === 529`.

Separately (not `APIError` subclasses, so no `.status`): a network failure throws
`APIConnectionError`; a request that doesn't complete in time throws `APITimeoutError extends
APIConnectionError`; a caller-triggered abort throws `APIUserAbortError`. `askJev()`
(`packages/core/src/jev/adapter.ts`) doesn't distinguish any of this at runtime — it catches
everything and returns `null` uniformly, redacting the configured API key from whatever it logs.

**Timeouts/retries — two independent layers**: the SDK's own `TypeSafeClientConfig` accepts
`timeout` (per-attempt HTTP timeout, confirmed default **10000ms**, read directly from
`dist/index.mjs`: `this.timeout = assertPositiveMs("timeout", config.timeout ?? 1e4)`) and `retry`
(`{ maxRetries, backoffInitialMs, backoffMaxMs, ... }`). This project deliberately does **not**
configure the SDK's own `timeout` — instead, `packages/core/src/jev/client.ts` sets its own
independent default deadline of **1500ms** (`JevClientConfig.timeoutMs`), enforced in
`adapter.ts` via `AbortSignal.timeout(handle.timeoutMs)` merged with any caller-supplied signal,
and passed to `systemOne(...)` as the request's `signal`. `retry` is forwarded straight through to
the SDK unchanged (`{ maxRetries: 1, backoffInitialMs: 150, backoffMaxMs: 400 }` by default).

**Why the gateway layers its own tighter deadline**: Jev calls sit on a hot path — a per-iteration
control-flow gate inside an agent loop, or a pre-flight classification before real work starts.
The SDK's own 10-second default per-attempt timeout (times however many retries) is far too slow
for that role; a control decision that takes multiple seconds to resolve defeats the purpose of
using a fast structured-decision model at all. Layering a 1.5-second hard deadline on top —
independent of, and tighter than, the SDK's own timeout/retry configuration — means a slow or
struggling Jev backend degrades to a fast, safe fallback outcome instead of stalling the caller.

## 9. Usage/token accounting

A successful `systemOne()` response's `usage` field is typed as always present (not optional):
`interface Usage { readonly input_tokens: number; readonly output_tokens: number; }`. `askJev()`
still checks this defensively at runtime (`Number.isFinite` on both fields) rather than trusting
the type blindly, and maps it to `{ inputTokens, outputTokens }`; if it's ever missing or
non-finite, `AskJevSuccess.usage` is `null` rather than a fabricated value.

**What `result.usage` does and doesn't tell you**: it tells you the token counts Jev's own
`systemOne` call consumed for that request — useful for understanding how "expensive" a batched
Jev call was in relative terms, or for comparing batching strategies. It does **not** tell you a
dollar cost: this project found no public per-token pricing for Jev/TypeSafe AI as of 2026-09 (the
benchmark's `ComparisonResult.jevBillingCost` field is always the literal string
`"n/a — no public pricing found as of 2026-09"`, never a computed number). Token counts are also
not directly comparable to a generative LLM's token accounting — a bounded Choice/Score/Noul
question is a fundamentally different, much smaller unit of work than a generation call, so
"tokens in/out" here should be read as a Jev-internal accounting signal, not as a stand-in for
LLM-equivalent cost.

## 10. When Jev is (and isn't) the right tool

Jev is well suited to decisions that are **bounded and enumerable**: a fixed set of named options
(routing, categorization), a position on a defined ordered scale (severity, confidence tiers), or a
yes/no gate (should we continue, does this pass verification, is escalation warranted). Its value
proposition is real for exactly this class of problem: typed, calibrated answers in place of
prompting a generative model and parsing its text back into an enum, at (per this project's own
tighter 1.5s deadline) a latency budget suited to a hot control-flow path.

Jev is **not** a replacement for a generative LLM, and this project does not claim it is. It cannot
write a paragraph, synthesize a summary across sources, produce code, or carry out open-ended,
multi-step reasoning where the "answer" isn't from a small fixed set decided in advance — there is
no `criteria` you could enumerate for "write a helpful response to this support ticket." Every
example and benchmark in this repository still uses a real LLM-provider interface
(`packages/providers`'s `LLMProvider`, backed by `OpenAIProvider`/`AnthropicProvider`/`MockProvider`)
for the generation half of the work; Jev only ever gates _when_ and _how_ that generation happens,
never replaces it. If your workload is mostly open-ended generation with few or no bounded
control decisions in front of it, a decision gateway like this one has little to offer — it earns
its keep specifically where many small structured decisions would otherwise be routed through an
expensive generative call.

## 11. Sources & verification log

- **Package**: `@typesafe-ai/sdk`, version **`0.6.0`** (resolved by `npm install
@typesafe-ai/sdk --workspace packages/core`; confirmed still `0.6.0` in
  `node_modules/@typesafe-ai/sdk/package.json` as of 2026-09-19).
- **Files directly inspected**:
  - `node_modules/@typesafe-ai/sdk/dist/index.d.mts` (full type declarations, 407 lines) —
    question-builder signatures, `EntryType`/`ChoiceCriteria`/`ScoreCriteria`/`NoulQuestion`
    shapes, `Usage`/`SystemOneResult` shape, `TypeSafeClientConfig` shape, error class hierarchy
    declarations.
  - `node_modules/@typesafe-ai/sdk/dist/index.mjs` (bundled implementation) — `APIError.fromResponse`'s
    status-to-error-class mapping, the default `timeout` value (`config.timeout ?? 1e4`), and retry
    behavior not visible from types alone.
  - `node_modules/@typesafe-ai/sdk/README.md` — confirms the real `choice(instructions, criteria)`
    argument order via its own quickstart example.
- **Dates**: initial verification during Task 2, **2026-09-17** (commit `89bb767`); this document
  written and the same package re-checked, **2026-09-19** (Task 10); real, live-key network calls
  made during Task 11's benchmark run, also **2026-09-19** (see the next two bullets).
- **Directly observed** (read from the installed package's own type declarations or bundled
  source — not inferred): all three builders' `(instructions, criteria)` argument order; `Score`'s
  criteria as an ordered tuple keyed by score position; `Noul`'s lack of a native confidence field;
  `EntryType`'s exact union; the `401`/`422`/`429`/`>=500` error-class mapping; `Usage`'s field
  names (`input_tokens`/`output_tokens`) and non-optional typing; the SDK's default per-attempt
  `timeout` of 10000ms; the `retry` config field names (`maxRetries`/`backoffInitialMs`/
  `backoffMaxMs`).
- **Confirmed via a real, live-key run** (Task 11, **2026-09-19** UTC — corrected here: an earlier
  revision of this section incorrectly claimed no live call had ever been made): 75 real network
  calls to `https://api.typesafe.ai`, made with a real `TYPESAFE_API_KEY`, across
  `benchmark/ai-agent-scenario`'s full 12-task benchmark (228 real decisions answered). Real,
  measured (not inferred) values from that run: per-task average confidence ranged 0.72–0.93
  (0.81 overall, call-weighted across tasks); per-task real Jev latency ranged 1,845.8 ms–3,942.0 ms
  total; 70 of 228 decisions fell back, all `LOW_CONFIDENCE` (0 `ERROR`, 0 `MISSING_KEY`). Full
  write-up, including the per-call latency breakdown and methodology: `benchmark/ai-agent-scenario/
REPORT.md`. `packages/core/test/live/jev.live.test.ts` (which `describe.skipIf`s cleanly without a
  key) also runs against the live API for real whenever `TYPESAFE_API_KEY` is set.
- **Still not directly observed / unconfirmed**: whether a live `529` response is ever actually
  observed in practice — none of the 75 real calls above hit one (0 `ERROR`-classified fallbacks
  across the whole run); only the SDK's code path for classifying a `529` (as `InternalServerError`)
  has been confirmed by reading its source, not by observing one occur.
