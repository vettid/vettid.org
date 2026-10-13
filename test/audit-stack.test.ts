import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ALERT_FORWARDER_ROLE_NAME, ORG, loadConfig } from '../lib/config';
import { VettidOrgAuditStack } from '../lib/stacks/audit-stack';
import { matchesPattern } from './event-pattern';

const app = new cdk.App();
const t = Template.fromStack(new VettidOrgAuditStack(app, 'Audit', { config: loadConfig(app.node), env: { account: ORG.management, region: 'us-east-1' } }));
const json = t.toJSON();

test('multi-region trail with log-file validation, incl. global events', () => {
  t.hasResourceProperties('AWS::CloudTrail::Trail', {
    IsMultiRegionTrail: true,
    IncludeGlobalServiceEvents: true,
    EnableLogFileValidation: true,
  });
});

describe('the trail bucket is write-once', () => {
  const buckets = Object.entries<any>(t.findResources('AWS::S3::Bucket'));
  const [bucketId, bucket] = buckets[0];

  test('Object Lock, compliance mode, 400 days for every new object, on the same bucket', () => {
    expect(buckets).toHaveLength(1);
    // The logical id and the name are what keep CloudFormation updating the
    // existing bucket in place instead of making another one.
    expect(bucketId).toBe('TrailBucketA831CE63');
    expect(bucket.Properties.BucketName).toBe(`vettid-org-cloudtrail-${ORG.management}`);
    expect(bucket.Properties.ObjectLockEnabled).toBe(true);
    expect(bucket.Properties.ObjectLockConfiguration).toEqual({
      ObjectLockEnabled: 'Enabled',
      Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 400 } },
    });
    // Object Lock needs versioning, and S3 refuses to suspend it afterwards.
    expect(bucket.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
  });

  test('the lifecycle rule agrees with the lock: expiry no earlier than the lock ends, then the old version goes', () => {
    const lifecycle = bucket.Properties.LifecycleConfiguration.Rules;
    expect(lifecycle).toHaveLength(1);
    const days = bucket.Properties.ObjectLockConfiguration.Rule.DefaultRetention.Days;
    expect(lifecycle[0].Status).toBe('Enabled');
    expect(lifecycle[0].ExpirationInDays).toBe(days);
    // Without this the expired (then unlocked) versions would stay for ever.
    expect(lifecycle[0].NoncurrentVersionExpiration).toEqual({ NoncurrentDays: 30 });
  });

  test('nothing in the stack tries to empty or delete it', () => {
    expect(bucket.DeletionPolicy).toBe('Retain');
    expect(bucket.UpdateReplacePolicy).toBe('Retain');
    // autoDeleteObjects would add this custom resource (and a tag on the bucket).
    t.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    expect(JSON.stringify(bucket.Properties.Tags ?? [])).not.toContain('auto-delete-objects');
  });

  test('the bucket admits CloudTrail only for this trail: every CloudTrail statement carries aws:SourceArn', () => {
    const policies = Object.values<any>(t.findResources('AWS::S3::BucketPolicy'));
    expect(policies).toHaveLength(1);
    const text = (v: any) => JSON.stringify(v).replace(/[^A-Za-z0-9:/*.-]+/g, ' ');
    const cloudtrail = policies[0].Properties.PolicyDocument.Statement.filter((st: any) => st.Principal?.Service === 'cloudtrail.amazonaws.com');
    expect(cloudtrail.map((st: any) => [st.Action, text(st.Resource).match(/AWSLogs\S+/)?.[0]])).toEqual([
      ['s3:GetBucketAcl', undefined],
      ['s3:PutObject', `AWSLogs/${ORG.management}/*`],
      ['s3:PutObject', `AWSLogs/${ORG.id}/*`],
    ]);
    for (const st of cloudtrail) {
      expect(st.Effect).toBe('Allow');
      expect(text(st.Condition.StringEquals['aws:SourceArn'])).toMatch(new RegExp(`:cloudtrail:us-east-1:${ORG.management}:trail/vettid-org-trail $`));
    }
    // The two writes still require the ACL header beside the new condition.
    for (const st of cloudtrail.slice(1)) expect(st.Condition.StringEquals['s3:x-amz-acl']).toBe('bucket-owner-full-control');
    // No statement admits any other principal.
    const others = policies[0].Properties.PolicyDocument.Statement.filter((st: any) => !cloudtrail.includes(st));
    expect(others.map((st: any) => st.Effect)).toEqual(['Deny']);
  });
});

test('trail bucket: private, TLS-only, versioned, retained, lifecycle-managed', () => {
  t.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicPolicy: true, RestrictPublicBuckets: true }),
      LifecycleConfiguration: Match.objectLike({ Rules: [Match.objectLike({ ExpirationInDays: 400 })] }),
    }),
  });
});

test('GuardDuty and Access Analyzer are on', () => {
  t.hasResourceProperties('AWS::GuardDuty::Detector', { Enable: true });
  t.hasResourceProperties('AWS::AccessAnalyzer::Analyzer', { Type: 'ACCOUNT' });
});

// ---- Alert rules ----------------------------------------------------------------------------

const RULES = [
  'RootActivity',
  'ConsoleSignInRisk',
  'NonStandardConsoleSignIn',
  'VaultProdConsoleSignIn',
  'IamCredentialChanges',
  'IamRoleOrPolicyChanges',
  'AuditTampering',
  'OrgOrSsoChanges',
  'CentralRootSession',
  'KmsKeyDeletion',
  'KmsKeyPolicy',
  'VaultServiceSwitch',
  'S3PublicAccess',
  'SecurityGroupOpenToWorld',
  'GuardDutyFindings',
] as const;
type RuleId = (typeof RULES)[number];

const rules = Object.entries<any>(t.findResources('AWS::Events::Rule'));
function rule(id: RuleId): any {
  const found = rules.filter(([logicalId]) => logicalId.startsWith(id) && /^[0-9A-F]{8}$/.test(logicalId.slice(id.length)));
  expect(found).toHaveLength(1);
  return found[0][1].Properties;
}
/** The rules (by id) that match `event`. */
const matching = (event: Record<string, any>) => RULES.filter((id) => matchesPattern(rule(id).EventPattern, event));

const SSO_ADMIN = { userName: 'AWSReservedSSO_VettIDAdmin_0f38cc20bf04b181', arn: 'arn:aws:sts::{acct}:assumed-role/AWSReservedSSO_VettIDAdmin_0f38cc20bf04b181/al@example.org' };
const CFN_EXEC = { userName: 'cdk-hnb659fds-cfn-exec-role-{acct}-us-east-1', arn: 'arn:aws:sts::{acct}:assumed-role/cdk-hnb659fds-cfn-exec-role-{acct}-us-east-1/AWSCloudFormation' };
type Who = typeof SSO_ADMIN | 'iam-user' | 'root';

function identity(account: string, who: Who): Record<string, any> {
  if (who === 'root') return { type: 'Root', arn: `arn:aws:iam::${account}:root`, accountId: account };
  if (who === 'iam-user') return { type: 'IAMUser', arn: `arn:aws:iam::${account}:user/someone`, accountId: account };
  const arn = who.arn.replace(/\{acct\}/g, account);
  return {
    type: 'AssumedRole',
    arn,
    accountId: account,
    sessionContext: { sessionIssuer: { type: 'Role', userName: who.userName.replace(/\{acct\}/g, account) } },
  };
}

/** A CloudTrail management event as EventBridge delivers it (after forwarding, `account` is the member's). */
function apiCall(account: string, source: string, eventName: string, who: Who, detail: Record<string, any> = {}) {
  return {
    'detail-type': 'AWS API Call via CloudTrail',
    source,
    account,
    region: 'us-east-1',
    detail: { eventName, eventSource: source.replace('aws.', '') + '.amazonaws.com', readOnly: false, userIdentity: identity(account, who), ...detail },
  };
}
function signIn(account: string, who: Who, detail: Record<string, any> = {}) {
  return {
    'detail-type': 'AWS Console Sign In via CloudTrail',
    source: 'aws.signin',
    account,
    region: 'us-east-1',
    detail: {
      eventName: 'ConsoleLogin',
      userIdentity: identity(account, who),
      responseElements: { ConsoleLogin: 'Success' },
      additionalEventData: { MFAUsed: 'Yes' },
      ...detail,
    },
  };
}

const { vaultProd, vaultStaging, proteus } = ORG.members;
const MGMT = ORG.management;

test('fifteen alert rules (plus one heartbeat rule per member), each to the emailed SNS topic, each naming the account', () => {
  t.resourceCountIs('AWS::Events::Rule', RULES.length + Object.keys(ORG.members).length);
  t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'admin@vettid.org' });
  const topicId = Object.keys(t.findResources('AWS::SNS::Topic'))[0];
  for (const id of RULES) {
    const targets = rule(id).Targets;
    expect(targets).toHaveLength(1);
    expect(targets[0].Arn).toEqual({ Ref: topicId });
    const paths = Object.values(targets[0].InputTransformer.InputPathsMap);
    expect({ id, names: paths.some((p) => p === '$.account' || p === '$.detail.accountId') }).toEqual({ id, names: true });
  }
});

describe('IAM', () => {
  test.each([vaultProd, vaultStaging, proteus, MGMT])('access key created by a person in %s alerts', (acct) => {
    expect(matching(apiCall(acct, 'aws.iam', 'CreateAccessKey', SSO_ADMIN))).toEqual(['IamCredentialChanges']);
    expect(matching(apiCall(acct, 'aws.iam', 'CreateAccessKey', 'iam-user'))).toEqual(['IamCredentialChanges']);
  });
  test('a deploy creating roles does not alert; a look-alike role name does', () => {
    expect(matching(apiCall(vaultProd, 'aws.iam', 'CreateRole', CFN_EXEC))).toEqual([]);
    expect(matching(apiCall(vaultProd, 'aws.iam', 'PutRolePolicy', CFN_EXEC))).toEqual([]);
    const lookalike = { userName: 'cdk-hnb659fds-deploy-ish', arn: 'arn:aws:sts::{acct}:assumed-role/cdk-hnb659fds-deploy-ish/x' };
    expect(matching(apiCall(vaultProd, 'aws.iam', 'CreateRole', lookalike))).toEqual(['IamRoleOrPolicyChanges']);
  });
  test('role trust change outside a deploy alerts, also when the SCP denied it', () => {
    expect(matching(apiCall(proteus, 'aws.iam', 'UpdateAssumeRolePolicy', SSO_ADMIN))).toEqual(['IamRoleOrPolicyChanges']);
    expect(matching(apiCall(vaultProd, 'aws.iam', 'UpdateAssumeRolePolicy', SSO_ADMIN, { errorCode: 'AccessDenied' }))).toEqual(['IamRoleOrPolicyChanges']);
  });
  test('read-only IAM calls never alert', () => {
    expect(matching(apiCall(vaultProd, 'aws.iam', 'GetRole', SSO_ADMIN, { readOnly: true }))).toEqual([]);
  });
});

describe('KMS', () => {
  test('key deletion scheduling always alerts, deploys included (outside the vault accounts)', () => {
    expect(matching(apiCall(proteus, 'aws.kms', 'ScheduleKeyDeletion', CFN_EXEC))).toEqual(['KmsKeyDeletion']);
    expect(matching(apiCall(MGMT, 'aws.kms', 'DisableKey', SSO_ADMIN))).toEqual(['KmsKeyDeletion']);
  });
  test('key policy change alerts outside a deploy', () => {
    expect(matching(apiCall(proteus, 'aws.kms', 'PutKeyPolicy', SSO_ADMIN))).toEqual(['KmsKeyPolicy']);
    expect(matching(apiCall(proteus, 'aws.kms', 'PutKeyPolicy', CFN_EXEC))).toEqual([]);
  });
  test.each([vaultProd, vaultStaging])('vault account %s: left to the vault stack\'s own KMS rules (no duplicate email)', (acct) => {
    expect(matching(apiCall(acct, 'aws.kms', 'ScheduleKeyDeletion', SSO_ADMIN))).toEqual([]);
    expect(matching(apiCall(acct, 'aws.kms', 'PutKeyPolicy', SSO_ADMIN))).toEqual([]);
  });
});

describe('vault service switch (MEMBER-API "Vault service pause")', () => {
  const name = (stage: string) => ({ requestParameters: { name: `/vettid-org/${stage}/switch/vault-service`, type: 'String', overwrite: true } });
  test.each([[MGMT, 'prod'], [vaultStaging, 'staging']])('every write in %s (%s) alerts: admin API, CLI, even a deploy', (acct, stage) => {
    const adminApi = { userName: 'VettidOrgAdminApiStack-VaultServiceFunctionRole', arn: 'arn:aws:sts::{acct}:assumed-role/VettidOrgAdminApiStack-VaultServiceFunctionRole/fn' };
    for (const who of [adminApi, SSO_ADMIN, CFN_EXEC] as Who[]) {
      expect(matching(apiCall(acct, 'aws.ssm', 'PutParameter', who, name(stage)))).toEqual(['VaultServiceSwitch']);
    }
    expect(matching(apiCall(acct, 'aws.ssm', 'DeleteParameter', SSO_ADMIN, name(stage)))).toEqual(['VaultServiceSwitch']);
    expect(matching(apiCall(acct, 'aws.ssm', 'DeleteParameters', SSO_ADMIN, { requestParameters: { names: ['/x', `/vettid-org/${stage}/switch/vault-service`] } }))).toEqual(['VaultServiceSwitch']);
  });
  test('other parameters, and reads, are quiet', () => {
    expect(matching(apiCall(MGMT, 'aws.ssm', 'PutParameter', CFN_EXEC, { requestParameters: { name: '/vettid-org/prod/auth/member-pool-id' } }))).toEqual([]);
    expect(matching(apiCall(MGMT, 'aws.ssm', 'GetParameter', SSO_ADMIN, { readOnly: true, ...name('prod') }))).toEqual([]);
  });
});

test('S3 bucket policy / public access block changes alert outside a deploy', () => {
  expect(matching(apiCall(vaultStaging, 'aws.s3', 'PutBucketPolicy', SSO_ADMIN))).toEqual(['S3PublicAccess']);
  expect(matching(apiCall(proteus, 'aws.s3', 'DeleteBucketPublicAccessBlock', 'iam-user'))).toEqual(['S3PublicAccess']);
  expect(matching(apiCall(proteus, 'aws.s3', 'PutBucketPolicy', CFN_EXEC))).toEqual([]);
});

describe('audit and alerting tampering', () => {
  test('CloudTrail/GuardDuty changes alert even when the SCP denied them', () => {
    expect(matching(apiCall(vaultProd, 'aws.cloudtrail', 'StopLogging', SSO_ADMIN, { errorCode: 'AccessDenied' }))).toEqual(['AuditTampering']);
    expect(matching(apiCall(proteus, 'aws.guardduty', 'DisassociateFromAdministratorAccount', SSO_ADMIN))).toEqual(['AuditTampering']);
    expect(matching(apiCall(MGMT, 'aws.guardduty', 'CreateFilter', SSO_ADMIN))).toEqual(['AuditTampering']);
  });
  test('deleting or disabling a member\'s forwarding rule alerts', () => {
    expect(matching(apiCall(vaultProd, 'aws.events', 'DisableRule', SSO_ADMIN, { requestParameters: { name: 'vettid-org-security-alert-forward' } }))).toEqual(['AuditTampering']);
    expect(matching(apiCall(vaultProd, 'aws.events', 'DeleteRule', CFN_EXEC))).toEqual([]);
  });
  test('Organizations and Identity Center changes alert', () => {
    expect(matching(apiCall(MGMT, 'aws.organizations', 'MoveAccount', SSO_ADMIN))).toEqual(['OrgOrSsoChanges']);
    expect(matching(apiCall(MGMT, 'aws.organizations', 'DetachPolicy', SSO_ADMIN))).toEqual(['OrgOrSsoChanges']);
    expect(matching(apiCall(MGMT, 'aws.sso', 'CreateAccountAssignment', SSO_ADMIN))).toEqual(['OrgOrSsoChanges']);
    expect(matching(apiCall(MGMT, 'aws.sts', 'AssumeRoot', SSO_ADMIN))).toEqual(['CentralRootSession']);
  });
});

describe('sign-ins', () => {
  test('the standard Identity Center sign-in to a member account is quiet (federated MFAUsed is always "No")', () => {
    expect(matching(signIn(proteus, SSO_ADMIN, { additionalEventData: { MFAUsed: 'No' } }))).toEqual([]);
    expect(matching(signIn(vaultStaging, SSO_ADMIN, { additionalEventData: { MFAUsed: 'No' } }))).toEqual([]);
  });
  test('…except into the production vault account', () => {
    expect(matching(signIn(vaultProd, SSO_ADMIN, { additionalEventData: { MFAUsed: 'No' } }))).toEqual(['VaultProdConsoleSignIn']);
  });
  test('another permission set, switch-role or an IAM user alerts', () => {
    const dev = { userName: 'AWSReservedSSO_VettIDDeveloper_1', arn: 'arn:aws:sts::{acct}:assumed-role/AWSReservedSSO_VettIDDeveloper_1/al@example.org' };
    expect(matching(signIn(proteus, dev))).toEqual(['NonStandardConsoleSignIn']);
    const oaar = { userName: 'OrganizationAccountAccessRole', arn: 'arn:aws:sts::{acct}:assumed-role/OrganizationAccountAccessRole/al' };
    expect(matching(signIn(vaultStaging, oaar, { eventName: 'SwitchRole' }))).toEqual(['NonStandardConsoleSignIn']);
    expect(matching(signIn(proteus, 'iam-user'))).toEqual(['NonStandardConsoleSignIn']);
  });
  test('root, failures and root/IAM-user sign-in without MFA alert in every account', () => {
    expect(matching(signIn(vaultStaging, 'root'))).toEqual(['RootActivity']);
    expect(matching(signIn(MGMT, 'root', { additionalEventData: { MFAUsed: 'No' } }))).toEqual(['RootActivity', 'ConsoleSignInRisk']);
    expect(matching(signIn(proteus, SSO_ADMIN, { responseElements: { ConsoleLogin: 'Failure' } }))).toEqual(['ConsoleSignInRisk']);
  });
});

test('security group open to the world (IPv4 or IPv6) alerts outside a deploy', () => {
  const sg = (cidr: Record<string, unknown>) => ({ requestParameters: { ipPermissions: { items: [cidr] } } });
  const v4 = sg({ ipRanges: { items: [{ cidrIp: '0.0.0.0/0' }] } });
  const v6 = sg({ ipv6Ranges: { items: [{ cidrIpv6: '::/0' }] } });
  const lan = sg({ ipRanges: { items: [{ cidrIp: '10.0.0.0/8' }] } });
  expect(matching(apiCall(vaultProd, 'aws.ec2', 'AuthorizeSecurityGroupIngress', SSO_ADMIN, v4))).toEqual(['SecurityGroupOpenToWorld']);
  expect(matching(apiCall(proteus, 'aws.ec2', 'AuthorizeSecurityGroupIngress', 'iam-user', v6))).toEqual(['SecurityGroupOpenToWorld']);
  expect(matching(apiCall(proteus, 'aws.ec2', 'AuthorizeSecurityGroupIngress', SSO_ADMIN, lan))).toEqual([]);
  expect(matching(apiCall(vaultProd, 'aws.ec2', 'AuthorizeSecurityGroupIngress', CFN_EXEC, v4))).toEqual([]);
});

test('GuardDuty findings of medium severity and above, from any account', () => {
  const finding = (severity: number, accountId: string) => ({ 'detail-type': 'GuardDuty Finding', source: 'aws.guardduty', account: MGMT, detail: { severity, accountId } });
  expect(matching(finding(5, vaultProd))).toEqual(['GuardDutyFindings']);
  expect(matching(finding(2, vaultProd))).toEqual([]);
});

// ---- The management bus policy ------------------------------------------------------------

test('the default bus admits only the members\' forwarder roles, from inside the organization', () => {
  const policies = Object.values<any>(t.findResources('AWS::Events::EventBusPolicy'));
  expect(policies).toHaveLength(1);
  const p = policies[0].Properties;
  expect(p.EventBusName).toBe('default');
  const members = [vaultProd, vaultStaging, proteus];
  expect(p.Statement).toEqual({
    Sid: 'vettid-org-member-security-events',
    Effect: 'Allow',
    Principal: { AWS: members.map((a) => `arn:aws:iam::${a}:root`) },
    Action: 'events:PutEvents',
    Resource: `arn:aws:events:us-east-1:${MGMT}:event-bus/default`,
    Condition: {
      StringEquals: { 'aws:PrincipalOrgID': 'o-kualrldevn' },
      ArnEquals: { 'aws:PrincipalArn': members.map((a) => `arn:aws:iam::${a}:role/${ALERT_FORWARDER_ROLE_NAME}`) },
    },
  });
});

test('no Allow to a wildcard principal anywhere in the stack (the TLS-only Deny is the one "*")', () => {
  const statements: any[] = [];
  const walk = (x: any): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if ('Effect' in x && 'Principal' in x) statements.push(x);
      Object.values(x).forEach(walk);
    }
  };
  walk(json.Resources);
  expect(statements.length).toBeGreaterThan(0);
  const wild = (p: any) => p === '*' || [p?.AWS].flat().includes('*');
  expect(statements.filter((st) => st.Effect === 'Allow' && wild(st.Principal))).toEqual([]);
});

// ---- Forwarding heartbeat -----------------------------------------------------------------

describe('heartbeat from each member account', () => {
  const beats = rules.filter(([id]) => id.startsWith('Heartbeat') && !id.startsWith('HeartbeatSink'));
  const alarms = Object.values<any>(t.findResources('AWS::CloudWatch::Alarm')).map((a) => a.Properties);
  const topicId = Object.keys(t.findResources('AWS::SNS::Topic'))[0];
  const scheduled = (account: string, rule = 'vettid-org-security-alert-heartbeat') => ({
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account,
    resources: [`arn:aws:events:us-east-1:${account}:rule/${rule}`],
    detail: {},
  });

  test('one rule per member, matching only that member\'s heartbeat', () => {
    expect(beats).toHaveLength(3);
    for (const acct of [vaultProd, vaultStaging, proteus]) {
      expect(beats.filter(([, r]) => matchesPattern(r.Properties.EventPattern, scheduled(acct)))).toHaveLength(1);
      expect(beats.filter(([, r]) => matchesPattern(r.Properties.EventPattern, scheduled(acct, 'some-other-rule')))).toHaveLength(0);
    }
    // Heartbeats never trigger an alert email themselves.
    for (const acct of [vaultProd, proteus]) expect(matching(scheduled(acct))).toEqual([]);
  });

  test('an alarm per member: no heartbeat for 3 hours (missing data counts) → the security topic, alarm and recovery', () => {
    expect(alarms).toHaveLength(3);
    for (const a of alarms) {
      expect(a).toMatchObject({
        Namespace: 'AWS/Events',
        MetricName: 'Invocations',
        Statistic: 'Sum',
        Period: 3600,
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        Threshold: 1,
        ComparisonOperator: 'LessThanThreshold',
        TreatMissingData: 'breaching',
        AlarmActions: [{ Ref: topicId }],
        OKActions: [{ Ref: topicId }],
      });
      const ruleRef = a.Dimensions[0].Value.Ref;
      expect(beats.map(([id]) => id)).toContain(ruleRef);
    }
  });
});

test('the alerts topic admits this account\'s CloudWatch alarms, and only them', () => {
  // Without this statement the topic policy names events.amazonaws.com
  // alone and every alarm action fails with "not authorized: SNS:Publish".
  t.hasResourceProperties('AWS::SNS::TopicPolicy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Sid: 'AlarmsOfThisAccount',
          Effect: 'Allow',
          Principal: { Service: 'cloudwatch.amazonaws.com' },
          Action: 'sns:Publish',
          Condition: {
            StringEquals: { 'aws:SourceAccount': ORG.management },
            ArnLike: { 'aws:SourceArn': Match.objectLike({ 'Fn::Join': Match.anyValue() }) },
          },
        }),
      ]),
    }),
  });
  const policies = Object.values(json.Resources).filter((r: any) => r.Type === 'AWS::SNS::TopicPolicy') as any[];
  const services = policies.flatMap((p) => p.Properties.PolicyDocument.Statement.map((s: any) => s.Principal?.Service));
  expect(new Set(services)).toEqual(new Set(['events.amazonaws.com', 'cloudwatch.amazonaws.com']));
});
