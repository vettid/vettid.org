import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ALERT_FORWARDER_ROLE_NAME, ORG, VAULT_ROLE_NAMES, loadConfig, vaultDataBucketNames } from '../lib/config';
import { COST_ALERTS, VettidOrgAuditStack } from '../lib/stacks/audit-stack';
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
    // One day: a record is gone 402 to 403 days after delivery (each of the
    // two steps is rounded up to midnight UTC), which is what "400 days" in
    // the privacy notice can honestly mean.
    expect(lifecycle[0].NoncurrentVersionExpiration).toEqual({ NoncurrentDays: 1 });
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

test('data events: the terms bucket as before (reads and writes), and writes only on both vault data buckets', () => {
  const selectors = Object.values<any>(t.findResources('AWS::CloudTrail::Trail'))[0].Properties.EventSelectors;
  // Unchanged: management events, then the terms bucket's selector alone.
  expect(selectors).toHaveLength(3);
  expect(selectors[0]).toEqual({ IncludeManagementEvents: true, ReadWriteType: 'All' });
  expect(selectors[1]).toMatchObject({ IncludeManagementEvents: false, ReadWriteType: 'All' });
  expect(selectors[1].DataResources).toHaveLength(1);
  expect(JSON.stringify(selectors[1].DataResources[0].Values)).not.toContain('vault-data');
  // New: the vault data buckets, whole ("arn:aws:s3:::<bucket>/", an empty prefix).
  expect(vaultDataBucketNames()).toEqual(['vettid-org-vault-data-369484479783', 'vettid-org-staging-vault-data-347272280361']);
  // Writes only (the owner's decision): reads of vault objects are not recorded.
  expect(selectors[2]).toMatchObject({ IncludeManagementEvents: false, ReadWriteType: 'WriteOnly' });
  expect(selectors.map((x: any) => x.ReadWriteType)).toEqual(['All', 'All', 'WriteOnly']);
  expect(selectors[2].DataResources).toHaveLength(1);
  expect(selectors[2].DataResources[0].Type).toBe('AWS::S3::Object');
  const arns = selectors[2].DataResources[0].Values.map((v: any) => v['Fn::Join'][1].filter((x: any) => typeof x === 'string').join(''));
  expect(arns).toEqual(vaultDataBucketNames().map((b) => `arn::s3:::${b}/`));
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
  'TrailBucketConfig',
  'OrgOrSsoChanges',
  'CentralRootSession',
  'KmsKeyDeletion',
  'KmsKeyPolicy',
  'VaultServiceSwitch',
  'S3PublicAccess',
  'VaultDataBucketConfig',
  'VaultHostAccess',
  'VaultHostProfileLaunch',
  'VaultHostLaunchPath',
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

test('twenty alert rules (plus one heartbeat rule per member), each to the emailed SNS topic, each naming the account', () => {
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

describe('the audit trail bucket\'s configuration (TrailBucketConfig)', () => {
  const TRAIL_BUCKET = `vettid-org-cloudtrail-${MGMT}`;
  const onBucket = (bucketName: string, extra: Record<string, any> = {}) => ({ requestParameters: { bucketName }, ...extra });
  // PutBucketObjectLockConfiguration and PutBucketLifecycle are the names
  // CloudTrail records for PutObjectLockConfiguration and
  // PutBucketLifecycleConfiguration (S3 user guide, "Amazon S3 CloudTrail events").
  const CALLS = [
    'PutBucketObjectLockConfiguration', 'PutObjectLockConfiguration', 'PutBucketLifecycle', 'PutBucketLifecycleConfiguration',
    'DeleteBucketLifecycle', 'PutBucketVersioning', 'DeleteBucket',
  ];

  test('the rule names exactly these calls on exactly this bucket', () => {
    const pattern = rule('TrailBucketConfig').EventPattern;
    expect(pattern.source).toEqual(['aws.s3']);
    expect(pattern.detail.requestParameters).toEqual({ bucketName: [TRAIL_BUCKET] });
    expect([...pattern.detail.eventName].sort()).toEqual([...CALLS, 'PutBucketPolicy', 'DeleteBucketPolicy'].sort());
    // Deploys included: nothing in the pattern looks at who made the call.
    expect(JSON.stringify(pattern)).not.toContain('userIdentity');
  });
  test.each(CALLS)('%s alerts, whoever makes it: a person, root, a deploy, and when it was refused', (name) => {
    expect(matching(apiCall(MGMT, 'aws.s3', name, SSO_ADMIN, onBucket(TRAIL_BUCKET)))).toEqual(['TrailBucketConfig']);
    expect(matching(apiCall(MGMT, 'aws.s3', name, CFN_EXEC, onBucket(TRAIL_BUCKET)))).toEqual(['TrailBucketConfig']);
    expect(matching(apiCall(MGMT, 'aws.s3', name, 'root', onBucket(TRAIL_BUCKET)))).toEqual(['RootActivity', 'TrailBucketConfig']);
    expect(matching(apiCall(MGMT, 'aws.s3', name, SSO_ADMIN, onBucket(TRAIL_BUCKET, { errorCode: 'AccessDenied' })))).toEqual(['TrailBucketConfig']);
  });
  test('a bucket policy change: by a deploy this rule alone, by a person S3PublicAccess as well', () => {
    for (const name of ['PutBucketPolicy', 'DeleteBucketPolicy']) {
      expect(matching(apiCall(MGMT, 'aws.s3', name, CFN_EXEC, onBucket(TRAIL_BUCKET)))).toEqual(['TrailBucketConfig']);
      expect(matching(apiCall(MGMT, 'aws.s3', name, SSO_ADMIN, onBucket(TRAIL_BUCKET)))).toEqual(['TrailBucketConfig', 'S3PublicAccess']);
    }
  });
  test('other buckets, and reads of this one, are quiet', () => {
    for (const name of CALLS) {
      expect(matching(apiCall(MGMT, 'aws.s3', name, SSO_ADMIN, onBucket('vettid-org-site-bucket')))).toEqual([]);
      expect(matching(apiCall(MGMT, 'aws.s3', name, SSO_ADMIN, onBucket(`${TRAIL_BUCKET}-copy`)))).toEqual([]);
      expect(matching(apiCall(MGMT, 'aws.s3', name, SSO_ADMIN))).toEqual([]);
    }
    expect(matching(apiCall(MGMT, 'aws.s3', 'GetBucketObjectLockConfiguration', SSO_ADMIN, onBucket(TRAIL_BUCKET)))).toEqual([]);
    expect(matching(apiCall(MGMT, 'aws.s3', 'GetBucketLifecycle', SSO_ADMIN, onBucket(TRAIL_BUCKET)))).toEqual([]);
  });
  test('the vault data buckets keep their own rule, and this one stays out of it', () => {
    for (const [acct, name] of [[vaultProd, 'vettid-org-vault-data-369484479783'], [vaultStaging, 'vettid-org-staging-vault-data-347272280361']]) {
      for (const call of ['PutBucketLifecycle', 'PutBucketVersioning', 'DeleteBucket']) {
        expect(matching(apiCall(acct, 'aws.s3', call, CFN_EXEC, onBucket(name)))).toEqual(['VaultDataBucketConfig']);
      }
    }
  });
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

describe('vault accounts: the data bucket, the hosts, the host role', () => {
  const [prodBucket, stagingBucket] = vaultDataBucketNames();
  const bucket = (bucketName: string) => ({ requestParameters: { bucketName } });
  const AUTO_SCALING = { userName: 'AWSServiceRoleForAutoScaling', arn: 'arn:aws:sts::{acct}:assumed-role/AWSServiceRoleForAutoScaling/AutoScaling' };
  const IMAGE_BUILDER = { userName: 'AWSServiceRoleForImageBuilder', arn: 'arn:aws:sts::{acct}:assumed-role/AWSServiceRoleForImageBuilder/ImageBuilder' };
  /** As CloudTrail records a call a service made: `invokedBy` beside the role. */
  const by = (account: string, who: Who, service: string) => ({ userIdentity: { ...identity(account, who), invokedBy: service } });

  test('lifecycle, versioning or deletion of a vault data bucket alerts, whoever does it (a deploy too), also when refused', () => {
    for (const who of [SSO_ADMIN, CFN_EXEC, 'iam-user'] as Who[]) {
      // CloudTrail's name for PutBucketLifecycleConfiguration is PutBucketLifecycle.
      expect(matching(apiCall(vaultStaging, 'aws.s3', 'PutBucketLifecycle', who, bucket(stagingBucket)))).toEqual(['VaultDataBucketConfig']);
      expect(matching(apiCall(vaultProd, 'aws.s3', 'PutBucketVersioning', who, bucket(prodBucket)))).toEqual(['VaultDataBucketConfig']);
    }
    expect(matching(apiCall(vaultProd, 'aws.s3', 'DeleteBucketLifecycle', SSO_ADMIN, bucket(prodBucket)))).toEqual(['VaultDataBucketConfig']);
    expect(matching(apiCall(vaultProd, 'aws.s3', 'DeleteBucket', SSO_ADMIN, { ...bucket(prodBucket), errorCode: 'AccessDenied' }))).toEqual(['VaultDataBucketConfig']);
  });
  test('its bucket policy: always here, and by S3PublicAccess too outside a deploy', () => {
    expect(matching(apiCall(vaultProd, 'aws.s3', 'PutBucketPolicy', CFN_EXEC, bucket(prodBucket)))).toEqual(['VaultDataBucketConfig']);
    expect(matching(apiCall(vaultProd, 'aws.s3', 'DeleteBucketPolicy', SSO_ADMIN, bucket(prodBucket)))).toEqual(['S3PublicAccess', 'VaultDataBucketConfig']);
  });
  test('other buckets are as before: quiet for lifecycle and versioning, in any account', () => {
    const other = bucket('vettid-org-staging-test-mail-347272280361');
    expect(matching(apiCall(vaultStaging, 'aws.s3', 'PutBucketLifecycle', CFN_EXEC, other))).toEqual([]);
    expect(matching(apiCall(vaultStaging, 'aws.s3', 'PutBucketVersioning', SSO_ADMIN, other))).toEqual([]);
    expect(matching(apiCall(vaultStaging, 'aws.s3', 'DeleteBucket', SSO_ADMIN, other))).toEqual([]);
    // The audit trail's own bucket has its own rule, and never this one.
    expect(matching(apiCall(MGMT, 'aws.s3', 'PutBucketLifecycle', SSO_ADMIN, bucket('vettid-org-cloudtrail-449757308783')))).toEqual(['TrailBucketConfig']);
  });

  test.each([vaultProd, vaultStaging])('an interactive way in, which the Vault OU policy refuses, alerts as an attempt in %s (and as a success if the policy is off)', (acct) => {
    const denied = { errorCode: 'AccessDenied' };
    expect(matching(apiCall(acct, 'aws.ssm', 'StartSession', SSO_ADMIN, { ...denied, requestParameters: { target: 'i-0b08e5d23f265790d', documentName: 'AWS-StartPortForwardingSession' } }))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ec2-instance-connect', 'SendSSHPublicKey', SSO_ADMIN, denied))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ec2-instance-connect', 'SendSerialConsoleSSHPublicKey', SSO_ADMIN))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ec2', 'EnableSerialConsoleAccess', SSO_ADMIN, denied))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ec2', 'CreateInstanceConnectEndpoint', 'iam-user', denied))).toEqual(['VaultHostAccess']);
    // Not every EC2 call: a release group's own launches and terminations stay quiet.
    expect(matching(apiCall(acct, 'aws.ec2', 'TerminateInstances', SSO_ADMIN))).toEqual([]);
  });
  test.each([vaultProd, vaultStaging])('a session or a command on an instance in %s alerts', (acct) => {
    expect(matching(apiCall(acct, 'aws.ssm', 'StartSession', SSO_ADMIN, { requestParameters: { target: 'i-0b08e5d23f265790d' } }))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ssm', 'StartSession', SSO_ADMIN, { readOnly: true }))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ssm', 'ResumeSession', 'iam-user'))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ssm', 'SendCommand', SSO_ADMIN, { requestParameters: { instanceIds: ['i-0b08e5d23f265790d'], documentName: 'AWS-RunShellScript' } }))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(acct, 'aws.ssm', 'SendCommand', SSO_ADMIN, { errorCode: 'AccessDenied' }))).toEqual(['VaultHostAccess']);
  });
  test.each([vaultProd, vaultStaging])('the other ways to make the SSM agent run a document in %s alert: association, automation, maintenance-window task', (acct) => {
    // A State Manager association is fetched by the agent itself: there is no SendCommand to see.
    const association = { requestParameters: { name: 'AWS-RunShellScript', targets: [{ key: 'InstanceIds', values: ['i-0b08e5d23f265790d'] }] } };
    for (const name of ['CreateAssociation', 'CreateAssociationBatch', 'UpdateAssociation', 'StartAssociationsOnce']) {
      expect({ name, rules: matching(apiCall(acct, 'aws.ssm', name, SSO_ADMIN, association)) }).toEqual({ name, rules: ['VaultHostAccess'] });
    }
    for (const name of ['StartAutomationExecution', 'StartChangeRequestExecution', 'RegisterTaskWithMaintenanceWindow', 'UpdateMaintenanceWindowTask']) {
      expect({ name, rules: matching(apiCall(acct, 'aws.ssm', name, SSO_ADMIN)) }).toEqual({ name, rules: ['VaultHostAccess'] });
    }
    // Through a deploy as well: no stack here makes an association.
    expect(matching(apiCall(acct, 'aws.ssm', 'CreateAssociation', CFN_EXEC, by(acct, CFN_EXEC, 'cloudformation.amazonaws.com')))).toEqual(['VaultHostAccess']);
  });
  test('the only exception is Image Builder itself: its service principal AND its service-linked role', () => {
    const SSM_SERVICE = { userName: 'AWSServiceRoleForAmazonSSM', arn: 'arn:aws:sts::{acct}:assumed-role/AWSServiceRoleForAmazonSSM/ssm' };
    // Another service sending a command (an automation or a maintenance window does it this way).
    expect(matching(apiCall(vaultStaging, 'aws.ssm', 'SendCommand', SSM_SERVICE, by(vaultStaging, SSM_SERVICE, 'ssm.amazonaws.com')))).toEqual(['VaultHostAccess']);
    // A person's call that a service relayed, and Image Builder's principal with another role.
    expect(matching(apiCall(vaultStaging, 'aws.ssm', 'SendCommand', SSO_ADMIN, by(vaultStaging, SSO_ADMIN, 'ssm.amazonaws.com')))).toEqual(['VaultHostAccess']);
    expect(matching(apiCall(vaultStaging, 'aws.ssm', 'SendCommand', SSO_ADMIN, by(vaultStaging, SSO_ADMIN, 'imagebuilder.amazonaws.com')))).toEqual(['VaultHostAccess']);
    // Its role without its principal (a role of that name cannot be made by hand; still not trusted alone).
    expect(matching(apiCall(vaultStaging, 'aws.ssm', 'SendCommand', IMAGE_BUILDER))).toEqual(['VaultHostAccess']);
    // The pattern itself: exactly these four alternatives, each of which means "someone else".
    expect(rule('VaultHostAccess').EventPattern.detail.$or).toEqual([
      { userIdentity: { invokedBy: [{ 'anything-but': ['imagebuilder.amazonaws.com'] }] } },
      { userIdentity: { invokedBy: [{ exists: false }] } },
      { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ 'anything-but': ['AWSServiceRoleForImageBuilder'] }] } } } },
      { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ exists: false }] } } } },
    ]);
  });
  test('Image Builder driving its build instance does not; nor sessions in the other accounts, nor other SSM calls', () => {
    expect(matching(apiCall(vaultStaging, 'aws.ssm', 'SendCommand', IMAGE_BUILDER, by(vaultStaging, IMAGE_BUILDER, 'imagebuilder.amazonaws.com')))).toEqual([]);
    expect(matching(apiCall(MGMT, 'aws.ssm', 'StartSession', SSO_ADMIN))).toEqual([]);
    expect(matching(apiCall(proteus, 'aws.ssm', 'SendCommand', SSO_ADMIN))).toEqual([]);
    expect(matching(apiCall(vaultStaging, 'aws.ssm', 'PutParameter', CFN_EXEC, { requestParameters: { name: '/vettid-org/staging/vault/dlq-name' } }))).toEqual([]);
  });

  const hostProfileArn = (acct: string) => `arn:aws:iam::${acct}:instance-profile/${VAULT_ROLE_NAMES.host}`;
  const launched = (acct: string, profileArn = hostProfileArn(acct)) => ({
    // A launch from a template: the request names the template only, the response the profile.
    requestParameters: { instancesSet: { items: [{ minCount: 1, maxCount: 1 }] }, launchTemplate: { launchTemplateId: 'lt-0c71b2e1336763458', version: '1' } },
    responseElements: { instancesSet: { items: [{ instanceId: 'i-1', iamInstanceProfile: { arn: profileArn, id: 'AIPA' } }] } },
  });
  test('a release group launching a host (Auto Scaling, through its service-linked role) is quiet; nothing else is', () => {
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', AUTO_SCALING, { ...launched(vaultStaging), ...by(vaultStaging, AUTO_SCALING, 'autoscaling.amazonaws.com') }))).toEqual([]);
    // Auto Scaling's principal with another role, its role without the principal, another service.
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', SSO_ADMIN, { ...launched(vaultStaging), ...by(vaultStaging, SSO_ADMIN, 'autoscaling.amazonaws.com') }))).toEqual(['VaultHostProfileLaunch']);
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', AUTO_SCALING, launched(vaultStaging)))).toEqual(['VaultHostProfileLaunch']);
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', IMAGE_BUILDER, { ...launched(vaultStaging), ...by(vaultStaging, IMAGE_BUILDER, 'imagebuilder.amazonaws.com') }))).toEqual(['VaultHostProfileLaunch']);
  });
  test('both conditions are required: the caller alone, or the profile alone, is not enough', () => {
    const builder = `arn:aws:iam::${vaultStaging}:instance-profile/vettid-org-staging-vault-image-builder`;
    // A person, another profile; a root launch with no session context, another profile.
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', SSO_ADMIN, launched(vaultStaging, builder)))).toEqual([]);
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', 'iam-user', launched(vaultStaging, builder)))).toEqual([]);
    // A person, no profile at all.
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', SSO_ADMIN, { requestParameters: { instanceType: 'm7g.large' } }))).toEqual([]);
    // The host profile, an IAM user (no session context, no principal).
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', 'iam-user', launched(vaultStaging)))).toEqual(['VaultHostProfileLaunch']);
  });
  test.each([vaultProd, vaultStaging])('anything else launching an instance with the host profile in %s alerts', (acct) => {
    // From a template (profile in the response), by name, by ARN, and a refused attempt.
    expect(matching(apiCall(acct, 'aws.ec2', 'RunInstances', SSO_ADMIN, launched(acct)))).toEqual(['VaultHostProfileLaunch']);
    expect(matching(apiCall(acct, 'aws.ec2', 'RunInstances', SSO_ADMIN, { requestParameters: { iamInstanceProfile: { name: VAULT_ROLE_NAMES.host } } }))).toEqual(['VaultHostProfileLaunch']);
    expect(matching(apiCall(acct, 'aws.ec2', 'RunInstances', 'iam-user', { requestParameters: { iamInstanceProfile: { arn: hostProfileArn(acct) } }, errorCode: 'Client.UnauthorizedOperation' }))).toEqual(['VaultHostProfileLaunch']);
    // Through CloudFormation as well: a stack is not a release group.
    expect(matching(apiCall(acct, 'aws.ec2', 'RunInstances', CFN_EXEC, { ...launched(acct), ...by(acct, CFN_EXEC, 'cloudformation.amazonaws.com') }))).toEqual(['VaultHostProfileLaunch']);
  });
  test('instances with another profile are quiet: an image build, a deploy\'s template check', () => {
    const builder = `arn:aws:iam::${vaultStaging}:instance-profile/vettid-org-staging-vault-image-builder`;
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', IMAGE_BUILDER, { ...launched(vaultStaging, builder), requestParameters: { iamInstanceProfile: { name: 'vettid-org-staging-vault-image-builder' } }, ...by(vaultStaging, IMAGE_BUILDER, 'imagebuilder.amazonaws.com') }))).toEqual([]);
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', SSO_ADMIN, launched(vaultStaging, builder)))).toEqual([]);
    // CloudFormation validates a launch template with a dry run: no response, no profile in the request.
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', CFN_EXEC, { requestParameters: launched(vaultStaging).requestParameters, errorCode: 'Client.DryRunOperation', ...by(vaultStaging, CFN_EXEC, 'cloudformation.amazonaws.com') }))).toEqual([]);
    // Not a look-alike name either.
    expect(matching(apiCall(vaultStaging, 'aws.ec2', 'RunInstances', SSO_ADMIN, launched(vaultStaging, hostProfileArn(vaultStaging) + '-2')))).toEqual([]);
  });

  const LAUNCH_PATH: Array<[string, string]> = [
    ['aws.ec2', 'CreateLaunchTemplate'], ['aws.ec2', 'CreateLaunchTemplateVersion'], ['aws.ec2', 'ModifyLaunchTemplate'],
    ['aws.autoscaling', 'CreateAutoScalingGroup'], ['aws.autoscaling', 'UpdateAutoScalingGroup'], ['aws.autoscaling', 'CreateLaunchConfiguration'],
    ['aws.autoscaling', 'StartInstanceRefresh'],
    ['aws.ec2', 'AssociateIamInstanceProfile'], ['aws.ec2', 'ReplaceIamInstanceProfileAssociation'],
    ['aws.iam', 'AddRoleToInstanceProfile'],
  ];
  test.each(LAUNCH_PATH)('the ways around it alert, whoever does it (%s %s): a person, and a deploy too', (source, name) => {
    for (const acct of [vaultProd, vaultStaging]) {
      expect(matching(apiCall(acct, source, name, SSO_ADMIN))).toEqual(['VaultHostLaunchPath']);
      expect(matching(apiCall(acct, source, name, 'iam-user', { errorCode: 'AccessDenied' }))).toEqual(['VaultHostLaunchPath']);
      // No exception for the CDK execution role: whoever can pass it to a stack of
      // their own would otherwise get a host through Auto Scaling with no email.
      expect(matching(apiCall(acct, source, name, CFN_EXEC, by(acct, CFN_EXEC, 'cloudformation.amazonaws.com')))).toEqual(['VaultHostLaunchPath']);
    }
  });
  test('a release, as it deploys: three emails for a new release stack, one for a removed one', () => {
    const cfn = (source: string, name: string) => matching(apiCall(vaultStaging, source, name, CFN_EXEC, by(vaultStaging, CFN_EXEC, 'cloudformation.amazonaws.com')));
    // New: the template, the group (created empty), then its sizes.
    const deploy = [cfn('aws.ec2', 'CreateLaunchTemplate'), cfn('aws.autoscaling', 'CreateAutoScalingGroup'), cfn('aws.autoscaling', 'UpdateAutoScalingGroup')];
    expect(deploy.flat()).toEqual(['VaultHostLaunchPath', 'VaultHostLaunchPath', 'VaultHostLaunchPath']);
    // Removed: sizes to zero, then the deletions, which nothing reports.
    const destroy = [cfn('aws.autoscaling', 'UpdateAutoScalingGroup'), cfn('aws.autoscaling', 'DeleteAutoScalingGroup'), cfn('aws.ec2', 'DeleteLaunchTemplate')];
    expect(destroy.flat()).toEqual(['VaultHostLaunchPath']);
  });
  test('the scaler and a group\'s own activity are quiet, and so are the same calls in the other accounts', () => {
    const scaler = { userName: 'vettid-org-staging-vault-scaler', arn: 'arn:aws:sts::{acct}:assumed-role/vettid-org-staging-vault-scaler/fn' };
    expect(matching(apiCall(vaultStaging, 'aws.autoscaling', 'SetDesiredCapacity', scaler))).toEqual([]);
    expect(matching(apiCall(vaultStaging, 'aws.autoscaling', 'CompleteLifecycleAction', SSO_ADMIN))).toEqual([]);
    expect(matching(apiCall(MGMT, 'aws.ec2', 'CreateLaunchTemplate', SSO_ADMIN))).toEqual([]);
    expect(matching(apiCall(proteus, 'aws.iam', 'AddRoleToInstanceProfile', SSO_ADMIN))).toEqual([]);
  });

  // Every event name of the four rules, exactly: a name dropped from a rule,
  // or added to one, fails here.
  test('the event names of each rule', () => {
    const names = (id: RuleId) => [...rule(id).EventPattern.detail.eventName].sort();
    expect(names('VaultDataBucketConfig')).toEqual([
      'DeleteBucket', 'DeleteBucketLifecycle', 'DeleteBucketPolicy',
      'PutBucketLifecycle', 'PutBucketLifecycleConfiguration', 'PutBucketPolicy', 'PutBucketVersioning',
    ]);
    expect(names('VaultHostAccess')).toEqual([
      'CreateAssociation', 'CreateAssociationBatch', 'CreateInstanceConnectEndpoint', 'EnableSerialConsoleAccess', 'OpenTunnel',
      'RegisterTaskWithMaintenanceWindow', 'ResumeSession', 'SendCommand', 'SendSSHPublicKey', 'SendSerialConsoleSSHPublicKey',
      'StartAssociationsOnce', 'StartAutomationExecution', 'StartChangeRequestExecution', 'StartSession',
      'UpdateAssociation', 'UpdateMaintenanceWindowTask',
    ]);
    expect(rule('VaultHostAccess').EventPattern.detail.eventSource).toEqual(['ssm.amazonaws.com', 'ec2-instance-connect.amazonaws.com', 'ec2.amazonaws.com']);
    expect(names('VaultHostProfileLaunch')).toEqual(['RunInstances']);
    // Its two conditions, each written once and both required: the profile's
    // place (under `detail`) and the caller (under `userIdentity`). As one
    // list of their twelve combinations the pattern is longer than EventBridge
    // accepts (test/event-pattern-size.test.ts).
    const launch = rule('VaultHostProfileLaunch').EventPattern.detail;
    expect(Object.keys(launch).sort()).toEqual(['$or', 'eventName', 'userIdentity']);
    expect(launch.$or).toEqual([
      { responseElements: { instancesSet: { items: { iamInstanceProfile: { arn: [{ suffix: `:instance-profile/${VAULT_ROLE_NAMES.host}` }] } } } } },
      { requestParameters: { iamInstanceProfile: { arn: [{ suffix: `:instance-profile/${VAULT_ROLE_NAMES.host}` }] } } },
      { requestParameters: { iamInstanceProfile: { name: [VAULT_ROLE_NAMES.host] } } },
    ]);
    expect(launch.userIdentity).toEqual({
      $or: [
        { invokedBy: [{ 'anything-but': ['autoscaling.amazonaws.com'] }] },
        { invokedBy: [{ exists: false }] },
        { sessionContext: { sessionIssuer: { userName: [{ 'anything-but': ['AWSServiceRoleForAutoScaling'] }] } } },
        { sessionContext: { sessionIssuer: { userName: [{ exists: false }] } } },
      ],
    });
    expect(names('VaultHostLaunchPath')).toEqual(LAUNCH_PATH.map(([, n]) => n).sort());
    expect([...rule('VaultHostLaunchPath').EventPattern.source].sort()).toEqual(['aws.autoscaling', 'aws.ec2', 'aws.iam']);
    // No exception of any kind on the launch path or the bucket rule.
    expect(Object.keys(rule('VaultHostLaunchPath').EventPattern.detail)).toEqual(['eventName']);
    expect(Object.keys(rule('VaultDataBucketConfig').EventPattern.detail).sort()).toEqual(['eventName', 'requestParameters']);
    for (const id of ['VaultHostAccess', 'VaultHostProfileLaunch', 'VaultHostLaunchPath'] as RuleId[]) {
      expect(rule(id).EventPattern.account).toEqual([vaultProd, vaultStaging]);
    }
  });
  test.each(['PutBucketLifecycle', 'PutBucketLifecycleConfiguration', 'DeleteBucketLifecycle', 'PutBucketVersioning', 'PutBucketPolicy', 'DeleteBucketPolicy', 'DeleteBucket'])(
    'vault data bucket: %s by a deploy alerts',
    (name) => expect(matching(apiCall(vaultStaging, 'aws.s3', name, CFN_EXEC, bucket(stagingBucket)))).toEqual(['VaultDataBucketConfig']),
  );
  test.each([['aws.ec2-instance-connect', 'OpenTunnel'], ['aws.ec2-instance-connect', 'SendSSHPublicKey'], ['aws.ec2', 'CreateInstanceConnectEndpoint']])(
    'Instance Connect: %s %s alerts',
    (source, name) => expect(matching(apiCall(vaultProd, source, name, SSO_ADMIN))).toEqual(['VaultHostAccess']),
  );
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
  expect(new Set(services)).toEqual(new Set(['events.amazonaws.com', 'cloudwatch.amazonaws.com', 'budgets.amazonaws.com', 'costalerts.amazonaws.com']));
});

describe('cost alerts', () => {
  const statements = (Object.values(json.Resources).filter((r: any) => r.Type === 'AWS::SNS::TopicPolicy') as any[])
    .flatMap((p) => p.Properties.PolicyDocument.Statement);
  const sid = (s: string) => statements.find((x: any) => x.Sid === s);
  const topicId = Object.keys(t.findResources('AWS::SNS::Topic', { Properties: { TopicName: 'vettid-org-security-alerts' } }))[0];

  test('the topic admits AWS Budgets and Cost Anomaly Detection for this account only', () => {
    expect(sid('BudgetsOfThisAccount')).toMatchObject({
      Effect: 'Allow', Principal: { Service: 'budgets.amazonaws.com' }, Action: 'sns:Publish',
      Condition: { StringEquals: { 'aws:SourceAccount': ORG.management }, ArnLike: { 'aws:SourceArn': expect.anything() } },
    });
    expect(JSON.stringify(sid('BudgetsOfThisAccount').Condition.ArnLike)).toContain(`:budgets::${ORG.management}:*`);
    expect(sid('CostAnomaliesOfThisAccount')).toMatchObject({
      Effect: 'Allow', Principal: { Service: 'costalerts.amazonaws.com' }, Action: 'sns:Publish',
      Condition: { StringEquals: { 'aws:SourceAccount': ORG.management } },
    });
  });

  test('a daily cost budget of $15 for this account\'s own costs, to the security-alerts topic', () => {
    expect(COST_ALERTS.mainAccountDailyUsd).toBe(15);
    const budgets = Object.values<any>(t.findResources('AWS::Budgets::Budget'));
    expect(budgets).toHaveLength(1); // the organization's monthly budget is not in CDK
    const b = budgets[0];
    expect(b.Properties.Budget).toEqual({
      BudgetName: 'vettid-org-main-account-daily',
      BudgetType: 'COST',
      TimeUnit: 'DAILY',
      BudgetLimit: { Amount: 15, Unit: 'USD' },
      Metrics: ['UnblendedCost'],
      FilterExpression: {
        And: [
          { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [ORG.management] } },
          { Not: { Dimensions: { Key: 'RECORD_TYPE', Values: ['Credit', 'Refund'] } } },
        ],
      },
    });
    expect(b.Properties.NotificationsWithSubscribers).toEqual([
      {
        Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 100, ThresholdType: 'PERCENTAGE' },
        Subscribers: [{ SubscriptionType: 'SNS', Address: { Ref: topicId } }],
      },
    ]);
    // Created after the topic admits Budgets, or Budgets refuses the topic.
    expect(b.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^AlertsPolicy/)]));
  });

  test('cost anomalies of $40 or more on the account\'s services monitor, as found, to the topic', () => {
    expect(COST_ALERTS.anomalyImpactUsd).toBe(40);
    const subs = Object.values<any>(t.findResources('AWS::CE::AnomalySubscription'));
    expect(subs).toHaveLength(1);
    expect(subs[0].Properties).toMatchObject({
      SubscriptionName: 'vettid-org-cost-anomalies',
      MonitorArnList: [COST_ALERTS.servicesMonitorArn],
      Frequency: 'IMMEDIATE',
      Subscribers: [{ Type: 'SNS', Address: { Ref: topicId } }],
    });
    expect(JSON.parse(subs[0].Properties.ThresholdExpression)).toEqual({
      Dimensions: { Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE', MatchOptions: ['GREATER_THAN_OR_EQUAL'], Values: ['40'] },
    });
    expect(COST_ALERTS.servicesMonitorArn).toMatch(new RegExp(`^arn:aws:ce::${ORG.management}:anomalymonitor/`));
    // No monitor of its own: an account has one services monitor, AWS's.
    t.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    expect(subs[0].DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^AlertsPolicy/)]));
  });
});
