import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const runAgentRuntimeOptimizerMock = vi.fn();

// Mocked at the imported-function boundary: this is the direct proof there's no duplicated
// business logic between the CLI and the example package (per the plan's design) -- if `run.ts`
// ever grew its own agent/decision logic instead of calling straight through, these assertions on
// the exact options object passed to the mock would catch it.
vi.mock("@jev-decision-gateway/example-agent-runtime-optimizer", () => ({
  runAgentRuntimeOptimizer: (...args: unknown[]) => runAgentRuntimeOptimizerMock(...args),
}));

import { registerRunCommand } from "./run.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit() during tests
  registerRunCommand(program);
  return program;
}

beforeEach(() => {
  runAgentRuntimeOptimizerMock.mockReset();
  runAgentRuntimeOptimizerMock.mockResolvedValue({
    transcript: "mock transcript",
    summary: {},
  });
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("registerRunCommand", () => {
  it("parses all flags and calls runAgentRuntimeOptimizer with the correctly-parsed options object", async () => {
    const program = buildProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(
      [
        "run",
        "--example",
        "agent-runtime-optimizer",
        "--task",
        "do the thing",
        "--max-iterations",
        "4",
        "--provider",
        "mock",
      ],
      { from: "user" }
    );

    expect(runAgentRuntimeOptimizerMock).toHaveBeenCalledTimes(1);
    expect(runAgentRuntimeOptimizerMock).toHaveBeenCalledWith({
      task: "do the thing",
      maxIterations: 4,
      provider: "mock",
    });
    expect(logSpy).toHaveBeenCalledWith("mock transcript");
    logSpy.mockRestore();
  });

  it("passes undefined for omitted optional flags rather than inventing defaults itself", async () => {
    const program = buildProgram();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["run", "--example", "agent-runtime-optimizer"], { from: "user" });

    expect(runAgentRuntimeOptimizerMock).toHaveBeenCalledWith({
      task: undefined,
      maxIterations: undefined,
      provider: "mock",
    });
  });

  it("rejects an unrecognized --example value with a clear, listed error, and never calls the example", async () => {
    const program = buildProgram();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await program.parseAsync(["run", "--example", "not-a-real-example"], { from: "user" });

    expect(runAgentRuntimeOptimizerMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain("not-a-real-example");
    expect(message).toContain("agent-runtime-optimizer");
    errorSpy.mockRestore();
  });

  it("requires --example to be present at all", async () => {
    const program = buildProgram();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(program.parseAsync(["run"], { from: "user" })).rejects.toThrow();
    expect(runAgentRuntimeOptimizerMock).not.toHaveBeenCalled();
  });

  // REGRESSION GUARD (final-review Finding #5): --max-iterations used to be parsed with a bare
  // `Number(value)`, so a non-numeric value silently became `NaN` and would have been passed
  // straight through to runAgentRuntimeOptimizer instead of being rejected up front.
  it("rejects a non-numeric --max-iterations value with a clear error instead of silently passing NaN through", async () => {
    const program = buildProgram();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      program.parseAsync(
        ["run", "--example", "agent-runtime-optimizer", "--max-iterations", "not-a-number"],
        { from: "user" }
      )
    ).rejects.toThrow();

    expect(runAgentRuntimeOptimizerMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("rejects a non-finite --max-iterations value (Infinity) too, not just non-numeric text", async () => {
    const program = buildProgram();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      program.parseAsync(
        ["run", "--example", "agent-runtime-optimizer", "--max-iterations", "Infinity"],
        { from: "user" }
      )
    ).rejects.toThrow();

    expect(runAgentRuntimeOptimizerMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
