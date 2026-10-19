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
 * 2.9.0 ("A recovery cancelled from the phone"): the same backstop for a
 * recovery an owner app's unlock cancelled in the vault: unlock slots with
 * the host's `cancelled_recovery_id`, stalled notice rows, and vault rows
 * whose `recovery_cancelled` names a recovery still pending or registered
 * (sweepAppCancels, noticeAppCancel).
 *
 * Writes RecoveryAttemptsUnnoticed (EMF): the attempts it found unnoticed,
 * RecoveryAttemptNoticeFailures: those whose notice failed this run
 * (retried at the next), and RecoveryCancelsUnnoticed: the cancels from the
 * phone it found unnoticed. Runs under its own fixed-name role
 * (lib/vault/access.ts, consumer `vault-attempts`).
 */
import { sweepAppCancels, sweepAttempts } from '../member/vault';

export const NAMESPACE = 'VettID/MemberApi';

export function emf(found: number, failed: number, cancelsFound: number, now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{
        Namespace: NAMESPACE,
        Dimensions: [[]],
        Metrics: [
          { Name: 'RecoveryAttemptsUnnoticed', Unit: 'Count' },
          { Name: 'RecoveryAttemptNoticeFailures', Unit: 'Count' },
          { Name: 'RecoveryCancelsUnnoticed', Unit: 'Count' },
        ],
      }],
    },
    RecoveryAttemptsUnnoticed: found,
    RecoveryAttemptNoticeFailures: failed,
    RecoveryCancelsUnnoticed: cancelsFound,
  });
}

type Counts = { found: number; noticed: number; failed: number };

export const handler = async (): Promise<Counts & { cancels: Counts }> => {
  const r = await sweepAttempts();
  const cancels = await sweepAppCancels();
  console.log(emf(r.found, r.failed, cancels.found, Date.now()));
  return { ...r, cancels };
};
