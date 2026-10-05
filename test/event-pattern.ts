/**
 * A small offline EventBridge pattern matcher for tests: enough of the
 * pattern language for the security-alert rules (literals, prefix, suffix,
 * wildcard, exists, numeric, anything-but with a list/prefix/suffix/wildcard,
 * nested $or). Arrays in the event match when any element does, as in
 * EventBridge. Not a full implementation: keep rule patterns to these
 * operators, or extend this alongside.
 */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const wildcardRe = (w: string) => new RegExp('^' + w.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

function leafMatches(matcher: any, value: Json | undefined): boolean {
  if (matcher === null || typeof matcher !== 'object') return value !== undefined && value === matcher;
  if ('exists' in matcher) return matcher.exists ? value !== undefined : value === undefined;
  if (value === undefined) return false; // every other operator needs the field
  if ('prefix' in matcher) return typeof value === 'string' && value.startsWith(matcher.prefix);
  if ('suffix' in matcher) return typeof value === 'string' && value.endsWith(matcher.suffix);
  if ('wildcard' in matcher) return typeof value === 'string' && wildcardRe(matcher.wildcard).test(value);
  if ('numeric' in matcher) {
    const ops: Array<[string, number]> = [];
    for (let i = 0; i < matcher.numeric.length; i += 2) ops.push([matcher.numeric[i], matcher.numeric[i + 1]]);
    if (typeof value !== 'number') return false;
    return ops.every(([op, n]) => ({ '>': value > n, '>=': value >= n, '<': value < n, '<=': value <= n, '=': value === n })[op] ?? false);
  }
  if ('anything-but' in matcher) {
    const ab = matcher['anything-but'];
    if (Array.isArray(ab)) return !ab.includes(value);
    if (ab !== null && typeof ab === 'object') return !leafMatches(ab, value);
    return value !== ab;
  }
  throw new Error(`event-pattern test matcher: unsupported operator ${JSON.stringify(matcher)}`);
}

function fieldMatches(pattern: any, value: Json | undefined): boolean {
  if (Array.isArray(pattern)) {
    if (Array.isArray(value)) return value.some((v) => pattern.some((m) => leafMatches(m, v)));
    return pattern.some((m) => leafMatches(m, value));
  }
  // nested object pattern
  if (Array.isArray(value)) return value.some((v) => fieldMatches(pattern, v));
  if (value === null || typeof value !== 'object') return objectMatches(pattern, {});
  return objectMatches(pattern, value);
}

function objectMatches(pattern: Record<string, any>, obj: Record<string, Json>): boolean {
  return Object.entries(pattern).every(([k, p]) => {
    if (k === '$or') return (p as any[]).some((alt) => objectMatches(alt, obj));
    return fieldMatches(p, obj[k]);
  });
}

/** Whether `event` (with `detail-type`, `source`, `account`, `detail`, ...) matches `pattern` (as in a template). */
export function matchesPattern(pattern: Record<string, any>, event: Record<string, Json>): boolean {
  return objectMatches(pattern, event);
}
