import type { Command } from "commander";
import { runAiAgentBenchmark } from "@jev-decision-gateway/benchmark-ai-agent";

interface BenchmarkCommandOptions {
  tasks?: number;
  out?: string;
  provider?: string;
}

/**
 * `jev-gateway benchmark [--tasks <n>] [--out <path>] [--provider mock]`
 *
 * Pure wiring: parses flags and calls straight through to `runAiAgentBenchmark`, which already
 * prints the console report and writes the JSON report itself (Task 8) -- this command does not
 * duplicate that logic, it only translates CLI flags into that function's options object.
 */
export function registerBenchmarkCommand(program: Command): void {
  program
    .command("benchmark")
    .description("Run the jev-decision-gateway AI-agent benchmark")
    .option("--tasks <n>", "limit the number of benchmark tasks to run", (value) => Number(value))
    .option("--out <path>", "path to write the JSON report to")
    .option("--provider <provider>", 'LLM provider to use (only "mock" is supported)', "mock")
    .action(async (options: BenchmarkCommandOptions) => {
      await runAiAgentBenchmark({
        tasksLimit: options.tasks,
        outPath: options.out,
        provider: options.provider === "mock" ? "mock" : undefined,
      });
    });
}
