import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';
import { ownerTrust } from '../constructs/owner-trust';
import { publishRef } from '../constructs/ssm-refs';

export interface VettidOrgCallsDataStackProps extends cdk.StackProps {
  /** The staging configuration (`config.calls` is set). */
  readonly config: AppConfig;
}

/** The TURN secret's key (CALLING-SERVICE §8.2, §8.3). */
export const CALLS_KEY_ALIAS = 'alias/vettid-org-calls';
/** Where the calling service's alarms go (§10): a topic of its own, emailed to the admin address. */
export const CALLS_ALERTS_TOPIC_NAME = 'vettid-org-calls-alerts';
/**
 * The one secret (§8.3), `vettid-org/<stage>/calls/turn-secret`. No stack
 * creates it: the operator does, with `callsctl secret new`, and the stacks
 * refer to it by name only (the lesson of vettid.org #216; as the push
 * gateway's secrets).
 */
export const callsSecretName = (config: Pick<AppConfig, 'stage'>): string => `vettid-org/${config.stage}/calls/turn-secret`;
/** `vettid-org-<stage>-calls[-thing]`. */
export const callsName = (config: AppConfig, thing?: string): string => resourceName(config, `calls${thing ? `-${thing}` : ''}`);
/** §10: the issuer's log, 14 days (starts and errors only; never a request). */
export const callsIssuerLogGroupName = (config: Pick<AppConfig, 'stage'>): string => `/vettid-org/${config.stage}/calls-issuer`;
/** §10: the server host's log, 14 days (the agent's errors; coturn's own log is discarded on the instance). */
export const callsServerLogGroupName = (config: Pick<AppConfig, 'stage'>): string => `/vettid-org/${config.stage}/calls-server`;
/**
 * The issuer function's role and the server instance's role: fixed names,
 * because the key policy names them before they exist (a role that does not
 * exist yet matches nobody).
 */
export const callsIssuerRoleName = (config: AppConfig): string => callsName(config, 'issuer');
export const callsServerRoleName = (config: AppConfig): string => callsName(config, 'server');
/** The metrics namespace of the issuer and of `turn-agent` (§10). */
export const callsMetricsNamespace = (config: Pick<AppConfig, 'stage'>): string => `vettid-org/${config.stage}/calls`;

/**
 * What the calling service keeps between deployments (CALLING-SERVICE §8.2),
 * apart from the services so those deploy and fail freely (RUNBOOK "CDK
 * conventions"; PUSH-GATEWAY §10.1 "As built"). Stateful: termination
 * protection, and everything here is retained.
 *
 *  - **The key** `alias/vettid-org-calls`, with the push key's policy:
 *    `kms:Decrypt` (through Secrets Manager, for the one secret) to the
 *    issuer's role and the server's role, and to the owner's Identity
 *    Center role, which alone creates and rotates the secret. Nobody else
 *    can read it; the administrator statement carries no cryptographic
 *    action and no `kms:CreateGrant`.
 *  - **Not the secret.** Created by the operator under the key.
 *  - **The log groups** `/vettid-org/<stage>/calls-issuer` and
 *    `/vettid-org/<stage>/calls-server`, 14 days: here, not with the
 *    services, because a service stack whose first deployment fails is
 *    rolled back and deleted and its log must survive that.
 *  - **The alarm topic** `vettid-org-calls-alerts`, emailed to the admin
 *    address (confirm the subscription once).
 *
 * Not here yet: the server's Elastic IP and fixed IPv6 address (§8.2). They
 * are a step 4 item (CALLS-PLAN §13.3) and an unattached public IPv4
 * address costs $3.65 a month, so they are allocated when the server
 * stack is, not for the handshake test.
 */
export class VettidOrgCallsDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgCallsDataStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.stage === 'prod' || !config.calls) throw new Error('VettidOrgCallsDataStack: the calling service is a staging stack (context callsStages)');

    const retain = cdk.RemovalPolicy.RETAIN;
    // Kept for life, but not stranded when the operation that creates them
    // rolls back (see VettidOrgPushDataStack).
    const retainOnceCreated = cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE;
    const viaSecretsManager = { StringEquals: { 'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com` } };
    const secretArn = `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${callsSecretName(config)}-??????`;

    const key = new kms.Key(this, 'Key', {
      alias: CALLS_KEY_ALIAS,
      description: 'VettID calling service TURN secret (CALLING-SERVICE 8.3)',
      enableKeyRotation: true,
      removalPolicy: retain,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
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
            // The operator of §8.3: the owner's Identity Center role creates,
            // fills and rotates the secret (Secrets Manager needs both
            // actions of its caller under a customer-managed key).
            sid: 'OwnerWritesAndReadsSecret',
            principals: [ownerTrust(this.account)],
            actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
            resources: ['*'],
            conditions: viaSecretsManager,
          }),
          ...([['Issuer', callsIssuerRoleName(config)], ['Server', callsServerRoleName(config)]] as const).map(
            ([who, role]) =>
              new iam.PolicyStatement({
                sid: `${who}Decrypts`,
                principals: [new iam.AccountRootPrincipal()],
                actions: ['kms:Decrypt'],
                resources: ['*'],
                conditions: {
                  ArnEquals: { 'aws:PrincipalArn': `arn:${this.partition}:iam::${this.account}:role/${role}` },
                  ...viaSecretsManager,
                  StringLike: { 'kms:EncryptionContext:SecretARN': secretArn },
                },
              }),
          ),
        ],
      }),
    });
    publishRef(this, config, 'calls/key-arn', key.keyArn);

    for (const [cid, name] of [['IssuerLogs', callsIssuerLogGroupName(config)], ['ServerLogs', callsServerLogGroupName(config)]]) {
      new logs.LogGroup(this, cid, { logGroupName: name, retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: retainOnceCreated });
    }

    const alerts = new sns.Topic(this, 'Alerts', { topicName: CALLS_ALERTS_TOPIC_NAME, displayName: 'VettID calling service alarms' });
    alerts.addSubscription(new subs.EmailSubscription(config.adminEmail));

    new cdk.CfnOutput(this, 'KeyArn', { value: key.keyArn });
  }
}
