import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HttpRouteGroup } from '../lib/constructs/route-group';
import { SITE_EXCLUDE, StaticSite, isExcludedSitePath } from '../lib/constructs/static-site';
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

  test('CSP: no data: images, Trusted Types required for script sinks', () => {
    const csp: string = Object.values<any>(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0]
      .Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    expect(csp).toContain("img-src 'self';");
    expect(csp).not.toContain('data:');
    expect(csp).toContain("require-trusted-types-for 'script'");
  });

  test('access logs go to a private, TLS-only, 90-day, retained per-site bucket (no cookies)', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    const [logId, logBucket] = Object.entries<any>(buckets).find(([, b]) => b.Properties.OwnershipControls)!;
    expect(logBucket.DeletionPolicy).toBe('Retain');
    expect(logBucket.Properties).toMatchObject({
      OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] },
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      LifecycleConfiguration: { Rules: [{ ExpirationInDays: 90, Status: 'Enabled' }] },
    });
    const policies = Object.values<any>(template.findResources('AWS::S3::BucketPolicy'));
    const logPolicy = policies.find((p) => p.Properties.Bucket.Ref === logId)!;
    expect(JSON.stringify(logPolicy)).toContain('aws:SecureTransport');
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Logging: { Bucket: { 'Fn::GetAtt': [logId, 'RegionalDomainName'] }, IncludeCookies: false, Prefix: 'cloudfront/' },
      }),
    });
  });

  test('dev junk is excluded from deployment (CDK asset globs) and from site paths, consistently', () => {
    const root = '/repo/sites/x';
    const strategy = cdk.IgnoreStrategy.glob(root, SITE_EXCLUDE);
    // Asset staging walks the tree and skips an ignored directory's whole
    // subtree, so a path is excluded if it or any ancestor is ignored.
    const glob = {
      ignores: (abs: string) =>
        abs.slice(root.length + 1).split('/').some((_, i, segs) => strategy.ignores(`${root}/${segs.slice(0, i + 1).join('/')}`)),
    };
    const junk = ['.env', '.DS_Store', 'js/.app.js.swp', 'app.js.swp', 'index.html~', 'config.example.json', '.git/config', 'a/.idea/x.xml'];
    const real = ['index.html', 'js/app.js', 'config.json', 'assets/logo.svg', 'styles.css', 'about/index.html'];
    for (const rel of junk) {
      expect({ rel, asset: glob.ignores(`${root}/${rel}`), walker: isExcludedSitePath(rel) }).toEqual({ rel, asset: true, walker: true });
    }
    for (const rel of real) {
      expect({ rel, asset: glob.ignores(`${root}/${rel}`), walker: isExcludedSitePath(rel) }).toEqual({ rel, asset: false, walker: false });
    }
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

describe('StaticSite branded 404', () => {
  const stack = new cdk.Stack(new cdk.App(), 'Site404', { env });
  const zone = route53.HostedZone.fromHostedZoneAttributes(stack, 'Zone', { hostedZoneId: 'Z1', zoneName: 'vettid.org' });
  new StaticSite(stack, 'S', {
    hostName: 'account.vettid.org',
    hostedZone: zone,
    sourceDir: 'test/fixtures/site',
    runtimeConfig: { a: 1 },
    notFoundPage: '404.html',
    wellKnown: { 'assetlinks.json': [{ a: 1 }] },
  });
  const t = Template.fromStack(stack);
  const code = Object.values<any>(t.findResources('AWS::CloudFront::Function'))[0].Properties.FunctionCode as string;
  // Run the real generated CloudFront Function.
  // eslint-disable-next-line no-new-func
  const handler = new Function(`${code}; return handler;`)() as (e: unknown) => any;
  const req = (uri: string) => handler({ request: { uri, headers: {}, querystring: {} } });

  test.each([
    ['/', '/index.html'],
    ['/about', '/about/index.html'],
    ['/about/', '/about/index.html'],
    ['/404.html', '/404.html'],
    ['/config.json', '/config.json'],
    ['/.well-known/assetlinks.json', '/.well-known/assetlinks.json'],
  ])('known path %s is rewritten to %s and passed to S3', (uri, expected) => {
    const r = req(uri);
    expect(r.statusCode).toBeUndefined();
    expect(r.uri).toBe(expected);
  });

  test.each(['/nope', '/nope/', '/assets/missing.css', '/About'])('unknown path %s gets the branded page with a real 404', (uri) => {
    const r = req(uri);
    expect(r.statusCode).toBe(404);
    expect(r.body.data).toContain('Nothing here.');
    expect(r.headers['content-security-policy'].value).toContain("script-src 'self'");
    expect(r.headers['x-frame-options'].value).toBe('DENY');
  });

  test('wellKnown documents are deployed under /.well-known/ in the revalidating pass', () => {
    const deps = Object.values<any>(t.findResources('Custom::CDKBucketDeployment')).map((r) => r.Properties);
    const html = deps.find((d) => JSON.stringify(d.Include ?? []).includes('*.json'));
    expect(html.SourceObjectKeys.length).toBe(3); // site, config.json, assetlinks.json
  });

  test('wellKnown names must be plain JSON file names', () => {
    const s2 = new cdk.Stack(new cdk.App(), 'Bad', { env });
    const z2 = route53.HostedZone.fromHostedZoneAttributes(s2, 'Zone', { hostedZoneId: 'Z1', zoneName: 'vettid.org' });
    expect(() => new StaticSite(s2, 'S', { hostName: 'x.vettid.org', hostedZone: z2, sourceDir: 'test/fixtures/site', wellKnown: { '../x.json': {} } })).toThrow(/plain/);
  });

  test('stays within the CloudFront Functions size limit', () => {
    expect(code.length).toBeLessThan(10 * 1024);
  });

  test('the /api/* behavior has no function, so API errors stay JSON', () => {
    const dist = Object.values<any>(t.findResources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    expect(dist.CustomErrorResponses).toBeUndefined();
  });
});

describe('StaticSite edge gate (requireCookie)', () => {
  const stack = new cdk.Stack(new cdk.App(), 'SiteGate', { env });
  const zone = route53.HostedZone.fromHostedZoneAttributes(stack, 'Zone', { hostedZoneId: 'Z1', zoneName: 'vettid.org' });
  new StaticSite(stack, 'S', {
    hostName: 'account.vettid.org',
    hostedZone: zone,
    sourceDir: 'test/fixtures/site',
    notFoundPage: '404.html',
    requireCookie: { pathPrefix: '/about/', cookie: 'vid_s', redirectTo: '/signin/' },
  });
  const code = Object.values<any>(Template.fromStack(stack).findResources('AWS::CloudFront::Function'))[0].Properties.FunctionCode as string;
  // eslint-disable-next-line no-new-func
  const handler = new Function(`${code}; return handler;`)() as (e: unknown) => any;
  const req = (uri: string, cookies: Record<string, unknown> = {}) => handler({ request: { uri, headers: {}, querystring: {}, cookies } });

  test.each(['/about', '/about/', '/about/index.html'])('signed-out %s is redirected before anything is served', (uri) => {
    const r = req(uri);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location.value).toBe('/signin/');
  });

  test('with the presence cookie the page is served', () => {
    expect(req('/about/', { vid_s: { value: '1' } }).uri).toBe('/about/index.html');
  });

  test('paths outside the prefix are unaffected', () => {
    expect(req('/').uri).toBe('/index.html');
  });
});
