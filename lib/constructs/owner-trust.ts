import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * The owner's IAM Identity Center permission set. Its role in an account
 * (`AWSReservedSSO_<name>_<hash>`) is the only principal that may assume
 * the owner-only roles: the vault's manifest-signer and retirement roles,
 * and staging's test-mail reader.
 */
export const OWNER_PERMISSION_SET = 'VettIDAdmin';

/**
 * Trust for an owner-only role in `account`: the account root, conditioned
 * on the caller being the owner's permission-set role.
 *
 * Identity Center enforces MFA at sign-in. aws:MultiFactorAuthPresent is
 * never present in an Identity Center (SAML-federated) session, so a Bool
 * condition on it would make these roles unassumable; the trust is pinned
 * to the owner's permission-set role instead.
 */
export function ownerTrust(account: string): iam.PrincipalBase {
  return new iam.AccountRootPrincipal().withConditions({
    ArnLike: { 'aws:PrincipalArn': `arn:aws:iam::${account}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_${OWNER_PERMISSION_SET}_*` },
  });
}
