import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AppConfig, resourceName } from '../config';

/**
 * Least-privilege DynamoDB grants by fixed table name (tables live in
 * VettidOrgDataStack; consumers never import them as constructs, so no
 * cross-stack exports). List the exact actions each function needs.
 */
export function tableGrant(
  scope: cdk.Stack,
  config: AppConfig,
  fn: lambda.IFunction,
  table: string,
  actions: string[],
  opts: { indexes?: boolean } = {},
): void {
  const arn = `arn:${scope.partition}:dynamodb:${scope.region}:${scope.account}:table/${resourceName(config, table)}`;
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: actions.map((a) => `dynamodb:${a}`),
      resources: opts.indexes ? [arn, `${arn}/index/*`] : [arn],
    }),
  );
}

/** Env vars naming every account/admin table (values are fixed names). */
export function tableEnv(config: AppConfig): Record<string, string> {
  const t = (n: string) => resourceName(config, n);
  return {
    TABLE_MEMBERS: t('members'),
    TABLE_INVITES: t('invites'),
    TABLE_TERMS: t('terms'),
    TABLE_SUBSCRIPTIONS: t('subscriptions'),
    TABLE_SUBSCRIPTION_TYPES: t('subscription-types'),
    TABLE_AUDIT: t('audit'),
    TABLE_RATELIMITS: t('ratelimits'),
    TABLE_MAGIC_LINKS: t('magic-links'),
    TABLE_VAULTS: t('vaults'),
    TABLE_VAULT_INSTANCES: t('vault-instances'),
    TABLE_VAULT_REQUESTS: t('vault-requests'),
    TABLE_VAULT_RELEASES: t('vault-releases'),
  };
}
