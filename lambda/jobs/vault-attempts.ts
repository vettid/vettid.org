/**
 * Every 5 minutes (MEMBER-API 2.7.0, release R; VAULT-MESSAGING §11.14.11):
 * the client-independent backstop for the per-attempt email. A counted
 * recovery attempt is otherwise noticed when the phone polls its open, at
 * a status read or at the next open; a phone that does none of these (it
 * can learn the outcome another way) must not keep the member from being
 * told. This run notices every open slot the enclave marked
 * `recovery_attempt` that has not been noticed, or whose notice stalled
 * (lambda/member/vault.ts sweepAttempts, noticeAttempt).
 *
 * Writes RecoveryAttemptsUnnoticed (EMF): the attempts it found unnoticed,
 * and RecoveryAttemptNoticeFailures: those whose notice failed this run
 * (retried at the next). Runs under its own fixed-name role
 * (lib/vault/access.ts, consumer `vault-attempts`).
 */
import { sweepAttempts } from '../member/vault';

export const NAMESPACE = 'VettID/MemberApi';

export function emf(found: number, failed: number, now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [[]], Metrics: [{ Name: 'RecoveryAttemptsUnnoticed', Unit: 'Count' }, { Name: 'RecoveryAttemptNoticeFailures', Unit: 'Count' }] }],
    },
    RecoveryAttemptsUnnoticed: found,
    RecoveryAttemptNoticeFailures: failed,
  });
}

export const handler = async (): Promise<{ found: number; noticed: number; failed: number }> => {
  const r = await sweepAttempts();
  console.log(emf(r.found, r.failed, Date.now()));
  return r;
};
