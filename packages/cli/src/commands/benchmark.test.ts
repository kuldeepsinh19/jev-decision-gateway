import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const runAiAgentBenchmarkMock = vi.fn();

// Mocked at the imported-function boundary: proves `benchmark.ts` contains no duplicated
// reporting/aggregation logic -- Task 8's `runAiAgentBenchmark` already prints the console report
// and writes the JSON file itself, and this command must not do either of those a second time.
vi.mock("@jev-decision-gateway/benchmark-ai-agent", () => ({
  runAiAgentBenchmark: (...args: unknown[]) => runAiAgentBenchmarkMock(...args),
}));

import { registerBenchmarkCommand } from "./benchmark.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerBenchmarkCommand(program);
  return program;
}

beforeEach(() => {
  runAiAgentBenchmarkMock.mockReset();
  runAiAgentBenchmarkMock.mockResolvedValue({});
});

describe("registerBenchmarkCommand", () => {
  it("parses all flags and calls runAiAgentBenchmark with the correctly-parsed options object", async () => {
    const program = buildProgram();

    await program.parseAsync(
      ["benchmark", "--tasks", "5", "--out", "/tmp/report.json", "--provider", "mock"],
      { from: "user" }
    );

    expect(runAiAgentBenchmarkMock).toHaveBeenCalledTimes(1);
    expect(runAiAgentBenchmarkMock).toHaveBeenCalledWith({
      tasksLimit: 5,
      outPath: "/tmp/report.json",
      provider: "mock",
    });
  });

  it("passes undefined for omitted optional flags, and does not print/write anything itself", async () => {
    const program = buildProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["benchmark"], { from: "user" });

    expect(runAiAgentBenchmarkMock).toHaveBeenCalledWith({
      tasksLimit: undefined,
      outPath: undefined,
      provider: "mock",
    });
    // The command itself must not console.log a report -- runAiAgentBenchmark already does that
    // internally (Task 8); duplicating it here would be exactly the kind of business logic this
    // package must not contain.
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
