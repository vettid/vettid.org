import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { VettidOrgStack } from '../lib/vettid.org-stack';

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
          HttpVersion: 'http2',
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
              ResponsePagePath: '/index.html',
            }),
            Match.objectLike({
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: '/index.html',
            }),
          ]),
        },
      });
    });

    test('enables access logging', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Logging: Match.objectLike({
            Prefix: 'cloudfront/',
            IncludeCookies: true,
          }),
        },
      });
    });

    test('configures security headers', () => {
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
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
        },
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
