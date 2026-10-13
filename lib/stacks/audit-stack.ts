import * as cdk from 'aws-cdk-lib';
import * as accessanalyzer from 'aws-cdk-lib/aws-accessanalyzer';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import {
  ALERT_FORWARDER_ROLE_NAME, ALERT_HEARTBEAT_RULE_NAME, AppConfig, ORG, ORG_MEMBER_ACCOUNTS, VAULT_ROLE_NAMES, resourceName, vaultDataBucketNames,
} from '../config';
import { readRef } from '../constructs/ssm-refs';

/** AWS Organizations organization (docs/AWS-ACCOUNTS.md). */
const ORG_ID = ORG.id;

/**
 * The standard way into every account: Identity Center's VettIDAdmin
 * permission set (its roles are AWSReservedSSO_VettIDAdmin_<suffix>).
 */
const STANDARD_SSO_ROLE_PREFIX = 'AWSReservedSSO_VettIDAdmin_';

export interface VettidOrgAuditStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Account-level audit and detection (security review, 2026-10-01):
 *  - CloudTrail: one multi-region trail with log-file validation into a
 *    dedicated, retained bucket; S3 data events on the membership-terms bucket
 *    and on the vault data buckets of both vault accounts
 *  - GuardDuty detector (us-east-1)
 *  - IAM Access Analyzer (account scope) for anything shared externally
 *  - EventBridge → SNS → email alerts for high-signal events, for every
 *    account in the organization: the member accounts forward their
 *    CloudTrail events to this account's default bus
 *    (VettidOrgAlertForwardStack; this stack's bus policy admits them), and
 *    member GuardDuty findings arrive here because this account is the
 *    GuardDuty administrator. CDK deploys create roles and security groups
 *    all the time, so most rules exclude CloudFormation's deploy role
 *    rather than alerting on every deploy.
 *
 * The SNS email subscription must be confirmed once from the inbox.
 * Alert rules run in us-east-1, where global (IAM, sign-in) events land.
 * RUNBOOK "Security alerts" lists the rules and how to test one.
 */
export class VettidOrgAuditStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAuditStackProps) {
    super(scope, id, props);
    const { config } = props;

    // ---- CloudTrail -------------------------------------------------------
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      bucketName: `${resourceName(config, 'cloudtrail')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [{ storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: cdk.Duration.days(90) }],
          expiration: cdk.Duration.days(400),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    const trail = new cloudtrail.Trail(this, 'Trail', {
      trailName: resourceName(config, 'trail'),
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
      // Organization trail: also records every member account (vault prod,
      // vault staging, proteus — docs/AWS-ACCOUNTS.md). Members can't stop or
      // change it; the SCP baseline protects their side as well.
      isOrganizationTrail: true,
      orgId: ORG_ID,
    });
    // Who read or wrote membership terms (data events; cents per month).
    const termsBucket = s3.Bucket.fromBucketName(this, 'TermsBucket', readRef(this, config, 'data/terms-bucket-name'));
    trail.addS3EventSelector([{ bucket: termsBucket }], { readWriteType: cloudtrail.ReadWriteType.ALL, includeManagementEvents: false });
    // Every object call on the vault data buckets (the vault accounts'; an
    // organization trail records member buckets by ARN): who read, wrote or
    // deleted which sealed object, from where. Reads too: the objects are
    // sealed, so the question after an incident is "was anything taken",
    // and only read events answer it. The enclave host is the main caller,
    // so the volume follows vault activity: $1 per million events (RUNBOOK
    // "Vault data events" has the arithmetic; WRITE_ONLY here halves it at
    // the price of that answer). The records land in the trail bucket with
    // the management events, under the member account's prefix.
    trail.addS3EventSelector(
      vaultDataBucketNames().map((name, i) => ({ bucket: s3.Bucket.fromBucketName(this, `VaultDataBucket${i}`, name) })),
      { readWriteType: cloudtrail.ReadWriteType.ALL, includeManagementEvents: false },
    );

    // ---- GuardDuty + Access Analyzer ---------------------------------------
    new guardduty.CfnDetector(this, 'GuardDuty', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      features: [{ name: 'S3_DATA_EVENTS', status: 'ENABLED' }],
    });
    new accessanalyzer.CfnAnalyzer(this, 'AccessAnalyzer', {
      analyzerName: resourceName(config, 'access-analyzer'),
      type: 'ACCOUNT',
    });

    // ---- Alerts -------------------------------------------------------------
    // One place for every account in the organization: each member account
    // forwards its CloudTrail events to this account's default bus
    // (VettidOrgAlertForwardStack), and the rules below match events from
    // any account; `account` in each email says which. GuardDuty findings of
    // the members arrive here directly (this account is the GuardDuty
    // administrator). RUNBOOK "Security alerts".
    const topic = new sns.Topic(this, 'Alerts', {
      topicName: resourceName(config, 'security-alerts'),
      displayName: 'VettID security alerts',
    });
    topic.addSubscription(new subs.EmailSubscription(config.adminEmail));
    // CloudWatch alarms publish as the CloudWatch service, which an SNS
    // topic admits only when its policy names it: the statements CDK adds
    // for the EventBridge rule targets below cover events.amazonaws.com
    // alone, and every alarm on this topic (the heartbeats here, the
    // member API's vault-service alarms) then fails with "not authorized
    // to perform: SNS:Publish" (seen 2026-10-06). Only this account's
    // alarms, never another's.
    topic.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AlarmsOfThisAccount',
      principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [topic.topicArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
        ArnLike: { 'aws:SourceArn': `arn:${this.partition}:cloudwatch:${this.region}:${this.account}:alarm:*` },
      },
    }));

    // Admit the members' forwarding rules to the default bus: each member
    // account's one forwarder role, and only from inside the organization.
    // Principals are the member accounts (never "*"), narrowed to the role.
    new events.CfnEventBusPolicy(this, 'MemberForwardPolicy', {
      eventBusName: 'default',
      statementId: 'vettid-org-member-security-events',
      statement: {
        Sid: 'vettid-org-member-security-events',
        Effect: 'Allow',
        Principal: { AWS: ORG_MEMBER_ACCOUNTS.map((a) => `arn:aws:iam::${a}:root`) },
        Action: 'events:PutEvents',
        Resource: `arn:aws:events:${this.region}:${this.account}:event-bus/default`,
        Condition: {
          StringEquals: { 'aws:PrincipalOrgID': ORG.id },
          ArnEquals: { 'aws:PrincipalArn': ORG_MEMBER_ACCOUNTS.map((a) => `arn:aws:iam::${a}:role/${ALERT_FORWARDER_ROLE_NAME}`) },
        },
      },
    });

    // "Not CloudFormation's CDK deploy role" (cdk-<qualifier>-cfn-exec-role-*
    // in any account; the same pattern the SCPs exempt). anything-but never
    // matches a MISSING field, and IAM-user/root calls have no session
    // issuer, so those must be matched explicitly or they'd slip through
    // unalerted. Creating a role with a cfn-exec-like name outside a deploy
    // is itself alerted (IamRoleOrPolicyChanges).
    const notDeploy = {
      $or: [
        { userIdentity: { sessionContext: { sessionIssuer: { userName: events.Match.anythingButWildcard('cdk-*-cfn-exec-role-*') } } } },
        { userIdentity: { sessionContext: { sessionIssuer: { userName: events.Match.doesNotExist() } } } },
      ],
    };
    // KMS in the vault accounts is alerted by the vault's own rules
    // (VettidOrgVaultHostStack, topic vettid-org[-staging]-vault-alerts, a
    // superset of these), so not twice.
    const notVaultAccount = { account: events.Match.anythingBut(ORG.members.vaultProd, ORG.members.vaultStaging) };

    const ev = (path: string) => events.EventField.fromPath(path);
    const apiCall = (id: string, description: string, source: string[], detail: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      new events.Rule(this, id, {
        description,
        eventPattern: { source, detailType: ['AWS API Call via CloudTrail'], detail, ...extra },
        targets: [
          new targets.SnsTopic(topic, {
            message: events.RuleTargetInput.fromText(
              `VettID security alert: ${description}\n\n` +
                `account: ${ev('$.account')}\n` +
                `event:   ${ev('$.detail.eventName')}\n` +
                `error:   ${ev('$.detail.errorCode')}\n` +
                `who:     ${ev('$.detail.userIdentity.arn')}\n` +
                `from:    ${ev('$.detail.sourceIPAddress')}\n` +
                `region:  ${ev('$.region')}\n` +
                `time:    ${ev('$.time')}\n\n` +
                'Look up the full event in CloudTrail (Event history, in that account) by time and event name. ' +
                'An error (e.g. AccessDenied) means the call was attempted and refused. RUNBOOK "Security alerts".',
            ),
          }),
        ],
      });
    const signIn = (id: string, description: string, pattern: Record<string, unknown>) =>
      new events.Rule(this, id, {
        description,
        eventPattern: { detailType: ['AWS Console Sign In via CloudTrail'], ...pattern },
        targets: [
          new targets.SnsTopic(topic, {
            message: events.RuleTargetInput.fromText(
              `VettID security alert: ${description}\n\n` +
                `account: ${ev('$.account')}\n` +
                `event:   ${ev('$.detail.eventName')}\n` +
                `who:     ${ev('$.detail.userIdentity.arn')}\n` +
                `result:  ${ev('$.detail.responseElements.ConsoleLogin')}\n` +
                `MFA:     ${ev('$.detail.additionalEventData.MFAUsed')}\n` +
                `from:    ${ev('$.detail.sourceIPAddress')}\n` +
                `time:    ${ev('$.time')}`,
            ),
          }),
        ],
      });

    new events.Rule(this, 'RootActivity', {
      description: 'Any use of the root user',
      eventPattern: {
        detailType: ['AWS API Call via CloudTrail', 'AWS Console Sign In via CloudTrail'],
        detail: { userIdentity: { type: ['Root'] } },
      },
      targets: [
        new targets.SnsTopic(topic, {
          message: events.RuleTargetInput.fromText(
            'VettID security alert: the ROOT user was used.\n\n' +
              `account: ${ev('$.account')}\n` +
              `event:   ${ev('$.detail.eventName')}\n` +
              `error:   ${ev('$.detail.errorCode')}\n` +
              `from:    ${ev('$.detail.sourceIPAddress')}\n` +
              `time:    ${ev('$.time')}\n\n` +
              'If this was not you, treat the account as compromised.',
          ),
        }),
      ],
    });

    // Federated (Identity Center) sign-ins always record MFAUsed "No": MFA
    // happens at the Identity Center portal. So the MFA check is for root and
    // IAM users only; failures are alerted for everyone.
    signIn('ConsoleSignInRisk', 'console sign-in that failed, or root/IAM-user sign-in without MFA', {
      detail: {
        $or: [
          { responseElements: { ConsoleLogin: ['Failure'] } },
          { additionalEventData: { MFAUsed: ['No'] }, userIdentity: { type: ['Root', 'IAMUser'] } },
        ],
      },
    });

    // The one standard way in is Identity Center's VettIDAdmin permission
    // set. Any other role (another permission set, switch-role into
    // OrganizationAccountAccessRole) or an IAM user signing in is unusual.
    signIn('NonStandardConsoleSignIn', 'console sign-in with something other than the VettIDAdmin permission set', {
      detail: {
        eventName: ['ConsoleLogin', 'SwitchRole'],
        userIdentity: {
          type: ['AssumedRole', 'IAMUser'],
          arn: events.Match.anythingButWildcard(`arn:aws:sts::*:assumed-role/${STANDARD_SSO_ROLE_PREFIX}*`),
        },
      },
    });

    // Production vault: console use there is rare enough to report every time.
    signIn('VaultProdConsoleSignIn', 'console sign-in to the PRODUCTION VAULT account', {
      account: [ORG.members.vaultProd],
      detail: { eventName: ['ConsoleLogin'], responseElements: { ConsoleLogin: ['Success'] } },
    });

    apiCall('IamCredentialChanges', 'IAM users, credentials or MFA changed', ['aws.iam'], {
      eventName: [
        'CreateUser',
        'CreateAccessKey',
        'UpdateAccessKey',
        'CreateLoginProfile',
        'UpdateLoginProfile',
        'AttachUserPolicy',
        'PutUserPolicy',
        'AddUserToGroup',
        'DeactivateMFADevice',
        'DeleteVirtualMFADevice',
        'UpdateAccountPasswordPolicy',
      ],
      ...notDeploy,
    });

    apiCall('IamRoleOrPolicyChanges', 'IAM role, trust policy, permission policy or identity provider changed (outside a deploy)', ['aws.iam'], {
      eventName: [
        'CreateRole',
        'DeleteRole',
        'UpdateAssumeRolePolicy',
        'AttachRolePolicy',
        'PutRolePolicy',
        'PutRolePermissionsBoundary',
        'DeleteRolePermissionsBoundary',
        'CreatePolicyVersion',
        'SetDefaultPolicyVersion',
        'AttachGroupPolicy',
        'PutGroupPolicy',
        'CreateSAMLProvider',
        'UpdateSAMLProvider',
        'CreateOpenIDConnectProvider',
        'UpdateOpenIDConnectProviderThumbprint',
        'AddClientIDToOpenIDConnectProvider',
      ],
      ...notDeploy,
    });

    apiCall(
      'AuditTampering',
      'audit/detection/alerting settings changed (CloudTrail, GuardDuty, Access Analyzer, EventBridge rules or bus policy)',
      ['aws.cloudtrail', 'aws.guardduty', 'aws.access-analyzer', 'aws.events'],
      {
        eventName: [
          // CloudTrail
          'StopLogging', 'DeleteTrail', 'UpdateTrail', 'PutEventSelectors',
          // GuardDuty: detector, membership, and anything that hides findings
          'DeleteDetector', 'UpdateDetector', 'DisassociateFromMasterAccount', 'DisassociateFromAdministratorAccount',
          'DisassociateMembers', 'DeleteMembers', 'StopMonitoringMembers', 'UpdateOrganizationConfiguration',
          'CreateFilter', 'UpdateFilter', 'CreateIPSet', 'UpdateIPSet',
          // Access Analyzer (archive rules hide findings)
          'DeleteAnalyzer', 'CreateArchiveRule', 'UpdateArchiveRule',
          // EventBridge: these alert rules, the member forwarders, the bus policy
          'DeleteRule', 'DisableRule', 'RemoveTargets', 'PutPermission', 'RemovePermission',
        ],
        ...notDeploy,
      },
    );

    // Organizations and Identity Center live in this (management) account.
    // MoveAccount matters: an account moved out of its OU loses that OU's SCPs.
    apiCall('OrgOrSsoChanges', 'organization, SCP or Identity Center (permission set, assignment, user) changed', ['aws.organizations', 'aws.sso', 'aws.identitystore'], {
      eventName: [
        // Organizations
        'LeaveOrganization', 'RemoveAccountFromOrganization', 'MoveAccount', 'CreateAccount', 'InviteAccountToOrganization',
        'CreatePolicy', 'UpdatePolicy', 'DeletePolicy', 'AttachPolicy', 'DetachPolicy', 'DisablePolicyType',
        'EnableAWSServiceAccess', 'DisableAWSServiceAccess', 'RegisterDelegatedAdministrator', 'DeregisterDelegatedAdministrator',
        // Identity Center
        'CreatePermissionSet', 'UpdatePermissionSet', 'PutInlinePolicyToPermissionSet', 'AttachManagedPolicyToPermissionSet',
        'AttachCustomerManagedPolicyReferenceToPermissionSet', 'PutPermissionsBoundaryToPermissionSet', 'CreateAccountAssignment',
        // Identity store
        'CreateUser', 'CreateGroupMembership',
      ],
    });

    // Root sessions into member accounts (centralized root access).
    apiCall('CentralRootSession', 'a root session was opened into a member account (sts:AssumeRoot)', ['aws.sts'], {
      eventName: ['AssumeRoot'],
    });

    // Key deletion is rare and important: always reported, deploys included.
    apiCall(
      'KmsKeyDeletion',
      'KMS key deletion scheduled or cancelled, key disabled, or key material deleted',
      ['aws.kms'],
      { eventName: ['ScheduleKeyDeletion', 'CancelKeyDeletion', 'DisableKey', 'DeleteImportedKeyMaterial'] },
      notVaultAccount,
    );
    // The vault service pause (MEMBER-API "Vault service pause"): every
    // write to the switch parameter, from the admin API or the CLI, in any
    // stage's account (staging's arrives through its forwarder). Including
    // deploys: none should ever touch it.
    apiCall('VaultServiceSwitch', 'vault service switch changed (pause or resume of the member API vault routes; RUNBOOK "Pausing the vault service")', ['aws.ssm'], {
      eventName: ['PutParameter', 'DeleteParameter', 'DeleteParameters', 'LabelParameterVersion'],
      requestParameters: { $or: [{ name: events.Match.wildcard('*switch/vault-service') }, { names: events.Match.wildcard('*switch/vault-service') }] },
    });
    apiCall('KmsKeyPolicy', 'KMS key policy changed (outside a deploy)', ['aws.kms'], { eventName: ['PutKeyPolicy'], ...notDeploy }, notVaultAccount);

    apiCall('S3PublicAccess', 'S3 bucket policy, ACL, ownership or public-access block changed (outside a deploy)', ['aws.s3'], {
      eventName: [
        'PutBucketPolicy',
        'DeleteBucketPolicy',
        'PutBucketAcl',
        'PutBucketOwnershipControls',
        'PutBucketPublicAccessBlock',
        'DeleteBucketPublicAccessBlock',
        'PutAccountPublicAccessBlock',
        'DeleteAccountPublicAccessBlock',
      ],
      ...notDeploy,
    });

    // ---- The vault accounts: data bucket, hosts, the host role -----------------
    const vaultAccounts = { account: [ORG.members.vaultProd, ORG.members.vaultStaging] };

    // There is no export or snapshot of vault data, so these calls can
    // destroy it for good: an expiry rule or suspended versioning removes
    // every object and then every older version; the bucket policy is what
    // keeps the objects to the host role. Rare and important: always
    // reported, deploys included (a deploy changes them only when the vault
    // stack's bucket definition changes). The Vault OU policy also denies
    // them to everyone but the CDK execution role; a refused attempt is
    // reported with its error. A bucket policy change outside a deploy is
    // reported by S3PublicAccess as well.
    apiCall('VaultDataBucketConfig', 'vault data bucket: lifecycle, versioning or bucket policy changed, or the bucket deleted (deploys included)', ['aws.s3'], {
      eventName: [
        'PutBucketLifecycle', // the name CloudTrail gives PutBucketLifecycleConfiguration
        'PutBucketLifecycleConfiguration',
        'DeleteBucketLifecycle',
        'PutBucketVersioning',
        'PutBucketPolicy',
        'DeleteBucketPolicy',
        'DeleteBucket',
      ],
      requestParameters: { bucketName: vaultDataBucketNames() },
    });

    // A command on an instance in a vault account, or an attempt at an
    // interactive way in. Run Command is how hosts are operated (a
    // release's self-test, the capacity measurement): CloudTrail records
    // that a command ran and on which instance, not what it was. The SSM
    // agent runs documents for more than SendCommand, so every call that
    // can make it run one is here: a State Manager association (the agent
    // fetches those itself, with no SendCommand), an automation, a
    // maintenance-window task. None is in use in the vault accounts.
    // Sessions, EC2 Instance Connect and the serial console are denied to
    // everyone by the Vault OU policy (lib/org/scp-vault.json), so those
    // arrive as refused attempts, or as a sign that the policy is off.
    // Matched by the event's own source field: the calls come from three
    // services.
    //
    // "Not this AWS service acting through its own service-linked role":
    // both fields are set by AWS, and a role with that name cannot be made
    // by hand. Either one differing or missing means someone else. Image
    // Builder drives its build instances with Run Command on every image
    // build; a release group's launches are Auto Scaling's.
    const notService = (service: string, role: string) => [
      { userIdentity: { invokedBy: events.Match.anythingBut(service) } },
      { userIdentity: { invokedBy: events.Match.doesNotExist() } },
      { userIdentity: { sessionContext: { sessionIssuer: { userName: events.Match.anythingBut(role) } } } },
      { userIdentity: { sessionContext: { sessionIssuer: { userName: events.Match.doesNotExist() } } } },
    ];
    apiCall(
      'VaultHostAccess',
      'operator access to an instance in a vault account (a Run Command or another way to have the SSM agent run one; or an interactive session, Instance Connect or serial console call, which the Vault OU policy denies)',
      events.Match.prefix('aws.'),
      {
        eventSource: ['ssm.amazonaws.com', 'ec2-instance-connect.amazonaws.com', 'ec2.amazonaws.com'],
        eventName: [
          'SendCommand',
          'CreateAssociation', 'CreateAssociationBatch', 'UpdateAssociation', 'StartAssociationsOnce',
          'StartAutomationExecution', 'StartChangeRequestExecution',
          'RegisterTaskWithMaintenanceWindow', 'UpdateMaintenanceWindowTask',
          'StartSession', 'ResumeSession',
          'SendSSHPublicKey', 'SendSerialConsoleSSHPublicKey', 'OpenTunnel', 'CreateInstanceConnectEndpoint',
          'EnableSerialConsoleAccess',
        ],
        $or: notService('imagebuilder.amazonaws.com', 'AWSServiceRoleForImageBuilder'),
      },
      vaultAccounts,
    );

    // The host role's credentials are what reads and deletes sealed vault
    // objects. The release stacks hand them to instances through their
    // Auto Scaling groups only, so: an instance launched with the host
    // instance profile by anything else (the profile is in the request for
    // a direct launch, in the response for a launch from a template), ...
    const hostProfile = events.Match.suffix(`:instance-profile/${VAULT_ROLE_NAMES.host}`);
    apiCall(
      'VaultHostProfileLaunch',
      `an instance was launched with the vault host instance profile (${VAULT_ROLE_NAMES.host}) by something other than Auto Scaling`,
      ['aws.ec2'],
      {
        eventName: ['RunInstances'],
        $or: [
          { responseElements: { instancesSet: { items: { iamInstanceProfile: { arn: hostProfile } } } } },
          { requestParameters: { iamInstanceProfile: { arn: hostProfile } } },
          { requestParameters: { iamInstanceProfile: { name: [VAULT_ROLE_NAMES.host] } } },
        ].flatMap((profile) => notService('autoscaling.amazonaws.com', 'AWSServiceRoleForAutoScaling').map((who) => ({ ...profile, ...who }))),
      },
      vaultAccounts,
    );
    // ... and the ways to get Auto Scaling, or an instance that already
    // runs, to do it instead: a launch template or group, a refresh of a
    // group's instances, a profile swapped on an instance, a role put into
    // another profile. Deploys included, unlike most rules here: a release
    // stack is how hosts come to exist, and anyone who can pass the CDK
    // execution role to a stack of their own would otherwise get a host
    // through Auto Scaling with no email at all. A release deploy sends
    // three (template, group, the group's sizes) and a release's removal
    // one; RUNBOOK lists them as expected.
    apiCall(
      'VaultHostLaunchPath',
      'launch template, Auto Scaling group or instance profile created, changed or attached in a vault account (deploys included: expected for a release, RUNBOOK "Security alerts")',
      ['aws.ec2', 'aws.autoscaling', 'aws.iam'],
      {
        eventName: [
          'CreateLaunchTemplate', 'CreateLaunchTemplateVersion', 'ModifyLaunchTemplate',
          'CreateAutoScalingGroup', 'UpdateAutoScalingGroup', 'CreateLaunchConfiguration', 'StartInstanceRefresh',
          'AssociateIamInstanceProfile', 'ReplaceIamInstanceProfileAssociation',
          'AddRoleToInstanceProfile',
        ],
      },
      vaultAccounts,
    );

    apiCall('SecurityGroupOpenToWorld', 'security group opened to the whole internet (outside a deploy)', ['aws.ec2'], {
      eventName: ['AuthorizeSecurityGroupIngress'],
      // (IPv4 or IPv6 world) and not a deploy: EventBridge has no $and, so
      // the cross product of the two $or lists.
      $or: [
        { requestParameters: { ipPermissions: { items: { ipRanges: { items: { cidrIp: ['0.0.0.0/0'] } } } } } },
        { requestParameters: { ipPermissions: { items: { ipv6Ranges: { items: { cidrIpv6: ['::/0'] } } } } } },
      ].flatMap((world) => notDeploy.$or.map((who) => ({ ...world, ...who }))),
    });

    // Members' findings included: this account is the GuardDuty administrator.
    new events.Rule(this, 'GuardDutyFindings', {
      description: 'GuardDuty findings, medium severity and above (every account in the organization)',
      eventPattern: { source: ['aws.guardduty'], detailType: ['GuardDuty Finding'], detail: { severity: events.Match.greaterThanOrEqual(4) } },
      targets: [
        new targets.SnsTopic(topic, {
          message: events.RuleTargetInput.fromText(
            `VettID GuardDuty finding (severity ${ev('$.detail.severity')}): ${ev('$.detail.title')}\n\n` +
              `account: ${ev('$.detail.accountId')}\n` +
              `type:    ${ev('$.detail.type')}\n` +
              `time:    ${ev('$.time')}\n\n` +
              'Details: GuardDuty console → Findings (management account; it shows every member).',
          ),
        }),
      ],
    });

    // ---- Forwarding heartbeat ------------------------------------------------
    // Each member account's heartbeat rule puts a scheduled event on this bus
    // every hour, through the forwarder role, bus policy and SCP. A rule here
    // per member counts them (its Invocations metric; the target is a
    // throwaway queue, since a rule needs a target to be invoked), and an
    // alarm fires when none arrived for three hours: the member's alerts are
    // not reaching us. Why not the member rule's FailedInvocations: that
    // metric lives in the member account, so notifying from there would
    // need a topic and subscription per account, and it misses a rule that
    // was disabled or deleted. Not "no CloudTrail events for 24 h" either:
    // quiet accounts (proteus) have days without a single write call.
    const heartbeatSink = new sqs.Queue(this, 'HeartbeatSink', {
      queueName: resourceName(config, 'security-alert-heartbeats'),
      retentionPeriod: cdk.Duration.seconds(60),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    const alarmAction = new cwActions.SnsAction(topic);
    for (const [name, account] of Object.entries(ORG.members)) {
      const id = name.charAt(0).toUpperCase() + name.slice(1);
      const beat = new events.Rule(this, `Heartbeat${id}`, {
        description: `Hourly forwarding heartbeat from ${name} (${account})`,
        eventPattern: {
          source: ['aws.events'],
          detailType: ['Scheduled Event'],
          account: [account],
          resources: [`arn:aws:events:${this.region}:${account}:rule/${ALERT_HEARTBEAT_RULE_NAME}`],
        },
        targets: [new targets.SqsQueue(heartbeatSink)],
      });
      const alarm = new cloudwatch.Alarm(this, `HeartbeatMissing${id}`, {
        alarmName: resourceName(config, `security-alert-heartbeat-${name}`),
        alarmDescription:
          `No security-alert heartbeat from ${name} (${account}) for 3 hours: its CloudTrail events are not reaching the ` +
          'alert rules. Check its forwarder (RUNBOOK "Security alerts").',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Events',
          metricName: 'Invocations',
          dimensionsMap: { RuleName: beat.ruleName },
          statistic: 'Sum',
          period: cdk.Duration.hours(1),
        }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      alarm.addAlarmAction(alarmAction);
      alarm.addOkAction(alarmAction);
    }

    new cdk.CfnOutput(this, 'AlertTopicArn', { value: topic.topicArn });
  }
}
