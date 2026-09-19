import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolved from this config file's own location (not `process.cwd()`) so that
// `npm test --workspace <pkg>` — which runs with cwd set to that package's directory — still
// finds tests via the repo-root-relative include globs below, the same as running `npm test`
// (bare `vitest run`) from the repo root.
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: repoRoot,
  test: {
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts", "benchmark/**/*.test.ts"],
    environment: "node",
  },
});
