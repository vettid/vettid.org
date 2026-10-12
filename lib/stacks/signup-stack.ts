import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { ApiFunction } from '../constructs/api-function';
import { websiteLogGroupRetention } from '../constructs/website-logs';

/**
 * Secret CloudFront adds to the public site's /api/* origin requests
 * (X-Origin-Verify); subscribe.mjs rejects requests without it. Fixed name so
 * the web stack resolves it at deploy time without a cross-stack export.
 */
export const SIGNUP_ORIGIN_VERIFY_SECRET_NAME = 'vettid-org-signup/origin-verify';

/** Members table (VettidOrgDataStack), consulted before reclaiming an SES identity. */
const MEMBERS_TABLE_NAME = 'vettid-org-members';

/** The main account's alarm topic (VettidOrgAuditStack; it admits CloudWatch alarms). */
const ALERTS_TOPIC_NAME = 'vettid-org-security-alerts';

/** The unsubscribe route: named by the WAF rules of the web stack too. */
export const UNSUBSCRIBE_API_PATH = '/api/subscribe/unsubscribe';
/**
 * The unsubscribe POST's own API throttle. After a mailing, mail providers
 * send their one-click POSTs from a few addresses in a burst; the stage's
 * 5 per second would answer 429 to people who then believe they left. A
 * miss costs one index query.
 */
const UNSUBSCRIBE_THROTTLE = { rateLimit: 50, burstLimit: 100 };

/**
 * Mailing-list signup backed by the SES-verification opt-in pattern:
 *
 *   POST /api/subscribe  → validate, SES CreateEmailIdentity(email), write a
 *                          pending row. SES sends its own verification email;
 *                          the user accepting it IS the opt-in, and it makes
 *                          the address sendable from the SES sandbox.
 *                          If SES has ALREADY verified the address (e.g. a
 *                          VettID member), we email our own single-use link
 *                          instead (row status pending_link, 48h).
 *   GET /api/subscribe/confirm?t=…  → that link: confirm, 302 to the site.
 *   GET|POST /api/subscribe/unsubscribe  → leave the list. Every row has a
 *                          random unsubscribe token (looked up through the
 *                          sparse unsub-index); list mail carries it in a
 *                          link and in the RFC 8058 List-Unsubscribe headers
 *                          (lambda/signup/list-mail.mjs). GET only redirects
 *                          to the site's /unsubscribe/ page; POST deletes
 *                          the row and leaves a release marker.
 *   every 15 minutes     → check pending rows against GetEmailIdentity and
 *                          flip verified ones to confirmed (and send the
 *                          welcome mail); for each release marker, delete
 *                          the SES identity unless a member uses it.
 *
 * Unconfirmed rows expire via TTL after 3 days (SES verification links die
 * after 24h anyway). Responses never reveal whether an address was already
 * subscribed, and the Lambdas log shapes only — never email addresses
 * (logging spec §5). The API only serves requests carrying CloudFront's
 * origin-verify header (deploy this stack before VettidOrgStack).
 */
export interface VettidOrgSignupStackProps extends cdk.StackProps {
  /** Route53 zone; enables the vettid.org SES domain identity (DKIM records) */
  hostedZone: route53.IPublicHostedZone;
}

export class VettidOrgSignupStack extends cdk.Stack {
  /** Domain of the HTTP API endpoint, for the CloudFront /api/* origin */
  public readonly apiDomain: string;

  constructor(scope: Construct, id: string, props: VettidOrgSignupStackProps) {
    super(scope, id, props);

    // Verified sending domain: lets the Lambdas send from no-reply@vettid.org.
    // DKIM CNAMEs land in the Route53 zone automatically.
    new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.publicHostedZone(props.hostedZone),
    });

    const table = new dynamodb.Table(this, 'MailingList', {
      tableName: 'vettid-org-mailing-list',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestedAt', type: dynamodb.AttributeType.STRING },
    });
    // Unsubscribe token → row. Sparse (only subscriber rows have the
    // attribute) and keys only: the lookup needs nothing but the address.
    table.addGlobalSecondaryIndex({
      indexName: 'unsub-index',
      partitionKey: { name: 'unsubToken', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    const originSecret = new secretsmanager.Secret(this, 'OriginVerify', {
      secretName: SIGNUP_ORIGIN_VERIFY_SECRET_NAME,
      description: 'Header value CloudFront adds to vettid.org /api/* requests; the signup API rejects requests without it.',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const env = {
      TABLE_NAME: table.tableName,
      ADMIN_EMAIL: 'admin@vettid.org',
      SENDER_EMAIL: 'no-reply@vettid.org',
    };
    const subscribeFn = new ApiFunction(this, 'SubscribeFn', {
      entry: 'lambda/signup/subscribe.mjs',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: { ...env, ORIGIN_VERIFY_SECRET_ARN: originSecret.secretArn },
      logRetention: websiteLogGroupRetention(),
    }).fn;
    originSecret.grantRead(subscribeFn);

    const check = new ApiFunction(this, 'CheckVerificationsFn', {
      entry: 'lambda/signup/check-verifications.mjs',
      timeout: cdk.Duration.minutes(2),
      memorySize: 128,
      environment: { ...env, MEMBERS_TABLE_NAME },
      logRetention: websiteLogGroupRetention(),
    });
    const checkFn = check.fn;

    // DynamoDB least privilege (was grantReadWriteData on both):
    //  - subscribe reads a row by key and writes new rows
    //  - check queries the status GSI and updates/deletes rows
    // GetItem/PutItem for subscriber rows and confirm-link pointers;
    // UpdateItem for the atomic global-send-quota counter (sentinel key in
    // the same table) and for confirming via link; DeleteItem for
    // unsubscribing (and for used confirm-link pointers). PutItem also
    // writes the release markers. GetItem on the sweep: is a released
    // address back on the list?
    table.grant(subscribeFn, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem');
    table.grant(checkFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem');
    // Unsubscribe token → address: that one index, nothing else. Subscribe
    // gets no read of the members table and may not delete SES identities;
    // the sweep, which already has both, finishes an unsubscribe.
    subscribeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${table.tableArn}/index/unsub-index`],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${table.tableArn}/index/*`],
    }));
    // Is an expiring or released address also a VettID member's? (see
    // check-verifications.mjs.) The email index, and a strongly consistent
    // read of the member table's email marker rows (`email:<addr>`) and of
    // nothing else in that table.
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [this.formatArn({ service: 'dynamodb', resource: 'table', resourceName: `${MEMBERS_TABLE_NAME}/index/email-index` })],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [this.formatArn({ service: 'dynamodb', resource: 'table', resourceName: MEMBERS_TABLE_NAME })],
      conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['email:*'] } },
    }));

    // ses:SendEmail stays on '*' ON PURPOSE. Empirically, scoping it to the
    // vettid.org domain-identity ARN causes AccessDeniedException on every
    // send (SES v2 SendEmail does not authorize a display-name sender against
    // the domain-identity resource the way the docs imply), which silently
    // kills the admin notifications — the exact breakage this has hit before.
    // The From address is hardcoded (no-reply@vettid.org) in both Lambdas, so
    // the residual risk of '*' is a future code change, not live exposure.
    // The identity actions can't be resource-scoped anyway.
    subscribeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:CreateEmailIdentity', 'ses:GetEmailIdentity', 'ses:SendEmail'],
      resources: ['*'],
    }));

    checkFn.addToRolePolicy(new iam.PolicyStatement({
      // DeleteEmailIdentity reclaims identities of subscribers who never
      // verified (identity-quota-exhaustion guard) and of those who
      // unsubscribed.
      actions: ['ses:GetEmailIdentity', 'ses:DeleteEmailIdentity', 'ses:SendEmail'],
      resources: ['*'],
    }));
    // ...but never the sending domain itself, nor one of the project's own
    // addresses: a bug (or a crafted row) must not be able to delete the
    // vettid.org domain identity or an @vettid.org identity.
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['ses:DeleteEmailIdentity'],
      resources: ['vettid.org', '*.vettid.org', '*@vettid.org', '*@*.vettid.org'].map((d) =>
        this.formatArn({ service: 'ses', resource: 'identity', resourceName: d })),
    }));

    new events.Rule(this, 'CheckSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(checkFn)],
    });

    const httpApi = new apigwv2.HttpApi(this, 'SignupApi', {
      apiName: 'vettid-org-signup',
      createDefaultStage: false,
    });
    const subscribeIntegration = new HttpLambdaIntegration('SubscribeIntegration', subscribeFn);
    httpApi.addRoutes({
      path: '/api/subscribe',
      methods: [apigwv2.HttpMethod.POST],
      integration: subscribeIntegration,
    });
    httpApi.addRoutes({
      path: '/api/subscribe/confirm',
      methods: [apigwv2.HttpMethod.GET],
      integration: subscribeIntegration,
    });
    const unsubscribeRoutes = httpApi.addRoutes({
      path: UNSUBSCRIBE_API_PATH,
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: subscribeIntegration,
    });
    const stage = new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      // Modest global throttle: this is a single public form
      throttle: { rateLimit: 5, burstLimit: 10 },
    });
    // ...except the unsubscribe POST (UNSUBSCRIBE_THROTTLE).
    const cfnStage = stage.node.defaultChild as apigwv2.CfnStage;
    // (RouteSettings is free-form JSON to CDK: CloudFormation's own key names.)
    cfnStage.routeSettings = {
      [`POST ${UNSUBSCRIBE_API_PATH}`]: {
        ThrottlingRateLimit: UNSUBSCRIBE_THROTTLE.rateLimit,
        ThrottlingBurstLimit: UNSUBSCRIBE_THROTTLE.burstLimit,
      },
    };
    for (const r of unsubscribeRoutes) stage.node.addDependency(r); // route settings name an existing route

    // ---- Alarms: an unsubscribe that is not finished must not be silent ----
    // The sweep logs one line per run with its counts. To the main account's
    // alarm topic; RUNBOOK "Mailing list" → Unsubscribe says what to do.
    const sweepCount = (cid: string, field: string) =>
      new logs.MetricFilter(this, cid, {
        logGroup: check.logGroup,
        filterPattern: logs.FilterPattern.all(
          logs.FilterPattern.stringValue('$.outcome', '=', 'sweep'),
          logs.FilterPattern.numberValue(`$.${field}`, '>', 0),
        ),
        metricNamespace: 'VettID/MailingList',
        metricName: field,
        metricValue: `$.${field}`,
      }).metric({ statistic: 'Sum', period: cdk.Duration.minutes(15) });
    const says = (text: string) => `Mailing list: ${text} (RUNBOOK "Mailing list" → Unsubscribe).`;
    const alarms = [
      // Four sweeps in a row: one failed lookup is retried and is not news.
      new cloudwatch.Alarm(this, 'ReleaseRetryAlarm', {
        alarmName: 'vettid-org-mailing-list-release-retry',
        alarmDescription: says('for an hour the sweep has not been able to finish an unsubscribe: an address is still held in a release marker and in SES'),
        metric: sweepCount('ReleaseRetryMetric', 'releaseRetry'),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 4,
        datapointsToAlarm: 4,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ReleaseAbandonedAlarm', {
        alarmName: 'vettid-org-mailing-list-release-abandoned',
        alarmDescription: says('the sweep gave up on an unsubscribe after 7 days: the address is off the list and off its marker, but its SES identity was not deleted; reconcile by hand'),
        metric: sweepCount('ReleaseAbandonedMetric', 'releaseAbandoned'),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'SweepErrorsAlarm', {
        alarmName: 'vettid-org-mailing-list-sweep-errors',
        alarmDescription: says('the sweep has failed four times in a row: confirmations and unsubscribes are not being finished'),
        metric: checkFn.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(15) }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 4,
        datapointsToAlarm: 4,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    const alertsTopicArn = this.formatArn({ service: 'sns', resource: ALERTS_TOPIC_NAME, arnFormat: cdk.ArnFormat.NO_RESOURCE_NAME });
    for (const a of alarms) a.addAlarmAction({ bind: () => ({ alarmActionArn: alertsTopicArn }) });

    // e.g. abc123.execute-api.us-east-1.amazonaws.com
    this.apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'Signup HTTP API endpoint (reached via CloudFront /api/*)',
    });
    new cdk.CfnOutput(this, 'MailingListTable', {
      value: table.tableName,
      description: 'DynamoDB table holding pending/confirmed subscribers',
    });
  }
}
