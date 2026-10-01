import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig, hostName } from '../config';
import { readRef } from '../constructs/ssm-refs';
import { StaticSite } from '../constructs/static-site';
import { originVerifySecretName } from './member-api-stack';

export interface VettidOrgAccountSiteStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Stateless: the member account site at account.vettid.org (sites/account),
 * with the member API same-origin at /api/* — no CORS, and session cookies
 * are host-only + SameSite=Strict. CloudFront adds the origin-verify secret
 * to every API request (resolved from Secrets Manager at deploy time).
 */
export class VettidOrgAccountSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAccountSiteStackProps) {
    super(scope, id, props);
    const { config } = props;
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.domainName });

    new StaticSite(this, 'Site', {
      hostName: hostName(config, 'account'),
      hostedZone,
      sourceDir: 'sites/account',
      notFoundPage: '404.html',
      apiOriginDomain: readRef(this, config, 'member-api/domain'),
      apiOriginHeaders: {
        'X-Origin-Verify': cdk.SecretValue.secretsManager(originVerifySecretName(config)).unsafeUnwrap(),
      },
    });
  }
}
