import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { readRef } from '../constructs/ssm-refs';
import { StaticSite } from '../constructs/static-site';

export interface VettidOrgAdminSiteStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Stateless: the admin single-page app at admin.vettid.org (sites/admin).
 * Behind the CLOUDFRONT web ACL from VettidOrgAdminAccessStack (allows only
 * the exit node's IP). Signs in via the admin pool's hosted UI and calls
 * admin-api.vettid.org directly (CORS) — the API's own resource policy
 * enforces the same IP, so the API never trusts CloudFront to do it.
 */
export class VettidOrgAdminSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAdminSiteStackProps) {
    super(scope, id, props);
    const { config } = props;
    // Looked up by name (cached in cdk.context.json) rather than passed from
    // VettidOrgDnsStack, which would create a CloudFormation export.
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.domainName });
    const apiBase = `https://${hostName(config, 'admin-api')}`;
    const cognitoDomain = `https://${resourceName(config, 'admin')}.auth.${config.region}.amazoncognito.com`;

    new StaticSite(this, 'Site', {
      hostName: hostName(config, 'admin'),
      hostedZone: hostedZone,
      sourceDir: 'sites/admin',
      notFoundPage: '404.html',
      webAclArn: readRef(this, config, 'admin-access/site-web-acl-arn'),
      connectSrc: [apiBase, cognitoDomain],
      runtimeConfig: {
        apiBase,
        cognitoDomain,
        clientId: readRef(this, config, 'auth/admin-client-id'),
        redirectUri: `https://${hostName(config, 'admin')}/`,
      },
    });
  }
}
