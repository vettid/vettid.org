import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface StaticSiteProps {
  /** Fully-qualified host, e.g. account.vettid.org. */
  readonly hostName: string;
  readonly hostedZone: route53.IHostedZone;
  /** Local directory with the site's files, relative to the repo root (e.g. 'sites/account'). */
  readonly sourceDir: string;
  /**
   * Runtime config written to /config.json at deploy time. Values may be
   * CDK tokens (pool IDs, client IDs); they are resolved during deployment,
   * so there is no placeholder/sed step.
   */
  readonly runtimeConfig?: Record<string, unknown>;
  /**
   * Same-origin API: requests to /api/* are forwarded to this host (an
   * execute-api domain). Keeping the API same-origin means no CORS and lets
   * auth cookies be host-only + SameSite=Strict.
   */
  readonly apiOriginDomain?: string;
  /** Extra CSP connect-src sources beyond 'self' (e.g. a Cognito or API host). */
  readonly connectSrc?: string[];
  /** ARN of a CLOUDFRONT-scope WAF web ACL (us-east-1). */
  readonly webAclArn?: string;
}

/**
 * A static site on S3 + CloudFront at its own host name, with the repo's
 * standard security posture: OAC-only bucket, strict CSP with no inline or
 * third-party script, HSTS, TLS 1.2+ (TLS 1.3 viewers negotiate CloudFront's
 * hybrid post-quantum key exchange), and deploy-time generated config.
 */
export class StaticSite extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id);

    // Site content is rebuilt from the repo on every deploy, so the bucket is
    // unnamed; RETAIN still avoids losing it to an accidental stack delete.
    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.hostName,
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      comment: `${props.hostName} security headers`,
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()', override: true },
          // Fallback only (override: false): site files carry their own
          // Cache-Control from the deployment; this catches API responses
          // that forget one, so per-user data never lands in a shared cache.
          { header: 'Cache-Control', value: 'no-store', override: false },
        ],
      },
      securityHeadersBehavior: {
        // Fully self-hosted: no external scripts/styles/fonts. Unlike the
        // public site, no 'unsafe-inline' styles — these apps use stylesheets only.
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
            ['connect-src', "'self'", ...(props.connectSrc ?? [])].join(' '),
            "img-src 'self' data:",
            "font-src 'self'",
            "manifest-src 'self'",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
    });

    // S3 (OAC) doesn't resolve /path or /path/ to /path/index.html by itself.
    const rewrite = new cloudfront.Function(this, 'Rewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Clean URLs: /x and /x/ -> /x/index.html',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) {
    req.uri = uri + 'index.html';
  } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/') + 1) {
    req.uri = uri + '/index.html';
  }
  return req;
}`),
    });

    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    if (props.apiOriginDomain) {
      additionalBehaviors['/api/*'] = {
        origin: new origins.HttpOrigin(props.apiOriginDomain),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        responseHeadersPolicy: headers,
      };
    }

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: props.hostName,
      domainNames: [props.hostName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultRootObject: 'index.html',
      webAclId: props.webAclArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        responseHeadersPolicy: headers,
        functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: rewrite }],
      },
      additionalBehaviors,
    });

    const target = route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(this.distribution));
    new route53.ARecord(this, 'Alias', { zone: props.hostedZone, recordName: props.hostName, target });
    new route53.AaaaRecord(this, 'AliasV6', { zone: props.hostedZone, recordName: props.hostName, target });

    // Two passes, as on the main site: HTML/JSON revalidate every visit,
    // static assets cache for a week. Each pass's include/exclude filter also
    // scopes its pruning to its own files. config.json rides in the
    // revalidating pass so it is never stale and never pruned.
    const revalidate = ['*.html', '*.json', '*.txt', '*.xml'];
    const content = s3deploy.Source.asset(props.sourceDir);
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [content],
      destinationBucket: this.bucket,
      exclude: revalidate,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=604800')],
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
    new s3deploy.BucketDeployment(this, 'DeployHtml', {
      sources: props.runtimeConfig
        ? [content, s3deploy.Source.jsonData('config.json', props.runtimeConfig)]
        : [content],
      destinationBucket: this.bucket,
      exclude: ['*'],
      include: revalidate,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache, must-revalidate')],
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
  }
}
