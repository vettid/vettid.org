import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

export interface VettidOrgStackProps extends cdk.StackProps {
  domainName: string;
  enableCustomDomain?: boolean;
  /** Route53 zone (from VettidOrgDnsStack); adds apex/www ALIAS records */
  hostedZone?: route53.IHostedZone;
  /** Signup HTTP API domain (from VettidOrgSignupStack); adds the /api/* behavior */
  apiDomain?: string;
}

export class VettidOrgStack extends cdk.Stack {
  public readonly distributionDomainName: cdk.CfnOutput;
  public readonly certificateArn?: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: VettidOrgStackProps) {
    super(scope, id, props);

    // S3 bucket for static website hosting
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `${props.domainName}-website`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
    });

    // S3 bucket for CloudFront access logs
    const logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${props.domainName}-logs`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          // Delete logs after 30 days
          expiration: cdk.Duration.days(30),
        },
      ],
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
    });

    // S3 bucket for Athena query results
    const athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      bucketName: `${props.domainName}-athena-results`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // S3 bucket for standard logging v2 (JSON) access logs.
    // Separate from the legacy logs bucket because CloudWatch vended-log
    // delivery requires a bucket name matching [\w-] (no dots).
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: 'vettid-org-access-logs',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Raw request logs kept 90 days (logging spec §5: 30-90 days raw)
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // SSL Certificate (must be in us-east-1 for CloudFront)
    let certificate: acm.Certificate | undefined;
    if (props.enableCustomDomain) {
      certificate = new acm.Certificate(this, 'Certificate', {
        domainName: props.domainName,
        subjectAlternativeNames: [`www.${props.domainName}`],
        validation: acm.CertificateValidation.fromDns(), // You'll need to manually add DNS records
      });

      this.certificateArn = new cdk.CfnOutput(this, 'CertificateArn', {
        value: certificate.certificateArn,
        description: 'SSL Certificate ARN - check ACM console for DNS validation records',
      });
    }

    // Security headers policy for CloudFront
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `${props.domainName.replace(/[.]/g, '-')}-security-headers`,
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
            override: true,
          },
        ],
      },
      securityHeadersBehavior: {
        // Site is fully self-hosted: no external scripts, styles, fonts, or
        // connections. 'unsafe-inline' styles are required by the per-page
        // inline <style> blocks; data: images cover the inline SVG noise
        // texture. There are no inline scripts or event handlers.
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'none'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "connect-src 'self'",
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
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
      },
    });

    // Clean-URL rewrite: the S3 REST origin (OAC) does not resolve /security or
    // /security/ to /security/index.html on its own, so multi-page routes need a
    // viewer-request rewrite. Also blocks common sensitive-path probes.
    const htmlRewriteFn = new cloudfront.Function(this, 'HtmlRewriteFn', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // API routes pass through untouched (handled by the /api/* behavior)
  if (uri === '/api' || uri.indexOf('/api/') === 0) {
    return request;
  }

  // Canonical host: 301 www -> apex, preserving path and query string.
  // DISABLED until the Route53 NS cutover: the apex currently resolves to the
  // registrar's redirect service (which can't even terminate TLS for the
  // domain), so redirecting www there strands every visitor. Flip to true
  // right after the nameservers move.
  var WWW_REDIRECT_ENABLED = false;
  var host = request.headers.host && request.headers.host.value;
  if (WWW_REDIRECT_ENABLED && host === 'www.${props.domainName}') {
    var qsParts = [];
    for (var k in request.querystring) {
      var entry = request.querystring[k];
      if (entry.multiValue) {
        for (var i = 0; i < entry.multiValue.length; i++) {
          qsParts.push(k + '=' + entry.multiValue[i].value);
        }
      } else if (entry.value) {
        qsParts.push(k + '=' + entry.value);
      } else {
        qsParts.push(k);
      }
    }
    var qs = qsParts.length ? '?' + qsParts.join('&') : '';
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { 'location': { value: 'https://${props.domainName}' + uri + qs } }
    };
  }

  // Normalize before matching so percent-encoded evasions (/%2Egit,
  // /%252eenv) collapse onto the same rules. Two decode passes handle
  // double-encoding; invalid sequences fall through undecoded.
  var norm = uri.toLowerCase();
  for (var d = 0; d < 2; d++) {
    if (norm.indexOf('%') === -1) break;
    try { norm = decodeURIComponent(norm).toLowerCase(); } catch (e) { break; }
  }
  // Collapse duplicate slashes so //.git matches too
  while (norm.indexOf('//') !== -1) { norm = norm.replace('//', '/'); }

  // /.well-known/* is always allowed (RFC 8615: security.txt etc.) and is
  // deliberately checked before the dotfile blocklist below.
  var wellKnown = norm.indexOf('/.well-known/') === 0;

  // RFC 9116 legacy location: serve the canonical file for /security.txt
  if (norm === '/security.txt') {
    request.uri = '/.well-known/security.txt';
    return request;
  }

  // SECURITY: Block hostile-scanner paths. The site is static with no
  // server-side code, so anything probing for dotfiles, VCS metadata, PHP,
  // or CMS internals is noise at best.
  var blockedPrefixes = [
    '/.git', '/.svn', '/.hg', '/.env', '/.aws', '/.ssh',
    '/.htaccess', '/.htpasswd', '/.ds_store', '/.idea', '/.vscode',
    '/wp-admin', '/wp-login', '/wp-content', '/wp-includes',
    '/phpmyadmin', '/cgi-bin', '/xmlrpc.php'
  ];
  var blocked = false;
  if (!wellKnown) {
    for (var b = 0; b < blockedPrefixes.length; b++) {
      if (norm.indexOf(blockedPrefixes[b]) === 0) { blocked = true; break; }
    }
    // No PHP exists anywhere on this site
    if (norm.endsWith('.php')) { blocked = true; }
  }
  if (blocked) {
    return {
      statusCode: 403,
      statusDescription: 'Forbidden',
      headers: { 'content-type': { value: 'text/plain' } },
      body: { encoding: 'text', data: 'Forbidden' }
    };
  }

  // If URI ends with a slash, append index.html
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    // If URI has no file extension, treat as directory and append /index.html
    request.uri = uri + '/index.html';
  }

  return request;
}
`),
      comment: 'Rewrite extensionless URIs to index.html and block sensitive paths',
    });

    // WAF WebACL in pure-telemetry mode (default allow, no blocking rules).
    // Its logs are the only CloudFront-compatible source of JA3/JA4 TLS
    // fingerprints and ordered request header names (logging spec §2).
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'vettid-org-telemetry',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      rules: [],
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'vettid-org-web-acl',
        sampledRequestsEnabled: true,
      },
    });

    // WAF log group name must start with aws-waf-logs-
    const wafLogGroup = new logs.LogGroup(this, 'WafLogGroup', {
      logGroupName: 'aws-waf-logs-vettid-org',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new wafv2.CfnLoggingConfiguration(this, 'WafLogging', {
      resourceArn: webAcl.attrArn,
      // Log group ARN must be passed without the trailing :* that
      // logGroup.logGroupArn carries
      logDestinationConfigs: [
        this.formatArn({
          service: 'logs',
          resource: 'log-group',
          resourceName: wafLogGroup.logGroupName,
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      // Logging spec §5: never log credential-bearing header values
      redactedFields: [
        { singleHeader: { Name: 'cookie' } },
        { singleHeader: { Name: 'authorization' } },
      ],
    });

    // CloudFront distribution configuration with Origin Access Control (OAC)
    // Note: OAC is the modern replacement for OAI and provides better security
    const distributionProps: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        responseHeadersPolicy: securityHeadersPolicy,
        functionAssociations: [
          { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: htmlRewriteFn },
        ],
      },
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      // Enable access logging
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: 'cloudfront/',
      // Logging spec §5: never log Cookie header values
      logIncludesCookies: false,
      webAclId: webAcl.attrArn,
      // Custom error responses for better user experience
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    };

    // Add custom domain configuration if enabled
    if (props.enableCustomDomain && certificate) {
      Object.assign(distributionProps, {
        domainNames: [props.domainName, `www.${props.domainName}`],
        certificate: certificate,
      });
    }

    if (props.apiDomain) {
      Object.assign(distributionProps, {
        additionalBehaviors: {
          '/api/*': {
            origin: new origins.HttpOrigin(props.apiDomain),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            responseHeadersPolicy: securityHeadersPolicy,
          },
        },
      });
    }

    const distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);

    // ALIAS records once DNS lives in Route53 (harmless before NS cutover).
    // Also fixes the apex, which previously sat on a registrar redirect IP
    // instead of CloudFront.
    if (props.hostedZone) {
      new route53.ARecord(this, 'ApexAlias', {
        zone: props.hostedZone,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
      new route53.AaaaRecord(this, 'ApexAliasV6', {
        zone: props.hostedZone,
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
      new route53.ARecord(this, 'WwwAlias', {
        zone: props.hostedZone,
        recordName: 'www',
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
      new route53.AaaaRecord(this, 'WwwAliasV6', {
        zone: props.hostedZone,
        recordName: 'www',
        target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
      });
    }

    // --- CloudFront standard logging v2 (JSON Lines to S3) ---
    // Runs alongside the legacy TSV logs; delivered via CloudWatch vended-log
    // delivery (DeliverySource -> DeliveryDestination -> Delivery).

    // Vended-log delivery writes with bucket-owner-full-control from the
    // delivery.logs.amazonaws.com service principal
    accessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AWSLogDeliveryWrite',
      principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [accessLogsBucket.arnForObjects('*')],
      conditions: {
        StringEquals: {
          's3:x-amz-acl': 'bucket-owner-full-control',
          'aws:SourceAccount': this.account,
        },
        ArnLike: {
          'aws:SourceArn': this.formatArn({
            service: 'logs',
            resource: 'delivery-source',
            resourceName: '*',
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        },
      },
    }));
    accessLogsBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AWSLogDeliveryAclCheck',
      principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
      actions: ['s3:GetBucketAcl', 's3:ListBucket'],
      resources: [accessLogsBucket.bucketArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
      },
    }));

    const deliverySource = new logs.CfnDeliverySource(this, 'AccessLogDeliverySource', {
      name: 'vettid-org-cf-access-logs',
      resourceArn: distribution.distributionArn,
      logType: 'ACCESS_LOGS',
    });

    const deliveryDestination = new logs.CfnDeliveryDestination(this, 'AccessLogDeliveryDestination', {
      name: 'vettid-org-cf-logs-s3',
      destinationResourceArn: accessLogsBucket.bucketArn,
      outputFormat: 'json',
    });

    // Full v2 field set per the logging spec, minus cs(Cookie) (spec §5).
    // Field names are fixed once shipped (spec §7) — add, never rename.
    const accessLogDelivery = new logs.CfnDelivery(this, 'AccessLogDelivery', {
      deliverySourceName: deliverySource.name,
      deliveryDestinationArn: deliveryDestination.attrArn,
      recordFields: [
        'timestamp(ms)',
        'date',
        'time',
        'x-edge-location',
        'asn',
        'c-country',
        'c-ip',
        'c-port',
        'cs-method',
        'cs(Host)',
        'x-host-header',
        'cs-uri-stem',
        'cs-uri-query',
        'cs-protocol',
        'cs-protocol-version',
        'cs-bytes',
        'cs(Referer)',
        'cs(User-Agent)',
        'sc-status',
        'sc-bytes',
        'sc-content-type',
        'sc-content-len',
        'sc-range-start',
        'sc-range-end',
        'x-edge-result-type',
        'x-edge-response-result-type',
        'x-edge-detailed-result-type',
        'x-edge-request-id',
        'x-forwarded-for',
        'ssl-protocol',
        'ssl-cipher',
        'time-taken',
        'time-to-first-byte',
        'origin-fbl',
        'origin-lbl',
        'cache-behavior-path-pattern',
        'fle-status',
        'fle-encrypted-fields',
      ],
      s3SuffixPath: 'cloudfront-v2/{distributionid}/{yyyy}/{MM}/{dd}/{HH}',
      s3EnableHiveCompatiblePath: false,
    });
    accessLogDelivery.node.addDependency(deliverySource);
    accessLogDelivery.node.addDependency(deliveryDestination);
    accessLogDelivery.node.addDependency(accessLogsBucket.policy!);

    // Deploy website content from ./website in two passes so browsers get
    // sensible Cache-Control: HTML and metadata revalidate on every visit,
    // static assets (css/js/fonts/images) cache for a week. The exclude/
    // include filters also scope each deployment's pruning to its own files.
    const revalidatePatterns = ['*.html', '*.txt', '*.xml', '*.json'];
    new s3deploy.BucketDeployment(this, 'DeployWebsiteAssets', {
      sources: [s3deploy.Source.asset('./website')],
      destinationBucket: websiteBucket,
      exclude: revalidatePatterns,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=604800')],
      distribution: distribution,
      distributionPaths: ['/*'],
    });
    new s3deploy.BucketDeployment(this, 'DeployWebsiteHtml', {
      sources: [s3deploy.Source.asset('./website')],
      destinationBucket: websiteBucket,
      exclude: ['*'],
      include: revalidatePatterns,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache, must-revalidate')],
      distribution: distribution,
      distributionPaths: ['/*'],
    });

    // Create Glue Database for Athena
    const glueDatabase = new glue.CfnDatabase(this, 'LogsDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'vettid_logs',
        description: 'Database for VettID CloudFront access logs',
      },
    });

    // Create Glue Table for CloudFront logs
    const glueTable = new glue.CfnTable(this, 'CloudFrontLogsTable', {
      catalogId: this.account,
      databaseName: glueDatabase.ref,
      tableInput: {
        name: 'cloudfront_logs',
        description: 'CloudFront access logs table',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'EXTERNAL': 'TRUE',
          'skip.header.line.count': '2',
        },
        storageDescriptor: {
          columns: [
            { name: 'date', type: 'date' },
            { name: 'time', type: 'string' },
            { name: 'location', type: 'string' },
            { name: 'bytes', type: 'bigint' },
            { name: 'request_ip', type: 'string' },
            { name: 'method', type: 'string' },
            { name: 'host', type: 'string' },
            { name: 'uri', type: 'string' },
            { name: 'status', type: 'int' },
            { name: 'referrer', type: 'string' },
            { name: 'user_agent', type: 'string' },
            { name: 'query_string', type: 'string' },
            { name: 'cookie', type: 'string' },
            { name: 'result_type', type: 'string' },
            { name: 'request_id', type: 'string' },
            { name: 'host_header', type: 'string' },
            { name: 'request_protocol', type: 'string' },
            { name: 'request_bytes', type: 'bigint' },
            { name: 'time_taken', type: 'float' },
            { name: 'xforwarded_for', type: 'string' },
            { name: 'ssl_protocol', type: 'string' },
            { name: 'ssl_cipher', type: 'string' },
            { name: 'response_result_type', type: 'string' },
            { name: 'http_version', type: 'string' },
            { name: 'fle_status', type: 'string' },
            { name: 'fle_encrypted_fields', type: 'int' },
            { name: 'c_port', type: 'int' },
            { name: 'time_to_first_byte', type: 'float' },
            { name: 'x_edge_detailed_result_type', type: 'string' },
            { name: 'sc_content_type', type: 'string' },
            { name: 'sc_content_len', type: 'bigint' },
            { name: 'sc_range_start', type: 'bigint' },
            { name: 'sc_range_end', type: 'bigint' },
          ],
          location: `s3://${logsBucket.bucketName}/cloudfront/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: {
              'field.delim': '\t',
              'serialization.format': '\t',
            },
          },
        },
      },
    });

    // Glue table for the standard logging v2 JSON logs, using partition
    // projection over the cloudfront-v2/{distributionid}/{yyyy}/{MM}/{dd}/{HH}
    // delivery path so no crawler or ALTER TABLE is ever needed.
    // Column names are sanitized; SerDe mappings bind them to the JSON keys
    // that contain parentheses (e.g. "cs(User-Agent)").
    new glue.CfnTable(this, 'CloudFrontV2LogsTable', {
      catalogId: this.account,
      databaseName: glueDatabase.ref,
      tableInput: {
        name: 'cloudfront_logs_v2',
        description: 'CloudFront standard logging v2 (JSON) access logs',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'EXTERNAL': 'TRUE',
          'projection.enabled': 'true',
          'projection.distributionid.type': 'injected',
          'projection.log_hour.type': 'date',
          'projection.log_hour.format': 'yyyy/MM/dd/HH',
          'projection.log_hour.interval': '1',
          'projection.log_hour.interval.unit': 'HOURS',
          'projection.log_hour.range': '2026/08/01/00,NOW',
          'storage.location.template': `s3://${accessLogsBucket.bucketName}/cloudfront-v2/\${distributionid}/\${log_hour}`,
        },
        partitionKeys: [
          { name: 'distributionid', type: 'string' },
          { name: 'log_hour', type: 'string' },
        ],
        storageDescriptor: {
          columns: [
            { name: 'timestamp_ms', type: 'string' },
            { name: 'date', type: 'string' },
            { name: 'time', type: 'string' },
            { name: 'x_edge_location', type: 'string' },
            { name: 'asn', type: 'string' },
            { name: 'c_country', type: 'string' },
            { name: 'c_ip', type: 'string' },
            { name: 'c_port', type: 'string' },
            { name: 'cs_method', type: 'string' },
            { name: 'cs_host', type: 'string' },
            { name: 'x_host_header', type: 'string' },
            { name: 'cs_uri_stem', type: 'string' },
            { name: 'cs_uri_query', type: 'string' },
            { name: 'cs_protocol', type: 'string' },
            { name: 'cs_protocol_version', type: 'string' },
            { name: 'cs_bytes', type: 'string' },
            { name: 'cs_referer', type: 'string' },
            { name: 'cs_user_agent', type: 'string' },
            { name: 'sc_status', type: 'string' },
            { name: 'sc_bytes', type: 'string' },
            { name: 'sc_content_type', type: 'string' },
            { name: 'sc_content_len', type: 'string' },
            { name: 'sc_range_start', type: 'string' },
            { name: 'sc_range_end', type: 'string' },
            { name: 'x_edge_result_type', type: 'string' },
            { name: 'x_edge_response_result_type', type: 'string' },
            { name: 'x_edge_detailed_result_type', type: 'string' },
            { name: 'x_edge_request_id', type: 'string' },
            { name: 'x_forwarded_for', type: 'string' },
            { name: 'ssl_protocol', type: 'string' },
            { name: 'ssl_cipher', type: 'string' },
            { name: 'time_taken', type: 'string' },
            { name: 'time_to_first_byte', type: 'string' },
            { name: 'origin_fbl', type: 'string' },
            { name: 'origin_lbl', type: 'string' },
            { name: 'cache_behavior_path_pattern', type: 'string' },
            { name: 'fle_status', type: 'string' },
            { name: 'fle_encrypted_fields', type: 'string' },
          ],
          location: `s3://${accessLogsBucket.bucketName}/cloudfront-v2/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
            parameters: {
              'mapping.timestamp_ms': 'timestamp(ms)',
              'mapping.cs_host': 'cs(Host)',
              'mapping.cs_referer': 'cs(Referer)',
              'mapping.cs_user_agent': 'cs(User-Agent)',
              'ignore.malformed.json': 'true',
            },
          },
        },
      },
    });

    // Create Athena WorkGroup
    const athenaWorkGroup = new athena.CfnWorkGroup(this, 'LogsWorkGroup', {
      name: 'vettid-logs-workgroup',
      description: 'WorkGroup for querying VettID access logs',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false,
      },
    });

    // CloudFront distribution domain name output
    this.distributionDomainName = new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    // Bucket name output
    new cdk.CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket name for website content',
    });

    // Distribution ID output
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    // Logs bucket output
    new cdk.CfnOutput(this, 'LogsBucketName', {
      value: logsBucket.bucketName,
      description: 'S3 bucket name for CloudFront access logs',
    });

    // Athena database output
    new cdk.CfnOutput(this, 'AthenaDatabase', {
      value: glueDatabase.ref,
      description: 'Athena database name for querying logs',
    });

    // Athena workgroup output
    new cdk.CfnOutput(this, 'AthenaWorkGroup', {
      value: 'vettid-logs-workgroup',
      description: 'Athena workgroup for running queries',
    });

    // Athena results bucket output
    new cdk.CfnOutput(this, 'AthenaResultsBucketName', {
      value: athenaResultsBucket.bucketName,
      description: 'S3 bucket for Athena query results',
    });

    new cdk.CfnOutput(this, 'AccessLogsBucketName', {
      value: accessLogsBucket.bucketName,
      description: 'S3 bucket for CloudFront standard logging v2 (JSON) access logs',
    });

    new cdk.CfnOutput(this, 'WafLogGroupName', {
      value: wafLogGroup.logGroupName,
      description: 'CloudWatch log group with WAF telemetry (JA3/JA4 fingerprints, ordered headers)',
    });

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: webAcl.attrArn,
      description: 'WAF WebACL (telemetry mode) attached to the distribution',
    });
  }
}
