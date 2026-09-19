import { createRequire } from "node:module";

/**
 * Resolves the installed `@typesafe-ai/sdk` version from its own `package.json`, once, at module
 * load time. This file lives inside `jev/` specifically so `@typesafe-ai/sdk` stays imported
 * (even just for its `package.json`) only inside this boundary directory (Global Constraint 1;
 * see `docs/architecture.md`'s "only `packages/core/src/jev/` ever imports `@typesafe-ai/sdk`"
 * rule) -- callers elsewhere (e.g. `benchmark/ai-agent-scenario/src/report.ts`) import the
 * resulting `SDK_VERSION` string from `@jev-decision-gateway/core`'s public API instead of ever
 * reaching for the SDK package directly themselves.
 */
function resolveSdkVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@typesafe-ai/sdk/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** The installed `@typesafe-ai/sdk` version, e.g. `"0.6.0"`, or `"unknown"` if unresolvable. */
export const SDK_VERSION: string = resolveSdkVersion();
