/**
 * Every 5 minutes: is the vault service paused (MEMBER-API "Vault service
 * pause")? Writes the metric VettID/MemberApi VaultServicePaused (1 or 0)
 * through the embedded metric format (a log line, no PutMetricData right),
 * which the "paused" alarms watch (RUNBOOK "Pausing the vault service"), so
 * a pause is not forgotten. Reads the switch without the cache; an
 * unreadable switch fails the run (Lambda errors), it is not guessed.
 */
import { readVaultService } from '../shared/vault-service';

export const NAMESPACE = 'VettID/MemberApi';
export const METRIC = 'VaultServicePaused';

export function emf(paused: boolean, now: number): string {
  return JSON.stringify({
    _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [[]], Metrics: [{ Name: METRIC, Unit: 'Count' }] }] },
    [METRIC]: paused ? 1 : 0,
  });
}

export const handler = async (): Promise<{ paused: boolean }> => {
  const s = await readVaultService();
  console.log(emf(!s.enabled, Date.now()));
  if (!s.enabled) console.warn('vault service paused', JSON.stringify({ set_by: s.set_by, set_at: s.set_at }));
  return { paused: !s.enabled };
};
