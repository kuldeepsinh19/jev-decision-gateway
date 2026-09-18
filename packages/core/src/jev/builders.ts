import { choice, noul, score } from "@typesafe-ai/sdk";
import type { ChoiceCriteria, EntryType } from "@typesafe-ai/sdk";

import type { DecisionDef } from "../policy/rules.js";

// ---------------------------------------------------------------------------------------------
// `DecisionDef` shapes now live canonically in `policy/rules.ts` (Task 3). This module originally
// defined a local copy (byte-identical field names, per the Task 2 brief) with a note that Task 3
// would own the canonical version going forward; that move has happened, so this module now
// imports them and re-exports them unchanged, so existing imports of `ChoiceDecisionDef` /
// `ScoreDecisionDef` / `NoulDecisionDef` / `DecisionDef` from "./builders.js" (including this
// file's own tests) keep working without modification.
// ---------------------------------------------------------------------------------------------

export type {
  ChoiceDecisionDef,
  DecisionDef,
  NoulDecisionDef,
  ScoreDecisionDef,
} from "../policy/rules.js";

/**
 * Maps a `DecisionDef` to the real SDK's question-builder output (`ChoiceQuestion` /
 * `ScoreQuestion` / `NoulQuestion`). Returns `unknown` because the SDK's builders are generically
 * typed over the exact criteria passed in (`const T extends ChoiceCriteria`, etc.), and we build
 * these dynamically from a `DecisionDef` rather than as object literals the SDK could infer from.
 */
export function toSdkQuestion(def: DecisionDef): unknown {
  switch (def.kind) {
    case "choice": {
      // CONFIRMED (node_modules/@typesafe-ai/sdk dist/index.d.mts + README example
      // `choice("What is this ticket about?", { billing: null, technical: null, other: null })`):
      //   choice(instructions: EntryType, criteria: ChoiceCriteria) => ChoiceQuestion
      // This is a DIFFERENT argument shape than the plan's original assumption of
      // `choice(criteria, options)` (criteria-array-first) — the real signature takes
      // `instructions` first, then a `ChoiceCriteria` (`{ [label]: Description }`) second.
      // `def.options` (Record<label, description-string>) is structurally a valid `ChoiceCriteria`
      // since `Description = EntryType` and `string` is a valid `EntryType`.
      const instructions: EntryType = def.instructions ?? null;
      return choice(instructions, def.options as ChoiceCriteria);
    }
    case "score": {
      // ADAPTED: the plan assumed `score(...)` took a flat `string[]` of level labels by symmetry
      // with `choice`. The REAL, installed SDK's `score(instructions, criteria)` instead wants
      // `criteria: readonly [EntryType, EntryType, ...EntryType[]]` — an ORDERED RUBRIC of at
      // least two descriptions indexed by score position (0, 1, 2, ...), not a label array. This
      // also confirms the plan's hint that `ScoreResponse.legend` "might carry more": `legend` is
      // typed as `{ [score]: criteria[score] }`, i.e. whatever richer `EntryType` value (string,
      // object, or array) each rubric position was given, not a flat `string[]`.
      // `def.levels` (string[]) still works unchanged: each string is a valid EntryType. We cast
      // to the SDK's required tuple shape because a plain `string[]` isn't structurally a
      // fixed-length (>=2) tuple; the SDK itself validates the minimum length at call time
      // (confirmed JSDoc: "@throws {TypeSafeError} ... score criteria are not a list of at least
      // two entries") and `askJev()` catches that like any other failure.
      const instructions: EntryType = def.instructions ?? null;
      const criteria = def.levels as unknown as readonly [
        EntryType,
        EntryType,
        ...EntryType[],
      ];
      return score(instructions, criteria);
    }
    case "noul": {
      // CONFIRMED (dist/index.d.mts):
      //   noul(instructions?: EntryType, criteria?: { true?: EntryType; false?: EntryType } | null)
      // `NoulQuestion.criteria.true`/`.false` matches the plan's assumption exactly, so
      // `def.trueDescription`/`def.falseDescription` map straight across.
      const instructions: EntryType = def.instructions ?? null;
      return noul(instructions, {
        true: def.trueDescription ?? null,
        false: def.falseDescription ?? null,
      });
    }
    default: {
      const exhaustiveCheck: never = def;
      throw new Error(
        `toSdkQuestion: unrecognized DecisionDef kind: ${JSON.stringify(exhaustiveCheck)}`
      );
    }
  }
}
