import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
const cache = new Map<string, { value: string; at: number }>();
const TTL_MS = 5 * 60 * 1000;

/** Secret string by ARN/name, cached per container for 5 minutes. */
export async function secret(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: id }));
  if (!r.SecretString) throw new Error(`Secret ${id} has no string value`);
  cache.set(id, { value: r.SecretString, at: Date.now() });
  return r.SecretString;
}
