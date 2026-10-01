import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../lib/config';
import { VettidOrgAuthStack } from '../lib/stacks/auth-stack';
import { VettidOrgDataStack } from '../lib/stacks/data-stack';
import { VettidOrgAdminAccessStack } from '../lib/stacks/admin-access-stack';

const env = { account: '123456789012', region: 'us-east-1' };
const newApp = () => new cdk.App({ context: { headscaleLoginServer: 'https://headscale.example.net' } });
const config = loadConfig(newApp().node);

describe('VettidOrgAuthStack', () => {
  const t = Template.fromStack(new VettidOrgAuthStack(newApp(), 'Auth', { config, env }));

  test('both pools are retained, deletion-protected, and closed to self sign-up', () => {
    const pools = t.findResources('AWS::Cognito::UserPool');
    expect(Object.keys(pools)).toHaveLength(2);
    for (const p of Object.values<any>(pools)) {
      expect(p.DeletionPolicy).toBe('Retain');
      expect(p.Properties.DeletionProtection).toBe('ACTIVE');
      expect(p.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly).toBe(true);
    }
  });

  test('member pool: Lite plan, user_guid attribute, registered + member groups', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'vettid-org-members',
      UserPoolTier: 'LITE',
      Schema: Match.arrayWith([Match.objectLike({ Name: 'user_guid', Mutable: false })]),
    });
    t.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'registered' });
    t.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'member' });
  });

  test('member client allows custom auth (magic link + PIN) only, nothing writable', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vettid-org-account-site',
      ExplicitAuthFlows: ['ALLOW_CUSTOM_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
      PreventUserExistenceErrors: 'ENABLED',
      WriteAttributes: [],
    });
  });

  test('admin pool requires TOTP MFA (no SMS) and strong passwords', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'vettid-org-admins',
      MfaConfiguration: 'ON',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 14, PasswordHistorySize: 5 }) },
    });
  });

  test('admin client: hosted-UI code flow to admin.vettid.org, no writable attributes', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vettid-org-admin-site',
      AllowedOAuthFlows: ['code'],
      CallbackURLs: ['https://admin.vettid.org/'],
      WriteAttributes: [],
    });
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'vettid-org-admin' });
  });

  test('PIN pepper is generated and retained', () => {
    t.hasResource('AWS::SecretsManager::Secret', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ Name: 'vettid-org-auth/pin-pepper' }),
    });
  });

  test('publishes refs to SSM, exports nothing', () => {
    t.resourceCountIs('AWS::SSM::Parameter', 8);
    expect(JSON.stringify(t.toJSON().Outputs ?? {})).not.toContain('Export');
  });
});

describe('VettidOrgDataStack', () => {
  const t = Template.fromStack(new VettidOrgDataStack(newApp(), 'Data', { config, env }));
  const tables = Object.values<any>(t.findResources('AWS::DynamoDB::GlobalTable'));

  test('creates the planned tables with fixed names', () => {
    expect(tables.map((x) => x.Properties.TableName).sort()).toEqual([
      'vettid-org-audit',
      'vettid-org-invites',
      'vettid-org-magic-links',
      'vettid-org-members',
      'vettid-org-ratelimits',
      'vettid-org-subscription-types',
      'vettid-org-subscriptions',
      'vettid-org-terms',
    ]);
  });

  test('every table is retained and deletion-protected', () => {
    for (const x of tables) {
      expect(x.DeletionPolicy).toBe('Retain');
      expect(x.Properties.Replicas[0].DeletionProtectionEnabled).toBe(true);
    }
  });

  test('members: email + state GSIs and a stream for lifecycle mail', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-members',
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'email-index' }),
        Match.objectLike({ IndexName: 'state-index' }),
      ]),
    });
  });

  test('magic links and rate limits expire via TTL', () => {
    for (const name of ['vettid-org-magic-links', 'vettid-org-ratelimits']) {
      t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
        TableName: name,
        TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
      });
    }
  });

  test('terms bucket is private, versioned, retained', () => {
    t.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ VersioningConfiguration: { Status: 'Enabled' } }),
    });
  });
});

describe('VettidOrgAdminAccessStack', () => {
  const t = Template.fromStack(new VettidOrgAdminAccessStack(newApp(), 'AdminAccess', { config, env }));

  test('exit node: t4g.nano, IMDSv2, encrypted disk, SSM-managed', () => {
    t.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.nano',
      BlockDeviceMappings: [Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }) })],
    });
    t.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: { MetadataOptions: { HttpTokens: 'required' } },
    });
    t.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: [Match.objectLike({ 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('AmazonSSMManagedInstanceCore')])]) })],
    });
  });

  test('only WireGuard is open inbound (no SSH)', () => {
    const sgs = Object.values<any>(t.findResources('AWS::EC2::SecurityGroup'));
    const ingress = sgs.flatMap((sg) => sg.Properties.SecurityGroupIngress ?? []);
    expect(ingress).toEqual([expect.objectContaining({ IpProtocol: 'udp', FromPort: 41641, ToPort: 41641 })]);
  });

  test('joins Headscale as exit node; key comes from Secrets Manager at boot', () => {
    const userData = JSON.stringify(t.findResources('AWS::EC2::Instance'));
    expect(userData).toContain('--login-server=https://headscale.example.net');
    expect(userData).toContain('--advertise-exit-node');
    expect(userData).toContain('--accept-dns=false'); // home DNS is unreachable from AWS
    expect(userData).toContain('/swapfile'); // dnf is OOM-killed on a nano without swap
    expect(userData).toContain('secretsmanager get-secret-value');
  });

  test('egress IP is retained', () => {
    t.hasResource('AWS::EC2::EIP', { DeletionPolicy: 'Retain' });
  });

  test('site web ACL blocks by default and allows only the egress IP set', () => {
    for (const scope of ['CLOUDFRONT']) {
      t.hasResourceProperties('AWS::WAFv2::WebACL', {
        Scope: scope,
        DefaultAction: { Block: {} },
        Rules: [Match.objectLike({ Action: { Allow: {} }, Statement: { IPSetReferenceStatement: Match.anyValue() } })],
      });
    }
  });

  test('no WAF on the admin user pool (hosted UI calls from Cognito IPs)', () => {
    t.resourceCountIs('AWS::WAFv2::WebACLAssociation', 0);
    t.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  test('refuses to synth without a Headscale login server', () => {
    const bare = new cdk.App();
    expect(() => new VettidOrgAdminAccessStack(bare, 'X', { config: loadConfig(bare.node), env })).toThrow(/headscaleLoginServer/);
  });
});

describe('VettidOrgAdminApiStack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VettidOrgAdminApiStack } = require('../lib/stacks/admin-api-stack');
  const t = Template.fromStack(new VettidOrgAdminApiStack(newApp(), 'AdminApi', { config, env }));

  test('REST API reachable only via its custom domain', () => {
    t.hasResourceProperties('AWS::ApiGateway::RestApi', { DisableExecuteApiEndpoint: true });
    t.hasResourceProperties('AWS::ApiGateway::DomainName', { DomainName: 'admin-api.vettid.org', SecurityPolicy: 'TLS_1_2' });
  });

  test('resource policy allows only the exit-node egress IP (from SSM)', () => {
    const api = Object.values<any>(t.findResources('AWS::ApiGateway::RestApi'))[0];
    const stmt = api.Properties.Policy.Statement;
    expect(stmt).toHaveLength(1);
    expect(stmt[0].Effect).toBe('Allow');
    expect(JSON.stringify(stmt[0].Condition)).toContain('aws:SourceIp');
    expect(JSON.stringify(t.toJSON().Parameters)).toContain('/vettid-org/prod/admin-access/egress-ip');
  });

  test('every non-OPTIONS method uses the Cognito authorizer', () => {
    const methods = Object.values<any>(t.findResources('AWS::ApiGateway::Method'));
    const real = methods.filter((m) => m.Properties.HttpMethod !== 'OPTIONS');
    expect(real.length).toBeGreaterThanOrEqual(16); // 8 prefixes × (prefix + proxy)
    for (const m of real) expect(m.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
  });

  test('three route-group Lambdas, Node 24 on ARM', () => {
    t.resourceCountIs('AWS::Lambda::Function', 3);
    t.allResourcesProperties('AWS::Lambda::Function', { Runtime: 'nodejs24.x', Architectures: ['arm64'] });
  });

  test('gateway-generated errors carry CORS so the UI can explain 401/403', () => {
    t.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'DEFAULT_4XX',
      ResponseParameters: Match.objectLike({ 'gatewayresponse.header.Access-Control-Allow-Origin': "'https://admin.vettid.org'" }),
    });
  });

  test('audit is append-only for writers (no Update/Delete on the audit table)', () => {
    const policies = JSON.stringify(t.findResources('AWS::IAM::Policy'));
    const auditStmts = Object.values<any>(t.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: any) => JSON.stringify(s.Resource).includes('table/vettid-org-audit'));
    expect(auditStmts.length).toBeGreaterThan(0);
    for (const s of auditStmts) {
      for (const a of [].concat(s.Action)) expect(['dynamodb:PutItem', 'dynamodb:Query']).toContain(a);
    }
    expect(policies).not.toContain('dynamodb:*');
  });
});

describe('VettidOrgAdminSiteStack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VettidOrgAdminSiteStack } = require('../lib/stacks/admin-site-stack');
  const t = Template.fromStack(new VettidOrgAdminSiteStack(newApp(), 'AdminSite', { config, env }));

  test('admin.vettid.org distribution sits behind the exit-node web ACL', () => {
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['admin.vettid.org'],
        WebACLId: Match.objectLike({ Ref: Match.stringLikeRegexp('SsmParameterValue.*adminaccess.*sitewebaclarn') }),
      }),
    });
  });

  test('CSP permits only self, the admin API, the admin login, and S3 uploads', () => {
    const csp = JSON.stringify(t.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
    expect(csp).toContain("connect-src 'self' https://admin-api.vettid.org https://vettid-org-admin.auth.us-east-1.amazoncognito.com");
    expect(csp).toContain("script-src 'self'");
  });
});
