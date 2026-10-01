import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { RestRouteGroup } from '../constructs/rest-route-group';
import { readRef } from '../constructs/ssm-refs';

export interface VettidOrgAdminApiStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Stateless: the admin REST API at admin-api.vettid.org (docs/ADMIN-API.md).
 *
 * Two independent locks on every request:
 *  1. Resource policy — only the admin exit node's egress IP may invoke
 *     (read from SSM, published by VettidOrgAdminAccessStack). The default
 *     execute-api endpoint is disabled, so the custom domain is the only way in.
 *  2. Cognito authorizer on the admin pool; handlers also require the
 *     `admin` group.
 *
 * Routes are served by three route-group Lambdas (people, content, system).
 */
export class VettidOrgAdminApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAdminApiStackProps) {
    super(scope, id, props);
    const { config } = props;
    // Looked up by name (cached in cdk.context.json) rather than passed from
    // VettidOrgDnsStack, which would create a CloudFormation export.
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.domainName });
    const apiHost = hostName(config, 'admin-api');
    const siteOrigin = `https://${hostName(config, 'admin')}`;
    const egressIp = readRef(this, config, 'admin-access/egress-ip');

    const api = new apigw.RestApi(this, 'Api', {
      restApiName: resourceName(config, 'admin-api'),
      description: 'VettID admin API (exit-node IP + Cognito admin pool)',
      endpointTypes: [apigw.EndpointType.REGIONAL],
      disableExecuteApiEndpoint: true,
      cloudWatchRole: false,
      deployOptions: {
        stageName: 'v1',
        throttlingRateLimit: 20,
        throttlingBurstLimit: 40,
      },
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*'],
            conditions: { IpAddress: { 'aws:SourceIp': [cdk.Fn.join('', [egressIp, '/32'])] } },
          }),
        ],
      }),
      defaultCorsPreflightOptions: {
        allowOrigins: [siteOrigin],
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Errors produced by API Gateway itself (policy denial, bad token) need
    // CORS headers too, or the browser reports an opaque network error
    // instead of a 401/403 the admin UI can explain.
    for (const type of [apigw.ResponseType.DEFAULT_4XX, apigw.ResponseType.DEFAULT_5XX]) {
      api.addGatewayResponse(`Cors${type.responseType}`, {
        type,
        responseHeaders: {
          'Access-Control-Allow-Origin': `'${siteOrigin}'`,
          'Access-Control-Allow-Headers': "'Authorization,Content-Type'",
          Vary: "'Origin'",
        },
      });
    }

    const adminPool = cognito.UserPool.fromUserPoolArn(this, 'AdminPool', readRef(this, config, 'auth/admin-pool-arn'));
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'AdminAuthorizer', {
      authorizerName: resourceName(config, 'admin'),
      cognitoUserPools: [adminPool],
    });

    // ---- custom domain ----------------------------------------------------
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: apiHost,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
    const domain = new apigw.DomainName(this, 'Domain', {
      domainName: apiHost,
      certificate,
      endpointType: apigw.EndpointType.REGIONAL,
      securityPolicy: apigw.SecurityPolicy.TLS_1_2,
    });
    domain.addBasePathMapping(api, { stage: api.deploymentStage });
    new route53.ARecord(this, 'Alias', {
      zone: hostedZone,
      recordName: apiHost,
      target: route53.RecordTarget.fromAlias(new route53targets.ApiGatewayDomain(domain)),
    });

    // ---- route groups -----------------------------------------------------
    const tableName = (t: string) => resourceName(config, t);
    const env = {
      ALLOWED_ORIGIN: siteOrigin,
      TABLE_MEMBERS: tableName('members'),
      TABLE_INVITES: tableName('invites'),
      TABLE_TERMS: tableName('terms'),
      TABLE_SUBSCRIPTIONS: tableName('subscriptions'),
      TABLE_SUBSCRIPTION_TYPES: tableName('subscription-types'),
      TABLE_AUDIT: tableName('audit'),
    };

    const people = new RestRouteGroup(this, 'People', {
      api,
      authorizer,
      pathPrefixes: ['/admin/requests', '/admin/members', '/admin/invites'],
      entry: 'lambda/admin/people.ts',
      environment: { ...env, MEMBER_POOL_ID: readRef(this, config, 'auth/member-pool-id') },
    }).fn;
    const content = new RestRouteGroup(this, 'Content', {
      api,
      authorizer,
      pathPrefixes: ['/admin/terms', '/admin/subscription-types'],
      entry: 'lambda/admin/content.ts',
      timeout: cdk.Duration.seconds(30), // hashes up to 10 MB PDFs at publish
      environment: { ...env, TERMS_BUCKET: readRef(this, config, 'data/terms-bucket-name') },
    }).fn;
    const system = new RestRouteGroup(this, 'System', {
      api,
      authorizer,
      pathPrefixes: ['/admin/me', '/admin/admins', '/admin/audit'],
      entry: 'lambda/admin/system.ts',
      environment: { ...env, ADMIN_POOL_ID: readRef(this, config, 'auth/admin-pool-id') },
    }).fn;

    // ---- least-privilege grants ---------------------------------------------
    const tableArn = (t: string) => `arn:${this.partition}:dynamodb:${this.region}:${this.account}:table/${tableName(t)}`;
    const grantTable = (fn: lambda.IFunction, t: string, actions: string[], withIndexes = false) =>
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: actions.map((a) => `dynamodb:${a}`),
          resources: withIndexes ? [tableArn(t), `${tableArn(t)}/index/*`] : [tableArn(t)],
        }),
      );

    // Audit is append-only for every writer; only `system` may read it.
    for (const fn of [people, content, system]) grantTable(fn, 'audit', ['PutItem']);
    grantTable(system, 'audit', ['Query'], true);

    grantTable(people, 'members', ['GetItem', 'Query', 'Scan', 'UpdateItem', 'DeleteItem'], true);
    grantTable(people, 'invites', ['Scan', 'PutItem', 'UpdateItem', 'DeleteItem']);
    grantTable(people, 'subscriptions', ['GetItem', 'BatchGetItem', 'PutItem', 'DeleteItem']);
    people.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminUserGlobalSignOut',
        ],
        resources: [readRef(this, config, 'auth/member-pool-arn')],
      }),
    );

    grantTable(content, 'terms', ['Scan', 'GetItem', 'PutItem', 'Query', 'UpdateItem'], true);
    grantTable(content, 'subscription-types', ['Scan', 'PutItem', 'UpdateItem']);
    const termsBucketName = readRef(this, config, 'data/terms-bucket-name');
    content.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [cdk.Fn.join('', ['arn:', this.partition, ':s3:::', termsBucketName, '/terms/*'])],
      }),
    );

    system.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:ListUsersInGroup',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminUserGlobalSignOut',
        ],
        resources: [readRef(this, config, 'auth/admin-pool-arn')],
      }),
    );

    // SES identity management for the sandbox opt-in flow. Identity ARNs are
    // per-address and created on demand, so these can't be narrowed further.
    const sesIdentities = new iam.PolicyStatement({
      actions: ['ses:GetEmailIdentity', 'ses:CreateEmailIdentity'],
      resources: ['*'],
    });
    people.addToRolePolicy(sesIdentities);
    system.addToRolePolicy(sesIdentities);
    people.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:DeleteEmailIdentity'], resources: ['*'] }));

    new cdk.CfnOutput(this, 'ApiUrl', { value: `https://${apiHost}/` });
  }
}
