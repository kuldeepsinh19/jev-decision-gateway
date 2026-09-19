import type { Command } from "commander";
import { runAgentRuntimeOptimizer } from "@jev-decision-gateway/example-agent-runtime-optimizer";

import { parseNumberOption } from "../parseNumberOption.js";

/** The only value this MVP's `--example` flag accepts. */
export const VALID_EXAMPLES = ["agent-runtime-optimizer"] as const;

interface RunCommandOptions {
  example: string;
  task?: string;
  maxIterations?: number;
  provider?: string;
}

/**
 * `jev-gateway run --example agent-runtime-optimizer [--task <str>] [--max-iterations <n>] [--provider mock]`
 *
 * Pure wiring: parses flags, validates `--example` (the one thing this command does that isn't a
 * direct pass-through -- an unrecognized value must produce a clear, listed error rather than
 * being silently ignored), and calls straight through to `runAgentRuntimeOptimizer`. No agent
 * logic, decision logic, or formatting lives here -- that's all in
 * `@jev-decision-gateway/example-agent-runtime-optimizer`.
 */
export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run a jev-decision-gateway example")
    .requiredOption(
      "--example <name>",
      `which example to run (valid values: ${VALID_EXAMPLES.join(", ")})`
    )
    .option("--task <task>", "task string to pass to the example")
    .option(
      "--max-iterations <n>",
      "override the example's max iterations",
      parseNumberOption("--max-iterations")
    )
    .option("--provider <provider>", 'LLM provider to use (only "mock" is supported)', "mock")
    .action(async (options: RunCommandOptions) => {
      if (!(VALID_EXAMPLES as readonly string[]).includes(options.example)) {
        console.error(
          `Error: unrecognized --example "${options.example}". Valid values: ${VALID_EXAMPLES.join(", ")}.`
        );
        process.exitCode = 1;
        return;
      }

      const result = await runAgentRuntimeOptimizer({
        task: options.task,
        maxIterations: options.maxIterations,
        provider: options.provider === "mock" ? "mock" : undefined,
      });
      console.log(result.transcript);
    });
}
