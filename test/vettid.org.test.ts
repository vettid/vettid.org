import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { VettidOrgStack } from '../lib/stacks/web-stack';
import { VettidOrgDnsStack } from '../lib/stacks/dns-stack';
import { VettidOrgSignupStack } from '../lib/stacks/signup-stack';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { VettidOrgPlaybooksStack } from '../lib/stacks/playbooks-stack';

describe('VettidOrgStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new VettidOrgStack(app, 'TestStack', {
      domainName: 'test.example.com',
      enableCustomDomain: false,
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
    template = Template.fromStack(stack);
  });

  describe('S3 Buckets', () => {
    test('creates website bucket with correct security settings', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'test.example.com-website',
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });

    test('creates logs bucket with lifecycle policy', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'test.example.com-logs',
        LifecycleConfiguration: {
          Rules: [
            {
              ExpirationInDays: 30,
              Status: 'Enabled',
            },
          ],
        },
      });
    });

    test('creates Athena results bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'test.example.com-athena-results',
      });
    });
  });

  describe('CloudFront Distribution', () => {
    test('creates distribution with HTTPS redirect', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: 'redirect-to-https',
          },
          DefaultRootObject: 'index.html',
          Enabled: true,
          HttpVersion: 'http2and3',
          PriceClass: 'PriceClass_100',
        },
      });
    });

    test('configures error responses', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CustomErrorResponses: Match.arrayWith([
            Match.objectLike({
              ErrorCode: 403,
              ResponseCode: 404,
              ResponsePagePath: '/404.html',
            }),
            Match.objectLike({
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: '/404.html',
            }),
          ]),
        },
      });
    });

    test('associates clean-URL rewrite function with default behavior', () => {
      template.hasResourceProperties('AWS::CloudFront::Function', {
        FunctionConfig: Match.objectLike({
          Runtime: Match.stringLikeRegexp('cloudfront-js'),
        }),
      });
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: [
              Match.objectLike({
                EventType: 'viewer-request',
              }),
            ],
          }),
        },
      });
    });

    test('enables access logging without cookie values', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Logging: Match.objectLike({
            Prefix: 'cloudfront/',
            IncludeCookies: false,
          }),
        },
      });
    });

    test('attaches telemetry WAF WebACL with logging and redaction', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Scope: 'CLOUDFRONT',
        DefaultAction: { Allow: {} },
      });
      template.hasResourceProperties('AWS::WAFv2::LoggingConfiguration', {
        RedactedFields: Match.arrayWith([
          Match.objectLike({ SingleHeader: { Name: 'cookie' } }),
          Match.objectLike({ SingleHeader: { Name: 'authorization' } }),
        ]),
      });
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          WebACLId: Match.anyValue(),
        }),
      });
    });

    test('rate-limits per IP with 429 and runs reputation lists in count mode', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'rate-limit-per-ip',
            Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
            Statement: {
              RateBasedStatement: Match.objectLike({ Limit: 300, AggregateKeyType: 'IP' }),
            },
          }),
          Match.objectLike({
            Name: 'rate-limit-probe-paths',
            Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
            Statement: {
              RateBasedStatement: Match.objectLike({
                Limit: 25,
                AggregateKeyType: 'IP',
                ScopeDownStatement: Match.objectLike({ NotStatement: Match.anyValue() }),
              }),
            },
          }),
          Match.objectLike({
            Name: 'rate-limit-per-ja4',
            Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
            Statement: {
              RateBasedStatement: Match.objectLike({
                Limit: 600,
                AggregateKeyType: 'CUSTOM_KEYS',
                CustomKeys: [Match.objectLike({ JA4Fingerprint: Match.anyValue() })],
              }),
            },
          }),
          Match.objectLike({
            Name: 'rate-limit-api',
            Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
            Statement: {
              RateBasedStatement: Match.objectLike({
                Limit: 20,
                AggregateKeyType: 'IP',
                ScopeDownStatement: Match.objectLike({ ByteMatchStatement: Match.anyValue() }),
              }),
            },
          }),
          Match.objectLike({
            Name: 'rate-limit-api-ja4',
            Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
            Statement: {
              RateBasedStatement: Match.objectLike({
                Limit: 50,
                AggregateKeyType: 'CUSTOM_KEYS',
                CustomKeys: [Match.objectLike({ JA4Fingerprint: Match.anyValue() })],
                ScopeDownStatement: Match.objectLike({ ByteMatchStatement: Match.anyValue() }),
              }),
            },
          }),
          Match.objectLike({
            Name: 'aws-ip-reputation',
            OverrideAction: { Count: {} },
          }),
          Match.objectLike({
            Name: 'aws-anonymous-ip',
            OverrideAction: { Count: {} },
          }),
        ]),
      });
    });

    test('configures standard logging v2 delivery to S3 as JSON', () => {
      template.hasResourceProperties('AWS::Logs::DeliverySource', {
        LogType: 'ACCESS_LOGS',
      });
      template.hasResourceProperties('AWS::Logs::DeliveryDestination', {
        OutputFormat: 'json',
      });
      template.hasResourceProperties('AWS::Logs::Delivery', {
        RecordFields: Match.arrayWith(['timestamp(ms)', 'x-edge-location', 'asn', 'c-ip', 'cs-uri-stem', 'cs(Referer)', 'cs(User-Agent)', 'sc-status', 'sc-bytes']),
      });
      // Privacy: cookie values must never be captured (spec §5)
      const deliveries = template.findResources('AWS::Logs::Delivery');
      for (const d of Object.values(deliveries)) {
        expect(d.Properties.RecordFields).not.toContain('cs(Cookie)');
      }
    });

    test('configures security headers', () => {
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
            ContentSecurityPolicy: {
              ContentSecurityPolicy: Match.stringLikeRegexp("default-src 'none'"),
              Override: true,
            },
            ContentTypeOptions: {
              Override: true,
            },
            FrameOptions: {
              FrameOption: 'DENY',
              Override: true,
            },
            StrictTransportSecurity: {
              AccessControlMaxAgeSec: 31536000,
              IncludeSubdomains: true,
              Override: true,
            },
          },
          CustomHeadersConfig: {
            Items: Match.arrayWith([
              Match.objectLike({ Header: 'Permissions-Policy' }),
            ]),
          },
        },
      });
    });

    test('creates v2 JSON logs Glue table with partition projection', () => {
      template.hasResourceProperties('AWS::Glue::Table', {
        TableInput: Match.objectLike({
          Name: 'cloudfront_logs_v2',
          Parameters: Match.objectLike({
            'projection.enabled': 'true',
          }),
        }),
      });
    });
  });

  describe('Glue and Athena', () => {
    test('creates Glue database', () => {
      template.hasResourceProperties('AWS::Glue::Database', {
        DatabaseInput: {
          Name: 'vettid_logs',
          Description: 'Database for VettID CloudFront access logs',
        },
      });
    });

    test('creates CloudFront logs table', () => {
      template.hasResourceProperties('AWS::Glue::Table', {
        TableInput: {
          Name: 'cloudfront_logs',
          TableType: 'EXTERNAL_TABLE',
        },
      });
    });

    test('creates Athena workgroup', () => {
      template.hasResourceProperties('AWS::Athena::WorkGroup', {
        Name: 'vettid-logs-workgroup',
        Description: 'WorkGroup for querying VettID access logs',
      });
    });
  });

  describe('Stack Outputs', () => {
    test('exports distribution domain name', () => {
      template.hasOutput('DistributionDomainName', {});
    });

    test('exports bucket name', () => {
      template.hasOutput('BucketName', {});
    });

    test('exports logs bucket name', () => {
      template.hasOutput('LogsBucketName', {});
    });

    test('exports Athena database name', () => {
      template.hasOutput('AthenaDatabase', {});
    });

    test('exports Athena workgroup name', () => {
      template.hasOutput('AthenaWorkGroup', {});
    });
  });
});

describe('VettidOrgStack with custom domain', () => {
  test('creates certificate when custom domain enabled', () => {
    const app = new cdk.App();
    const stack = new VettidOrgStack(app, 'TestStackWithDomain', {
      domainName: 'test.example.com',
      enableCustomDomain: true,
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'test.example.com',
      SubjectAlternativeNames: ['www.test.example.com'],
      ValidationMethod: 'DNS',
    });
  });
});

describe('VettidOrgSignupStack', () => {
  let template: Template;
  beforeAll(() => {
    const app = new cdk.App();
    const env = { account: '123456789012', region: 'us-east-1' };
    const zoneStack = new cdk.Stack(app, 'TestSignupZone', { env });
    const zone = new route53.PublicHostedZone(zoneStack, 'Zone', { zoneName: 'test.example.com' });
    const stack = new VettidOrgSignupStack(app, 'TestSignup', { hostedZone: zone, env });
    template = Template.fromStack(stack);
  });

  test('creates retained mailing-list table with TTL and status index', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        TimeToLiveSpecification: Match.objectLike({ AttributeName: 'expiresAt', Enabled: true }),
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({ IndexName: 'status-index' }),
        ]),
      }),
    });
  });

  test('creates subscribe route and scheduled verification sweep', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/subscribe',
    });
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
    });
  });
});

describe('VettidOrgDnsStack', () => {
  test('replicates ProtonMail records in the hosted zone', () => {
    const app = new cdk.App();
    const stack = new VettidOrgDnsStack(app, 'TestDns', {
      domainName: 'test.example.com',
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'MX',
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: '_dmarc.test.example.com.',
      Type: 'TXT',
    });
  });
});

describe('VettidOrgPlaybooksStack', () => {
  test('creates retained private playbooks bucket and web stack wires the behavior', () => {
    const app = new cdk.App();
    const env = { account: '123456789012', region: 'us-east-1' };
    const playbooks = new VettidOrgPlaybooksStack(app, 'TestPlaybooks', { env });
    const web = new VettidOrgStack(app, 'TestWebWithPlaybooks', {
      domainName: 'test.example.com',
      enableCustomDomain: false,
      playbooksBucket: playbooks.bucket,
      env,
    });
    const pbTemplate = Template.fromStack(playbooks);
    pbTemplate.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
    const webTemplate = Template.fromStack(web);
    webTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/playbooks/*' }),
        ]),
      }),
    });
  });
});
