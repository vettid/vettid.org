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
    const env = {
      ...tableEnv(config),
      MEMBER_POOL_ID: readRef(this, config, 'auth/member-pool-id'),
      MEMBER_CLIENT_ID: readRef(this, config, 'auth/member-client-id'),
      PIN_PEPPER_SECRET_ARN: readRef(this, config, 'auth/pin-pepper-secret-arn'),
      TERMS_BUCKET: readRef(this, config, 'data/terms-bucket-name'),
      ORIGIN_VERIFY_SECRET_ARN: originSecret.secretArn,
      SENDER_EMAIL: config.senderEmail,
      ADMIN_EMAIL: config.adminEmail,
      ACCOUNT_HOST: hostName(config, 'account'),
    };

    const group = (id: string, pathPrefix: string, entry: string) => {
      const fn = new HttpRouteGroup(this, id, { api, pathPrefix, entry, environment: env }).fn;
      originSecret.grantRead(fn);
      return fn;
    };
    const pub = group('Public', '/api/public', 'lambda/member/public.ts');
    const auth = group('Auth', '/api/auth', 'lambda/member/auth.ts');
    const account = group('Account', '/api/account', 'lambda/member/account.ts');
    const vault = group('Vault', '/api/vault', 'lambda/member/vault.ts');

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
    const vaultControlQueuePrefix = `${resourceName(config, 'vault-control')}-`;
    vault.addEnvironment('VAULT_QUEUE_URL_PREFIX', `https://sqs.${this.region}.amazonaws.com/${this.account}/${vaultControlQueuePrefix}`);
    g(vault, 'members', ['GetItem']);
    g(vault, 'terms', ['Query'], true);
    g(vault, 'ratelimits', ['UpdateItem']);
    g(vault, 'audit', ['PutItem']);
    g(vault, 'vaults', ['GetItem']);
    g(vault, 'vault-instances', ['GetItem', 'Query'], true);
    g(vault, 'vault-requests', ['GetItem', 'PutItem', 'UpdateItem']);
    g(vault, 'vault-releases', ['GetItem', 'Query'], true);
    const tableArn = (t: string) => `arn:${this.partition}:dynamodb:${this.region}:${this.account}:table/${resourceName(config, t)}`;
    // Attribute-level write limits (DynamoDB fine-grained access control).
    // ForAllValues is vacuously true if a request carried no attribute list,
    // so this narrows, and never widens, the plain table grant.
    const onlyAttributes = (attrs: string[]) =>({ 'ForAllValues:StringEquals': { 'dynamodb:Attributes': attrs } });
    vault.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [tableArn('vaults')],
        conditions: onlyAttributes(['vault_id', 'user_guid', 'state', 'created_at', 'updated_at', 'current_vault_id', 'recovery']),
      }),
    );
    vault.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:UpdateItem'],
        resources: [tableArn('vault-releases')],
        conditions: onlyAttributes(['release', 'start_requested_at', 'start_requests']),
      }),
    );
    vault.addToRolePolicy(sesSend); // recovery notices (VAULT-MESSAGING §11.11)
    vault.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [`arn:${this.partition}:sqs:${this.region}:${this.account}:${vaultControlQueuePrefix}*`],
      }),
    );

    // ---- background jobs --------------------------------------------------------
    const job = (id: string, entry: string, timeout = cdk.Duration.minutes(5)) =>
      new ApiFunction(this, id, { entry, environment: env, timeout }).fn;

    const verifications = job('VerificationsJob', 'lambda/jobs/verifications.ts');
    g(verifications, 'members', ['Query', 'UpdateItem'], true);
    sesIdentity(verifications, ['GetEmailIdentity']);
    new events.Rule(this, 'VerificationsSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(verifications)],
    });

    const cleanup = job('CleanupJob', 'lambda/jobs/cleanup.ts');
    g(cleanup, 'members', ['Query', 'DeleteItem'], true);
    g(cleanup, 'subscriptions', ['Query', 'UpdateItem', 'DeleteItem'], true);
    g(cleanup, 'audit', ['PutItem']);
    // canceled accounts: their vault rows go with them (vault objects: V5)
    g(cleanup, 'vaults', ['Query', 'DeleteItem'], true);
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

    // Credential-clone alarms (VAULT-MESSAGING 0.9.0 §3.5.9, §11.5): the
    // enclave host records a content-free alarm on the vault row; this
    // mailer, fed only the stream records that carry `alarm_pending`, emails
    // the member. It may only clear `alarm_pending` and stamp the alarm.
    const alarms = job('VaultAlarmMailer', 'lambda/jobs/vault-alarms.ts', cdk.Duration.seconds(30));
    g(alarms, 'members', ['GetItem']);
    g(alarms, 'ratelimits', ['UpdateItem']);
    g(alarms, 'audit', ['PutItem']);
    alarms.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:UpdateItem'],
        resources: [tableArn('vaults')],
        conditions: onlyAttributes(['vault_id', 'alarm', 'alarm_pending']),
      }),
    );
    alarms.addToRolePolicy(sesSend);
    const vaultsTable = dynamodb.Table.fromTableAttributes(this, 'VaultsTable', {
      tableName: resourceName(config, 'vaults'),
      tableStreamArn: readRef(this, config, 'data/vaults-stream-arn'),
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

    publishRef(this, config, 'member-api/domain', cdk.Fn.select(2, cdk.Fn.split('/', api.apiEndpoint)));
  }
}
