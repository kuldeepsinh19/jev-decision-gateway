# Roadmap

This MVP pass deliberately scoped down to one flagship example, one benchmark scenario, and a
minimal CLI, in order to ship a solid, real, live-tested core (`packages/core`'s Jev integration)
rather than a wide but shallow surface. Everything below was consciously deferred for time/scope
reasons, not because it's a bad idea — each bullet notes why it's deferred and, where relevant,
roughly where it would live if built later.

- **RAG-gating example** — a second example using `DecisionGateway` to decide document relevance /
  retrieval-worthiness before an expensive embedding or generation step. Deferred: the flagship
  agent-loop example already exercises `evaluate()`/`chain()`/fallback end-to-end; a second example
  would mostly re-demonstrate the same gateway mechanics on a different domain. Would live in a new
  `examples/rag-gating` workspace package, following the same `state.ts`/`decisions.ts`/`loop.ts`
  structure as `examples/agent-runtime-optimizer`.

- **Output-verification as its own standalone example** — the flagship example already includes a
  `verifyOutput` Noul gate inline (`examples/agent-runtime-optimizer/src/decisions.ts`), but it's a
  speculative pre-check asked alongside `nextTool`/`shouldContinue`/`modelTier` before that
  iteration's generation step runs (only informed by real draft content on a verify-retry — see
  `docs/jev-understanding.md` section 6), not a standalone "verify this finished output" gate. A
  dedicated example focused purely on post-generation verification/escalation patterns was deferred
  as separate scope. Would live in a new `examples/output-verification` workspace package.

- **Coding-agent example** — a third example applying the gateway to a code-generation agent's
  control decisions (which file to edit, whether to run tests, whether a diff is safe to apply).
  Deferred for time; would live in `examples/coding-agent`, reusing `packages/core` and
  `packages/providers` exactly as the flagship example does.

- **The other 3 benchmark scenarios** — the project brief scoped 4 benchmark scenarios total;
  `benchmark/ai-agent-scenario` (baseline vs. JEV-gated AI agent workload) is the one built for this
  pass. The other three were deferred for time. Would live as sibling `benchmark/*` workspace
  packages, reusing `benchmark/ai-agent-scenario/src/metrics.ts`'s `real`/`simulated`-tagged
  aggregation pattern.

- **Extra CLI commands (`evaluate`, `trace`, `inspect`, `init`)** — `packages/cli` currently ships
  exactly two commands, `run` and `benchmark`, both pure wiring over the example/benchmark packages
  (per the brief's "thin CLI wrapper, no business logic" constraint). Ad-hoc `evaluate` (run a
  single `DecisionSet` from the command line), `trace` (inspect a saved trace file), `inspect`
  (introspect a `DecisionDef`), and `init` (scaffold a new project) were deferred as scope beyond
  the two commands the flagship example/benchmark actually need. Would live as new files under
  `packages/cli/src/commands/`.

- **Extra provider adapters (Gemini, OpenRouter, Vercel AI SDK)** — `packages/providers` ships
  Mock/OpenAI/Anthropic behind the shared `LLMProvider` interface. Additional adapters were
  deferred for time; each would be a new `packages/providers/src/<provider>/provider.ts` implementing
  the same `LLMProvider` interface (`packages/providers/src/types.ts`), following the
  `OpenAIProvider`/`AnthropicProvider` pattern (lazy client construction, `MissingApiKeyError` before
  any SDK call, real usage-field mapping).

- **npm publishing** — every workspace package here is `"private": true` and unpublished; this repo
  is consumed as a git-cloned monorepo, not as installable npm packages. Deferred: publishing needs
  its own versioning/release process decision, out of scope for an MVP pass. Would involve dropping
  `"private": true` from each `packages/*` `package.json` and adding a release workflow.

- **Zod-based runtime validation** — `packages/core` currently validates SDK responses with
  hand-written defensive type guards (`packages/core/src/jev/types.ts`'s `isChoiceAnswer`/
  `isScoreAnswer`/`isNoulAnswer`), not a schema-validation library. Deferred: the hand-written guards
  are sufficient for the response shapes actually observed from the SDK's type declarations, and
  adding a dependency for this was judged unnecessary complexity for the MVP (Global Constraint 7:
  no unnecessary abstraction). Would replace those guards in `packages/core/src/jev/types.ts` if
  adopted later.

- **CI workflow** — there is no GitHub Actions (or other CI) workflow in this repository yet; `npm
test`/`npm run typecheck`/`npm run lint` are run locally/manually. Deferred for time. Would live at
  `.github/workflows/ci.yml`, running the same three root scripts across the whole workspace.

- **Separate `policy`/`observability` packages** — the policy engine, fallback engine, and trace
  currently live as sibling modules inside `packages/core` (`src/policy/`, `src/fallback/`,
  `src/trace/`), a deliberate simplification noted in the project's build plan rather than splitting
  them into their own npm workspace packages. Deferred/simplified for MVP scope: three tiny packages
  with a shared dependency on `packages/core`'s types would add workspace/build overhead without a
  concrete need (nothing outside `packages/core` currently needs to depend on the policy engine
  without also depending on the gateway). Would involve extracting `src/policy/`, `src/fallback/`,
  and `src/trace/` into their own `packages/policy` and `packages/observability` workspace packages
  if a real standalone consumer ever needs one without the other.

## Known constraints

- **`openai` is pinned to `^6.49.0`, not the newer `7.x` line** (`packages/providers/package.json`).
  `openai@7` requires Node >=22, which conflicts with this repo's `engines`/`.nvmrc` pin of Node 20
  (`package.json`'s root `"engines": { "node": ">=20" }`). Revisit this pin if/when the project
  moves its minimum supported Node version to 22+; until then, `OpenAIProvider`
  (`packages/providers/src/openai/provider.ts`) stays on the `6.x` line intentionally, not because
  it's stale.
