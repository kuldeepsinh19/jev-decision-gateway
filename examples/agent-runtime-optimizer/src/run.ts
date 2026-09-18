/**
 * Thin standalone script: `npx tsx src/run.ts [--task "..."] [--max-iterations N]`.
 * Lets a developer run the flagship example directly, without going through `packages/cli`.
 */
import { runAgentRuntimeOptimizer } from "./index.js";

function parseArgs(argv: string[]): { task?: string; maxIterations?: number } {
  const result: { task?: string; maxIterations?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--task") {
      result.task = argv[++i];
    } else if (arg === "--max-iterations") {
      const value = Number(argv[++i]);
      if (Number.isFinite(value)) result.maxIterations = value;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { transcript } = await runAgentRuntimeOptimizer(options);
  console.log(transcript);
}

main().catch((err) => {
  console.error("agent-runtime-optimizer failed:", err);
  process.exitCode = 1;
});
