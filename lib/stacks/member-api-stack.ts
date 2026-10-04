import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { ApiFunction } from '../constructs/api-function';
import { HttpRouteGroup } from '../constructs/route-group';
import { publishRef, readRef } from '../constructs/ssm-refs';
import { tableEnv, tableGrant } from '../constructs/table-grants';
import {
  VAULT_API_ACCESS,
  VaultApiConsumer,
  vaultApiRoleName,
  vaultControlQueueArnPattern,
  vaultControlQueueUrlPrefix,
  vaultTableArn,
} from '../vault/access';

export interface VettidOrgMemberApiStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/** Secret CloudFront adds to every /api/* request (X-Origin-Verify). */
export const originVerifySecretName = (config: AppConfig) => `${resourceName(config, 'member-api')}/origin-verify`;

/**
 * Stateless: the member API (docs/MEMBER-API.md), served same-origin behind
 * account.vettid.org. Four route groups (public, auth, account, vault) plus the
 * background jobs: SES-verification sweep, daily cleanup/expiry, and the
 * members-stream welcome mailer and the vault credential-clone alarm mailer.
 *
 * The HTTP API's execute-api URL is public; every handler rejects requests
 * without CloudFront's origin-verify header, so the API is only usable via
 * the site (and client IPs used for rate limits can't be spoofed).
 */
export class VettidOrgMemberApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgMemberApiStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vaultCfg = config.vault;
    if (!vaultCfg) throw new Error(`stage ${config.stage} has no vault account (lib/config.ts)`);

    const originSecret = new secretsmanager.Secret(this, 'OriginVerify', {
      secretName: originVerifySecretName(config),
      description: 'Header value CloudFront adds to account-site /api/* requests; the member API rejects requests without it.',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: resourceName(config, 'member-api'),
      description: 'VettID member API (behind account.vettid.org CloudFront)',
    });
    const stage = api.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 50, throttlingBurstLimit: 100 };
    // Access log: request metadata only — no headers, cookies or bodies.
    // ($context.identity.sourceIp is CloudFront's edge, not the viewer.)
    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      logGroupName: `/vettid-org/${config.stage}/member-api/access`,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        time: '$context.requestTime',
        method: '$context.httpMethod',
        path: '$context.path',
        status: '$context.status',
        bytes: '$context.responseLength',
        latencyMs: '$context.integrationLatency',
        error: '$context.integrationErrorMessage',
      }),
    };

    const memberPoolArn = readRef(this, config, 'auth/member-pool-arn');
    // The vault tables live in the vault account and are addressed by ARN
    // (DynamoDB accepts a table ARN as TableName; lib/vault/access.ts).
    const vaultTableEnv = {
      TABLE_VAULTS: vaultTableArn(config, vaultCfg, 'vaults'),
      TABLE_VAULT_INSTANCES: vaultTableArn(config, vaultCfg, 'vault-instances'),
      TABLE_VAULT_REQUESTS: vaultTableArn(config, vaultCfg, 'vault-requests'),
      TABLE_VAULT_RELEASES: vaultTableArn(config, vaultCfg, 'vault-releases'),
    };
    const env = {
      ...tableEnv(config),
      ...vaultTableEnv,
      MEMBER_POOL_ID: readRef(this, config, 'auth/member-pool-id'),
      MEMBER_CLIENT_ID: readRef(this, config, 'auth/member-client-id'),
      PIN_PEPPER_SECRET_ARN: readRef(this, config, 'auth/pin-pepper-secret-arn'),
      TERMS_BUCKET: readRef(this, config, 'data/terms-bucket-name'),
      ORIGIN_VERIFY_SECRET_ARN: originSecret.secretArn,
      SENDER_EMAIL: config.senderEmail,
      ADMIN_EMAIL: config.adminEmail,
      ACCOUNT_HOST: hostName(config, 'account'),
    };

    const group = (id: string, pathPrefix: string, entry: string, roleName?: string) => {
      const fn = new HttpRouteGroup(this, id, { api, pathPrefix, entry, environment: env, roleName }).fn;
      originSecret.grantRead(fn);
      return fn;
    };
    const pub = group('Public', '/api/public', 'lambda/member/public.ts');
    const auth = group('Auth', '/api/auth', 'lambda/member/auth.ts');
    const account = group('Account', '/api/account', 'lambda/member/account.ts');
    // Fixed role name: the vault account's resource policies name it.
    const vault = group('Vault', '/api/vault', 'lambda/member/vault.ts', vaultApiRoleName(config, 'vault'));

    const cognitoActions = (fn: lambda.IFunction, actions: string[]) =>
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: actions.map((a) => `cognito-idp:${a}`), resources: [memberPoolArn] }));
    // ses:SendEmail stays resources:['*'] — scoping it to the domain identity
    // makes every send fail (see signup-stack.ts / RUNBOOK).
    const sesSend = new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: ['*'] });
    const sesIdentity = (fn: lambda.IFunction, actions: string[]) =>
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: actions.map((a) => `ses:${a}`), resources: ['*'] }));
    const g = (fn: lambda.IFunction, t: string, actions: string[], indexes = false) => tableGrant(this, config, fn, t, actions, { indexes });
    // Functions that may delete SES identities must never delete the domain
    // identity that all system mail is sent from.
    const denyDomainIdentityDelete = new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['ses:DeleteEmailIdentity'],
      resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/${config.domainName}`, `arn:${this.partition}:ses:${this.region}:${this.account}:identity/*.${config.domainName}`],
    });

    // public: request membership
    g(pub, 'members', ['Query', 'PutItem', 'UpdateItem'], true);
    g(pub, 'invites', ['UpdateItem']);
    g(pub, 'ratelimits', ['UpdateItem']);
    g(pub, 'audit', ['PutItem']);
    cognitoActions(pub, ['AdminCreateUser', 'AdminAddUserToGroup']);
    sesIdentity(pub, ['GetEmailIdentity', 'CreateEmailIdentity']);
    pub.addToRolePolicy(sesSend);

    // auth: Cognito custom auth (InitiateAuth etc. are unauthenticated APIs
    // for a public client — no IAM needed); hands link sending to the mailer.
    g(auth, 'members', ['Query'], true); // PIN lock state for a signed PIN-step cookie
    g(auth, 'ratelimits', ['UpdateItem', 'GetItem']);

    // link mailer: invoked asynchronously by /api/auth/start
    const linkMailer = new ApiFunction(this, 'LinkMailer', {
      entry: 'lambda/member/link-mailer.ts',
      environment: env,
      description: 'Sends magic sign-in links (async, so /api/auth/start timing reveals nothing)',
    }).fn;
    g(linkMailer, 'members', ['Query', 'UpdateItem'], true); // UpdateItem: live SES-verified flag
    g(linkMailer, 'magic-links', ['PutItem']);
    g(linkMailer, 'ratelimits', ['UpdateItem']);
    sesIdentity(linkMailer, ['GetEmailIdentity']);
    linkMailer.addToRolePolicy(sesSend);
    linkMailer.grantInvoke(auth);
    auth.addEnvironment('LINK_MAILER_FN', linkMailer.functionName);

    // account
    g(account, 'members', ['GetItem', 'UpdateItem']);
    g(account, 'terms', ['Query'], true);
    g(account, 'subscriptions', ['GetItem', 'PutItem']);
    g(account, 'subscription-types', ['Scan']);
    g(account, 'ratelimits', ['GetItem', 'PutItem', 'UpdateItem', 'DeleteItem']); // PIN lockout (atomic reserve)
    account.addToRolePolicy(sesSend); // PIN change / lockout notices
    g(account, 'audit', ['PutItem']);
    cognitoActions(account, ['AdminAddUserToGroup', 'AdminDisableUser', 'AdminUserGlobalSignOut']);
    account.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [cdk.Fn.join('', ['arn:', this.partition, ':s3:::', env.TERMS_BUCKET, '/terms/*'])],
      }),
    );
    account.addToRolePolicy(new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [env.PIN_PEPPER_SECRET_ARN] }));

    // vault: alternate channel (docs/VAULT-MESSAGING.md §11). Routes sealed,
    // opaque envelopes to enclave instances; the data it may write is
    // limited to its own attributes, so it can never set a lease, a sealed
    // release or lifecycle state, or alter a release's status.
    //
    // Vault tables and control queues are in the vault account. These are
    // this side's identity policies; the vault account's resource policies
    // grant the same matrix (lib/vault/access.ts) to the same fixed roles.
    const vaultControlQueues = vaultControlQueueArnPattern(config, vaultCfg);
    const vaultQueueUrlPrefix = vaultControlQueueUrlPrefix(config, vaultCfg);
    const vaultGrants = (fn: lambda.Function, consumer: VaultApiConsumer) => {
      const access = VAULT_API_ACCESS[consumer];
      for (const grant of access.tables) {
        const arn = vaultTableArn(config, vaultCfg, grant.table);
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: grant.actions.map((a) => `dynamodb:${a}`),
            resources: grant.indexes ? [arn, `${arn}/index/*`] : [arn],
            // Attribute-level write limits (fine-grained access control).
            // ForAllValues is vacuously true if a request carried no attribute
            // list, so this narrows, and never widens, the plain grant.
            conditions: grant.attributes ? { 'ForAllValues:StringEquals': { 'dynamodb:Attributes': grant.attributes } } : undefined,
          }),
        );
      }
      if (access.sendsToControlQueues) {
        fn.addEnvironment('VAULT_QUEUE_URL_PREFIX', vaultQueueUrlPrefix);
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [vaultControlQueues] }));
      }
    };
    g(vault, 'members', ['GetItem']);
    g(vault, 'terms', ['Query'], true);
    g(vault, 'ratelimits', ['UpdateItem']);
    g(vault, 'audit', ['PutItem']);
    vaultGrants(vault, 'vault');
    vault.addToRolePolicy(sesSend); // recovery notices (VAULT-MESSAGING §11.11)

    // ---- background jobs --------------------------------------------------------
    const job = (id: string, entry: string, timeout = cdk.Duration.minutes(5), roleName?: string) =>
      new ApiFunction(this, id, { entry, environment: env, timeout, roleName }).fn;

    const verifications = job('VerificationsJob', 'lambda/jobs/verifications.ts');
    g(verifications, 'members', ['Query', 'UpdateItem'], true);
    sesIdentity(verifications, ['GetEmailIdentity']);
    new events.Rule(this, 'VerificationsSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(verifications)],
    });

    const cleanup = job('CleanupJob', 'lambda/jobs/cleanup.ts', cdk.Duration.minutes(5), vaultApiRoleName(config, 'cleanup'));
    g(cleanup, 'members', ['Query', 'DeleteItem'], true);
    g(cleanup, 'subscriptions', ['Query', 'UpdateItem', 'DeleteItem'], true);
    g(cleanup, 'audit', ['PutItem']);
    // canceled accounts (VAULT-MESSAGING 0.9.0 §12.5): each vault is asked
    // to delete itself through its instance's queue (the vault_deleted
    // notice then removes its row); never-sealed rows and the pointer row go
    // here; unreported deletions are retried (Scan) and flagged after 30 days.
    vaultGrants(cleanup, 'cleanup');
    // stale-request reclaim: keep identities the mailing list still uses
    tableGrant(this, config, cleanup, 'mailing-list', ['GetItem']);
    cleanup.addEnvironment('TABLE_MAILING_LIST', resourceName(config, 'mailing-list'));
    sesIdentity(cleanup, ['DeleteEmailIdentity']);
    cleanup.addToRolePolicy(denyDomainIdentityDelete);
    cognitoActions(cleanup, ['AdminDeleteUser']);
    new events.Rule(this, 'CleanupSchedule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '7' }), // 07:00 UTC daily
      targets: [new targets.LambdaFunction(cleanup)],
    });

    const mailer = job('MembersStreamMailer', 'lambda/jobs/members-stream.ts', cdk.Duration.seconds(30));
    g(mailer, 'members', ['UpdateItem']);
    mailer.addToRolePolicy(sesSend);
    const membersTable = dynamodb.Table.fromTableAttributes(this, 'MembersTable', {
      tableName: resourceName(config, 'members'),
      tableStreamArn: readRef(this, config, 'data/members-stream-arn'),
    });
    mailer.addEventSource(
      new sources.DynamoEventSource(membersTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
        bisectBatchOnError: true,
      }),
    );

    // Credential-clone alarms and deletion notices (VAULT-MESSAGING 0.9.0 §3.5.9, §11.5, §12.5): the
    // enclave host records a content-free alarm on the vault row; this
    // mailer, fed only the stream records that carry `alarm_pending`, emails
    // the member. It may only clear `alarm_pending` and stamp the alarm.
    const alarms = job('VaultAlarmMailer', 'lambda/jobs/vault-alarms.ts', cdk.Duration.seconds(30), vaultApiRoleName(config, 'vault-alarms'));
    g(alarms, 'members', ['GetItem']);
    g(alarms, 'ratelimits', ['UpdateItem']);
    g(alarms, 'audit', ['PutItem']);
    // May only clear the alarm flag and delete a deleted vault's rows (§12.5).
    vaultGrants(alarms, 'vault-alarms');
    alarms.addToRolePolicy(sesSend);
    // The vaults stream is in the vault account (cross-account event source:
    // its stream policy admits this role). Its ARN carries a creation label,
    // so it comes from context after VettidOrgVaultStack's first deploy.
    const streamArn = vaultCfg.vaultsStreamArn;
    const streamPrefix = `${vaultTableArn(config, vaultCfg, 'vaults')}/stream/`;
    if (streamArn && !streamArn.startsWith(streamPrefix)) {
      throw new Error(`vaultsStreamArn must be a stream of ${vaultTableArn(config, vaultCfg, 'vaults')}`);
    }
    if (streamArn) {
      const vaultsTable = dynamodb.Table.fromTableAttributes(this, 'VaultsTable', {
        tableArn: vaultTableArn(config, vaultCfg, 'vaults'),
        tableStreamArn: streamArn,
      });
      alarms.addEventSource(
        new sources.DynamoEventSource(vaultsTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 10,
          retryAttempts: 3,
          bisectBatchOnError: true,
          filters: [lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('MODIFY'), dynamodb: { NewImage: { alarm_pending: { BOOL: lambda.FilterRule.isEqual(true) } } } })],
        }),
      );
    } else {
      cdk.Annotations.of(this).addWarningV2(
        'vettid:vaults-stream-unset',
        'The vault alarm mailer has no event source: set context vaultsStreamArn (VettidOrgVaultStack output VaultsStreamArn)',
      );
    }

    publishRef(this, config, 'member-api/domain', cdk.Fn.select(2, cdk.Fn.split('/', api.apiEndpoint)));
  }
}
