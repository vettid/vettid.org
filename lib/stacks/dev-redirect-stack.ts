import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';

/**
 * The entire remaining vettid.dev footprint: a permanent, contentless
 * blanket 301 of vettid.dev, www.vettid.dev, and admin.vettid.dev to
 * https://vettid.org/. Replaces the old VettIDStack after the backend
 * teardown. Intended to run indefinitely so search engines fully
 * reassign equity and stale links keep landing.
 *
 * Deploy AFTER VettIDStack is deleted — CloudFront aliases are exclusive,
 * so this distribution cannot claim vettid.dev while the old one holds it.
 */
export class VettidDevRedirectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, 'DevZone', {
      domainName: 'vettid.dev',
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'vettid.dev',
      subjectAlternativeNames: ['www.vettid.dev', 'admin.vettid.dev'],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const redirectFn = new cloudfront.Function(this, 'RedirectFn', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      'location': { value: 'https://vettid.org/' },
      'cache-control': { value: 'max-age=86400' }
    }
  };
}
`),
      comment: 'Permanent blanket redirect of all vettid.dev traffic to https://vettid.org/',
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: ['vettid.dev', 'www.vettid.dev', 'admin.vettid.dev'],
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        // Origin is never reached; the function answers every request
        origin: new origins.HttpOrigin('vettid.org'),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [
          { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: redirectFn },
        ],
      },
    });

    for (const [name, record] of [['Apex', ''], ['Www', 'www'], ['Admin', 'admin']] as const) {
      new route53.ARecord(this, `${name}A`, {
        zone,
        recordName: record,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
      new route53.AaaaRecord(this, `${name}Aaaa`, {
        zone,
        recordName: record,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
    }

    new cdk.CfnOutput(this, 'RedirectDistribution', {
      value: distribution.distributionDomainName,
      description: 'Distribution serving the vettid.dev -> vettid.org redirect',
    });
  }
}
