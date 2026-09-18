import type { DecisionTrace } from "./trace.js";

/**
 * Simple in-memory, array-backed collector. `gateway.ts` (Task 5) creates one per
 * `evaluate()`/`chain()` call and forwards each trace to `GatewayConfig.onTrace` if configured, in
 * addition to collecting it here.
 */
export class TraceCollector {
  private readonly traces: DecisionTrace[] = [];

  add(trace: DecisionTrace): void {
    this.traces.push(trace);
  }

  all(): DecisionTrace[] {
    return [...this.traces];
  }

  clear(): void {
    this.traces.length = 0;
  }
}
