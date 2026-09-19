import { performance } from "node:perf_hooks";

import { askJev } from "./jev/adapter.js";
import { createJevClient } from "./jev/client.js";
import type { JevClientHandle } from "./jev/client.js";
import { applyPolicy } from "./policy/engine.js";
import { fallbackOutcome } from "./fallback/engine.js";
import { createTrace } from "./trace/trace.js";
import { TraceCollector } from "./trace/collector.js";
import type {
  DecisionDef,
  DecisionOutcome,
  DecisionSet,
  DecisionState,
  DecisionTrace,
  EvaluationResult,
  FallbackReason,
  GatewayConfig,
} from "./types.js";

/**
 * The public API surface of `@jev-decision-gateway/core`: batches a `DecisionSet` into a single
 * Jev call, applies policy/fallback per decision, and collects a trace. Never throws — every
 * failure mode (no API key, transport error, timeout, malformed response) resolves to a fallback
 * `DecisionOutcome` per decision instead (Global Constraint 5: fail-open).
 */
export class DecisionGateway {
  private readonly config: GatewayConfig;
  /**
   * Built once, eagerly, in the constructor — never rebuilt per call. `null` here means "no
   * resolvable API key" (Global Constraint 5's MISSING_KEY fail-open path), not an error.
   */
  private readonly handle: JevClientHandle | null;

  constructor(config: GatewayConfig = {}) {
    this.config = config;
    this.handle = createJevClient({
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      logLevel: config.logLevel,
    });
  }

  async evaluate<TSet extends DecisionSet>(args: {
    state: DecisionState;
    decisions: TSet;
    signal?: AbortSignal;
  }): Promise<EvaluationResult<TSet>> {
    const startedAt = performance.now();
    const collector = new TraceCollector();
    const ids = Object.keys(args.decisions);

    // MISSING_KEY fail-open path (Global Constraint 5): no resolvable API key means `askJev` is
    // never called at all -- zero network calls, asserted directly in gateway.test.ts.
    if (this.handle === null) {
      const decisions: Record<string, DecisionOutcome> = {};
      for (const id of ids) {
        const def = args.decisions[id] as DecisionDef;
        const outcome = fallbackOutcome(def, elapsedMs(startedAt), "MISSING_KEY");
        decisions[id] = outcome;
        this.emitTrace(collector, def, outcome);
      }
      return {
        decisions: decisions as unknown as {
          [K in keyof TSet]: DecisionOutcome;
        },
        usage: null,
        trace: collector.all(),
        latencyMs: elapsedMs(startedAt),
      };
    }

    // Batching (Global Constraint 3): exactly one `askJev` call no matter how many decisions are
    // in `args.decisions` -- every id is sent (and answered) in this single request.
    const result = await askJev(
      this.handle,
      { state: args.state, questions: args.decisions },
      { signal: args.signal }
    );

    const latencyMs = elapsedMs(startedAt);
    const decisions: Record<string, DecisionOutcome> = {};

    if (result === null) {
      // Best-effort TIMEOUT/ERROR distinction: `askJev` merges `args.signal` internally with its
      // own `handle.timeoutMs` deadline before it ever reaches the SDK, so by the time it resolves
      // to `null` we can no longer tell which of the two fired. The only thing observable from out
      // here is whether the signal *we* passed in is itself aborted: if so, attribute this to a
      // caller-driven TIMEOUT; otherwise (our own internal deadline elapsing, a network failure,
      // an HTTP error, or anything else `askJev` caught) label it ERROR. Documented heuristic, not
      // a precise classification.
      const reason: FallbackReason = args.signal?.aborted ? "TIMEOUT" : "ERROR";
      for (const id of ids) {
        const def = args.decisions[id] as DecisionDef;
        const outcome = fallbackOutcome(def, latencyMs, reason);
        decisions[id] = outcome;
        this.emitTrace(collector, def, outcome);
      }
      return {
        decisions: decisions as unknown as {
          [K in keyof TSet]: DecisionOutcome;
        },
        usage: null,
        trace: collector.all(),
        latencyMs,
      };
    }

    for (const id of ids) {
      const def = args.decisions[id] as DecisionDef;
      const raw = result.answers[id] ?? null;
      // A raw answer already ran through `jev/adapter.ts`'s `isChoiceAnswer`/`isScoreAnswer`/
      // `isNoulAnswer` guards before it could ever land in `result.answers` -- an id that failed
      // those guards is simply absent here, which we treat as MALFORMED_RESPONSE for just that id
      // (the rest of an otherwise-successful batch is unaffected). A present-but-wrong-kind answer
      // (e.g. a `noul` answer for a `choice` decision id) is caught inside `applyPolicy` itself.
      const outcome =
        raw === null
          ? applyPolicy(def, null, latencyMs, "MALFORMED_RESPONSE")
          : applyPolicy(def, raw, latencyMs);
      decisions[id] = outcome;
      this.emitTrace(collector, def, outcome);
    }

    return {
      decisions: decisions as unknown as { [K in keyof TSet]: DecisionOutcome },
      usage: result.usage,
      trace: collector.all(),
      latencyMs,
    };
  }

  async chain<T>(
    initialState: DecisionState,
    callback: (ctx: {
      evaluate: <TSet extends DecisionSet>(args: {
        state?: DecisionState;
        decisions: TSet;
        signal?: AbortSignal;
      }) => Promise<EvaluationResult<TSet>>;
    }) => Promise<T>
  ): Promise<{
    value: T;
    steps: EvaluationResult<DecisionSet>[];
    trace: DecisionTrace[];
    totalLatencyMs: number;
  }> {
    const startedAt = performance.now();
    const steps: EvaluationResult<DecisionSet>[] = [];
    const trace: DecisionTrace[] = [];

    const stepEvaluate = async <TSet extends DecisionSet>(args: {
      state?: DecisionState;
      decisions: TSet;
      signal?: AbortSignal;
    }): Promise<EvaluationResult<TSet>> => {
      // Per-step state is shallow-merged over the chain's initial state, with the per-step value
      // winning on conflicting keys -- this is how a later step sees an earlier step's answers,
      // once the callback threads them into `state` itself (see the dependent-decision example).
      const mergedState: DecisionState = {
        ...initialState,
        ...(args.state ?? {}),
      };
      const result = await this.evaluate({
        state: mergedState,
        decisions: args.decisions,
        signal: args.signal,
      });
      steps.push(result as unknown as EvaluationResult<DecisionSet>);
      trace.push(...result.trace);
      return result;
    };

    const value = await callback({ evaluate: stepEvaluate });

    return {
      value,
      steps,
      trace,
      totalLatencyMs: elapsedMs(startedAt),
    };
  }

  private emitTrace(collector: TraceCollector, def: DecisionDef, outcome: DecisionOutcome): void {
    const decisionTrace = createTrace(def, outcome);
    collector.add(decisionTrace);
    this.config.onTrace?.(decisionTrace);
  }
}

function elapsedMs(startedAt: number): number {
  return performance.now() - startedAt;
}
