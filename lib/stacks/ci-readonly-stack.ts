import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';

/** GitHub Actions' OIDC issuer (no thumbprint: IAM trusts its CA directly). */
export const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/** The repository and branch whose workflows may assume the role. */
export const CI_REPO = 'vettid/vettid.org';
export const CI_BRANCH = 'master';

/** Role name, the same in every account (`.github/workflows/drift.yml` names it). */
export function ciDriftRoleName(config: AppConfig): string {
  return resourceName(config, 'ci-drift-readonly');
}

export interface VettidOrgCiReadOnlyStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Read-only access for the scheduled production drift check
 * (`.github/workflows/drift.yml`, RUNBOOK "Production drift"), one per
 * production account (management and vault-prod):
 *
 *  - the account's GitHub Actions OIDC provider (none existed; IAM allows
 *    one per URL per account, so a second user of it must import this one);
 *  - a role that only workflows of vettid/vettid.org running on master can
 *    assume (OIDC `sub` = `repo:vettid/vettid.org:ref:refs/heads/master`,
 *    which the scheduled and the manually dispatched runs carry; pull
 *    requests and other branches cannot), and that can only list stacks and
 *    read the templates of this app's stacks. No write action, no data
 *    access (templates hold no secrets: those are dynamic references).
 */
export class VettidOrgCiReadOnlyStack extends cdk.Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: VettidOrgCiReadOnlyStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: GITHUB_OIDC_URL,
      clientIds: ['sts.amazonaws.com'],
    });

    this.role = new iam.Role(this, 'DriftRole', {
      roleName: ciDriftRoleName(props.config),
      description: `Production drift check (read-only): GitHub Actions ${CI_REPO} on ${CI_BRANCH} only`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: `repo:${CI_REPO}:ref:refs/heads/${CI_BRANCH}`,
        },
      }),
    });

    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'ListStacks',
      actions: ['cloudformation:ListStacks'], // no resource-level permissions
      resources: ['*'],
    }));
    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadOurTemplates',
      actions: ['cloudformation:GetTemplate'],
      resources: [this.formatArn({ service: 'cloudformation', resource: 'stack', resourceName: 'Vettid*' })],
    }));
  }
}
