/**
 * Secret redaction used on every log message and every error message before it's surfaced
 * anywhere (including thrown errors and trace fields) — see Global Constraint 4: no secrets in
 * logs, traces, or error messages, ever.
 */

/**
 * Replaces any occurrence of any defined, non-empty secret in `input` with "[REDACTED]".
 * Secrets that are `undefined` or empty/whitespace-only are ignored (never matched, since an
 * empty-string replace would be a no-op anyway and could otherwise mask bugs silently).
 */
export function redactSecret(input: string, secrets: Array<string | undefined>): string {
  let result = input;
  for (const secret of secrets) {
    if (!secret) continue;
    if (secret.trim().length === 0) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}
