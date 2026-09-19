#!/usr/bin/env node
import { Command } from "commander";

import { registerRunCommand } from "./commands/run.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";

const program = new Command("jev-gateway");
program.description(
  "jev-decision-gateway CLI: run the flagship example and the AI-agent benchmark."
);

registerRunCommand(program);
registerBenchmarkCommand(program);

// FIX (final-review Finding #5): `parseAsync` returns a promise, and an action handler that
// rejects (e.g. `runAiAgentBenchmark` throwing on a bad `--out` path) previously had nowhere to
// go -- a real, reachable unhandled-rejection crash, not a hypothetical one. This `.catch()` is
// the top-level backstop: print the error and exit non-zero instead of an unhandled rejection.
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
