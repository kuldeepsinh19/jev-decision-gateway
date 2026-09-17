import { describe, expect, it } from "vitest";

import { redactSecret } from "./errors.js";

describe("redactSecret", () => {
  it("replaces a single occurrence of a secret", () => {
    expect(redactSecret("key=sk-abc123 failed", ["sk-abc123"])).toBe(
      "key=[REDACTED] failed"
    );
  });

  it("replaces every occurrence of a secret", () => {
    expect(redactSecret("sk-abc123 ... sk-abc123", ["sk-abc123"])).toBe(
      "[REDACTED] ... [REDACTED]"
    );
  });

  it("redacts multiple distinct secrets", () => {
    expect(
      redactSecret("typesafe=tsk-1 openai=osk-2", ["tsk-1", "osk-2"])
    ).toBe("typesafe=[REDACTED] openai=[REDACTED]");
  });

  it("ignores undefined secrets", () => {
    expect(redactSecret("nothing secret here", [undefined, undefined])).toBe(
      "nothing secret here"
    );
  });

  it("ignores empty and whitespace-only secrets (never blanket-replaces)", () => {
    expect(redactSecret("hello world", ["", "   "])).toBe("hello world");
  });

  it("leaves input unchanged when no secret matches", () => {
    expect(redactSecret("nothing to redact", ["not-present"])).toBe(
      "nothing to redact"
    );
  });

  it("handles an empty input string", () => {
    expect(redactSecret("", ["sk-abc123"])).toBe("");
  });
});
