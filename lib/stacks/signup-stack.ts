import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * Mailing-list signup backed by the SES-verification opt-in pattern:
 *
 *   POST /api/subscribe  → validate, SES CreateEmailIdentity(email), write a
 *                          pending row. SES sends its own verification email;
 *                          the user accepting it IS the opt-in, and it makes
 *                          the address sendable from the SES sandbox.
 *   every 15 minutes     → check pending rows against GetEmailIdentity and
 *                          flip verified ones to confirmed.
 *
 * Unconfirmed rows expire via TTL after 3 days (SES verification links die
 * after 24h anyway). Responses never reveal whether an address was already
 * subscribed, and the Lambdas log shapes only — never email addresses
 * (logging spec §5).
 */
export class VettidOrgSignupStack extends cdk.Stack {
  /** Domain of the HTTP API endpoint, for the CloudFront /api/* origin */
  public readonly apiDomain: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'MailingList', {
      tableName: 'vettid-org-mailing-list',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    table.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestedAt', type: dynamodb.AttributeType.STRING },
    });

    const subscribeFn = new lambda.Function(this, 'SubscribeFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'subscribe.handler',
      code: lambda.Code.fromAsset('lambda/signup'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: { TABLE_NAME: table.tableName },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const checkFn = new lambda.Function(this, 'CheckVerificationsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'check-verifications.handler',
      code: lambda.Code.fromAsset('lambda/signup'),
      timeout: cdk.Duration.minutes(2),
      memorySize: 128,
      environment: { TABLE_NAME: table.tableName },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    table.grantReadWriteData(subscribeFn);
    table.grantReadWriteData(checkFn);

    subscribeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:CreateEmailIdentity', 'ses:GetEmailIdentity'],
      resources: ['*'],
    }));
    checkFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:GetEmailIdentity'],
      resources: ['*'],
    }));

    new events.Rule(this, 'CheckSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(checkFn)],
    });

    const httpApi = new apigwv2.HttpApi(this, 'SignupApi', {
      apiName: 'vettid-org-signup',
      createDefaultStage: false,
    });
    httpApi.addRoutes({
      path: '/api/subscribe',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('SubscribeIntegration', subscribeFn),
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
