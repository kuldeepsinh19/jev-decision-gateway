/**
 * Deterministic, network-free "tools" for the demo agent loop. Each is a canned lookup keyed by a
 * short, canonical phrase, with a generic fallback string when nothing matches -- the demo must
 * never crash or hang on an unexpected input (Global Constraint 5's fail-open spirit applies here
 * too, not just to Jev/LLM calls).
 *
 * FIX (final-review Finding #4): `loop.ts` drives every tool call with the *whole* task prompt
 * (`toolInputFor(state)` returns `state.task` verbatim -- see that file's doc comment), not a
 * short phrase matching one of these tables' keys exactly. An earlier version of `lookup()` only
 * ever did an exact, normalized string match, so a real task prompt like "Search the documentation
 * to explain what TypeScript's strict mode enables." never equaled the canned key `"search
 * documentation for typescript strict mode"` -- every real call fell through to the generic
 * fallback (verified: 0/39 canned hits across the flagship example's default task and the 12
 * `benchmark/ai-agent-scenario` tasks). `lookup()` now also tries a keyword-overlap match: it
 * tokenizes both the input and each table key into their significant (stopword-stripped, lightly
 * stemmed) words and picks the key whose words are *mostly* (>= `MATCH_THRESHOLD`) present in the
 * input, so a full-sentence task prompt that clearly restates a canned key's topic still resolves
 * to that key's real canned response. An exact match (post-normalization) is still tried first and
 * always wins outright. Deliberately conservative: a weak, coincidental overlap (e.g. one shared
 * generic word) still falls through to the honest fallback string rather than returning a
 * confidently-wrong canned answer -- see `bestKeyMatch()` below.
 */

export const FINISH_SENTINEL = "finish" as const;

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Words too common to carry any topical signal for matching purposes. */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "of",
  "to",
  "for",
  "and",
  "or",
  "in",
  "on",
  "at",
  "with",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "do",
  "does",
  "did",
  "you",
  "your",
  "we",
  "i",
  "then",
  "if",
  "so",
  "up",
  "now",
]);

/**
 * A deliberately tiny, English-specific stemmer -- just enough to fold common
 * singular/plural (`log`/`logs`, `error`/`errors`) and verb-form (`clarify`/`clarifying`)
 * variants together for matching purposes. Not linguistically complete, and not meant to be:
 * false *negatives* here (missing a real match) just mean a fallback string instead of a canned
 * one, which is always safe; false *positives* are the risk to avoid, so this only strips a small,
 * well-understood set of suffixes.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Splits free-form text into its significant (non-stopword), stemmed words. */
function significantWords(input: string): string[] {
  return normalize(input)
    .replace(/'s\b/g, "") // "typescript's" -> "typescript" (possessive, not a plural)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * A canned key counts as matched only when at least this fraction of its own significant words
 * are also present in the input. High enough that a single generic shared word (e.g. "config")
 * can never alone match a 3+ word key, but low enough that real paraphrased task prompts (which
 * restate a key's topic, not quote it verbatim) still resolve to it.
 */
const MATCH_THRESHOLD = 0.6;

/**
 * Finds the table key that best overlaps with `input`'s significant words, or `null` if nothing
 * clears `MATCH_THRESHOLD`. Ties prefer the key with more significant words (a more specific,
 * longer key winning over a shorter, more generic one that happens to score the same).
 */
function bestKeyMatch(table: Record<string, string>, input: string): string | null {
  const inputWords = new Set(significantWords(input));
  if (inputWords.size === 0) return null;

  let bestKey: string | null = null;
  let bestScore = 0;
  let bestKeyWordCount = 0;

  for (const key of Object.keys(table)) {
    const keyWords = significantWords(key);
    if (keyWords.length === 0) continue;
    const overlap = keyWords.filter((w) => inputWords.has(w)).length;
    const score = overlap / keyWords.length;
    if (score > bestScore || (score === bestScore && keyWords.length > bestKeyWordCount)) {
      bestScore = score;
      bestKey = key;
      bestKeyWordCount = keyWords.length;
    }
  }

  return bestScore >= MATCH_THRESHOLD ? bestKey : null;
}

const SEARCH_TABLE: Record<string, string> = {
  "search documentation for typescript strict mode":
    "Docs: TypeScript strict mode enables strictNullChecks, noImplicitAny, and related flags for stronger type safety.",
  "modify a config value":
    "Docs: config values live in config/*.json; use the config-loader module to read and write them safely.",
  "run the test suite and report results":
    "Docs: the test suite is run via `npm test`; results are written to the CI log and a JUnit XML report.",
  "inspect recent logs for an error":
    "Docs: recent logs are under /var/log/app; grep for ERROR or FATAL to find failures.",
  "ask the user to clarify an ambiguous request":
    "Docs: when a request is ambiguous, the agent should ask a targeted clarifying question before acting.",
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
  const exactKey = normalize(input);
  const key = exactKey in table ? exactKey : bestKeyMatch(table, input);
  return (
    (key !== null ? table[key] : undefined) ??
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
