import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
  /** Extra headers CloudFront adds to /api/* origin requests (e.g. an origin-verify secret). */
  readonly apiOriginHeaders?: Record<string, string>;
  /** Extra CSP connect-src sources beyond 'self' (e.g. a Cognito or API host). */
  readonly connectSrc?: string[];
  /** ARN of a CLOUDFRONT-scope WAF web ACL (us-east-1). */
  readonly webAclArn?: string;
  /**
   * Branded 404 page (path inside sourceDir, e.g. '404.html'). Requests for
   * files the site doesn't contain get this page with a real 404 status,
   * answered by the viewer-request function from a file list built at synth.
   * (CloudFront's distribution-wide error pages would also rewrite the API's
   * JSON errors, so they aren't used.)
   */
  readonly notFoundPage?: string;
}

/** Every file the deployment will put in the bucket, as request paths. */
function sitePaths(dir: string): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : ['/' + relative(dir, p).split(sep).join('/')];
    });
  return walk(dir).sort();
}

const FUNCTION_CODE_LIMIT = 10 * 1024; // CloudFront Functions hard limit

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

    const csp = [
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
    ].join('; ');

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
          contentSecurityPolicy: csp,
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
    // With notFoundPage, unknown paths are answered here with the branded
    // page and a real 404 (S3 would say 403 for a missing key).
    let notFound = '';
    if (props.notFoundPage) {
      const files = sitePaths(props.sourceDir);
      if (props.runtimeConfig) files.push('/config.json');
      const page = readFileSync(join(props.sourceDir, props.notFoundPage), 'utf8');
      const fnHeaders = {
        'content-type': { value: 'text/html; charset=utf-8' },
        'cache-control': { value: 'no-store' },
        'content-security-policy': { value: csp },
        'x-content-type-options': { value: 'nosniff' },
        'x-frame-options': { value: 'DENY' },
        'referrer-policy': { value: 'no-referrer' },
        'strict-transport-security': { value: 'max-age=31536000; includeSubDomains' },
      };
      notFound = `
  if (!FILES[uri]) {
    return { statusCode: 404, statusDescription: 'Not Found', headers: ${JSON.stringify(fnHeaders)},
      body: { encoding: 'text', data: NOT_FOUND } };
  }
`;
      notFound = `var FILES = ${JSON.stringify(Object.fromEntries(files.map((f) => [f, 1])))};
var NOT_FOUND = ${JSON.stringify(page)};
@@CHECK@@${notFound}`;
    }
    const [decls, check] = notFound ? notFound.split('@@CHECK@@') : ['', ''];
    const rewriteCode = `${decls}
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) {
    uri = uri + 'index.html';
  } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/') + 1) {
    uri = uri + '/index.html';
  }${check}
  req.uri = uri;
  return req;
}`;
    if (rewriteCode.length > FUNCTION_CODE_LIMIT) {
      throw new Error(`${props.hostName}: viewer-request function is ${rewriteCode.length} bytes (limit ${FUNCTION_CODE_LIMIT}); shrink the 404 page or the site's file list`);
    }
    const rewrite = new cloudfront.Function(this, 'Rewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: props.notFoundPage ? 'Clean URLs + branded 404 for unknown paths' : 'Clean URLs: /x and /x/ -> /x/index.html',
      code: cloudfront.FunctionCode.fromInline(rewriteCode),
    });

    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    if (props.apiOriginDomain) {
      // Forward only what the API uses: cookies (session), query strings, the
      // CSRF and content-type headers, and the viewer's address (rate limits).
      const apiRequests = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequests', {
        comment: `${props.hostName} /api/*`,
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Content-Type', 'X-VettID-CSRF', 'CloudFront-Viewer-Address'),
      });
      additionalBehaviors['/api/*'] = {
        origin: new origins.HttpOrigin(props.apiOriginDomain, { customHeaders: props.apiOriginHeaders }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: apiRequests,
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
