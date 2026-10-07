/**
 * The account's name rule (MEMBER-API 2.2.1), shared by registration
 * (`/api/public/request`) and the name-change job (lambda/jobs/vault-names.ts),
 * as the vault applies it to `account.name.set` (VAULT-MESSAGING §10.8):
 * trimmed of leading and trailing U+0020 spaces only (no other white space
 * is trimmed, and the pattern admits none), then a letter or mark first,
 * letters, marks, spaces and '’.- after it, at most 40 UTF-16 code units.
 */
export const NAME_MAX = 40;
export const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u;

/** Leading and trailing U+0020 removed, nothing else. */
export const trimSpaces = (s: string): string => s.replace(/^ +| +$/g, '');

/** The normalized name, or null when it fails the rule. */
export function normalizeName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = trimSpaces(v);
  return s.length <= NAME_MAX && NAME_RE.test(s) ? s : null;
}
