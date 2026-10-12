import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { AppConfig, PushChannel, PushPlatform } from '../config';
import { ownerTrust } from '../constructs/owner-trust';
import { publishRef } from '../constructs/ssm-refs';
import { amazonOnlyCaa } from './dns-stack';

export interface VettidOrgPushDataStackProps extends cdk.StackProps {
  /** The prod configuration: both channels' gateways live in the main account. */
  readonly config: AppConfig;
}

/** The secrets' key (PUSH-GATEWAY §10.2). One key for both channels; the policy separates them. */
export const PUSH_KEY_ALIAS = 'alias/vettid-org-push';
/** Where the gateways' alarms go (§10.5): a topic of their own, emailed to the admin address. */
export const PUSH_ALERTS_TOPIC_NAME = 'vettid-org-push-alerts';
/**
 * The secrets a gateway reads at start (§10.2), `vettid-org/<channel>/push/<name>`.
 * No stack creates them: the operator does, under the key (RUNBOOK "Push
 * gateway"), and the stacks refer to them by name only.
 */
export const PUSH_SECRETS = ['apns', 'fcm', 'blob-keys'] as const;
export type PushSecret = (typeof PUSH_SECRETS)[number];

/** `vettid-org-push[-thing]` in prod, `vettid-org-staging-push[-thing]` in staging. */
export function pushName(channel: PushChannel, thing?: string): string {
  return `vettid-org-${channel === 'prod' ? '' : `${channel}-`}push${thing ? `-${thing}` : ''}`;
}
/** `PUSH_SECRET_PREFIX`, the gateway's default for its channel. */
export const pushSecretPrefix = (channel: PushChannel): string => `vettid-org/${channel}/push`;
export const pushSecretName = (channel: PushChannel, secret: PushSecret): string => `${pushSecretPrefix(channel)}/${secret}`;
/** §10.5. */
export const pushLogGroupName = (channel: PushChannel): string => `/vettid-org/${channel}/push-service`;
/**
 * The gateway's task role: a fixed name, because the key policy names it
 * before the role exists, and because it is what Google's workload
 * identity pool trusts (§10.3).
 */
export const pushTaskRoleName = (channel: PushChannel): string => pushName(channel, 'gateway');
/** The secrets a gateway with these platforms reads: its blob keys, and each listed platform's credentials. */
export const pushSecretsRead = (platforms: readonly PushPlatform[]): PushSecret[] =>
  PUSH_SECRETS.filter((s) => s === 'blob-keys' || platforms.includes(s));

/**
 * What the push gateways keep between deployments (PUSH-GATEWAY §10.2,
 * §10.5), apart from the services so those deploy and fail freely
 * (RUNBOOK "CDK conventions"). Stateful: termination protection, and
 * everything here is retained.
 *
 *  - **The key** `alias/vettid-org-push`. `kms:Decrypt` is allowed to
 *    exactly: each channel's gateway task role, for that channel's secrets
 *    only (through Secrets Manager, by the secret's ARN in the encryption
 *    context), and the owner's Identity Center role (the account's
 *    break-glass admin, who also creates and rotates the secrets). Nobody
 *    else can read a secret, whatever their IAM policy says: the
 *    administrator statement carries no cryptographic action and no
 *    `kms:CreateGrant`. Both channels' roles are named from the start, so
 *    adding production later does not touch the key.
 *  - **Not the secrets.** `vettid-org/<channel>/push/apns`, `fcm` and
 *    `blob-keys` are created by the operator, with their value, under the
 *    key (RUNBOOK "Push gateway"), and are named here and in
 *    VettidOrgPushStack only. CloudFormation cannot create them, not even
 *    empty: Secrets Manager's CreateSecret under a customer-managed key
 *    needs `kms:GenerateDataKey` **and** `kms:Decrypt` for its caller, and
 *    a deployment role that may decrypt under this key could read every
 *    secret, which is what the key policy exists to prevent (the first
 *    deployment tried, and failed with "Access to KMS is not allowed").
 *  - **The log group** per listed channel, `/vettid-org/<channel>/push-service`,
 *    14 days. Here, not with the service: a service stack whose first
 *    deployment fails is rolled back and deleted, and its log (why the tasks
 *    did not start) must survive that without blocking the next attempt.
 *  - **The staging zone** `push.staging.vettid.org` (when staging is listed).
 *    The staging gateway runs in this account, behind the relay's load
 *    balancer (§10.4), but `staging.vettid.org` is a zone in the staging
 *    account. Rather than give this account's deployments a way to write
 *    into that zone, the one name is delegated: this zone holds the
 *    certificate's validation record and the alias, both managed by
 *    VettidOrgPushStack, and the staging zone holds four NS records
 *    (VettidOrgStagePushDelegationStack, context `stagingPushZoneNs`).
 *  - **The alarm topic** `vettid-org-push-alerts`, emailed to the admin
 *    address (confirm the subscription once).
 */
export class VettidOrgPushDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgPushDataStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.stage !== 'prod') throw new Error('the push gateways live in the prod app (main account), both channels (PUSH-GATEWAY §10.4)');
    const channels = config.push.gateways.map((g) => g.channel);
    if (!channels.length) throw new Error('VettidOrgPushDataStack: context pushStages lists no channel');

    const retain = cdk.RemovalPolicy.RETAIN;
    // The log groups and the zone are kept for life, but not stranded when
    // the operation that creates them rolls back (RetainExceptOnCreate): a
    // failed first deploy on 2026-10-11 left a log group whose name then
    // blocked the retry, and an empty zone. The key stays plain RETAIN:
    // CloudFormation never schedules a key deletion here.
    const retainOnceCreated = cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE;
    const viaSecretsManager = { StringEquals: { 'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com` } };
    const secretArnPattern = (channel: PushChannel) =>
      `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${pushSecretPrefix(channel)}/*`;

    const key = new kms.Key(this, 'Key', {
      alias: PUSH_KEY_ALIAS,
      description: 'VettID push gateway secrets (PUSH-GATEWAY 10.2): APNs key, FCM access, wake-blob keys',
      enableKeyRotation: true,
      removalPolicy: retain,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            // Explicit actions, not kms:Create* / kms:*: no Decrypt, no
            // GenerateDataKey and no CreateGrant (a grant could hand
            // Decrypt to anyone).
            sid: 'AdministerButNotDecrypt',
            principals: [new iam.AccountRootPrincipal()],
            actions: [
              'kms:Describe*', 'kms:Get*', 'kms:List*',
              'kms:CreateAlias', 'kms:UpdateAlias', 'kms:DeleteAlias',
              'kms:PutKeyPolicy', 'kms:UpdateKeyDescription',
              'kms:EnableKey', 'kms:DisableKey', 'kms:EnableKeyRotation', 'kms:DisableKeyRotation',
              'kms:TagResource', 'kms:UntagResource', 'kms:RevokeGrant', 'kms:RetireGrant',
              'kms:ScheduleKeyDeletion', 'kms:CancelKeyDeletion',
            ],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            // The break-glass admin of §10.2: the owner's Identity Center
            // role (MFA at sign-in), and the only one who creates, fills,
            // rotates and reads the secrets. Secrets Manager needs both
            // actions of its caller for CreateSecret and PutSecretValue
            // under a customer-managed key, even for a secret with no
            // value, and Decrypt alone for GetSecretValue
            // (`pushctl blob-keys rotate` reads the secret). Nobody else
            // has either: no deployment role can write a secret, and so
            // none needs to be able to read one.
            sid: 'OwnerWritesAndReadsSecrets',
            principals: [ownerTrust(this.account)],
            actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
            resources: ['*'],
            conditions: viaSecretsManager,
          }),
          // Both channels, whether listed or not: the policy never changes
          // when production is added, and a role that does not exist yet
          // matches nobody. The account root with a PrincipalArn condition
          // rather than the role as principal: a role principal must exist
          // when the policy is put, and turns into a dead id if the role is
          // ever recreated. The role still needs its own IAM allow.
          ...(['prod', 'staging'] as const).map(
            (channel) =>
              new iam.PolicyStatement({
                sid: `Gateway${channel === 'prod' ? 'Prod' : 'Staging'}Decrypts`,
                principals: [new iam.AccountRootPrincipal()],
                actions: ['kms:Decrypt'],
                resources: ['*'],
                conditions: {
                  ArnEquals: { 'aws:PrincipalArn': `arn:${this.partition}:iam::${this.account}:role/${pushTaskRoleName(channel)}` },
                  ...viaSecretsManager,
                  // Secrets Manager's encryption context: a staging gateway
                  // cannot open a production secret, even if handed one.
                  StringLike: { 'kms:EncryptionContext:SecretARN': secretArnPattern(channel) },
                },
              }),
          ),
        ],
      }),
    });
    publishRef(this, config, 'push/key-arn', key.keyArn);

    for (const channel of channels) {
      const cid = channel === 'prod' ? 'Prod' : 'Staging';
      new logs.LogGroup(this, `${cid}ServiceLogs`, {
        logGroupName: pushLogGroupName(channel),
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: retainOnceCreated,
      });
    }

    if (channels.includes('staging')) {
      const host = config.push.gateways.find((g) => g.channel === 'staging')!.host;
      const zone = new route53.PublicHostedZone(this, 'StagingZone', {
        zoneName: host,
        comment: `${host} (the staging push gateway, behind the relay's load balancer) - managed by VettidOrgPushDataStack; delegated from staging.vettid.org`,
      });
      // New name servers would orphan the delegation in the staging zone.
      zone.applyRemovalPolicy(retainOnceCreated);
      // The zone's apex is the host itself, so a CAA lookup stops here.
      amazonOnlyCaa(this, 'StagingCaa', zone);
      publishRef(this, config, 'push/staging-zone-id', zone.hostedZoneId);
      new cdk.CfnOutput(this, 'StagingZoneNameServers', {
        value: cdk.Fn.join(',', zone.hostedZoneNameServers ?? []),
        description: 'Put into cdk.json context "stagingPushZoneNs" and deploy VettidOrgStagePushDelegationStack in staging (RUNBOOK "Push gateway")',
      });
    }

    // A topic of its own with the default access policy, which lets this
    // account's CloudWatch alarms publish.
    const alerts = new sns.Topic(this, 'Alerts', { topicName: PUSH_ALERTS_TOPIC_NAME, displayName: 'VettID push gateway alarms' });
    alerts.addSubscription(new subs.EmailSubscription(config.adminEmail));

    new cdk.CfnOutput(this, 'KeyArn', { value: key.keyArn });
  }
}
