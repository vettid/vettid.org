/**
 * The vault service pause: the operator's off switch for the member API's
 * vault routes (docs/MEMBER-API.md "Vault service pause", ADMIN-API
 * "Vault service", RUNBOOK "Pausing the vault service").
 *
 * State: one SSM String parameter per stage in the member API's account,
 * named by env VAULT_SERVICE_PARAM (/vettid-org/<stage>/switch/vault-service),
 * value JSON { enabled, reason, set_by, set_at }. No deploy creates it:
 *  - no parameter: on (the normal case);
 *  - JSON with a boolean `enabled`: that;
 *  - anything else: paused (someone wrote it there on purpose).
 *
 * Readers cache it per Lambda instance for CACHE_TTL_MS. A failed read keeps
 * the last value read; with none it answers "on" (logged): an SSM outage
 * must not take the vaults down.
 */
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { env } from './aws';

const ssm = new SSMClient({});

export const CACHE_TTL_MS = 30_000;
export const REASON_MAX = 500;

export interface VaultServiceState {
  enabled: boolean;
  /** Operators only; never shown to members. */
  reason: string | null;
  set_by: string | null;
  set_at: string | null;
}

export const SERVICE_ON: VaultServiceState = Object.freeze({ enabled: true, reason: null, set_by: null, set_at: null });

const str = (v: unknown, max = REASON_MAX): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);

/** The state a parameter value stands for (see the module comment). */
export function parseState(value: string | undefined): VaultServiceState {
  if (value === undefined) return SERVICE_ON;
  let o: unknown;
  try {
    o = JSON.parse(value);
  } catch {
    o = null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof (o as { enabled?: unknown }).enabled !== 'boolean') {
    return { enabled: false, reason: 'unreadable switch value (treated as paused)', set_by: null, set_at: null };
  }
  const r = o as Record<string, unknown>;
  return { enabled: r.enabled as boolean, reason: str(r.reason), set_by: str(r.set_by, 320), set_at: str(r.set_at, 40) };
}

/** Read the parameter now (no cache). Throws on any error but "not found". */
export async function readVaultService(): Promise<VaultServiceState> {
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: env('VAULT_SERVICE_PARAM') }));
    return parseState(r.Parameter?.Value);
  } catch (e) {
    if ((e as Error).name === 'ParameterNotFound') return SERVICE_ON;
    throw e;
  }
}

/** Write the switch (admin API). The value always carries a boolean `enabled`. */
export async function writeVaultService(s: VaultServiceState): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: env('VAULT_SERVICE_PARAM'),
      Type: 'String',
      Overwrite: true,
      Value: JSON.stringify({ enabled: s.enabled, reason: s.reason, set_by: s.set_by, set_at: s.set_at }),
      Description: 'vettid.org vault service pause (MEMBER-API "Vault service pause"); absent or enabled:true = on',
    }),
  );
}

let cached: { state: VaultServiceState; at: number } | null = null;

/** The switch, cached for CACHE_TTL_MS (member API and jobs). */
export async function vaultService(now = Date.now()): Promise<VaultServiceState> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;
  try {
    cached = { state: await readVaultService(), at: now };
  } catch (e) {
    console.error('vault service switch unreadable', JSON.stringify({ error: (e as Error).name, cached: cached ? cached.state.enabled : null }));
    // Keep the last value (none: on); try again after another TTL.
    cached = { state: cached?.state ?? SERVICE_ON, at: now };
  }
  return cached.state;
}

/** Tests only. */
export function resetVaultServiceCache(): void {
  cached = null;
}
