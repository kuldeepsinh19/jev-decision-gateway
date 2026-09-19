import { InvalidArgumentError } from "commander";

/**
 * Commander custom option-parser for a numeric flag (e.g. `--max-iterations <n>`, `--tasks <n>`).
 *
 * FIX (final-review Finding #5): `run.ts`/`benchmark.ts` used to parse these flags with a bare
 * `(value) => Number(value)`, so an invalid value (`--max-iterations abc`, or the flag given with
 * no argument at all) silently became `NaN` and flowed straight through to
 * `runAgentRuntimeOptimizer`/`runAiAgentBenchmark` -- a real, reachable bug (e.g. `for (let i = 1;
 * i <= NaN; i++)` never executes a single loop iteration, silently, with no error at all). This
 * parser instead rejects any non-finite result (`NaN`, `Infinity`, `-Infinity`) by throwing a
 * commander `InvalidArgumentError`, which commander turns into a clear, immediate
 * `error: option '<flag> <n>' argument '<value>' is invalid. ...` usage error instead.
 */
export function parseNumberOption(flag: string): (value: string) => number {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new InvalidArgumentError(`"${value}" is not a valid finite number for ${flag}.`);
    }
    return parsed;
  };
}
