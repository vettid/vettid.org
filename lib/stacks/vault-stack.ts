import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig, VAULT_RELEASE_KEY_FUNCTION_NAME, VAULT_ROLE_NAMES, VaultConfig, resourceName, vaultRoleArn } from '../config';
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
        encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
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
    // Objects are already DEK-encrypted or KMS-sealed, so SSE-S3. Versioned;
    // noncurrent versions and delete markers go after 7 days (O9).
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
          noncurrentVersionExpiration: cdk.Duration.days(7),
          expiredObjectDeleteMarker: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

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
    // only here, from the enclave's reports.
    h(['dynamodb:UpdateItem'], [t.vaults.tableArn], onlyAttributes([
      'vault_id', 'lease', 'updated_at', 'sealed_release', 'vault_version', 'state_version', 'state', 'alarm', 'alarm_pending', 'app_key', 'credential_backup',
    ]));
    h(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'], [t['vault-instances'].tableArn]);
    h(['dynamodb:UpdateItem'], [t['vault-requests'].tableArn], onlyAttributes(['request_id', 'status', 'envelope', 'code']));
    h(['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], ['vaults/*', 'users/*', 'smoke/*'].map((p) => this.dataBucket.arnForObjects(p)));
    h(['s3:GetObject'], [this.dataBucket.arnForObjects('manifests/*')]);
    // NoSuchKey (not AccessDenied) for a missing object needs ListBucket.
    h(['s3:ListBucket'], [this.dataBucket.bucketArn]);
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
  }
}

/** The vault account's stack env for a stage. */
export function vaultEnv(config: AppConfig, vault: VaultConfig): cdk.Environment {
  return { account: vault.account, region: config.region };
}
