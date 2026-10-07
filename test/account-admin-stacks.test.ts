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
    ]);
  });

  test('the vault tables and their refs moved to the vault account (VettidOrgVaultStack, VAULT-RELEASES §8.1)', () => {
    expect(JSON.stringify(t.toJSON())).not.toMatch(/vettid-org-vault|data\/vault/);
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

  test('people may invoke the member API account push, by its fixed name (MEMBER-API 2.0.0)', () => {
    const all = Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const inv = all.filter((x: any) => JSON.stringify(x.Action).includes('lambda:InvokeFunction'));
    expect(inv).toHaveLength(1);
    expect(JSON.stringify(inv[0].Resource)).toContain(':function:vettid-org-member-account-push');
    const fns = Object.values<any>(t.findResources('AWS::Lambda::Function')).filter((f) => f.Properties.Environment?.Variables?.ACCOUNT_PUSH_FN);
    expect(fns.map((f) => f.Properties.Environment.Variables.ACCOUNT_PUSH_FN)).toEqual(['vettid-org-member-account-push']);
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
    expect(real.length).toBeGreaterThanOrEqual(18); // 9 prefixes × (prefix + proxy)
    for (const m of real) expect(m.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
  });

  test('five route-group Lambdas, Node 24 on ARM', () => {
    t.resourceCountIs('AWS::Lambda::Function', 5);
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

  test('vault-canary Lambda may write only the vault_canary flag on a member row', () => {
    const fns = t.findResources('AWS::Lambda::Function');
    const roleId = Object.entries<any>(fns).find(([id]) => id.startsWith('VaultCanary'))![1].Properties.Role['Fn::GetAtt'][0];
    const stmts = Object.values<any>(t.findResources('AWS::IAM::Policy'))
      .filter((p) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
      .flatMap((p) => p.Properties.PolicyDocument.Statement);
    const members = stmts.filter((s: any) => JSON.stringify(s.Resource).includes('table/vettid-org-members'));
    const actions = members.flatMap((s: any) => [].concat(s.Action)).sort();
    expect(actions).toEqual(['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:UpdateItem']);
    const update = members.find((s: any) => [].concat(s.Action).includes('dynamodb:UpdateItem' as never));
    expect([].concat(update.Action)).toEqual(['dynamodb:UpdateItem']);
    expect(update.Condition).toEqual({
      'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['user_guid', 'vault_canary', 'updated_at'] },
      StringEqualsIfExists: { 'dynamodb:ReturnValues': ['NONE', 'UPDATED_OLD', 'UPDATED_NEW'] },
    });
    // nothing else on the members table, its indexes, or any other data table but audit (PutItem)
    expect(JSON.stringify(members.map((s: any) => s.Resource))).not.toContain('/index/');
    const writes = stmts.flatMap((s: any) => [].concat(s.Action)).filter((a: string) => a.startsWith('dynamodb:'));
    expect(writes.sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:UpdateItem']);
  });

  test('vault-service Lambda: get and put the one switch parameter; no other function touches SSM', () => {
    const fns = t.findResources('AWS::Lambda::Function');
    const [fnId, fn] = Object.entries<any>(fns).find(([id]) => id.startsWith('VaultService'))!;
    expect(fn.Properties.Environment.Variables.VAULT_SERVICE_PARAM).toBe('/vettid-org/prod/switch/vault-service');
    const roleId = fns[fnId].Properties.Role['Fn::GetAtt'][0];
    const policies = Object.values<any>(t.findResources('AWS::IAM::Policy'));
    const own = policies.filter((p) => p.Properties.Roles.some((r: any) => r.Ref === roleId)).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const ssm = own.filter((s: any) => JSON.stringify(s.Action).includes('ssm:'));
    expect(ssm).toHaveLength(1);
    expect(ssm[0].Action).toEqual(['ssm:GetParameter', 'ssm:PutParameter']);
    expect(JSON.stringify(ssm[0].Resource)).toContain(':parameter/vettid-org/prod/switch/vault-service"');
    // Its data rights: the audit table (append) only.
    const ddb = own.flatMap((s: any) => [].concat(s.Action)).filter((a: string) => a.startsWith('dynamodb:'));
    expect(ddb).toEqual(['dynamodb:PutItem']);
    const others = policies.filter((p) => !p.Properties.Roles.some((r: any) => r.Ref === roleId)).flatMap((p) => p.Properties.PolicyDocument.Statement);
    expect(JSON.stringify(others.map((s: any) => s.Action))).not.toContain('ssm:');
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
  // The vaults stream (vault account) is context, set after VettidOrgVaultStack deploys.
  const apiApp = new cdk.App({ context: { vaultsStreamArn: 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults/stream/2026-10-05T00:00:00.000' } });
  const t = Template.fromStack(new VettidOrgMemberApiStack(apiApp, 'MemberApi', { config: loadConfig(apiApp.node), env }));

  test('four route groups + link mailer + eight jobs (incl. the vault notice job, W8, the vault service watch, the account push, 2.0.0, and the vault-names job, 2.2.0)', () => {
    t.resourceCountIs('AWS::Lambda::Function', 13);
    for (const p of ['/api/public', '/api/auth', '/api/account', '/api/vault']) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: `ANY ${p}/{proxy+}` });
    }
  });

  test('jobs are scheduled and the mailer reads the members stream', () => {
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' });
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 7 * * ? *)' });
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 15 * * ? *)' }); // vault release notices
    // 2.1.0: the cleanup job's start-over run, every 5 minutes
    t.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(5 minutes)',
      Targets: [Match.objectLike({ Input: JSON.stringify({ task: 'start_over' }) })],
    });
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
      expect(sqsStmts).toHaveLength(3); // the vault routes, the cleanup job's vault deletions (§12.5), the account push (2.0.0)
      for (const q of sqsStmts) {
        expect(q.Action).toBe('sqs:SendMessage');
        expect(str(q.Resource)).toContain(':369484479783:vettid-org-vault-control-*'); // the vault account
      }
    });

    test("vault and release writes are limited to the API's own attributes (never lease, sealed_release or status)", () => {
      const writes = stmts().filter(
        (s: any) => /dynamodb:(PutItem|UpdateItem)/.test(str(s.Action)) && /table\/vettid-org-(vaults|vault-releases)"/.test(str(s.Resource)),
      );
      expect(writes).toHaveLength(6); // the API's two, the alarm mailer's, the cleanup job's deletion mark and start request, the vault-names job's (2.2.0)
      for (const w of writes) {
        const attrs: string[] = w.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'];
        for (const f of ['lease', 'sealed_release', 'vault_version', 'state_version', 'status', 'available']) expect(attrs).not.toContain(f);
      }
      // The instance registry is read-only to the API.
      const instanceWrites = stmts().filter((s: any) => str(s.Resource).includes('vettid-org-vault-instances') && /Put|Update|Delete/.test(str(s.Action)));
      expect(instanceWrites).toHaveLength(0);
    });

    test('the alarm mailer: only the vaults stream records with alarm_pending, and may only clear the alarm flag', () => {
      t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        StartingPosition: 'LATEST',
        FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ['MODIFY'], dynamodb: { NewImage: { alarm_pending: { BOOL: [true] } } } }) }] },
      });
      const alarmWrites = stmts().filter(
        (s: any) => str(s.Action) === '"dynamodb:UpdateItem"' && str(s.Resource).includes('table/vettid-org-vaults"') && str(s.Condition).includes('alarm_pending'),
      );
      expect(alarmWrites).toHaveLength(1);
      expect(alarmWrites[0].Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(['vault_id', 'alarm', 'alarm_pending']);
      // The API itself never writes alarm fields.
      const apiWrites = stmts().filter((s: any) => /PutItem/.test(str(s.Action)) && str(s.Resource).includes('table/vettid-org-vaults"'));
      for (const w of apiWrites) expect(str(w.Condition)).not.toContain('alarm');
    });

    test('2.2.0: the vault-names job reads only name_change_pending records; may only clear the flag and write the result, and on the member row only the names', () => {
      t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        StartingPosition: 'LATEST',
        BisectBatchOnFunctionError: true,
        FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ['MODIFY'], dynamodb: { NewImage: { name_change_pending: { BOOL: [true] } } } }) }] },
      });
      const fn = Object.entries<any>(t.findResources('AWS::Lambda::Function')).find(([id]) => id.startsWith('VaultNamesJob'))!;
      expect(fn[1].Properties.Environment.Variables.ACCOUNT_PUSH_FN).toBeDefined();
      const roles = Object.values<any>(t.findResources('AWS::IAM::Role'));
      expect(roles.map((r) => r.Properties.RoleName)).toContain('vettid-org-member-vault-names');
      const policy = Object.values<any>(t.findResources('AWS::IAM::Policy')).find((p) => str(p.Properties.Roles).includes('VaultNamesJob'))!;
      const own = policy.Properties.PolicyDocument.Statement;
      const vaultWrites = own.filter((s: any) => str(s.Action).includes('UpdateItem') && str(s.Resource).includes('table/vettid-org-vaults"'));
      expect(vaultWrites).toHaveLength(1);
      expect(vaultWrites[0].Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(['vault_id', 'name_change', 'name_change_pending', 'name_change_result']);
      const memberWrites = own.filter((s: any) => str(s.Action).includes('UpdateItem') && str(s.Resource).includes('table/vettid-org-members'));
      expect(memberWrites).toHaveLength(1);
      expect(memberWrites[0].Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(['user_guid', 'first_name', 'last_name', 'name_changed_at', 'name_change_applied', 'updated_at']);
      // Nothing else: no queue sends (account-push sends), no deletes, no other table writes.
      expect(str(own)).not.toContain('sqs:');
      expect(own.filter((s: any) => /PutItem|DeleteItem/.test(str(s.Action)) && /vettid-org-(members|vaults)/.test(str(s.Resource)))).toEqual([]);
      expect(own.some((s: any) => str(s.Action).includes('lambda:InvokeFunction'))).toBe(true);
      expect(own.some((s: any) => str(s.Action).includes('ses:SendEmail'))).toBe(true);
    });

    test('vault rows are deleted only by the cleanup job and the deletion notice (§12.5)', () => {
      const deletes = stmts().filter((s: any) => str(s.Action).includes('dynamodb:DeleteItem') && str(s.Resource).includes('table/vettid-org-vaults'));
      expect(deletes).toHaveLength(2);
      const actions = deletes.map((d: any) => ([] as string[]).concat(d.Action).sort().join(',')).sort();
      expect(actions).toEqual(['dynamodb:DeleteItem', 'dynamodb:DeleteItem,dynamodb:Query,dynamodb:Scan']);
      // The cleanup job may only mark a deletion requested.
      const mark = stmts().filter((s: any) => String(str(s.Condition)).includes('deletion_requested_at'));
      expect(mark).toHaveLength(1);
      expect(mark[0].Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(['vault_id', 'deletion_requested_at', 'deletion']);
    });

    test('the queue URL prefix is pinned to the vault account and region', () => {
      const fns = Object.values<any>(t.findResources('AWS::Lambda::Function'));
      const vs = fns.filter((f) => f.Properties.Environment?.Variables?.VAULT_QUEUE_URL_PREFIX);
      expect(vs).toHaveLength(3); // the vault routes, the cleanup job and the account push
      for (const v of vs) {
        expect(str(v.Properties.Environment.Variables.VAULT_QUEUE_URL_PREFIX)).toContain('https://sqs.us-east-1.amazonaws.com/369484479783/vettid-org-vault-control-');
      }
    });
  });

  describe('MEMBER-API 2.0.0: setup codes, app keys, the account push', () => {
    const fns = () => Object.entries<any>(t.findResources('AWS::Lambda::Function'));
    const fnOf = (prefix: string) => fns().find(([id]) => id.startsWith(prefix))![1];
    const stmtsOf = (prefix: string) => {
      const roleId = fnOf(prefix).Properties.Role['Fn::GetAtt'][0];
      return Object.values<any>(t.findResources('AWS::IAM::Policy'))
        .filter((p) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
        .flatMap((p) => p.Properties.PolicyDocument.Statement);
    };
    const str = (v: unknown) => JSON.stringify(v);

    test('only the vault routes read k_code, by name (an SSM SecureString nobody here can write)', () => {
      const all = Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
      const keyStmts = all.filter((x: any) => str(x.Resource).includes('enroll-code-key'));
      expect(keyStmts).toHaveLength(1);
      expect(keyStmts[0].Action).toBe('ssm:GetParameter');
      expect(str(keyStmts[0].Resource)).toContain(':parameter/vettid-org/prod/member/enroll-code-key"');
      expect(stmtsOf('VaultFunction')).toContainEqual(keyStmts[0]);
      expect(fnOf('VaultFunction').Properties.Environment.Variables.ENROLL_CODE_KEY_PARAM).toBe('/vettid-org/prod/member/enroll-code-key');
      expect(all.some((x: any) => str(x.Action).includes('ssm:Put'))).toBe(false);
    });

    test('the vault routes: members by email (typed codes), subscriptions (the snapshot), no legacy sessions in production', () => {
      const own = stmtsOf('VaultFunction');
      expect(own.some((x: any) => str(x.Action).includes('dynamodb:Query') && str(x.Resource).includes('vettid-org-members/index/*'))).toBe(true);
      expect(own.some((x: any) => str(x.Action).includes('dynamodb:GetItem') && str(x.Resource).includes('vettid-org-subscriptions'))).toBe(true);
      expect(fnOf('VaultFunction').Properties.Environment.Variables.VAULT_LEGACY_SESSION_AUTH).toBeUndefined();
    });

    test('the account push: fixed names, the vault grants of its own matrix entry, invoked by the account routes', () => {
      const push = fnOf('VaultAccountPush');
      expect(push.Properties.FunctionName).toBe('vettid-org-member-account-push');
      t.hasResourceProperties('AWS::IAM::Role', { RoleName: 'vettid-org-member-account-push' });
      const own = stmtsOf('VaultAccountPush');
      const vault = own.filter((x: any) => str(x.Resource).includes('369484479783'));
      expect(vault.map((x: any) => [x.Action, x.Resource])).toEqual([
        ['dynamodb:GetItem', 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults'],
        ['dynamodb:GetItem', 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vault-instances'],
        ['dynamodb:PutItem', 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vault-requests'],
        ['sqs:SendMessage', 'arn:aws:sqs:us-east-1:369484479783:vettid-org-vault-control-*'],
      ]);
      expect(own.some((x: any) => str(x.Action).includes('UpdateItem'))).toBe(false);
      expect(str(fnOf('AccountFunction').Properties.Environment.Variables.ACCOUNT_PUSH_FN)).toContain('VaultAccountPush');
      expect(stmtsOf('AccountFunction').some((x: any) => str(x.Action).includes('lambda:InvokeFunction'))).toBe(true);
    });

    test('alarm MemberEnrollTypedCeiling on the EMF metric the vault routes write', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'vettid-org-member-enroll-typed-ceiling',
        Namespace: 'VettID/MemberApi',
        MetricName: 'EnrollTypedCeiling',
        Statistic: 'Sum',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        TreatMissingData: 'notBreaching',
      });
    });

    test('the legacy session switch is staging-only: refused in production, set in staging when asked', () => {
      expect(() => loadConfig(new cdk.App({ context: { prodVaultLegacySessionAuth: true } }).node)).toThrow(/staging-only/);
      expect(() => loadConfig(new cdk.App({ context: { vaultLegacySessionAuth: true } }).node)).toThrow(/staging-only/);
      const staging = loadConfig(new cdk.App({ context: { stage: 'staging', stagingVaultLegacySessionAuth: true } }).node);
      expect(staging.vaultLegacySessionAuth).toBe(true);
      expect(loadConfig(new cdk.App({ context: { stage: 'staging' } }).node).vaultLegacySessionAuth).toBeUndefined();
    });
  });

  describe('vault service switch (MEMBER-API "Vault service pause")', () => {
    const PARAM_ARN = ':parameter/vettid-org/prod/switch/vault-service"';
    const fns = () => Object.entries<any>(t.findResources('AWS::Lambda::Function'));
    const roleOf = (prefix: string) => fns().find(([id]) => id.startsWith(prefix))![1].Properties.Role['Fn::GetAtt'][0];
    const stmtsOf = (roleId: string) =>
      Object.values<any>(t.findResources('AWS::IAM::Policy'))
        .filter((p) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
        .flatMap((p) => p.Properties.PolicyDocument.Statement);

    test('read-only: ssm:GetParameter on the one parameter, for the vault routes, the cleanup job and the watch; nobody here may write it', () => {
      const all = Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
      // (The vault routes also read the setup codes' key, MEMBER-API 2.0.0: below.)
      const ssm = all.filter((s: any) => JSON.stringify(s.Action).includes('ssm:') && !JSON.stringify(s.Resource).includes('enroll-code-key'));
      expect(ssm).toHaveLength(3);
      for (const s of ssm) {
        expect(s.Action).toBe('ssm:GetParameter');
        expect(JSON.stringify(s.Resource)).toContain(PARAM_ARN);
      }
      for (const prefix of ['VaultFunction', 'CleanupJob', 'VaultServiceWatch']) {
        const own = stmtsOf(roleOf(prefix)).filter((s: any) => JSON.stringify(s.Resource).includes(PARAM_ARN));
        expect({ prefix, n: own.length }).toEqual({ prefix, n: 1 });
      }
      const withEnv = fns().filter(([, f]) => f.Properties.Environment?.Variables?.VAULT_SERVICE_PARAM).map(([id]) => id.replace(/[0-9A-F]{8}$/, ''));
      expect(withEnv.sort()).toEqual(['CleanupJobFn', 'VaultFunctionFn', 'VaultServiceWatchFn']);
    });

    test('the watch: every 5 minutes, no rights but the read (the metric is EMF, no PutMetricData)', () => {
      t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(5 minutes)' });
      const own = stmtsOf(roleOf('VaultServiceWatch'));
      expect(own.map((s: any) => s.Action)).toEqual(['ssm:GetParameter']);
    });

    test('alarms: paused (5 min) and paused for 24 h, on VettID/MemberApi VaultServicePaused; no recipient outside the management account', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'vettid-org-vault-service-paused', Namespace: 'VettID/MemberApi', MetricName: 'VaultServicePaused',
        Statistic: 'Maximum', Period: 300, EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching',
      });
      t.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'vettid-org-vault-service-paused-24h', Period: 3600, EvaluationPeriods: 24, DatapointsToAlarm: 24 });
      for (const a of Object.values<any>(t.findResources('AWS::CloudWatch::Alarm'))) expect(a.Properties.AlarmActions).toBeUndefined();
    });

    test('a silent watch alarms: no VaultServicePaused sample for 20 minutes (missing data breaches)', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'vettid-org-vault-service-watch-silent', Namespace: 'VettID/MemberApi', MetricName: 'VaultServicePaused',
        Statistic: 'SampleCount', Period: 300, EvaluationPeriods: 4, DatapointsToAlarm: 4, Threshold: 1,
        ComparisonOperator: 'LessThanThreshold', TreatMissingData: 'breaching',
      });
    });

    test('in production (the management account) all three alarm to the security-alerts topic; the paused and silent-watch alarms also say when they end', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ORG } = require('../lib/config');
      const prodApp = new cdk.App({ context: { vaultsStreamArn: 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults/stream/2026-10-05T00:00:00.000' } });
      const p = Template.fromStack(new VettidOrgMemberApiStack(prodApp, 'MemberApiProd', { config: loadConfig(prodApp.node), env: { account: ORG.management, region: 'us-east-1' } }));
      const topic = `:sns:us-east-1:${ORG.management}:vettid-org-security-alerts`;
      const alarms = Object.values<any>(p.findResources('AWS::CloudWatch::Alarm')).filter((a) => String(a.Properties.AlarmName).startsWith('vettid-org-vault-service-'));
      expect(alarms.map((a) => a.Properties.AlarmName).sort()).toEqual([
        'vettid-org-vault-service-paused', 'vettid-org-vault-service-paused-24h', 'vettid-org-vault-service-watch-silent',
      ]);
      for (const a of alarms) expect(JSON.stringify(a.Properties.AlarmActions)).toContain(topic);
      const first = alarms.find((a) => a.Properties.AlarmName === 'vettid-org-vault-service-paused');
      expect(JSON.stringify(first.Properties.OKActions)).toContain(topic);
      expect(alarms.find((a) => a.Properties.AlarmName.endsWith('-24h')).Properties.OKActions).toBeUndefined();
      const silent = alarms.find((a) => a.Properties.AlarmName.endsWith('-watch-silent'));
      expect(JSON.stringify(silent.Properties.OKActions)).toContain(topic);
    });

    test('no deploy creates or changes the parameter', () => {
      const params = Object.values<any>(t.findResources('AWS::SSM::Parameter'));
      expect(JSON.stringify(params)).not.toContain('switch/vault-service');
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
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Content-Type', 'X-VettID-CSRF', 'X-VettID-App', 'CloudFront-Viewer-Address'] },
      }),
    });
  });

  test('publishes the Android App Links statement for the release signing keys', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { androidAssetLinks } = require('../lib/config');
    const links = androidAssetLinks();
    expect(links).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.vettid.app',
        sha256_cert_fingerprints: ['31:A1:96:13:AA:10:F2:09:E0:89:45:F9:47:F9:4F:7C:E3:E6:E5:AC:34:24:57:FF:99:69:A6:79:86:92:8E:65'],
      },
    }]);
    const code = JSON.stringify(t.findResources('AWS::CloudFront::Function'));
    expect(code).toContain('/.well-known/assetlinks.json');
  });

  describe('edge function with the real site tree', () => {
    const code = Object.values<any>(t.findResources('AWS::CloudFront::Function'))[0].Properties.FunctionCode as string;
    // eslint-disable-next-line no-new-func
    const handler = new Function(`${code}; return handler;`)() as (e: unknown) => any;
    const req = (uri: string, cookies: Record<string, unknown> = {}) => handler({ request: { uri, headers: {}, querystring: {}, cookies } });
    const signedIn = { vid_s: { value: '1' } };

    test('stays within the CloudFront Functions size limit', () => {
      expect(code.length).toBeLessThan(10 * 1024);
    });

    test('the vault recovery page is behind the /account/ gate', () => {
      expect(req('/account/vault/recovery/').statusCode).toBe(302);
      expect(req('/account/vault/recovery/', signedIn).uri).toBe('/account/vault/recovery/index.html');
    });

    test.each(['/vault/recovery/cancel', '/vault/recovery/cancel/'])('the emailed cancel link %s needs no session', (uri) => {
      const r = req(uri);
      expect(r.statusCode).toBeUndefined();
      expect(r.uri).toBe('/vault/recovery/cancel/index.html');
    });

    test('2.1.0: the start-over page is behind the gate; its emailed cancel link needs no session', () => {
      expect(req('/account/vault/deletion/').statusCode).toBe(302);
      expect(req('/account/vault/deletion/', signedIn).uri).toBe('/account/vault/deletion/index.html');
      for (const uri of ['/vault/deletion/cancel', '/vault/deletion/cancel/']) {
        const r = req(uri);
        expect(r.statusCode).toBeUndefined();
        expect(r.uri).toBe('/vault/deletion/cancel/index.html');
      }
      for (const uri of ['/js/deletion.js', '/js/deletion-cancel.js']) expect(req(uri).statusCode).toBeUndefined();
    });

    test.each(['/js/vault.js', '/js/recovery.js', '/js/recovery-code.js', '/js/qr.js', '/js/vendor/qrcode-generator.js', '/js/vendor/qrcode-generator.LICENSE.txt', '/config.json'])('%s is a known file', (uri) => {
      expect(req(uri).statusCode).toBeUndefined();
    });

    test('unknown vault paths get the branded 404', () => {
      expect(req('/vault/').statusCode).toBe(404);
      expect(req('/account/vault/nope/', signedIn).statusCode).toBe(404);
    });
  });

  test('config.json: stage, public site, no Android link until one is configured', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { accountSiteConfig } = require('../lib/stacks/account-site-stack');
    expect(accountSiteConfig(config)).toEqual({ stage: 'prod', release_log_url: 'https://vettid.org/security/releases/', android_app_url: null });
    expect(accountSiteConfig(loadConfig(new cdk.App({ context: { stage: 'staging', stagingAndroidAppUrl: 'https://example.org/a' } }).node)))
      .toEqual({ stage: 'staging', release_log_url: 'https://vettid.org/security/releases/', android_app_url: 'https://example.org/a' });
    // Deployed in the revalidating pass: the site, config.json and assetlinks.json.
    const deps = Object.values<any>(t.findResources('Custom::CDKBucketDeployment')).map((r) => r.Properties);
    const html = deps.find((d) => JSON.stringify(d.Include ?? []).includes('*.json'));
    expect(html.SourceObjectKeys).toHaveLength(3);
  });

  test('the Android app link comes from context (https only)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig: load } = require('../lib/config');
    expect(load(new cdk.App({ context: { androidAppUrl: 'https://play.google.com/store/apps/details?id=com.vettid.app' } }).node).androidAppUrl)
      .toBe('https://play.google.com/store/apps/details?id=com.vettid.app');
    expect(load(new cdk.App({ context: { stage: 'staging', stagingAndroidAppUrl: 'https://example.org/staging.apk' } }).node).androidAppUrl)
      .toBe('https://example.org/staging.apk');
    expect(load(new cdk.App().node).androidAppUrl).toBeUndefined();
    expect(() => load(new cdk.App({ context: { androidAppUrl: 'http://example.org' } }).node)).toThrow(/https URL/);
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
