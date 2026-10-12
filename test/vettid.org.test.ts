import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { VettidOrgStack } from '../lib/stacks/web-stack';
import { VettidOrgDnsStack } from '../lib/stacks/dns-stack';
import { VettidOrgSignupStack } from '../lib/stacks/signup-stack';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { VettidOrgPlaybooksStack } from '../lib/stacks/playbooks-stack';
import { VettidDevRedirectStack } from '../lib/stacks/dev-redirect-stack';
import { WEBSITE_LOG_RETENTION_DAYS, websiteLogGroupRetention } from '../lib/constructs/website-logs';

const AMAZON_CAA = [
  '0 issue "amazon.com"',
  '0 issue "amazontrust.com"',
  '0 issue "awstrust.com"',
  '0 issue "amazonaws.com"',
  '0 issuewild ";"',
  '0 iodef "mailto:security@vettid.org"',
];

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

    test('the retired legacy logs bucket keeps the 30-day rule its contents were written under', () => {
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

    test('every log store of the website keeps the one period (90 days)', () => {
      expect(WEBSITE_LOG_RETENTION_DAYS).toBe(90);
      for (const BucketName of ['vettid-org-access-logs', 'test.example.com-athena-results']) {
        template.hasResourceProperties('AWS::S3::Bucket', {
          BucketName,
          LifecycleConfiguration: { Rules: [{ ExpirationInDays: WEBSITE_LOG_RETENTION_DAYS, Status: 'Enabled' }] },
        });
      }
      // The only log group of the stack is the WAF's.
      const groups = Object.values<any>(template.findResources('AWS::Logs::LogGroup'));
      expect(groups.map((g) => g.Properties)).toEqual([
        expect.objectContaining({ LogGroupName: 'aws-waf-logs-vettid-org', RetentionInDays: WEBSITE_LOG_RETENTION_DAYS }),
      ]);
      // No bucket of the stack is left without an expiry except the site itself.
      const buckets = Object.values<any>(template.findResources('AWS::S3::Bucket'));
      const unbounded = buckets.filter((b) => !b.Properties.LifecycleConfiguration).map((b) => b.Properties.BucketName);
      expect(unbounded).toEqual(['test.example.com-website']);
    });

    test('the period must be one CloudWatch Logs accepts', () => {
      expect(websiteLogGroupRetention(90)).toBe(90);
      expect(websiteLogGroupRetention(30)).toBe(30);
      expect(() => websiteLogGroupRetention(45)).toThrow(/not a retention CloudWatch Logs accepts/);
      expect(() => websiteLogGroupRetention(9999)).toThrow();
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

    test('the legacy standard log is off: v2 is the one access log', () => {
      const dist = Object.values<any>(template.findResources('AWS::CloudFront::Distribution'))[0];
      expect(dist.Properties.DistributionConfig.Logging).toBeUndefined();
      template.resourceCountIs('AWS::Logs::Delivery', 1);
    });

    test('the unsubscribe POST is outside every general rate rule and has its own, higher one', () => {
      const acl = Object.values<any>(template.findResources('AWS::WAFv2::WebACL'))[0];
      const rules: any[] = acl.Properties.Rules;
      const isUnsubPost = (st: any) =>
        JSON.stringify(st) ===
        JSON.stringify({
          AndStatement: {
            Statements: [
              { ByteMatchStatement: { FieldToMatch: { UriPath: {} }, PositionalConstraint: 'EXACTLY', SearchString: '/api/subscribe/unsubscribe', TextTransformations: [{ Priority: 0, Type: 'NONE' }] } },
              { ByteMatchStatement: { FieldToMatch: { Method: {} }, PositionalConstraint: 'EXACTLY', SearchString: 'POST', TextTransformations: [{ Priority: 0, Type: 'NONE' }] } },
            ],
          },
        });
      const rate = (name: string) => rules.find((r) => r.Name === name).Statement.RateBasedStatement;
      for (const name of ['rate-limit-per-ip', 'rate-limit-per-ja4']) {
        expect(isUnsubPost(rate(name).ScopeDownStatement.NotStatement.Statement)).toBe(true);
      }
      for (const name of ['rate-limit-api', 'rate-limit-api-ja4']) {
        const [prefix, not] = rate(name).ScopeDownStatement.AndStatement.Statements;
        expect(prefix.ByteMatchStatement).toMatchObject({ PositionalConstraint: 'STARTS_WITH', SearchString: '/api/' });
        expect(isUnsubPost(not.NotStatement.Statement)).toBe(true);
      }
      // the general limits themselves are unchanged
      expect([rate('rate-limit-per-ip').Limit, rate('rate-limit-per-ja4').Limit, rate('rate-limit-api').Limit, rate('rate-limit-api-ja4').Limit]).toEqual([300, 600, 20, 50]);
      const own = rules.find((r) => r.Name === 'rate-limit-unsubscribe');
      expect(own.Action).toEqual({ Block: { CustomResponse: { ResponseCode: 429 } } });
      expect(own.Statement.RateBasedStatement).toMatchObject({ Limit: 2000, AggregateKeyType: 'IP', EvaluationWindowSec: 300 });
      expect(isUnsubPost(own.Statement.RateBasedStatement.ScopeDownStatement)).toBe(true);
      expect(new Set(rules.map((r) => r.Priority)).size).toBe(rules.length);
    });

    test('the unsubscribe pages are not counted as probe traffic', () => {
      expect(JSON.stringify(template.findResources('AWS::WAFv2::WebACL'))).toContain('"SearchString":"/unsubscribe"');
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
                ScopeDownStatement: Match.objectLike({ AndStatement: Match.anyValue() }), // /api/, except the unsubscribe POST
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
                ScopeDownStatement: Match.objectLike({ AndStatement: Match.anyValue() }), // /api/, except the unsubscribe POST
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

    test('does not send the deprecated X-XSS-Protection header', () => {
      for (const p of Object.values<any>(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'))) {
        expect(p.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.XSSProtection).toBeUndefined();
      }
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

    test('only the v2 logs table exists (the legacy cloudfront_logs table went with its log)', () => {
      const tables = Object.values<any>(template.findResources('AWS::Glue::Table'));
      expect(tables.map((t) => t.Properties.TableInput.Name)).toEqual(['cloudfront_logs_v2']);
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

  test('mailing-list table is deletion-protected', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vettid-org-mailing-list',
      DeletionProtectionEnabled: true,
    });
  });

  test('creates subscribe, confirm and unsubscribe routes and scheduled verification sweep', () => {
    const routes = Object.values<any>(template.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties.RouteKey).sort();
    expect(routes).toEqual([
      'GET /api/subscribe/confirm',
      'GET /api/subscribe/unsubscribe',
      'POST /api/subscribe',
      'POST /api/subscribe/unsubscribe',
    ]);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
    });
  });

  test('Lambdas use the repo defaults (Node 24, ARM64, explicit log group) — no logRetention custom resource', () => {
    const fns = Object.values<any>(template.findResources('AWS::Lambda::Function'));
    expect(fns).toHaveLength(2);
    for (const fn of fns) {
      expect(fn.Properties).toMatchObject({ Runtime: 'nodejs24.x', Architectures: ['arm64'] });
      expect(fn.Properties.LoggingConfig.LogGroup).toBeDefined();
    }
    template.resourceCountIs('Custom::LogRetention', 0);
    expect(JSON.stringify(template.toJSON())).not.toContain('logs:PutRetentionPolicy');
  });

  test("the Lambdas' logs keep the website's one period; the API writes no access log", () => {
    const groups = Object.values<any>(template.findResources('AWS::Logs::LogGroup'));
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g.Properties.RetentionInDays).toBe(WEBSITE_LOG_RETENTION_DAYS);
    const stage = Object.values<any>(template.findResources('AWS::ApiGatewayV2::Stage'))[0];
    expect(stage.Properties.AccessLogSettings).toBeUndefined();
  });

  test('the unsubscribe POST has its own API throttle; everything else keeps the stage default', () => {
    const stage = Object.values<any>(template.findResources('AWS::ApiGatewayV2::Stage'))[0];
    expect(stage.Properties.DefaultRouteSettings).toMatchObject({ ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 });
    expect(stage.Properties.RouteSettings).toEqual({
      'POST /api/subscribe/unsubscribe': { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 },
    });
    expect(stage.DependsOn.length).toBeGreaterThanOrEqual(2); // the routes exist first
  });

  test('an unfinished unsubscribe is not silent: alarms on retries, on giving up and on a failing sweep, to the alerts topic', () => {
    const filters = Object.values<any>(template.findResources('AWS::Logs::MetricFilter')).map((f) => f.Properties);
    expect(filters.map((f) => f.FilterPattern).sort()).toEqual([
      '{ ($.outcome = "sweep") && ($.releaseAbandoned > 0) }',
      '{ ($.outcome = "sweep") && ($.releaseRetry > 0) }',
    ]);
    const alarms = Object.values<any>(template.findResources('AWS::CloudWatch::Alarm')).map((a) => a.Properties);
    const byName = Object.fromEntries(alarms.map((a) => [a.AlarmName, a]));
    expect(Object.keys(byName).sort()).toEqual([
      'vettid-org-mailing-list-release-abandoned',
      'vettid-org-mailing-list-release-retry',
      'vettid-org-mailing-list-sweep-errors',
    ]);
    expect(byName['vettid-org-mailing-list-release-retry']).toMatchObject({ MetricName: 'releaseRetry', Namespace: 'VettID/MailingList', Period: 900, EvaluationPeriods: 4, DatapointsToAlarm: 4, Threshold: 0, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching' });
    expect(byName['vettid-org-mailing-list-release-abandoned']).toMatchObject({ MetricName: 'releaseAbandoned', EvaluationPeriods: 1, Threshold: 0 });
    expect(byName['vettid-org-mailing-list-sweep-errors']).toMatchObject({ MetricName: 'Errors', Namespace: 'AWS/Lambda', EvaluationPeriods: 4 });
    for (const a of alarms) {
      expect(JSON.stringify(a.AlarmActions)).toContain(':sns:us-east-1:123456789012:vettid-org-security-alerts');
    }
  });

  test("the sweep's read of the members table is the email index and the email marker rows only", () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:GetItem',
            Effect: 'Allow',
            Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['email:*'] } },
            Resource: Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':table/vettid-org-members$')])] }),
          }),
        ]),
      },
    });
  });

  test('unsubscribe tokens are looked up through a sparse keys-only index', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'unsub-index',
          KeySchema: [{ AttributeName: 'unsubToken', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'KEYS_ONLY' },
        }),
      ]),
    });
  });

  test('subscribe can unsubscribe a row but reads no member data and deletes no SES identity', () => {
    const policies = Object.values<any>(template.findResources('AWS::IAM::Policy'));
    const ofSubscribe = policies.filter((p) => JSON.stringify(p).includes('secretsmanager:GetSecretValue'));
    expect(ofSubscribe).toHaveLength(1);
    const doc = JSON.stringify(ofSubscribe[0].Properties.PolicyDocument);
    expect(doc).toContain('dynamodb:DeleteItem');
    expect(doc).toContain('/index/unsub-index');
    expect(doc).not.toContain('vettid-org-members');
    expect(doc).not.toContain('ses:DeleteEmailIdentity');
    expect(doc).not.toContain('dynamodb:Scan');
    // its one Query right is on the unsubscribe index
    const queries = ofSubscribe[0].Properties.PolicyDocument.Statement.filter((st: any) => JSON.stringify(st.Action).includes('dynamodb:Query'));
    expect(queries).toHaveLength(1);
    expect(JSON.stringify(queries[0].Resource)).toMatch(/\/index\/unsub-index"\]\]\}$/);
  });

  test('origin-verify secret is generated under its fixed name and readable by subscribe only', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'vettid-org-signup/origin-verify',
      GenerateSecretString: Match.objectLike({ PasswordLength: 48 }),
    });
    const policies = Object.values<any>(template.findResources('AWS::IAM::Policy'));
    const readers = policies.filter((p) => JSON.stringify(p).includes('secretsmanager:GetSecretValue'));
    expect(readers).toHaveLength(1);
  });

  test('sweep may query only the members email index, and can never delete the domain identity', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain(':table/vettid-org-members/index/email-index');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 'ses:DeleteEmailIdentity',
            Resource: [
              Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':identity/vettid\\.org$')])] }),
              Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':identity/\\*\\.vettid\\.org$')])] }),
              Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':identity/\\*@vettid\\.org$')])] }),
              Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':identity/\\*@\\*\\.vettid\\.org$')])] }),
            ],
          }),
        ]),
      },
    });
  });
});

describe('VettidOrgStack /api/* origin (signup API)', () => {
  test('CloudFront adds X-Origin-Verify from the signup secret', () => {
    const app = new cdk.App();
    const stack = new VettidOrgStack(app, 'TestWebWithApi', {
      domainName: 'test.example.com',
      enableCustomDomain: false,
      apiDomain: 'abc123.execute-api.us-east-1.amazonaws.com',
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            DomainName: 'abc123.execute-api.us-east-1.amazonaws.com',
            OriginCustomHeaders: [
              {
                HeaderName: 'X-Origin-Verify',
                HeaderValue: '{{resolve:secretsmanager:vettid-org-signup/origin-verify:SecretString:::}}',
              },
            ],
          }),
        ]),
      }),
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
      ResourceRecords: ['"v=DMARC1; p=quarantine; rua=mailto:admin@vettid.org"'],
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'test.example.com.',
      Type: 'CAA',
      ResourceRecords: AMAZON_CAA,
    });
  });
});

describe('VettidDevRedirectStack', () => {
  const build = (context: Record<string, unknown> = {}) =>
    Template.fromStack(new VettidDevRedirectStack(new cdk.App({ context }), 'TestDevRedirect', {
      env: { account: '123456789012', region: 'us-east-1' },
    }));

  test('CAA restricts issuance to Amazon; mail-policy records stay off until the old ones are removed', () => {
    const t = build();
    t.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'CAA', ResourceRecords: AMAZON_CAA });
    expect(Object.values<any>(t.findResources('AWS::Route53::RecordSet')).filter((r) => r.Properties.Type === 'TXT')).toHaveLength(0);
  });

  test('with vettidDevMailPolicy: SPF -all and DMARC reject (redirect-only domain sends no mail)', () => {
    const t = build({ vettidDevMailPolicy: 'true' });
    t.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'TXT', ResourceRecords: ['"v=spf1 -all"'] });
    t.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'TXT',
      Name: Match.stringLikeRegexp('^_dmarc\\.'),
      ResourceRecords: ['"v=DMARC1; p=reject;"'],
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
    pbTemplate.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
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
