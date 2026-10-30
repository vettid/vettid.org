import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AppConfig } from '../config';
import { readRef } from '../constructs/ssm-refs';
import { stageZone } from '../constructs/stage-zone';
import {
  CALLS_ALERTS_TOPIC_NAME, callsIssuerLogGroupName, callsIssuerRoleName, callsMetricsNamespace, callsName, callsSecretName,
} from './calls-data-stack';

export interface VettidOrgCallsStackProps extends cdk.StackProps {
  /** The staging configuration (`config.calls` is set and names an issuer). */
  readonly config: AppConfig;
}

/** §8.2: "at most 4 at once"; the issuer's own limit (`CALLS_MAX_INFLIGHT`, §7.5) is the same number. */
export const CALLS_ISSUER_CONCURRENCY = 4;
/** The invocation alarm: a vault asks for credentials rarely (§5.4); 1,000 in 5 minutes is not a vault. */
export const CALLS_INVOCATIONS_PER_5_MIN = 1000;
/** §10: more refused attestations than this in an hour fire `issuer-errors`. */
export const CALLS_ATTESTATION_REFUSALS_PER_HOUR = 25;

/**
 * The handshake test's stand-in (CALLS-PLAN §13.3 step 2), inline code with
 * fixed answers and nothing else: no secret, no key, no attestation code,
 * no logging, no state, and it answers nothing from the request (it does
 * not even read it). It exists to be the origin behind the front, so that a
 * development enclave can complete TLS 1.3 + HTTP/2 against the deployed
 * name and send a request with a real attestation's header size.
 *
 *  - `GET /v1/health` → `200 {}` (as the issuer).
 *  - anything else → `403` with the issuer's `attestation_invalid` body, so
 *    a `POST /v1/credentials` with a 7 KiB `X-VettID-Attestation` header
 *    shows that the front and the origin pass such a header (§13 of the
 *    spec: not established).
 *
 * Every answer carries `x-vettid-calls-stub: 1`, so that no one mistakes it
 * for the issuer; the checks before step 5 (the DNS Firewall entry) assert
 * the header is absent (RUNBOOK "Calling service").
 */
export const CALLS_STUB_CODE = `exports.handler = async (event) => {
  const h = { 'content-type': 'application/json', 'x-vettid-calls-stub': '1' };
  const m = event && event.requestContext && event.requestContext.http && event.requestContext.http.method;
  const p = event && event.rawPath;
  if (m === 'GET' && p === '/v1/health') return { statusCode: 200, headers: h, body: '{}\\n' };
  return { statusCode: 403, headers: h, body: '{"code":"attestation_invalid","message":"stub"}\\n' };
};
`;

/**
 * The calling service's stateless stack in the staging account
 * (CALLING-SERVICE §8.2). What is built so far (CALLS-PLAN §13.3 steps 2
 * and 4 for the issuer; the server is a later step of the same stack):
 *
 *  - **The issuer's front**: a CloudFront distribution named
 *    `calls.<stage>.vettid.org` with an ACM certificate (validated in the
 *    stage's zone), HTTPS only, HTTP/2, TLS 1.3 only (TLSv1.3_2025, as
 *    the enclave's egress), no cache, no access log,
 *    every viewer header but `Host` forwarded (the `X-VettID-*` headers).
 *    Port 443 only: it is what the enclave's egress allows.
 *  - **The origin**: a Lambda function (arm64, `provided.al2023`,
 *    reserved concurrency 4) behind a function URL. It is either the
 *    **stub** (context `callsIssuerStub=true`, the handshake test only) or
 *    the **real issuer** (context `stagingCallsIssuer`, a vettid-calls
 *    archive pinned by SHA-256), never both. The function URL is not
 *    authenticated by IAM: a CloudFront origin access control signs with
 *    SigV4 and a POST's body then has to be hashed by the caller
 *    (`x-amz-content-sha256`), which a vault cannot do; the issuer
 *    authenticates every request itself (signature and attestation), and
 *    its concurrency is capped, so a direct call to the URL gets what a
 *    call through the front gets.
 *  - **DNS**: A and AAAA aliases in the stage's zone.
 *  - **Alarms**: `issuer-invocations` (also for the stub: a flood costs
 *    money), and of the real issuer only (the stub emits no metric):
 *    `issuer-errors`, `issuer-attestation-refusals`, `issuer-manifest`.
 *
 * Not yet here: the VPC, security group, Auto Scaling group and instance of
 * the TURN server, their DNS records and the server's alarms (step 4).
 *
 * No log is added or changed outside this service: its log group is
 * VettidOrgCallsDataStack's, and CloudFront's access log is off.
 */
export class VettidOrgCallsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgCallsStackProps) {
    super(scope, id, props);
    const { config } = props;
    const calls = config.calls;
    if (config.stage === 'prod' || !calls) throw new Error('VettidOrgCallsStack: the calling service is a staging stack (context callsStages)');
    if (calls.issuer.kind === 'none') throw new Error('VettidOrgCallsStack: no issuer (context callsIssuerStub or stagingCallsIssuer)');
    const { issuer } = calls;

    const zone = stageZone(this, config);
    const logGroup = logs.LogGroup.fromLogGroupName(this, 'IssuerLogs', callsIssuerLogGroupName(config));
    const fnName = callsName(config, 'issuer');
    const namespace = callsMetricsNamespace(config);

    // ---- The origin ---------------------------------------------------------
    const role = new iam.Role(this, 'IssuerRole', {
      roleName: callsIssuerRoleName(config),
      description: issuer.kind === 'stub'
        ? 'VettID calling service issuer STUB (handshake test): writes its log; holds no secret'
        : 'VettID calling service issuer: reads the TURN secret, puts its own metrics',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'IssuerLog',
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:${callsIssuerLogGroupName(config)}:*`],
    }));

    let code: lambda.Code;
    let environment: Record<string, string> | undefined;
    if (issuer.kind === 'stub') {
      code = lambda.Code.fromInline(CALLS_STUB_CODE);
    } else {
      // The archive is built in vettid-calls (`make archive-repro`) and pinned
      // by SHA-256 (§8.2): the synth refuses any other file.
      const bytes = readFileSync(issuer.file);
      const got = createHash('sha256').update(bytes).digest('hex');
      if (got !== issuer.sha256) {
        throw new Error(`context stagingCallsIssuerFile: SHA-256 is ${got}, the pinned one (stagingCallsIssuer) is ${issuer.sha256}`);
      }
      code = lambda.Code.fromAsset(issuer.file);
      environment = {
        CALLS_CHANNEL: config.stage,
        CALLS_TURN_HOST: calls.turnHost,
        // Each function instance handles one request at a time, so this is
        // never reached; the limit that acts is Lambda's reserved concurrency
        // (4): a fifth request gets Lambda's own 429, without the issuer's
        // JSON error body (RELAY-PROTOCOL §7.1).
        CALLS_MAX_INFLIGHT: String(CALLS_ISSUER_CONCURRENCY),
        CALLS_SECRETS: 'aws',
        CALLS_SECRET_ID: callsSecretName(config),
        CALLS_METRICS: 'cloudwatch',
        CALLS_METRICS_NAMESPACE: namespace,
      };
      // By name (-?????? is Secrets Manager's six-character suffix): the
      // secret is the operator's, not a stack's (VettidOrgCallsDataStack).
      role.addToPrincipalPolicy(new iam.PolicyStatement({
        sid: 'TurnSecret',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${callsSecretName(config)}-??????`],
      }));
      role.addToPrincipalPolicy(new iam.PolicyStatement({
        sid: 'TurnSecretKey',
        actions: ['kms:Decrypt'],
        resources: [readRef(this, config, 'calls/key-arn')],
        conditions: {
          StringEquals: { 'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com` },
          StringLike: { 'kms:EncryptionContext:SecretARN': `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${callsSecretName(config)}-??????` },
        },
      }));
      role.addToPrincipalPolicy(new iam.PolicyStatement({
        sid: 'OwnMetrics',
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'], // PutMetricData has no resource-level permissions
        conditions: { StringEquals: { 'cloudwatch:namespace': namespace } },
      }));
    }

    const fn = new lambda.Function(this, 'Issuer', {
      functionName: fnName,
      description: issuer.kind === 'stub'
        ? 'HANDSHAKE TEST STUB (CALLS-PLAN 13.3 step 2): fixed answers, no issuer'
        : 'VettID calling service credential issuer (CALLING-SERVICE 4.2, 5)',
      runtime: issuer.kind === 'stub' ? lambda.Runtime.NODEJS_24_X : lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: issuer.kind === 'stub' ? 'index.handler' : 'bootstrap',
      code,
      role,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      reservedConcurrentExecutions: CALLS_ISSUER_CONCURRENCY,
      environment,
      // §3 item 5, §10: no START/END/REPORT line per invocation; the
      // issuer's own starts and errors only.
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      logGroup,
    });
    const fnUrl = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // ---- The front: certificate, distribution, names -------------------------
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: calls.host,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    const distribution = new cloudfront.Distribution(this, 'Front', {
      comment: `${calls.host} (the calling service's credential issuer; CALLING-SERVICE 8.2)`,
      domainNames: [calls.host],
      certificate,
      httpVersion: cloudfront.HttpVersion.HTTP2, // not HTTP/3: the enclave's egress is TCP, h2
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_3_2025, // TLS 1.3 only, as the enclave's egress; SNI only
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      enableLogging: false, // §10: CloudFront's access log stays off for this name
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(fnUrl),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        compress: false,
      },
    });
    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'Alias', { zone, recordName: calls.host, target });
    new route53.AaaaRecord(this, 'AliasAaaa', { zone, recordName: calls.host, target });

    // ---- Alarms (§10) → vettid-org-calls-alerts → admin@ ---------------------
    const topicArn = `arn:${this.partition}:sns:${this.region}:${this.account}:${CALLS_ALERTS_TOPIC_NAME}`;
    const action = { bind: () => ({ alarmActionArn: topicArn }) };

    // Cost: reserved concurrency caps parallel runs, not request volume, and
    // the function URL is open (the issuer authenticates each request
    // itself), so a flood is paid for per invocation. This alarm is on the
    // stub too. The tag is for the cost budget of §10 (step 4: the budget
    // needs the tag activated as a cost allocation tag by the owner).
    cdk.Tags.of(this).add('vettid-service', 'calls');
    const invocations = new cloudwatch.Alarm(this, 'IssuerInvocations', {
      alarmName: `${callsName(config)}-issuer-invocations`,
      alarmDescription: `Calling service issuer: more than ${CALLS_INVOCATIONS_PER_5_MIN} invocations in 5 minutes (a flood; each costs money). Look at CloudFront's request count; consider destroying VettidOrgCallsStack (RUNBOOK "Calling service").`,
      metric: fn.metricInvocations({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: CALLS_INVOCATIONS_PER_5_MIN,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    invocations.addAlarmAction(action);

    // The real issuer's metrics only (the stub emits none).
    if (issuer.kind === 'archive') {
      const five = cdk.Duration.minutes(5);
      const quarter = cdk.Duration.minutes(15);
      const own = (metricName: string, dimensionsMap?: Record<string, string>, period = five) =>
        new cloudwatch.Metric({ namespace, metricName, dimensionsMap, statistic: 'Sum', period });
      const alarm = (cid: string, name: string, a: Omit<cloudwatch.AlarmProps, 'alarmName'>) => {
        const x = new cloudwatch.Alarm(this, cid, {
          alarmName: `${callsName(config)}-${name}`,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          ...a,
        });
        x.addAlarmAction(action);
        return x;
      };
      const atLeast = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
      const says = (text: string) => `Calling service issuer: ${text} (RUNBOOK "Calling service" → Alarms).`;

      alarm('IssuerInternal', 'issuer-errors', {
        alarmDescription: says('a request was answered 500 internal: the secret could not be read, or a bug; read the issuer log'),
        metric: own('internal_errors'),
        threshold: 1,
        comparisonOperator: atLeast,
        evaluationPeriods: 1,
      });
      // The 403 `attestation_invalid` is every failing attestation alike (§5.2).
      alarm('IssuerAttestationRefusals', 'issuer-attestation-refusals', {
        alarmDescription: says(`more than ${CALLS_ATTESTATION_REFUSALS_PER_HOUR} requests refused for their attestation in an hour (metric requests, outcome attestation_invalid; attestation_failures says why)`),
        metric: own('requests', { outcome: 'attestation_invalid' }, cdk.Duration.hours(1)),
        threshold: CALLS_ATTESTATION_REFUSALS_PER_HOUR,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
      });
      // The issuer refreshes its manifest every 10 minutes while it runs; a
      // function that is not invoked refreshes nothing, and says nothing.
      alarm('IssuerManifest', 'issuer-manifest', {
        alarmDescription: says('the release manifest could not be refreshed for an hour (errors, no success). The last good one stays trusted for 7 days'),
        metric: new cloudwatch.MathExpression({
          label: 'refresh failing (errors, no success)',
          expression: 'IF(FILL(errors, 0) > 0 AND FILL(ok, 0) == 0, 1, 0)',
          usingMetrics: {
            errors: own('manifest_refresh', { outcome: 'error' }, quarter),
            ok: own('manifest_refresh', { outcome: 'ok' }, quarter),
          },
          period: quarter,
        }),
        threshold: 1,
        comparisonOperator: atLeast,
        evaluationPeriods: 4,
        datapointsToAlarm: 4,
      });
    }

    new cdk.CfnOutput(this, 'Url', { value: `https://${calls.host}` });
    new cdk.CfnOutput(this, 'IssuerKind', { value: issuer.kind, description: '"stub" until the real issuer is deployed (RUNBOOK "Calling service")' });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
  }
}
