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
  | 'admin-net/egress-ip';

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
