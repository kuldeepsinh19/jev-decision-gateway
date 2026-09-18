/**
 * Deterministic, network-free "tools" for the demo agent loop. Each is a canned lookup keyed by a
 * normalized form of its input, with a generic fallback string when the input isn't in the table
 * -- the demo must never crash or hang on an unexpected input (Global Constraint 5's fail-open
 * spirit applies here too, not just to Jev/LLM calls).
 *
 * `finish` is deliberately NOT exported as a callable function here: per the brief, it is a
 * routing sentinel value that `loop.ts` handles directly (it means "stop calling tools and
 * generate the final answer"), not a tool with an input/output shape of its own.
 */

export const FINISH_SENTINEL = "finish" as const;

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

const SEARCH_TABLE: Record<string, string> = {
  "search documentation for typescript strict mode": "Docs: TypeScript strict mode enables strictNullChecks, noImplicitAny, and related flags for stronger type safety.",
  "modify a config value": "Docs: config values live in config/*.json; use the config-loader module to read and write them safely.",
  "run the test suite and report results": "Docs: the test suite is run via `npm test`; results are written to the CI log and a JUnit XML report.",
  "inspect recent logs for an error": "Docs: recent logs are under /var/log/app; grep for ERROR or FATAL to find failures.",
  "ask the user to clarify an ambiguous request": "Docs: when a request is ambiguous, the agent should ask a targeted clarifying question before acting.",
};

const CALCULATOR_TABLE: Record<string, string> = {
  "2 + 2": "4",
  "10 * 3": "30",
  "100 / 4": "25",
  "15 - 7": "8",
  "how many retries are configured": "2",
};

const FILE_READ_TABLE: Record<string, string> = {
  "package.json": '{ "name": "demo-project", "version": "1.0.0" }',
  "readme.md": "# Demo Project\nThis is a sample repository used for demonstration purposes.",
  "config/app.json": '{ "featureFlag": false, "retries": 3 }',
  ".env.example": "TYPESAFE_API_KEY=\nOPENAI_API_KEY=\n",
};

function lookup(table: Record<string, string>, input: string, toolName: string): string {
  const key = normalize(input);
  return (
    table[key] ??
    `[${toolName}] No canned result for "${input}" (generic demo fallback -- the real tool would look this up live).`
  );
}

export function search(input: string): string {
  return lookup(SEARCH_TABLE, input, "search");
}

export function calculator(input: string): string {
  return lookup(CALCULATOR_TABLE, input, "calculator");
}

export function fileRead(input: string): string {
  return lookup(FILE_READ_TABLE, input, "fileRead");
}

export type ToolName = "search" | "calculator" | "fileRead";

const TOOLS: Record<ToolName, (input: string) => string> = {
  search,
  calculator,
  fileRead,
};

/** Dispatches by tool name. Callers are expected to have already excluded the `finish` sentinel. */
export function callTool(name: ToolName, input: string): string {
  return TOOLS[name](input);
}
