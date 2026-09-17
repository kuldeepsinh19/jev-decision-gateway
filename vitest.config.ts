import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "examples/**/*.test.ts",
      "benchmark/**/*.test.ts"
    ],
    environment: "node"
  }
});
