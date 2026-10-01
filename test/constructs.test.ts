import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HttpRouteGroup } from '../lib/constructs/route-group';
import { StaticSite } from '../lib/constructs/static-site';
import { publishRef, readRef, ssmParamName } from '../lib/constructs/ssm-refs';
import { hostName, loadConfig, resourceName } from '../lib/config';

const env = { account: '123456789012', region: 'us-east-1' };

describe('config', () => {
  test('prod names carry no stage; other stages are suffixed', () => {
    const prod = loadConfig(new cdk.App().node);
    expect(prod.stage).toBe('prod');
    expect(resourceName(prod, 'members')).toBe('vettid-org-members');
    expect(hostName(prod, 'account')).toBe('account.vettid.org');

    const staging = loadConfig(new cdk.App({ context: { stage: 'staging' } }).node);
    expect(resourceName(staging, 'members')).toBe('vettid-org-staging-members');
    expect(hostName(staging, 'account')).toBe('account.staging.vettid.org');
  });

  test('rejects malformed stage names', () => {
    expect(() => loadConfig(new cdk.App({ context: { stage: 'Prod!' } }).node)).toThrow(/Invalid stage/);
  });
});

describe('ssm refs', () => {
  test('publish and read use the same stage-scoped name', () => {
    const app = new cdk.App();
    const config = loadConfig(app.node);
    const producer = new cdk.Stack(app, 'Producer', { env });
    const consumer = new cdk.Stack(app, 'Consumer', { env });
    publishRef(producer, config, 'auth/member-pool-id', 'us-east-1_abc');
    new cdk.CfnOutput(consumer, 'Out', { value: readRef(consumer, config, 'auth/member-pool-id') });

    expect(ssmParamName(config, 'auth/member-pool-id')).toBe('/vettid-org/prod/auth/member-pool-id');
    Template.fromStack(producer).hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/vettid-org/prod/auth/member-pool-id',
      Value: 'us-east-1_abc',
    });
    const consumerJson = JSON.stringify(Template.fromStack(consumer).toJSON());
    expect(consumerJson).toContain('/vettid-org/prod/auth/member-pool-id');
    expect(consumerJson).not.toContain('Fn::ImportValue');
  });
});

describe('HttpRouteGroup', () => {
  const stack = new cdk.Stack(new cdk.App(), 'Api', { env });
  const api = new apigwv2.HttpApi(stack, 'Api');
  new HttpRouteGroup(stack, 'Account', {
    api,
    pathPrefix: '/api/account',
    entry: 'test/fixtures/handler.ts',
    environment: { TABLE: 'x' },
  });
  const template = Template.fromStack(stack);

  test('one function serves the prefix and everything under it', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ANY /api/account' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ANY /api/account/{proxy+}' });
  });

  test('function uses repo defaults: Node 24, ARM64, bounded log retention', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      Environment: { Variables: Match.objectLike({ TABLE: 'x', NODE_OPTIONS: '--enable-source-maps' }) },
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
  });

  test('rejects sloppy prefixes', () => {
    const s = new cdk.Stack(new cdk.App(), 'Bad', { env });
    const a = new apigwv2.HttpApi(s, 'Api');
    expect(() => new HttpRouteGroup(s, 'G', { api: a, pathPrefix: '/api/account/', entry: 'test/fixtures/handler.ts' })).toThrow();
  });
});

describe('StaticSite', () => {
  const stack = new cdk.Stack(new cdk.App(), 'Site', { env });
  const zone = route53.HostedZone.fromHostedZoneAttributes(stack, 'Zone', {
    hostedZoneId: 'Z123',
    zoneName: 'vettid.org',
  });
  new StaticSite(stack, 'Account', {
    hostName: 'account.vettid.org',
    hostedZone: zone,
    sourceDir: 'test/fixtures/site',
    runtimeConfig: { apiBase: '/api' },
    apiOriginDomain: 'abc123.execute-api.us-east-1.amazonaws.com',
    connectSrc: ['https://cognito-idp.us-east-1.amazonaws.com'],
  });
  const template = Template.fromStack(stack);

  test('bucket is private and TLS-only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('distribution serves the host over TLS 1.2+ with an /api/* same-origin behavior', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['account.vettid.org'],
        ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }),
        CacheBehaviors: [Match.objectLike({ PathPattern: '/api/*', ViewerProtocolPolicy: 'https-only' })],
      }),
    });
  });

  test('CSP allows only self-hosted script and listed connect sources', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp(
              "script-src 'self'; style-src 'self'; connect-src 'self' https://cognito-idp\\.us-east-1\\.amazonaws\\.com;",
            ),
            Override: true,
          },
        }),
      }),
    });
  });

  test('A and AAAA aliases point the host at CloudFront', () => {
    template.resourceCountIs('AWS::Route53::RecordSet', 2);
  });

  test('runtime config is deployed with the revalidating (HTML/JSON) pass', () => {
    const deployments = template.findResources('Custom::CDKBucketDeployment');
    const sourceCounts = Object.values<any>(deployments).map((d) => d.Properties.SourceBucketNames.length);
    expect(sourceCounts.sort()).toEqual([1, 2]);
  });
});
