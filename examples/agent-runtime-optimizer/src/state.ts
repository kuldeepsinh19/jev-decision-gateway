/**
 * Mutable agent state threaded through `loop.ts`'s control loop. `iteration`/`verifyRetries` are
 * counters *observed* by decisions (via `DecisionState` facts) but the numeric caps
 * (`maxIterations`/`maxVerifyRetries`) are fixed once, in code, at construction time here -- no
 * `DecisionOutcome` anywhere in this example ever changes what these two numbers *are*, only
 * whether the loop keeps spending the budget they already define. See `loop.ts` for where that
 * hard boundary is enforced.
 */
export interface AgentState {
  task: string;
  iteration: number;
  maxIterations: number;
  verifyRetries: number;
  maxVerifyRetries: number;
  toolsUsed: Array<{ tool: string; input: string; output: string }>;
  scratchpad: string;
  draftAnswer: string | null;
  done: boolean;
}

/** Default hard caps -- see `AgentState`'s doc comment: never overridable by a Jev answer. */
export const DEFAULT_MAX_ITERATIONS = 6;
export const DEFAULT_MAX_VERIFY_RETRIES = 2;

export function createInitialState(
  task: string,
  opts?: { maxIterations?: number; maxVerifyRetries?: number }
): AgentState {
  return {
    task,
    iteration: 0,
    maxIterations: opts?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    verifyRetries: 0,
    maxVerifyRetries: opts?.maxVerifyRetries ?? DEFAULT_MAX_VERIFY_RETRIES,
    toolsUsed: [],
    scratchpad: "",
    draftAnswer: null,
    done: false,
  };
}
