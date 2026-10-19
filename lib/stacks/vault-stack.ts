import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig, VAULT_RELEASE_KEY_FUNCTION_NAME, VAULT_ROLE_NAMES, VaultConfig, resourceName, vaultRecoveryBucketName, vaultRoleArn } from '../config';
import { ApiFunction } from '../constructs/api-function';
import { ReleaseKey, ReleaseKeySpec } from '../constructs/release-key';
import { publishRef } from '../constructs/ssm-refs';
import { ownerTrust as ownerTrustIn } from '../constructs/owner-trust';
import {
  SEALED_RELEASE_INDEX,
  VaultTable,
  vaultControlQueueArnPattern,
  vaultControlQueuePolicy,
  vaultControlQueuePrefix,
  vaultDlqName,
  vaultTableName,
  vaultTableResourceStatements,
  vaultsStreamResourceStatements,
} from '../vault/access';

// The owner's permission set (Identity Center): the only principal that may
// assume the manifest-signer and retirement roles (lib/constructs/owner-trust.ts).
export { OWNER_PERMISSION_SET } from '../constructs/owner-trust';

/**
 * Old versions of the data bucket's objects (owner, 2026-10-13: the
 * current version and a few older ones are enough). A vault's state is one
 * object rewritten in full at every change, so its old versions are where
 * the bucket's bytes go. S3 removes a noncurrent version when it has been
 * noncurrent for more than `keepAllDays` AND `keepNewest` newer noncurrent
 * versions of the object exist, or when it has been noncurrent for more
 * than `maxDays`, whichever comes first. S3 counts days from the moment a
 * version was replaced, rounds up to the next midnight UTC and removes
 * some time after that.
 */
export const VAULT_DATA_VERSIONS = {
  /** Every version replaced within this many days is kept (1 is the least S3 accepts). */
  keepAllDays: 1,
  /** Beyond that, this many of the newest noncurrent versions of each object (S3 allows 1 to 100). */
  keepNewest: 5,
  /** No noncurrent version is kept longer than this; it also bounds how long a deleted vault's objects stay (VAULT-RELEASES §11.4). */
  maxDays: 7,
} as const;

/**
 * The recovery counter bucket's one lifecycle rule (release R): a version
 * that has been noncurrent this many days is removed, if its lock has ended
 * (S3 never removes a locked version). Never a rule on current versions.
 */
export const VAULT_RECOVERY_NONCURRENT_DAYS = 30;

/**
 * What the enclave host role may do on the recovery counter bucket
 * (VAULT-HOST-PROTOCOL §8.1, P18): write a new object or version, set and
 * read its lock, read a version, list versions. Nothing that deletes,
 * bypasses or holds a lock, or touches the bucket's configuration.
 */
export const VAULT_RECOVERY_HOST_OBJECT_ACTIONS = ['s3:PutObject', 's3:PutObjectRetention', 's3:GetObjectVersion', 's3:GetObjectRetention'] as const;
export const VAULT_RECOVERY_HOST_BUCKET_ACTIONS = ['s3:ListBucketVersions'] as const;

export interface VettidOrgVaultStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Release keys to hold (none yet; W7 feeds them from releases.json). */
  readonly releaseKeys?: readonly ReleaseKeySpec[];
}

/**
 * Stateful vault stack, deployed into the vault account of the stage's
 * channel (docs/VAULT-RELEASES.md §6, §8.1–8.2; AWS-ACCOUNTS.md):
 *
 *  - the vault tables (moved here from VettidOrgDataStack, §8.1), with
 *    resource policies that admit exactly the member API's grants;
 *  - the vault data bucket;
 *  - the recovery attempt counter bucket (release R; Object Lock in
 *    compliance mode, which can never be undone);
 *  - the enclave HOST role and the key RETIREMENT role, with fixed names:
 *    every release key's policy names them forever (§6.3);
 *  - manifest signing key A and the owner-only signer role (§6.1);
 *  - the release-key custom resource and one key per release (§6.2).
 *
 * Everything is retained and the stack has termination protection. Refs are
 * published under `/vettid-org/<stage>/vault/*` in the vault account.
 */
export class VettidOrgVaultStack extends cdk.Stack {
  readonly hostRole: iam.Role;
  readonly retirementRole: iam.Role;
  readonly dataBucket: s3.Bucket;
  /** The recovery attempt counter (release R; Object Lock, compliance mode, irreversible). */
  readonly recoveryBucket: s3.Bucket;
  readonly tables: Record<VaultTable, dynamodb.TableV2>;
  readonly releaseKeys: ReleaseKey[] = [];

  constructor(scope: Construct, id: string, props: VettidOrgVaultStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vault = config.vault;
    if (!vault) throw new Error(`stage ${config.stage} has no vault account`);
    if (props.env?.account !== vault.account) {
      throw new Error(`VettidOrgVaultStack must be deployed into the ${vault.channel} vault account ${vault.account}`);
    }
    const retain = cdk.RemovalPolicy.RETAIN;

    // ---- the owner (Identity Center; MFA at sign-in, see owner-trust.ts) -------
    const ownerTrust = (): iam.PrincipalBase => ownerTrustIn(vault.account);

    // ---- the roles named in key policies (FIXED NAMES, never delete) ------------
    this.hostRole = new iam.Role(this, 'HostRole', {
      roleName: VAULT_ROLE_NAMES.host,
      description: 'Vault enclave host (EC2). Named in every release key policy: NEVER rename or delete (VAULT-RELEASES §6.3).',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    this.hostRole.applyRemovalPolicy(retain);
    const instanceProfile = new iam.InstanceProfile(this, 'HostInstanceProfile', {
      instanceProfileName: VAULT_ROLE_NAMES.host,
      role: this.hostRole,
    });
    instanceProfile.applyRemovalPolicy(retain);

    this.retirementRole = new iam.Role(this, 'RetirementRole', {
      roleName: VAULT_ROLE_NAMES.retirement,
      description:
        'Schedules (with exactly the pinned window), cancels and re-enables release key deletion. Named in every release key policy: NEVER rename or delete (VAULT-RELEASES §6.3).',
      assumedBy: ownerTrust(),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    this.retirementRole.applyRemovalPolicy(retain);
    // No IAM grants: each release key's policy names this role directly
    // (same account), for exactly ScheduleKeyDeletion (pinned window),
    // CancelKeyDeletion, EnableKey and the reads vaultctl keycheck needs.

    // ---- tables (VAULT-MESSAGING §11.5; were in VettidOrgDataStack) -------------
    const S = dynamodb.AttributeType.STRING;
    const N = dynamodb.AttributeType.NUMBER;
    const ephemeral = { timeToLiveAttribute: 'expires_at', pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false } };
    const table = (key: VaultTable, partitionKey: dynamodb.Attribute, extra: Partial<dynamodb.TablePropsV2> = {}) =>
      new dynamodb.TableV2(this, `Table-${key}`, {
        tableName: vaultTableName(config, key),
        partitionKey,
        billing: dynamodb.Billing.onDemand(),
        // DynamoDB's own key, not the account's AWS-managed aws/dynamodb key:
        // an AWS-managed key can't be used from another account, and the
        // production member API reads these tables from the API account
        // (the resource policies below admit its roles). With DynamoDB's
        // own key a caller needs no KMS permission at all.
        encryption: dynamodb.TableEncryptionV2.dynamoOwnedKey(),
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        deletionProtection: true,
        removalPolicy: retain,
        resourcePolicy: iam.PolicyDocument.fromJson({ Version: '2012-10-17', Statement: vaultTableResourceStatements(config, vault, key) }),
        ...extra,
      });
    this.tables = {
      // vaults: PK vault_id; `user#<guid>` pointer rows. The stream (new
      // images) feeds the member API's alarm mailer across accounts.
      vaults: table('vaults', { name: 'vault_id', type: S }, {
        dynamoStream: dynamodb.StreamViewType.NEW_IMAGE,
        streamResourcePolicy: iam.PolicyDocument.fromJson({ Version: '2012-10-17', Statement: vaultsStreamResourceStatements(config, vault) }),
        globalSecondaryIndexes: [
          { indexName: 'user-index', partitionKey: { name: 'user_guid', type: S }, sortKey: { name: 'created_at', type: S } },
          // The release notice job (W8) finds the vaults sealed to a release
          // here; it sees only these attributes, never leases or alarms.
          {
            indexName: SEALED_RELEASE_INDEX,
            partitionKey: { name: 'sealed_release', type: S },
            sortKey: { name: 'vault_id', type: S },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['user_guid', 'state'],
          },
        ],
      }),
      // vault-instances: the registry, kept alive by the parent's heartbeat.
      'vault-instances': table('vault-instances', { name: 'instance_id', type: S }, {
        ...ephemeral,
        globalSecondaryIndexes: [
          {
            indexName: 'release-index',
            partitionKey: { name: 'release', type: S },
            sortKey: { name: 'heartbeat_at', type: N },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['load'],
          },
        ],
      }),
      // vault-requests: response slots (TTL 15 min).
      'vault-requests': table('vault-requests', { name: 'request_id', type: S }, ephemeral),
      // vault-releases: routing rows from the signed manifest + start
      // requests; the stream feeds the scaler (W6, same account).
      'vault-releases': table('vault-releases', { name: 'release', type: S }, {
        dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        globalSecondaryIndexes: [
          { indexName: 'status-index', partitionKey: { name: 'status', type: S }, sortKey: { name: 'release_number', type: N } },
        ],
      }),
    };

    // ---- data bucket (§8.2) -----------------------------------------------------
    // Objects are already DEK-encrypted or KMS-sealed, so SSE-S3. Versioned.
    // Two lifecycle rules over every key (VAULT_DATA_VERSIONS):
    //  - the first is the rule the bucket has always had: no noncurrent
    //    version outlives 7 days (O9), a delete marker goes once nothing
    //    is left under it, unfinished multipart uploads go after a day;
    //  - the second caps what is kept inside those 7 days: a noncurrent
    //    version older than 1 day (the least S3 accepts) goes unless it
    //    is one of the 5 newest noncurrent versions of its object.
    // S3 removes a version as soon as either rule allows it. The first
    // rule is what removes the last 5 versions of a deleted vault: the
    // second alone would keep them, and the delete marker, for ever.
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${resourceName(config, 'vault-data')}-${vault.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: retain,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(VAULT_DATA_VERSIONS.maxDays),
          expiredObjectDeleteMarker: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
        {
          id: 'KeepNewestNoncurrentVersions',
          noncurrentVersionExpiration: cdk.Duration.days(VAULT_DATA_VERSIONS.keepAllDays),
          noncurrentVersionsToRetain: VAULT_DATA_VERSIONS.keepNewest,
        },
      ],
    });

    // ---- recovery attempt counter bucket (§8.2, release R) ----------------------
    // VAULT-HOST-PROTOCOL §8.1, VAULT-MESSAGING §11.14.4. The enclave keeps
    // each vault's recovery attempts here as objects it writes with a
    // compliance-mode lock and reads back; it relies on no bucket setting.
    // IRREVERSIBLE once deployed: Object Lock cannot be turned off, a
    // compliance-locked version cannot be shortened or deleted by anyone
    // (the root user included) until its date, and in production tokens and
    // close records are locked for 100 years, so the bucket can never be
    // emptied and never deleted (staging: 1 day, set by the vault release
    // for its channel, so a staging bucket can be emptied later). Hence
    // RETAIN, and a fixed name the vault release pins
    // (`recovery_counter`): never rename it.
    //  - Object Lock enabled at creation, with NO default retention: a
    //    default would lock objects the enclave did not mean to lock, and the
    //    enclave sets every lock itself.
    //  - Versioning on (Object Lock requires it, and it cannot be suspended).
    //  - No lifecycle rule that expires a current version or a vault's newest
    //    present record (VAULT-RELEASES §8.2). The one rule below expires
    //    NONCURRENT versions only, 30 days after they were replaced: S3 never
    //    removes a version that is still locked, the newest present record is
    //    the marker's current version, and every other record is created once
    //    (If-None-Match), so in practice this removes old present-marker
    //    versions whose 96-hour locks have ended. It keeps the enclave's
    //    complete versions listings short. Incomplete multipart uploads (the
    //    host never makes one) go after a day.
    const recoveryBucket = new s3.Bucket(this, 'RecoveryCounterBucket', {
      bucketName: vaultRecoveryBucketName(vault.account),
      objectLockEnabled: true,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: retain,
      lifecycleRules: [
        {
          id: 'OldVersionsOfUnlockedRecords',
          noncurrentVersionExpiration: cdk.Duration.days(VAULT_RECOVERY_NONCURRENT_DAYS),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });
    this.recoveryBucket = recoveryBucket;

    // ---- manifest signing key A (§6.1) ------------------------------------------
    const signerRole = new iam.Role(this, 'ManifestSignerRole', {
      roleName: VAULT_ROLE_NAMES.manifestSigner,
      description: 'Signs the release manifest with key A and publishes manifests/<sha256>.json. Owner only (Identity Center, MFA at sign-in).',
      assumedBy: ownerTrust(),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    signerRole.applyRemovalPolicy(retain);
    const root = new iam.AccountRootPrincipal();
    const manifestKey = new kms.Key(this, 'ManifestKey', {
      alias: resourceName(config, 'vault-manifest'),
      description: `VettID ${vault.channel} vault manifest signing key A (VAULT-RELEASES §6.1). Not a release key; deletable.`,
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: retain,
      // An ordinary key with an administrator statement, minus kms:Sign:
      // signing goes through the signer role only.
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: 'AdministerButNotSign',
            principals: [root],
            actions: [
              'kms:Create*', 'kms:Describe*', 'kms:Enable*', 'kms:List*', 'kms:Put*', 'kms:Update*', 'kms:Revoke*',
              'kms:Disable*', 'kms:Get*', 'kms:Delete*', 'kms:TagResource', 'kms:UntagResource',
              'kms:ScheduleKeyDeletion', 'kms:CancelKeyDeletion',
            ],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            sid: 'SignerSigns',
            principals: [new iam.ArnPrincipal(vaultRoleArn(vault, 'manifestSigner'))],
            actions: ['kms:Sign', 'kms:GetPublicKey', 'kms:DescribeKey'],
            resources: ['*'],
          }),
        ],
      }),
    });
    manifestKey.node.addDependency(signerRole);
    signerRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [this.dataBucket.arnForObjects('manifests/*')] }));

    // ---- bucket policy: vault data is the host's alone --------------------------
    const notPrincipal = (arn: string) => ({ ArnNotEquals: { 'aws:PrincipalArn': arn } });
    this.dataBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'VaultDataHostOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*Object*'],
        resources: ['vaults/*', 'users/*', 'smoke/*'].map((p) => this.dataBucket.arnForObjects(p)),
        conditions: notPrincipal(vaultRoleArn(vault, 'host')),
      }),
    );
    this.dataBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'ManifestsWrittenBySignerOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:PutObject*', 's3:DeleteObject*', 's3:RestoreObject'],
        resources: [this.dataBucket.arnForObjects('manifests/*')],
        conditions: notPrincipal(vaultRoleArn(vault, 'manifestSigner')),
      }),
    );

    // ---- host role grants (§8.5). No KMS: the key policies name the role. -------
    const prefix = vaultControlQueuePrefix(config);
    const h = (actions: string[], resources: string[], conditions?: Record<string, unknown>) =>
      this.hostRole.addToPolicy(new iam.PolicyStatement({ actions, resources, conditions }));
    h(
      ['sqs:CreateQueue', 'sqs:DeleteQueue', 'sqs:SetQueueAttributes', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility'],
      [vaultControlQueueArnPattern(config, vault)],
    );
    h(['sqs:ListQueues'], ['*']);
    h(['sqs:SendMessage', 'sqs:GetQueueAttributes'], [`arn:aws:sqs:${config.region}:${vault.account}:${vaultDlqName(config)}`]);
    const onlyAttributes = (attrs: string[]) => ({ 'ForAllValues:StringEquals': { 'dynamodb:Attributes': attrs } });
    const t = this.tables;
    h(['dynamodb:GetItem'], [t.vaults.tableArn]);
    // Lease, lifecycle, alarm and app-key attributes only (parent/aws.go):
    // never the member's own fields (user_guid, recovery, current_vault_id,
    // app_key_pending, enroll_live, deletion). `app_key` (VAULT-MESSAGING
    // 0.15.0 §11.5) and `credential_backup` (0.16.0 §11.5: the one bit of
    // whether the vault keeps a backup copy of its credential) are written
    // only here, from the enclave's reports. `name_change` and
    // `name_change_pending` (0.18.0 §11.5, MEMBER-API 2.2.0): the vault's
    // name request from the event `account_name`, which only the host writes.
    // `att_sweep_pending` (VAULT-HOST-PROTOCOL P15, release A): set in the
    // update that marks a vault `deleted`, removed once its
    // `vaults/<vault_id>/att/` prefix is empty or the vault id is enrolled again.
    // `app_key_next` (release R, VAULT-HOST-PROTOCOL 0.1.10 §6.1,
    // VAULT-MESSAGING §11.14.2): {key, kid, seq, header_seq}, the app key a
    // transfer or recovery is putting in place, written with the header
    // write of step 1 and cleared by the rules there (parent/aws.go
    // appKeyNext); the member API accepts it beside `app_key` while it is set.
    // `recovery_cancelled` (VAULT-HOST-PROTOCOL 0.1.13 §7.2, VAULT-MESSAGING
    // 0.49.0 §11.5, MEMBER-API 2.9.0): {recovery_id, at}, written from the
    // `cancelled_recovery_id` of an unlock's `unlocked` or `moved` event,
    // the backstop for an answer lost before its slot was written; never
    // cleared. The member API only reads it.
    h(['dynamodb:UpdateItem'], [t.vaults.tableArn], onlyAttributes([
      'vault_id', 'lease', 'updated_at', 'sealed_release', 'vault_version', 'state_version', 'state', 'alarm', 'alarm_pending', 'app_key', 'credential_backup',
      'name_change', 'name_change_pending', 'att_sweep_pending', 'app_key_next', 'recovery_cancelled',
    ]));
    // P15's resumption at the parent's start: a Scan filtered on
    // attribute_exists(att_sweep_pending), projecting vault_id (vettid-vault
    // parent/aws.go PendingSweeps, as merged in #94). Scan cannot be narrowed
    // by key; the conditions confine what it may return to those two
    // attributes (the AWS pattern for attribute-level reads: a request that
    // names other attributes, or asks for all of them, is refused). A request
    // that names no attributes at all carries no dynamodb:Attributes key, and
    // ForAllValues passes on an empty set, so the Null condition requires the
    // key to be present: a Scan without a projection is refused. A sparse
    // index with Query would read fewer items, but needs a vault release
    // that queries it; the table holds a few hundred rows.
    h(['dynamodb:Scan'], [t.vaults.tableArn], {
      'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['vault_id', 'att_sweep_pending'] },
      StringEqualsIfExists: { 'dynamodb:Select': 'SPECIFIC_ATTRIBUTES' },
      Null: { 'dynamodb:Attributes': 'false' },
    });
    h(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'], [t['vault-instances'].tableArn]);
    // Response slots. Release R (VAULT-HOST-PROTOCOL 0.1.10 §6.1, parent/aws.go
    // WriteSlot) adds the enclave's clear members, copied beside `code`: a
    // recovery's `not_before`, `expires` and `earliest`; a counted open's
    // `retry_at` and `expires`; a refusal's `reason`. 0.1.13 (VAULT-MESSAGING
    // 0.49.0 §11.5): an unlock's `cancelled_recovery_id`, copied with the
    // code `recovery_cancelled` into that unlock's slot only.
    h(['dynamodb:UpdateItem'], [t['vault-requests'].tableArn], onlyAttributes([
      'request_id', 'status', 'envelope', 'code', 'not_before', 'expires', 'earliest', 'retry_at', 'reason', 'cancelled_recovery_id',
    ]));
    h(['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], ['vaults/*', 'users/*', 'smoke/*'].map((p) => this.dataBucket.arnForObjects(p)));
    h(['s3:GetObject'], [this.dataBucket.arnForObjects('manifests/*')]);
    // NoSuchKey (not AccessDenied) for a missing object needs ListBucket,
    // without a prefix condition (S3's check for a missing key carries no
    // `s3:prefix`). The same grant covers P15's listing of
    // `vaults/<vault_id>/att/` (VAULT-HOST-PROTOCOL 0.1.11); DeleteObject on
    // `vaults/*` above covers its deletes. Narrowing it would turn missing
    // objects into AccessDenied for the parent's store.
    h(['s3:ListBucket'], [this.dataBucket.bucketArn]);
    // The recovery attempt counter (release R, VAULT-HOST-PROTOCOL §8.1, P18):
    // exactly these five actions, on that bucket only. The enclave signs its
    // own requests with the role's credentials (the parent holds the same,
    // §5.5). No delete, bypass-governance, legal-hold or configuration
    // permission, here or anywhere else on this role (test/vault-stack.test.ts).
    h([...VAULT_RECOVERY_HOST_OBJECT_ACTIONS], [recoveryBucket.arnForObjects('*')]);
    h([...VAULT_RECOVERY_HOST_BUCKET_ACTIONS], [recoveryBucket.bucketArn]);
    h(['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'], [`arn:aws:ssm:${config.region}:${vault.account}:parameter/vettid-org/${config.stage}/vault/*`]);
    h(['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'], [`arn:aws:logs:${config.region}:${vault.account}:log-group:/vettid-org/${config.stage}/vault-host:*`]);
    h(['cloudwatch:PutMetricData'], ['*'], { StringEquals: { 'cloudwatch:namespace': 'VettID/Vault' } });
    h(
      ['autoscaling:CompleteLifecycleAction', 'autoscaling:RecordLifecycleActionHeartbeat'],
      [`arn:aws:autoscaling:${config.region}:${vault.account}:autoScalingGroup:*:autoScalingGroupName/${resourceName(config, 'vault-r')}*`],
    );

    // ---- release keys (§6.2) ------------------------------------------------------
    // The custom resource's role is the only principal allowed to create a
    // key with BypassPolicyLockoutSafetyCheck (here, and by the Vault OU SCP).
    const creator = new ApiFunction(this, 'ReleaseKeyCreator', {
      entry: 'lambda/vault/release-key.ts',
      functionName: VAULT_RELEASE_KEY_FUNCTION_NAME,
      roleName: VAULT_ROLE_NAMES.releaseKeyCreator,
      timeout: cdk.Duration.seconds(60),
      description: 'Creates immutable vault release keys (VAULT-RELEASES §6.2); refuses updates, ignores deletes',
      environment: {
        HOST_ROLE_ARN: vaultRoleArn(vault, 'host'),
        RETIREMENT_ROLE_ARN: vaultRoleArn(vault, 'retirement'),
      },
    }).fn;
    creator.configureAsyncInvoke({ retryAttempts: 0 });
    creator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:CreateKey'],
        resources: ['*'],
        conditions: {
          Bool: { 'kms:BypassPolicyLockoutSafetyCheck': 'true', 'kms:MultiRegion': 'false' },
          StringEquals: { 'kms:KeySpec': 'SYMMETRIC_DEFAULT', 'kms:KeyUsage': 'ENCRYPT_DECRYPT', 'kms:KeyOrigin': 'AWS_KMS' },
        },
      }),
    );
    // Tags given at creation need TagResource; only the two release tags.
    creator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:TagResource'],
        resources: [`arn:aws:kms:${config.region}:${vault.account}:key/*`],
        conditions: { 'ForAllValues:StringEquals': { 'aws:TagKeys': ['vettid:release', 'vettid:channel'] } },
      }),
    );
    for (const spec of props.releaseKeys ?? []) {
      const key = new ReleaseKey(this, `Release${spec.release}Key`, { ...spec, config, vault, serviceToken: creator.functionArn });
      // The roles the policy names must exist before CreateKey validates it.
      key.node.addDependency(this.hostRole, this.retirementRole);
      this.releaseKeys.push(key);
    }

    // ---- refs ---------------------------------------------------------------------
    publishRef(this, config, 'vault/data-bucket-name', this.dataBucket.bucketName);
    publishRef(this, config, 'vault/recovery-bucket-name', recoveryBucket.bucketName);
    publishRef(this, config, 'vault/host-role-arn', this.hostRole.roleArn);
    publishRef(this, config, 'vault/host-instance-profile-name', VAULT_ROLE_NAMES.host);
    publishRef(this, config, 'vault/retirement-role-arn', this.retirementRole.roleArn);
    publishRef(this, config, 'vault/manifest-signer-role-arn', signerRole.roleArn);
    publishRef(this, config, 'vault/manifest-key-arn', manifestKey.keyArn);
    publishRef(this, config, 'vault/vaults-table-name', t.vaults.tableName);
    publishRef(this, config, 'vault/vault-instances-table-name', t['vault-instances'].tableName);
    publishRef(this, config, 'vault/vault-requests-table-name', t['vault-requests'].tableName);
    publishRef(this, config, 'vault/vault-releases-table-name', t['vault-releases'].tableName);
    publishRef(this, config, 'vault/vault-releases-stream-arn', t['vault-releases'].tableStreamArn!);
    publishRef(this, config, 'vault/control-queue-prefix', prefix);
    publishRef(this, config, 'vault/control-queue-policy', JSON.stringify(vaultControlQueuePolicy(config, vault)));
    publishRef(this, config, 'vault/dlq-name', vaultDlqName(config));

    // The member API's alarm mailer reads this stream from its own account;
    // set it as context `vaultsStreamArn` (prod) or `<stage>VaultsStreamArn` (cdk.json) after the first deploy.
    new cdk.CfnOutput(this, 'VaultsStreamArn', { value: t.vaults.tableStreamArn! });
    new cdk.CfnOutput(this, 'ManifestKeyArn', { value: manifestKey.keyArn });
    new cdk.CfnOutput(this, 'DataBucketName', { value: this.dataBucket.bucketName });
    new cdk.CfnOutput(this, 'RecoveryCounterBucketName', { value: recoveryBucket.bucketName });
  }
}

/** The vault account's stack env for a stage. */
export function vaultEnv(config: AppConfig, vault: VaultConfig): cdk.Environment {
  return { account: vault.account, region: config.region };
}
