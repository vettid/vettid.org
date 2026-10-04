import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { AppConfig, androidAssetLinks, hostName, resourceName } from '../config';
import { readRef } from '../constructs/ssm-refs';
import { stageZone } from '../constructs/stage-zone';
import { StaticSite } from '../constructs/static-site';
import { WafLogging } from '../constructs/waf-logging';
import { originVerifySecretName } from './member-api-stack';

export interface VettidOrgAccountSiteStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/** Per-IP request budgets over a 5-minute window (WAF rate-based rules). */
export const ACCOUNT_RATE_LIMITS = {
  /** Sign-in and membership-request endpoints: the brute-force / mail-bomb surface. */
  authAndPublic: 30,
  /** Everything under /api/* (a busy signed-in session is well under this). */
  api: 300,
};

/**
 * Stateless: the member account site at account.vettid.org (sites/account;
 * account.staging.vettid.org in staging),
 * with the member API same-origin at /api/* — no CORS, and session cookies
 * are host-only + SameSite=Strict. CloudFront adds the origin-verify secret
 * to every API request (resolved from Secrets Manager at deploy time).
 *
 * A CLOUDFRONT web ACL (default allow) rate-limits the API per viewer IP in
 * front of the member API's own limits, and logs to CloudWatch.
 */
export class VettidOrgAccountSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAccountSiteStackProps) {
    super(scope, id, props);
    const { config } = props;
    const hostedZone = stageZone(this, config);

    const prefix = (searchString: string): wafv2.CfnWebACL.StatementProperty => ({
      byteMatchStatement: {
        fieldToMatch: { uriPath: {} },
        positionalConstraint: 'STARTS_WITH',
        searchString,
        textTransformations: [{ priority: 0, type: 'NONE' }],
      },
    });
    const visibility = (metricName: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      metricName,
      sampledRequestsEnabled: true,
    });
    const rateLimit = (name: string, priority: number, limit: number, scopeDownStatement: wafv2.CfnWebACL.StatementProperty): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      action: { block: { customResponse: { responseCode: 429 } } },
      statement: { rateBasedStatement: { limit, aggregateKeyType: 'IP', evaluationWindowSec: 300, scopeDownStatement } },
      visibilityConfig: visibility(`${resourceName(config, 'account')}-${name}`),
    });

    // CLOUDFRONT scope: must live in us-east-1, which this whole app does.
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: resourceName(config, 'account'),
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility(`${resourceName(config, 'account')}-web-acl`),
      rules: [
        rateLimit('rate-limit-auth', 0, ACCOUNT_RATE_LIMITS.authAndPublic, {
          orStatement: { statements: [prefix('/api/public/'), prefix('/api/auth/')] },
        }),
        rateLimit('rate-limit-api', 1, ACCOUNT_RATE_LIMITS.api, prefix('/api/')),
        {
          // Observe first (count); decide from the logs whether it should block.
          name: 'aws-ip-reputation',
          priority: 2,
          overrideAction: { count: {} },
          statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesAmazonIpReputationList' } },
          visibilityConfig: visibility(`${resourceName(config, 'account')}-ip-reputation`),
        },
      ],
    });
    new WafLogging(this, 'WafLogging', {
      webAclArn: webAcl.attrArn,
      logGroupName: `aws-waf-logs-${resourceName(config, 'account')}`,
    });

    new StaticSite(this, 'Site', {
      hostName: hostName(config, 'account'),
      hostedZone,
      sourceDir: 'sites/account',
      notFoundPage: '404.html',
      // Sign-in links open in the Android app (App Links).
      wellKnown: { 'assetlinks.json': androidAssetLinks() },
      // Signed-out visitors never get the account page shell (see COOKIES.present).
      requireCookie: { pathPrefix: '/account/', cookie: 'vid_s', redirectTo: '/signin/' },
      webAclArn: webAcl.attrArn,
      apiOriginDomain: readRef(this, config, 'member-api/domain'),
      apiOriginHeaders: {
        'X-Origin-Verify': cdk.SecretValue.secretsManager(originVerifySecretName(config)).unsafeUnwrap(),
      },
    });
  }
}
