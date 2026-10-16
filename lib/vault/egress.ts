import { AppConfig, VaultConfig, resourceName, vaultRecoveryBucketName } from '../config';

/**
 * The enclave hosts' DNS allowlist (VAULT-RELEASES §8.4 control 3): Route 53
 * Resolver DNS Firewall on the host VPC answers these names and NXDOMAIN for
 * everything else, which also bounds a compromised parent (and DNS
 * tunnelling). Snapshot-tested: a change here is a security review item.
 *
 *  - The enclave's own egress (the parent's forwarder allowlist,
 *    parent.DefaultAllow): the relay, the pinned KMS endpoint, Google's
 *    attestation status list, the push gateway of the vault's channel
 *    (VAULT-MESSAGING §14.3; PUSH-GATEWAY §10.1), and (release R) the
 *    recovery counter bucket's virtual-hosted name, which the enclave
 *    reaches over its own TLS (VAULT-HOST-PROTOCOL §8.1; VAULT-RELEASES
 *    §8.4). Its traffic, like all S3 traffic, goes through the gateway
 *    endpoint, whose policy admits this account's buckets.
 *  - What the parent uses (AWS SDK, the vault's own account): SQS, DynamoDB
 *    (including the SDK's account-based endpoint), S3 (path and the data
 *    bucket's virtual host; the gateway endpoint carries the traffic), SSM
 *    parameters at boot.
 *  - The agents: the SSM agent, for Run Command (ssm, ssmmessages,
 *    ec2messages; interactive sessions are denied by the Vault OU policy), the
 *    CloudWatch agent (logs, monitoring), the lifecycle hook completion
 *    (autoscaling).
 *  - The VPC's own names (`*.ec2.internal`): resolved inside the VPC only.
 *
 * Not listed on purpose: package repositories, GitHub, STS, EC2 APIs, other
 * regions, any other S3 bucket. The AMI is built in a separate build VPC
 * without this firewall (lib/stacks/vault-host-stack.ts).
 */
export function vaultHostDnsAllowlist(config: AppConfig, vault: VaultConfig): string[] {
  const r = config.region;
  const aws = (svc: string) => `${svc}.${r}.amazonaws.com`;
  return [
    // enclave egress (through the parent's forwarder)
    vault.relayHost,
    aws('kms'),
    'android.googleapis.com',
    vault.pushHost,
    `${vaultRecoveryBucketName(vault.account)}.s3.${r}.amazonaws.com`,
    // parent
    aws('sqs'),
    aws('dynamodb'),
    `${vault.account}.ddb.${r}.amazonaws.com`,
    aws('s3'),
    `${resourceName(config, 'vault-data')}-${vault.account}.s3.${r}.amazonaws.com`,
    aws('ssm'),
    // agents
    aws('ssmmessages'),
    aws('ec2messages'),
    aws('logs'),
    aws('monitoring'),
    aws('autoscaling'),
    // the VPC's own host names
    '*.ec2.internal',
  ];
}
