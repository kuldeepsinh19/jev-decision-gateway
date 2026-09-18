/**
 * Thin standalone script: `npx tsx src/run.ts [--tasks N] [--out <path>]`.
 * Lets a developer run the benchmark directly, without going through `packages/cli`.
 */
import { runAiAgentBenchmark } from "./index.js";

function parseArgs(argv: string[]): { tasksLimit?: number; outPath?: string } {
  const result: { tasksLimit?: number; outPath?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tasks") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value)) result.tasksLimit = value;
    } else if (arg === "--out") {
      result.outPath = argv[++i];
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runAiAgentBenchmark(options);
}

main().catch((err) => {
  console.error("ai-agent-scenario benchmark failed:", err);
  process.exitCode = 1;
});
