import { randomBytes, randomUUID } from 'node:crypto';

export const newGuid = (): string => randomUUID();

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Human-friendly registration code (formerly "invite code"), e.g. 7K3QX-M9TZA (50 bits, no I/L/O/U). */
export function inviteCode(): string {
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += CROCKFORD[b & 31];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export const nowIso = (): string => new Date().toISOString();

/** Sortable unique id: ISO timestamp + random suffix. */
export const tsId = (iso = nowIso()): string => `${iso}#${randomBytes(6).toString('hex')}`;
