import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AppConfig, ORG, accountPushFunctionName, enrollCodeKeyParamName, hostName, resourceName, vaultServiceParamName } from '../config';
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
  vaultGrantResources,
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
 * members-stream welcome mailer, the vault credential-clone alarm mailer and
 * the vault-names job (2.2.0).
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
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: grant.actions.map((a) => `dynamodb:${a}`),
            resources: vaultGrantResources(config, vaultCfg, grant),
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
    // The vault service pause (MEMBER-API "Vault service pause"): read-only
    // access to the one switch parameter, for the routes and the cleanup
    // job; only the admin API's vault-service Lambda may write it.
    const switchParamArn = `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${vaultServiceParamName(config)}`;
    const readSwitch = (fn: lambda.Function) => {
      fn.addEnvironment('VAULT_SERVICE_PARAM', vaultServiceParamName(config));
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [switchParamArn] }));
    };
    readSwitch(vault);
    // GetItem by user_guid; Query on email-index for a typed setup code
    // (the member is found by the email typed with it, MEMBER-API 2.0.0).
    g(vault, 'members', ['GetItem', 'Query'], true);
    g(vault, 'terms', ['Query'], true);
    g(vault, 'subscriptions', ['GetItem']); // the account snapshot in each unlock (§11.13)
    g(vault, 'ratelimits', ['UpdateItem']); // counters and the app requests' single-use nonces
    g(vault, 'audit', ['PutItem']);
    vaultGrants(vault, 'vault');
    vault.addToRolePolicy(sesSend); // recovery notices (VAULT-MESSAGING §11.11), setup-code emails
    // k_code (MEMBER-API 2.0.0 "Setup codes"): the HMAC key of the setup
    // codes, an SSM SecureString an operator creates once (RUNBOOK "Setup
    // codes"). Read here only; the AWS-managed aws/ssm key decrypts it for
    // any principal of the account allowed to read the parameter.
    const enrollKeyParam = enrollCodeKeyParamName(config);
    vault.addEnvironment('ENROLL_CODE_KEY_PARAM', enrollKeyParam);
    vault.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [`arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${enrollKeyParam}`] }));
    // The staging-only switch-over (ENROLLMENT-CODES §8 step 3; never in production, lib/config.ts).
    if (config.vaultLegacySessionAuth) {
      if (config.stage === 'prod') throw new Error('vaultLegacySessionAuth is staging-only');
      vault.addEnvironment('VAULT_LEGACY_SESSION_AUTH', '1');
    }

    // A member's typed setup-code entry reached its ceiling of 800 attempts
    // (MEMBER-API 2.0.0 "Setup codes"): the vault Lambda writes
    // EnrollTypedCeiling (EMF) when it blocks an issuance's typed entry.
    const typedCeiling = new cloudwatch.Alarm(this, 'MemberEnrollTypedCeiling', {
      alarmName: resourceName(config, 'member-enroll-typed-ceiling'),
      alarmDescription: "MemberEnrollTypedCeiling: a member's setup code got 800 wrong typed attempts and its typed entry is blocked (the QR still works; the member was emailed). Someone is guessing one member's code (RUNBOOK \"Setup codes\").",
      metric: new cloudwatch.Metric({ namespace: 'VettID/MemberApi', metricName: 'EnrollTypedCeiling', statistic: 'Sum', period: cdk.Duration.minutes(5) }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // The account snapshot to a running vault (MEMBER-API 2.0.0, VAULT-MESSAGING
    // 0.15.0 §11.13): invoked asynchronously by the account routes and the
    // admin API after a change; sends the op `account` to the vault's live
    // leaseholder only. Fixed role name (the vault account's policies name
    // it) and function name (the admin API invokes it by name).
    const accountPush = new ApiFunction(this, 'VaultAccountPush', {
      entry: 'lambda/jobs/vault-account-push.ts',
      environment: env,
      timeout: cdk.Duration.seconds(30),
      functionName: accountPushFunctionName(config),
      roleName: vaultApiRoleName(config, 'account-push'),
      description: "Sends a member's account snapshot to their running vault (queue op account)",
    }).fn;
    g(accountPush, 'members', ['GetItem']);
    g(accountPush, 'subscriptions', ['GetItem']);
    g(accountPush, 'terms', ['Query'], true);
    vaultGrants(accountPush, 'account-push');
    accountPush.grantInvoke(account);
    account.addEnvironment('ACCOUNT_PUSH_FN', accountPush.functionName);

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
    readSwitch(cleanup); // no deletion is queued while the vault service is paused
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
    // "Delete my vault and start over" (MEMBER-API 2.1.0, VAULT-MESSAGING
    // 0.16.0 §11.11.9): the same job, every 5 minutes, sends the host's
    // `delete` for each start-over past its 24 h.
    new events.Rule(this, 'StartOverSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(cleanup, { event: events.RuleTargetInput.fromObject({ task: 'start_over' }) })],
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
    // Name changes from the vault (MEMBER-API 2.2.0, VAULT-MESSAGING 0.18.0
    // §10.8, §11.5): the enclave host records the vault's name request on the
    // vault row; this job, fed only the stream records that carry
    // `name_change_pending`, applies or refuses it (one applied change per 30
    // days), audits, emails the member and has account-push send the
    // snapshot. On the vault row it may only clear the flag and write the
    // result; on the member row only the names and their change record.
    const names = job('VaultNamesJob', 'lambda/jobs/vault-names.ts', cdk.Duration.seconds(30), vaultApiRoleName(config, 'vault-names'));
    g(names, 'members', ['GetItem']);
    tableGrant(this, config, names, 'members', ['UpdateItem'], {
      attributes: ['user_guid', 'first_name', 'last_name', 'name_changed_at', 'name_change_applied', 'updated_at'],
    });
    g(names, 'audit', ['PutItem']);
    vaultGrants(names, 'vault-names');
    names.addToRolePolicy(sesSend);
    accountPush.grantInvoke(names);
    names.addEnvironment('ACCOUNT_PUSH_FN', accountPush.functionName);
    // Release notices (VAULT-RELEASES §3.5, §10.2; W8): daily, emails the
    // members whose vault is sealed to an ending release (90/30/7/1 days
    // before ends_at, then "ended") or to one an urgent security release
    // fixes. Reads the release rows and the sealed-release index only; each
    // notice is claimed once in the ratelimits table.
    const notices = job('VaultNoticeJob', 'lambda/jobs/vault-notices.ts', cdk.Duration.minutes(5), vaultApiRoleName(config, 'vault-notices'));
    g(notices, 'members', ['GetItem']);
    g(notices, 'ratelimits', ['PutItem', 'DeleteItem']);
    g(notices, 'audit', ['PutItem']);
    vaultGrants(notices, 'vault-notices');
    notices.addToRolePolicy(sesSend);
    // The public release log (generated from the signed manifest): urgent security releases.
    notices.addEnvironment('RELEASE_LOG_URL', `https://${config.domainName}/security/releases/`);
    new events.Rule(this, 'VaultNoticeSchedule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '15' }), // 15:00 UTC daily: daytime in the Americas and Europe
      targets: [new targets.LambdaFunction(notices)],
    });

    // A pause must not be forgotten (RUNBOOK "Pausing the vault service"):
    // every 5 minutes the watcher writes VaultServicePaused (EMF, no
    // PutMetricData right); one alarm reports a pause and its end, another
    // a pause still on after a day. Every write to the parameter is also
    // emailed by VettidOrgAuditStack's rule (both stages).
    const watch = job('VaultServiceWatch', 'lambda/jobs/vault-service-watch.ts', cdk.Duration.seconds(30));
    readSwitch(watch);
    new events.Rule(this, 'VaultServiceWatchSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(watch)],
    });
    const pausedMetric = (period: cdk.Duration) =>
      new cloudwatch.Metric({ namespace: 'VettID/MemberApi', metricName: 'VaultServicePaused', statistic: 'Maximum', period });
    const pausedAlarms = [
      new cloudwatch.Alarm(this, 'VaultServicePaused', {
        alarmName: resourceName(config, 'vault-service-paused'),
        alarmDescription: 'The vault service is paused: enroll, unlock and recovery answer 503 (RUNBOOK "Pausing the vault service"). OK when resumed.',
        metric: pausedMetric(cdk.Duration.minutes(5)),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'VaultServicePaused24h', {
        alarmName: resourceName(config, 'vault-service-paused-24h'),
        alarmDescription: 'The vault service has been paused for 24 hours (RUNBOOK "Pausing the vault service"): resume it or say why not.',
        metric: pausedMetric(cdk.Duration.hours(1)),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 24,
        datapointsToAlarm: 24,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    // Both alarms above read missing data as "not paused", so a watcher
    // that stops writing would silence them. The watcher writes the metric
    // every run in both states (1 or 0), so its absence is the one signal
    // that covers every way it can stop: a failed run (unreadable switch),
    // a timeout, throttling, a disabled schedule, a broken EMF line. An
    // alarm on the function's Errors would see only the first.
    const watchSilent = new cloudwatch.Alarm(this, 'VaultServiceWatchSilent', {
      alarmName: resourceName(config, 'vault-service-watch-silent'),
      alarmDescription: 'VaultServicePaused has not been written for 20 minutes: the VaultServiceWatch job is failing or not running, so a pause would go unreported (RUNBOOK "Pausing the vault service"). OK when it writes again.',
      metric: new cloudwatch.Metric({ namespace: 'VettID/MemberApi', metricName: 'VaultServicePaused', statistic: 'SampleCount', period: cdk.Duration.minutes(5) }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 4,
      datapointsToAlarm: 4,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    // Production's main account is the management account, home of the
    // security-alerts topic (VettidOrgAuditStack). Staging's account has no
    // topic: there the parameter-change emails are the notice.
    if (this.account === ORG.management && config.stage === 'prod') {
      const alertsTopicArn = `arn:${this.partition}:sns:${this.region}:${this.account}:${resourceName(config, 'security-alerts')}`;
      const action = { bind: () => ({ alarmActionArn: alertsTopicArn }) };
      for (const a of pausedAlarms) a.addAlarmAction(action);
      typedCeiling.addAlarmAction(action);
      pausedAlarms[0].addOkAction(action); // "resumed"; the 24 h alarm's OK would say it twice
      watchSilent.addAlarmAction(action);
      watchSilent.addOkAction(action); // the watch is back
    }

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
      names.addEventSource(
        new sources.DynamoEventSource(vaultsTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 10,
          retryAttempts: 3,
          bisectBatchOnError: true,
          filters: [lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('MODIFY'), dynamodb: { NewImage: { name_change_pending: { BOOL: lambda.FilterRule.isEqual(true) } } } })],
        }),
      );
    } else {
      cdk.Annotations.of(this).addWarningV2(
        'vettid:vaults-stream-unset',
        `The vault alarm mailer and the vault-names job have no event source: set context ${config.stage === 'prod' ? 'vaultsStreamArn' : `${config.stage}VaultsStreamArn`} (VettidOrgVaultStack output VaultsStreamArn)`,
      );
    }

    publishRef(this, config, 'member-api/domain', cdk.Fn.select(2, cdk.Fn.split('/', api.apiEndpoint)));
  }
}
