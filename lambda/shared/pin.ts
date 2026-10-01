import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './aws';
import { hit, lockout } from './ratelimit';
import { secret } from './secrets';

/**
 * Member PINs (optional second sign-in step). Stored as
 * HMAC-SHA-256(pepper, "<user_guid>:<pin>") — the pepper lives only in
 * Secrets Manager, so a table dump can't be brute-forced offline (4–8
 * digits would fall instantly to a plain hash, as vettid-dev's did).
 */

export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_SECONDS = 15 * 60;
const lockKey = (guid: string) => `pinfail#${guid}`;

const COMMON = new Set(['1234', '12345', '123456', '1234567', '12345678', '0000', '1111', '1212', '6969', '2580', '0852', '4321', '7777', '2000', '2020', '1004', '6666', '9999', '5555', '1122', '112233', '121212', '696969', '654321']);

/** Returns a reason the PIN is unacceptable, or null if it's fine. */
export function pinProblem(pin: unknown): string | null {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return 'PIN must be 4–8 digits';
  if (/^(\d)\1+$/.test(pin)) return 'PIN cannot be one repeated digit';
  const digits = [...pin].map(Number);
  const asc = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const desc = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  if (asc || desc) return 'PIN cannot be a straight sequence';
  if (COMMON.has(pin)) return 'That PIN is too common';
  return null;
}

export async function hashPin(guid: string, pin: string): Promise<string> {
  const pepper = await secret(env('PIN_PEPPER_SECRET_ARN'));
  return createHmac('sha256', pepper).update(`${guid}:${pin}`).digest('hex');
}

export const PIN_DAILY_MAX_FAILURES = 15;
export const PIN_LONG_LOCK_SECONDS = 24 * 3600;
const dailyKey = (guid: string) => `pinfailday#${guid}`;

export type PinCheck =
  | { ok: true }
  | { ok: false; locked: boolean; attemptsLeft: number; justLocked: boolean };

/**
 * Constant-time check with a lockout that holds under concurrency: an attempt
 * is reserved atomically before the comparison (5 per 15 minutes), and 15
 * failures in a day escalate to a 24-hour lock. `justLocked` is true on the
 * attempt that triggered a lock, so callers can notify the member.
 */
export async function checkPin(guid: string, storedHash: string, pin: string): Promise<PinCheck> {
  const n = await lockout.reserve(lockKey(guid), PIN_MAX_FAILURES, PIN_LOCK_SECONDS);
  if (n === null) return { ok: false, locked: true, attemptsLeft: 0, justLocked: false };
  const given = Buffer.from(await hashPin(guid, String(pin)), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (given.length === stored.length && timingSafeEqual(given, stored)) {
    await lockout.clear(lockKey(guid));
    return { ok: true };
  }
  const daily = await hit(dailyKey(guid), PIN_DAILY_MAX_FAILURES, 86400);
  if (!daily.allowed) {
    await lockout.lockUntil(lockKey(guid), PIN_MAX_FAILURES, Math.floor(Date.now() / 1000) + PIN_LONG_LOCK_SECONDS);
    return { ok: false, locked: true, attemptsLeft: 0, justLocked: daily.count === PIN_DAILY_MAX_FAILURES + 1 };
  }
  const locked = n >= PIN_MAX_FAILURES;
  return { ok: false, locked, attemptsLeft: Math.max(0, PIN_MAX_FAILURES - n), justLocked: locked };
}

export async function pinLockState(guid: string): Promise<{ locked: boolean; attemptsLeft: number }> {
  const n = await lockout.failures(lockKey(guid));
  return { locked: n >= PIN_MAX_FAILURES, attemptsLeft: Math.max(0, PIN_MAX_FAILURES - n) };
}
