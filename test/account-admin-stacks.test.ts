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

  test('member client allows custom auth (magic link + PIN) only, no OAuth, nothing meaningful writable', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vettid-org-account-site',
      ExplicitAuthFlows: ['ALLOW_CUSTOM_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
      PreventUserExistenceErrors: 'ENABLED',
      // Empty would mean "all standard attributes writable" to Cognito.
      WriteAttributes: ['email'],
      AllowedOAuthFlows: Match.absent(),
      CallbackURLs: Match.absent(),
    });
  });

  test('member pool keeps the original email until a change is verified', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'vettid-org-members',
      AutoVerifiedAttributes: ['email'],
      UserAttributeUpdateSettings: { AttributesRequireVerificationBeforeUpdate: ['email'] },
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
      WriteAttributes: ['email'], // immutable on the admin pool
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
      'vettid-org-vault-instances',
      'vettid-org-vault-releases',
      'vettid-org-vault-requests',
      'vettid-org-vaults',
    ]);
  });

  test('vault tables: routing indexes; ephemeral ones expire via TTL; the vault table is point-in-time recoverable', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vaults',
      KeySchema: [{ AttributeName: 'vault_id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'user-index' })],
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })],
    });
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vault-instances',
      KeySchema: [{ AttributeName: 'instance_id', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: 'release-index',
          KeySchema: [{ AttributeName: 'release', KeyType: 'HASH' }, { AttributeName: 'heartbeat_at', KeyType: 'RANGE' }],
          Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['load'] },
        }),
      ],
    });
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vault-requests',
      KeySchema: [{ AttributeName: 'request_id', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
    });
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vault-releases',
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'status-index' })],
    });
  });

  test('vault table names and the control-queue prefix are published for the enclave host', () => {
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/data/vault-control-queue-prefix', Value: 'vettid-org-vault-control-' });
    for (const k of ['vaults', 'vault-instances', 'vault-requests', 'vault-releases']) {
      t.hasResourceProperties('AWS::SSM::Parameter', { Name: `/vettid-org/prod/data/${k}-table-name` });
    }
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

  test('exit node: t4g.nano, IMDSv2 with hop limit 1, encrypted disk, SSM-managed', () => {
    t.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.nano',
      BlockDeviceMappings: [Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }) })],
      MetadataOptions: { HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
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

  test('never forwards to link-local / IMDS (persistent nftables drop, before forwarding is on)', () => {
    const userData: string = Object.values<any>(t.findResources('AWS::EC2::Instance'))[0].Properties.UserData['Fn::Base64'];
    expect(userData).toContain('type filter hook forward priority -10; policy accept;');
    expect(userData).toContain('ip daddr 169.254.0.0/16 drop');
    expect(userData).toContain('systemctl enable --now vettid-linklocal-drop.service');
    expect(userData).toContain("'WantedBy=multi-user.target'");
    expect(userData.indexOf('vettid-linklocal-drop.service\n')).toBeLessThan(userData.indexOf('net.ipv4.ip_forward'));
  });

  test('SSM session transcripts: 90-day log group the instance role can write', () => {
    t.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      Properties: { LogGroupName: '/vettid-org/ssm-sessions', RetentionInDays: 90 },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('^SsmSessionLogs'), 'Arn'] },
          }),
        ]),
      },
    });
  });

  test('admin site WAF logs to CloudWatch with cookie/authorization redacted', () => {
    t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: 'aws-waf-logs-vettid-org-admin', RetentionInDays: 90 });
    t.hasResourceProperties('AWS::WAFv2::LoggingConfiguration', {
      ResourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^SiteAcl'), 'Arn'] },
      RedactedFields: [{ SingleHeader: { Name: 'cookie' } }, { SingleHeader: { Name: 'authorization' } }],
    });
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
    t.hasResourceProperties('AWS::ApiGateway::DomainName', { DomainName: 'admin-api.vettid.org', SecurityPolicy: 'SecurityPolicy_TLS13_1_2_PFS_PQ_2025_09', EndpointAccessMode: 'STRICT' });
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

  test('content Lambda can do everything its terms routes need', () => {
    const stmts = Object.values<any>(t.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: any) => JSON.stringify(s.Resource).includes('table/vettid-org-terms'));
    const actions = stmts.flatMap((s: any) => [].concat(s.Action));
    for (const a of ['Scan', 'GetItem', 'PutItem', 'Query', 'UpdateItem', 'DeleteItem']) expect(actions).toContain(`dynamodb:${a}`);
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

  test('CSP permits only self, the admin API and the admin login', () => {
    const csp = JSON.stringify(t.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
    expect(csp).toContain("connect-src 'self' https://admin-api.vettid.org https://vettid-org-admin.auth.us-east-1.amazoncognito.com;");
    expect(csp).toContain("script-src 'self'");
  });
});

describe('VettidOrgAuthStack member triggers', () => {
  const t = Template.fromStack(new VettidOrgAuthStack(newApp(), 'Auth2', { config, env }));

  test('member pool wires all three custom-auth triggers', () => {
    const pool = Object.values<any>(t.findResources('AWS::Cognito::UserPool')).find((p) => p.Properties.UserPoolName === 'vettid-org-members');
    expect(Object.keys(pool.Properties.LambdaConfig).sort()).toEqual(['CreateAuthChallenge', 'DefineAuthChallenge', 'VerifyAuthChallengeResponse']);
  });

  test('member client allows a 5-minute window for the PIN step', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', { ClientName: 'vettid-org-account-site', AuthSessionValidity: 5 });
  });
});

describe('VettidOrgMemberApiStack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VettidOrgMemberApiStack } = require('../lib/stacks/member-api-stack');
  const t = Template.fromStack(new VettidOrgMemberApiStack(newApp(), 'MemberApi', { config, env }));

  test('four route groups + link mailer + three jobs', () => {
    t.resourceCountIs('AWS::Lambda::Function', 8);
    for (const p of ['/api/public', '/api/auth', '/api/account', '/api/vault']) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: `ANY ${p}/{proxy+}` });
    }
  });

  test('jobs are scheduled and the mailer reads the members stream', () => {
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' });
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 7 * * ? *)' });
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', { StartingPosition: 'LATEST', BisectBatchOnFunctionError: true });
  });

  test('no wildcard DynamoDB access; audit is append-only', () => {
    const stmts = Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
    expect(JSON.stringify(stmts)).not.toContain('dynamodb:*');
    for (const s of stmts.filter((x: any) => JSON.stringify(x.Resource).includes('table/vettid-org-audit'))) {
      expect([].concat(s.Action)).toEqual(['dynamodb:PutItem']);
    }
  });

  test('functions that may delete SES identities are denied the vettid.org domain identity', () => {
    const stmts = Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const deletes = stmts.filter((s: any) => ([] as string[]).concat(s.Action).includes('ses:DeleteEmailIdentity'));
    expect(deletes.some((s: any) => s.Effect === 'Allow')).toBe(true);
    expect(deletes.some((s: any) => s.Effect === 'Deny' && JSON.stringify(s.Resource).includes('identity/vettid.org'))).toBe(true);
  });

  describe('vault route group', () => {
    const stmts = () => Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const str = (x: unknown) => JSON.stringify(x);

    test('sqs:SendMessage only to vettid-org-vault-control-* queues, and nothing else on SQS', () => {
      const sqsStmts = stmts().filter((s: any) => str(s.Action).includes('sqs:'));
      expect(sqsStmts).toHaveLength(1);
      expect(sqsStmts[0].Action).toBe('sqs:SendMessage');
      expect(str(sqsStmts[0].Resource)).toContain(':vettid-org-vault-control-*');
    });

    test("vault and release writes are limited to the API's own attributes (never lease, sealed_release or status)", () => {
      const writes = stmts().filter(
        (s: any) => /dynamodb:(PutItem|UpdateItem)/.test(str(s.Action)) && /table\/vettid-org-(vaults|vault-releases)"/.test(str(s.Resource)),
      );
      expect(writes).toHaveLength(2);
      for (const w of writes) {
        const attrs: string[] = w.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'];
        for (const f of ['lease', 'sealed_release', 'vault_version', 'state_version', 'status', 'available']) expect(attrs).not.toContain(f);
      }
      // The instance registry is read-only to the API.
      const instanceWrites = stmts().filter((s: any) => str(s.Resource).includes('vettid-org-vault-instances') && /Put|Update|Delete/.test(str(s.Action)));
      expect(instanceWrites).toHaveLength(0);
    });

    test('the queue URL prefix is pinned to this account and region', () => {
      const fns = Object.values<any>(t.findResources('AWS::Lambda::Function'));
      const v = fns.find((f) => f.Properties.Environment?.Variables?.VAULT_QUEUE_URL_PREFIX);
      expect(str(v.Properties.Environment.Variables.VAULT_QUEUE_URL_PREFIX)).toContain('https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-');
    });
  });

  test('access log records request metadata only', () => {
    const stage = Object.values<any>(t.findResources('AWS::ApiGatewayV2::Stage'))[0];
    const fmt = stage.Properties.AccessLogSettings.Format as string;
    expect(fmt).toContain('$context.requestId');
    expect(fmt.toLowerCase()).not.toMatch(/cookie|header|body/);
  });

  test('origin-verify secret is generated, and published API domain feeds the site', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'vettid-org-member-api/origin-verify' });
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/member-api/domain' });
  });
});

describe('VettidOrgAccountSiteStack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VettidOrgAccountSiteStack } = require('../lib/stacks/account-site-stack');
  const t = Template.fromStack(new VettidOrgAccountSiteStack(newApp(), 'AccountSite', { config, env }));

  test('/api/* goes to the member API with the origin-verify header, uncached', () => {
    const dist = Object.values<any>(t.findResources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    expect(dist.Aliases).toEqual(['account.vettid.org']);
    const api = dist.CacheBehaviors.find((b: any) => b.PathPattern === '/api/*');
    expect(api.ViewerProtocolPolicy).toBe('https-only');
    const origin = dist.Origins.find((o: any) => o.Id === api.TargetOriginId);
    expect(JSON.stringify(origin.OriginCustomHeaders)).toContain('X-Origin-Verify');
    expect(JSON.stringify(origin.OriginCustomHeaders)).toContain('resolve:secretsmanager:vettid-org-member-api/origin-verify');
  });

  test('API origin requests forward cookies, CSRF header and viewer address only', () => {
    t.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        CookiesConfig: { CookieBehavior: 'all' },
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Content-Type', 'X-VettID-CSRF', 'CloudFront-Viewer-Address'] },
      }),
    });
  });

  test('CSP: same-origin only', () => {
    const csp = JSON.stringify(t.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("script-src 'self'");
  });

  test('distribution sits behind its own CLOUDFRONT web ACL (default allow)', () => {
    t.hasResourceProperties('AWS::WAFv2::WebACL', { Name: 'vettid-org-account', Scope: 'CLOUDFRONT', DefaultAction: { Allow: {} } });
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ WebACLId: { 'Fn::GetAtt': [Match.stringLikeRegexp('^WebAcl'), 'Arn'] } }),
    });
  });

  test('per-IP rate limits: 30/5min on /api/public + /api/auth, 300/5min on all /api; IP reputation counts', () => {
    const acl = Object.values<any>(t.findResources('AWS::WAFv2::WebACL'))[0].Properties;
    const rule = (name: string) => acl.Rules.find((r: any) => r.Name === name);
    const prefixes = (stmt: any): string[] =>
      stmt.OrStatement ? stmt.OrStatement.Statements.flatMap(prefixes) : [stmt.ByteMatchStatement.SearchString];

    const auth = rule('rate-limit-auth');
    expect(auth.Action).toEqual({ Block: { CustomResponse: { ResponseCode: 429 } } });
    expect(auth.Statement.RateBasedStatement).toMatchObject({ Limit: 30, AggregateKeyType: 'IP', EvaluationWindowSec: 300 });
    expect(prefixes(auth.Statement.RateBasedStatement.ScopeDownStatement)).toEqual(['/api/public/', '/api/auth/']);

    const api = rule('rate-limit-api');
    expect(api.Statement.RateBasedStatement).toMatchObject({ Limit: 300, AggregateKeyType: 'IP', EvaluationWindowSec: 300 });
    expect(prefixes(api.Statement.RateBasedStatement.ScopeDownStatement)).toEqual(['/api/']);

    const rep = rule('aws-ip-reputation');
    expect(rep.OverrideAction).toEqual({ Count: {} });
    expect(rep.Statement.ManagedRuleGroupStatement.Name).toBe('AWSManagedRulesAmazonIpReputationList');
  });

  test('WAF logs to CloudWatch (90 days) with cookie/authorization redacted', () => {
    t.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      Properties: { LogGroupName: 'aws-waf-logs-vettid-org-account', RetentionInDays: 90 },
    });
    t.hasResourceProperties('AWS::WAFv2::LoggingConfiguration', {
      RedactedFields: [{ SingleHeader: { Name: 'cookie' } }, { SingleHeader: { Name: 'authorization' } }],
    });
  });
});
