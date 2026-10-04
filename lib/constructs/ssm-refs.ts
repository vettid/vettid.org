import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AppConfig } from '../config';

/**
 * Cross-stack references through SSM Parameter Store instead of CloudFormation
 * exports.
 *
 * Stateful stacks (pools, tables) publish IDs here; stateless stacks (APIs,
 * sites) read them at deploy time. Unlike Fn::ImportValue this never locks the
 * producer: a stateful stack can change an output without first redeploying
 * every consumer, which is what wedged the old vettid-dev stacks.
 *
 * Keys are a closed set so a typo is a compile error, not a deploy-time miss.
 */
export type SsmRefKey =
  | 'auth/member-pool-id'
  | 'auth/member-pool-arn'
  | 'auth/member-client-id'
  | 'auth/admin-pool-id'
  | 'auth/admin-pool-arn'
  | 'auth/admin-client-id'
  | 'auth/admin-login-domain'
  | 'auth/pin-pepper-secret-arn'
  | 'data/terms-bucket-name'
  | 'data/members-stream-arn'
  | 'relay/table-name'
  | 'relay/table-arn'
  | 'relay/blob-bucket-name'
  | 'member-api/domain'
  // A non-prod stage's own zone (VettidOrgStageDnsStack); prod's site
  // stacks look vettid.org up instead (cached in cdk.context.json).
  | 'dns/zone-id'
  | 'admin-access/egress-ip'
  | 'admin-access/site-web-acl-arn'
  // Vault account (VettidOrgVaultStack); read by the host stack and the
  // enclave host's boot script (VAULT-RELEASES §8.3), all in that account.
  | 'vault/data-bucket-name'
  | 'vault/host-role-arn'
  | 'vault/host-instance-profile-name'
  | 'vault/retirement-role-arn'
  | 'vault/manifest-signer-role-arn'
  | 'vault/manifest-key-arn'
  | 'vault/vaults-table-name'
  | 'vault/vault-instances-table-name'
  | 'vault/vault-requests-table-name'
  | 'vault/vault-releases-table-name'
  | 'vault/vault-releases-stream-arn'
  | 'vault/control-queue-prefix'
  | 'vault/control-queue-policy'
  | 'vault/dlq-name'
  | `vault/releases/${number}/seal-key-arn`
  // Vault host stack (VettidOrgVaultHostStack); read by the release stacks
  // and the enclave hosts' boot (vettid-vault deploy/host).
  | 'vault/dlq-arn'
  | 'vault/relay-host'
  | 'vault/host-log-group'
  | 'vault/host-security-group-id'
  | 'vault/host-subnet-ids'
  | 'vault/image-builder-infra-arn'
  | 'vault/alerts-topic-arn'
  | 'vault/smoke-key-arn'
  // Per release stack: its group exists (the manifest sync's `available`).
  | `vault/releases/${number}/group-name`;

export function ssmParamName(config: AppConfig, key: SsmRefKey): string {
  return `/vettid-org/${config.stage}/${key}`;
}

/** Publish a value for other stacks to read. */
export function publishRef(scope: Construct, config: AppConfig, key: SsmRefKey, value: string): ssm.StringParameter {
  return new ssm.StringParameter(scope, `Ref-${key.replace(/[^A-Za-z0-9]/g, '-')}`, {
    parameterName: ssmParamName(config, key),
    stringValue: value,
    description: `vettid.org cross-stack ref (${key}); consumers read at deploy time`,
  });
}

/**
 * Read a value published by another stack. Resolved by CloudFormation at
 * deploy time (an SSM parameter type), so the producer must be deployed first.
 */
export function readRef(scope: Construct, config: AppConfig, key: SsmRefKey): string {
  return ssm.StringParameter.valueForStringParameter(scope, ssmParamName(config, key));
}
