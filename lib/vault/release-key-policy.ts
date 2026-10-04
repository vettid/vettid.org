/**
 * The release sealing key's policy (docs/VAULT-RELEASES.md §6.2): the
 * normative example of VAULT-MESSAGING 0.10.0 §11.10.7, rendered for one
 * release. No administrator statement: nobody, the account root included,
 * can change the policy, add grants or disable the key. Only the pinned
 * retirement role can end the key, by scheduling its deletion with exactly
 * the channel's window.
 *
 * Rendered at synth time from plain strings (no CDK tokens), so the exact
 * JSON is in the template, reviewable in a diff, and testable against the
 * enclave's rules (lambda/shared/keypolicy.ts).
 */

export interface ReleaseKeyPolicyInput {
  /** The pinned vault account. */
  readonly account: string;
  readonly release: number;
  /** The release's PCR0 (96 lowercase hex). */
  readonly pcr0: string;
  /**
   * PCR0s of the releases admitted to seal for this one: every release not
   * `removed` when this key is created (they may all move into it). Never
   * the release's own PCR0.
   */
  readonly admittedPcr0s: readonly string[];
  readonly hostRoleArn: string;
  readonly retirementRoleArn: string;
  /** 30 (production) or 7 (staging). */
  readonly retirementWindowDays: number;
}

const PCR0 = /^[0-9a-f]{96}$/;

export function validateReleaseKeyPolicyInput(p: ReleaseKeyPolicyInput): void {
  if (!/^[0-9]{12}$/.test(p.account)) throw new Error(`release key: bad account "${p.account}"`);
  if (!Number.isSafeInteger(p.release) || p.release < 1) throw new Error(`release key: bad release number ${p.release}`);
  if (!PCR0.test(p.pcr0)) throw new Error(`release ${p.release}: pcr0 must be 96 lowercase hex`);
  for (const a of p.admittedPcr0s) {
    if (!PCR0.test(a)) throw new Error(`release ${p.release}: admitted PCR0 must be 96 lowercase hex`);
  }
  if (new Set([p.pcr0, ...p.admittedPcr0s]).size !== p.admittedPcr0s.length + 1) {
    throw new Error(`release ${p.release}: admitted PCR0s must be distinct and must not repeat the release's own`);
  }
  if (p.retirementWindowDays !== 30 && p.retirementWindowDays !== 7) {
    throw new Error(`release ${p.release}: retirement window must be 30 (prod) or 7 (staging) days`);
  }
  for (const arn of [p.hostRoleArn, p.retirementRoleArn]) {
    if (!arn.startsWith(`arn:aws:iam::${p.account}:role/`)) throw new Error(`release ${p.release}: ${arn} is not a role in ${p.account}`);
  }
  if (p.hostRoleArn === p.retirementRoleArn) throw new Error('release key: host and retirement roles must differ');
}

export function renderReleaseKeyPolicy(p: ReleaseKeyPolicyInput): Record<string, unknown> {
  validateReleaseKeyPolicyInput(p);
  const callerAccount = { StringEquals: { 'kms:CallerAccount': p.account } };
  const sealPcr0s = [...p.admittedPcr0s, p.pcr0];
  return {
    Version: '2012-10-17',
    Id: `vettid-release-${p.release}`,
    Statement: [
      {
        Sid: `UnsealOnlyInRelease${p.release}`,
        Effect: 'Allow',
        Principal: { AWS: p.hostRoleArn },
        Action: 'kms:Decrypt',
        Resource: '*',
        Condition: { StringEqualsIgnoreCase: { 'kms:RecipientAttestation:ImageSha384': p.pcr0 }, ...callerAccount },
      },
      {
        Sid: 'SealFromAdmittedReleases',
        Effect: 'Allow',
        Principal: { AWS: p.hostRoleArn },
        Action: 'kms:GenerateDataKey',
        Resource: '*',
        Condition: {
          StringEqualsIgnoreCase: { 'kms:RecipientAttestation:ImageSha384': sealPcr0s.length === 1 ? sealPcr0s[0] : sealPcr0s },
          ...callerAccount,
        },
      },
      {
        Sid: 'EnclaveVerifiesThisPolicy',
        Effect: 'Allow',
        Principal: { AWS: [p.hostRoleArn, p.retirementRoleArn] },
        Action: ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:ListGrants'],
        Resource: '*',
      },
      {
        Sid: 'RetireAfterNotice',
        Effect: 'Allow',
        Principal: { AWS: p.retirementRoleArn },
        Action: 'kms:ScheduleKeyDeletion',
        Resource: '*',
        Condition: {
          NumericEquals: { 'kms:ScheduleKeyDeletionPendingWindowInDays': String(p.retirementWindowDays) },
          ...callerAccount,
        },
      },
      {
        Sid: 'RescueBeforeDeletion',
        Effect: 'Allow',
        Principal: { AWS: p.retirementRoleArn },
        Action: ['kms:CancelKeyDeletion', 'kms:EnableKey'],
        Resource: '*',
        Condition: callerAccount,
      },
    ],
  };
}
