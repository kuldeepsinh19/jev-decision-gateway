#!/usr/bin/env node
import { Command } from "commander";

import { registerRunCommand } from "./commands/run.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";

const program = new Command("jev-gateway");
program.description("jev-decision-gateway CLI: run the flagship example and the AI-agent benchmark.");

registerRunCommand(program);
registerBenchmarkCommand(program);

program.parseAsync(process.argv);
