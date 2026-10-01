import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { ApiFunction } from '../constructs/api-function';

/**
 * Secret CloudFront adds to the public site's /api/* origin requests
 * (X-Origin-Verify); subscribe.mjs rejects requests without it. Fixed name so
 * the web stack resolves it at deploy time without a cross-stack export.
 */
export const SIGNUP_ORIGIN_VERIFY_SECRET_NAME = 'vettid-org-signup/origin-verify';

/** Members table (VettidOrgDataStack), consulted before reclaiming an SES identity. */
const MEMBERS_TABLE_NAME = 'vettid-org-members';

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
 *   every 15 minutes     → check pending rows against GetEmailIdentity and
 *                          flip verified ones to confirmed.
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
    }).fn;
    originSecret.grantRead(subscribeFn);

    const checkFn = new ApiFunction(this, 'CheckVerificationsFn', {
      entry: 'lambda/signup/check-verifications.mjs',
      timeout: cdk.Duration.minutes(2),
      memorySize: 128,
      environment: { ...env, MEMBERS_TABLE_NAME },
    }).fn;

    // DynamoDB least privilege (was grantReadWriteData on both):
    //  - subscribe reads a row by key and writes new rows
    //  - check queries the status GSI and updates/deletes rows
    // GetItem/PutItem for subscriber rows and confirm-link pointers;
    // UpdateItem for the atomic global-send-quota counter (sentinel key in
    // the same table) and for confirming via link.
    table.grant(subscribeFn, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
    table.grant(checkFn, 'dynamodb:UpdateItem', 'dynamodb:DeleteItem');
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${table.tableArn}/index/*`],
    }));
    // Is an expiring row's address also a VettID member's? (see check-verifications.mjs)
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [this.formatArn({ service: 'dynamodb', resource: 'table', resourceName: `${MEMBERS_TABLE_NAME}/index/email-index` })],
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
      // verified (identity-quota-exhaustion guard).
      actions: ['ses:GetEmailIdentity', 'ses:DeleteEmailIdentity', 'ses:SendEmail'],
      resources: ['*'],
    }));
    // ...but never the sending domain itself: a bug (or a crafted row) must
    // not be able to delete the vettid.org domain identity.
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['ses:DeleteEmailIdentity'],
      resources: ['vettid.org', '*.vettid.org'].map((d) =>
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
    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      // Modest global throttle: this is a single public form
      throttle: { rateLimit: 5, burstLimit: 10 },
    });

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
