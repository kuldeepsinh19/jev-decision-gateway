import { describe, expect, it } from "vitest";

import { SDK_VERSION } from "./version.js";

describe("SDK_VERSION", () => {
  it("resolves the real installed @typesafe-ai/sdk version, not the 'unknown' failure fallback", () => {
    // A real `node_modules/@typesafe-ai/sdk/package.json` is present in this repo's own install,
    // so this should always resolve successfully here -- `"unknown"` would mean `resolveSdkVersion`
    // silently swallowed a real error.
    expect(SDK_VERSION).not.toBe("unknown");
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
