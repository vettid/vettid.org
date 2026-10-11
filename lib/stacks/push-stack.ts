import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig, PushGatewayConfig, resourceName } from '../config';
import { readRef } from '../constructs/ssm-refs';
import {
  PUSH_ALERTS_TOPIC_NAME, pushLogGroupName, pushName, pushSecretName, pushSecretPrefix, pushSecretsRead, pushTaskRoleName,
} from './push-data-stack';

export interface VettidOrgPushStackProps extends cdk.StackProps {
  /** The prod configuration: both channels' gateways live in the main account. */
  readonly config: AppConfig;
}

const PUSH_PORT = 8080;
/** §10.1: two tasks in two AZs. Stateless: scaling is adding tasks (the §8 limits are per task). */
export const PUSH_TASKS = 2;
/**
 * "Attestation failures above a baseline" (§10.5): refused registrations
 * per hour, over every reason. A request reaches the attestation check
 * only with a valid signature, so scanners do not count; what does is a
 * retired release still registering, or someone probing with forged
 * documents. A starting value, to be set from what production shows.
 */
export const PUSH_ATTESTATION_FAILURES_PER_HOUR = 25;
/** Listener rule priorities on the relay's HTTPS listener (which has no other rule). */
const RULE_PRIORITY = { prod: 10, staging: 20 } as const;

/**
 * push.vettid.org and push.staging.vettid.org: the VettID push gateway
 * (github.com/vettid/vettid-push, docs/PUSH-GATEWAY.md §10) on ECS Fargate,
 * one service per channel with an image, in the relay's cluster and behind
 * the relay's load balancer.
 *
 *  - **Shared with the relay, read through SSM** (VettidOrgRelayStack
 *    `publishPushRefs`): the VPC and its two public subnets, the cluster, the
 *    ALB's HTTPS listener (so the same post-quantum TLS policy) and its
 *    security group. This stack **adds** to the listener (a host rule and a
 *    certificate per gateway) and changes nothing of the relay's: the
 *    listener's default action, its own certificate and the relay's target
 *    group are not referenced here.
 *  - **Not shared**: each gateway has its own target group, task role, log
 *    group and security group, and no permission on the relay's table,
 *    bucket or Valkey (whose security group admits only relay tasks).
 *  - **No state.** Nothing is written anywhere; the three secrets are read
 *    once at start, by the task itself (`PUSH_SECRETS=aws`), so no secret
 *    value passes through the task definition or the execution role.
 *  - **No per-request log** (§10.5): the service logs starts, stops and
 *    throttled errors, and the load balancer's access logs are off (they
 *    are for the relay too; turning them on for the relay would log the
 *    push hosts as well, ALB access logs being per load balancer).
 *  - **Deploys** are rolling like the relay's (100 % min / 200 % max,
 *    circuit breaker with rollback). Secrets are read at start only, so a
 *    blob-key rotation takes effect with the next deployment
 *    (`aws ecs update-service --force-new-deployment`).
 *
 * A request carries an attestation document of about 6.5 KiB in one header
 * (`X-VettID-Attestation`): inside the ALB's limits (16 KiB a header, 64 KiB
 * for all of them), and a valid field name for `dropInvalidHeaderFields`.
 */
export class VettidOrgPushStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgPushStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.stage !== 'prod') throw new Error('the push gateways live in the prod app (main account), both channels (PUSH-GATEWAY §10.4)');
    const gateways = config.push.gateways.filter((g) => g.image);
    if (!gateways.length) throw new Error('VettidOrgPushStack: no gateway has an image (context pushImage / stagingPushImage)');

    // ---- The relay's network, cluster and load balancer (SSM refs) ----------
    const subnetIds = readRef(this, config, 'relay/public-subnet-ids');
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'RelayVpc', {
      vpcId: readRef(this, config, 'relay/vpc-id'),
      // As the relay's VPC (maxAzs 2): the stack's first two zones.
      availabilityZones: this.availabilityZones.slice(0, 2),
      publicSubnetIds: [0, 1].map((i) => cdk.Fn.select(i, cdk.Fn.split(',', subnetIds))),
    });
    // The services need the subnets' ids only, never their route tables.
    cdk.Annotations.of(this).acknowledgeWarning('@aws-cdk/aws-ec2:noSubnetRouteTableId', 'imported relay subnets: only their ids are used');
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'RelayCluster', { clusterName: resourceName(config, 'relay'), vpc });
    // Immutable: this stack never adds a rule to the relay's security group
    // (its egress is already open; the tasks' groups admit it below).
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'RelayAlbSg', readRef(this, config, 'relay/alb-security-group-id'), { mutable: false });
    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'RelayHttpsListener', {
      listenerArn: readRef(this, config, 'relay/https-listener-arn'),
      securityGroup: albSg,
    });
    const shared: SharedInfra = {
      vpc,
      cluster,
      listener,
      alb: {
        dnsName: readRef(this, config, 'relay/alb-dns-name'),
        hostedZoneId: readRef(this, config, 'relay/alb-hosted-zone-id'),
        fullName: readRef(this, config, 'relay/alb-full-name'),
      },
      keyArn: readRef(this, config, 'push/key-arn'),
      alertsTopicArn: `arn:${this.partition}:sns:${this.region}:${this.account}:${PUSH_ALERTS_TOPIC_NAME}`,
    };

    for (const gateway of gateways) {
      // Prod: the cached vettid.org lookup, as the relay. Staging: the
      // delegated zone push.staging.vettid.org (VettidOrgPushDataStack).
      const zone =
        gateway.channel === 'prod'
          ? route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.domainName })
          : route53.HostedZone.fromHostedZoneAttributes(this, 'StagingZone', {
            hostedZoneId: readRef(this, config, 'push/staging-zone-id'),
            zoneName: gateway.host,
          });
      new PushGateway(this, gateway.channel === 'prod' ? 'Prod' : 'Staging', { gateway, zone, shared });
    }
  }
}

interface SharedInfra {
  readonly vpc: ec2.IVpc;
  readonly cluster: ecs.ICluster;
  readonly listener: elbv2.IApplicationListener;
  readonly alb: { readonly dnsName: string; readonly hostedZoneId: string; readonly fullName: string };
  readonly keyArn: string;
  readonly alertsTopicArn: string;
}

interface PushGatewayProps {
  readonly gateway: PushGatewayConfig;
  /** Where the host's certificate validates and its alias record lives. */
  readonly zone: route53.IHostedZone;
  readonly shared: SharedInfra;
}

/**
 * One channel's gateway. A construct of its own so that adding production
 * next to staging changes no logical id of staging's.
 */
class PushGateway extends Construct {
  constructor(scope: Construct, id: string, props: PushGatewayProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const { gateway, zone, shared } = props;
    const { channel, host } = gateway;
    const metricsNamespace = `vettid-org/${channel}/push`;

    // ---- Task ---------------------------------------------------------------
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: pushTaskRoleName(channel),
      description: `VettID push gateway (${channel}) task role: reads its secrets, nothing else. Google's workload identity pool trusts this role (PUSH-GATEWAY 10.3).`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    // Its blob keys, and the credentials of the platforms it serves: a
    // gateway without APNs cannot read the APNs key. `-??????` is the
    // random suffix Secrets Manager adds to a secret's ARN.
    const secretArns = pushSecretsRead(gateway.platforms).map(
      (s) => `arn:${stack.partition}:secretsmanager:${stack.region}:${stack.account}:secret:${pushSecretName(channel, s)}-??????`,
    );
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'PushSecrets', actions: ['secretsmanager:GetSecretValue'], resources: secretArns }));
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'PushSecretsKey',
        actions: ['kms:Decrypt'],
        resources: [shared.keyArn],
        // The key policy says the same (VettidOrgPushDataStack).
        conditions: {
          StringEquals: { 'kms:ViaService': `secretsmanager.${stack.region}.amazonaws.com` },
          StringLike: {
            'kms:EncryptionContext:SecretARN': `arn:${stack.partition}:secretsmanager:${stack.region}:${stack.account}:secret:${pushSecretPrefix(channel)}/*`,
          },
        },
      }),
    );

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      family: pushName(channel),
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const logGroup = logs.LogGroup.fromLogGroupName(this, 'ServiceLogs', pushLogGroupName(channel));
    taskDef.addContainer('Push', {
      image: ecs.ContainerImage.fromRegistry(gateway.image),
      essential: true,
      portMappings: [{ containerPort: PUSH_PORT }],
      readonlyRootFilesystem: true, // no volume, no writable file system (§10.1)
      // None of these is secret (§10.1); the secrets are read by name at start.
      environment: {
        PUSH_CHANNEL: channel,
        PUSH_LISTEN_ADDR: `:${PUSH_PORT}`,
        // The per-address limits (§8) use the hop the ALB appends.
        PUSH_TRUST_PROXY: 'true',
        // Set even when empty: unset means the gateway's default, both platforms.
        PUSH_PLATFORMS: gateway.platforms.join(','),
        PUSH_FCM_APP_IDS: gateway.fcmAppIds.join(','),
        PUSH_APNS_APP_IDS: gateway.apnsAppIds.join(','),
        ...(gateway.fcmProject ? { PUSH_FCM_PROJECT: gateway.fcmProject } : {}),
        PUSH_SECRETS: 'aws',
        PUSH_SECRET_PREFIX: pushSecretPrefix(channel),
        PUSH_METRICS_NAMESPACE: metricsNamespace,
        AWS_REGION: stack.region,
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'push' }),
      stopTimeout: cdk.Duration.seconds(30), // > PUSH_SHUTDOWN_TIMEOUT (20 s)
      // Distroless image, no shell: the binary checks its own /v1/health.
      healthCheck: {
        command: ['CMD', '/vettid-push', '-healthcheck'],
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(10),
      },
    });

    // ---- Service ------------------------------------------------------------
    // Only HTTPS out: Secrets Manager, the manifest site, Google, Apple, the
    // image registry and CloudWatch Logs are all 443. Public subnets without
    // NAT, as the relay: the tasks' public addresses are for these calls;
    // inbound, only the load balancer.
    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc: shared.vpc,
      description: `push gateway (${channel}) task: only the ALB may connect; HTTPS out`,
      allowAllOutbound: false,
    });
    taskSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS: Secrets Manager, manifest, FCM, APNs, registry, logs');

    const service = new ecs.FargateService(this, 'Service', {
      serviceName: pushName(channel),
      cluster: shared.cluster,
      taskDefinition: taskDef,
      desiredCount: PUSH_TASKS,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      assignPublicIp: true,
      securityGroups: [taskSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      enableExecuteCommand: false,
    });

    // ---- Load balancer: own target group, host rule, certificate ------------
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'Targets', {
      vpc: shared.vpc,
      port: PUSH_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      deregistrationDelay: cdk.Duration.seconds(30), // requests are short; > the drain
      healthCheck: { path: '/v1/health', healthyHttpCodes: '200', interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 },
    });
    new elbv2.ApplicationListenerRule(this, 'HostRule', {
      listener: shared.listener,
      priority: RULE_PRIORITY[channel],
      conditions: [elbv2.ListenerCondition.hostHeaders([host])],
      targetGroups: [targetGroup],
    });
    // A certificate of its own, added to the listener (SNI), rather than a
    // new name on the relay's: reissuing that one would replace the
    // certificate of the live relay.
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: host,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    new elbv2.ApplicationListenerCertificate(this, 'ListenerCertificate', { listener: shared.listener, certificates: [certificate] });
    new route53.ARecord(this, 'Alias', {
      zone,
      recordName: host,
      target: route53.RecordTarget.fromAlias({
        bind: () => ({ dnsName: `dualstack.${shared.alb.dnsName}`, hostedZoneId: shared.alb.hostedZoneId }),
      }),
    });

    // ---- Alarms (§10.5) → vettid-org-push-alerts → admin@ -------------------
    // The gateway writes CloudWatch embedded metric format lines to its log
    // (one per series and minute, never per request). Where an alarm reads
    // one series, it reads the gateway's own metric; where it needs a sum
    // over dimensions (every platform and environment), a metric filter on
    // the same lines makes it, since an alarm cannot search dimensions.
    const action = { bind: () => ({ alarmActionArn: shared.alertsTopicArn }) };
    const five = cdk.Duration.minutes(5);
    const derivedNamespace = `${metricsNamespace}/alarms`;
    const derived = (cid: string, metricName: string, field: string, outcome?: string): cloudwatch.Metric => {
      const present = logs.FilterPattern.numberValue(`$.${field}`, '>', 0);
      return new logs.MetricFilter(this, cid, {
        logGroup,
        filterPattern: outcome ? logs.FilterPattern.all(logs.FilterPattern.stringValue('$.outcome', '=', outcome), present) : present,
        metricNamespace: derivedNamespace,
        metricName,
        metricValue: `$.${field}`,
      }).metric({ statistic: 'Sum', period: five });
    };
    const own = (metricName: string, dimensionsMap?: Record<string, string>, period = five) =>
      new cloudwatch.Metric({ namespace: metricsNamespace, metricName, dimensionsMap, statistic: 'Sum', period });
    const alarm = (cid: string, name: string, a: Omit<cloudwatch.AlarmProps, 'alarmName'>) => {
      const x = new cloudwatch.Alarm(this, cid, {
        alarmName: `${pushName(channel)}-${name}`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        ...a,
      });
      x.addAlarmAction(action);
      return x;
    };
    const atLeast = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    const says = (text: string) => `Push gateway (${channel}): ${text} (RUNBOOK "Push gateway" → Alarms).`;

    alarm('ProviderAuth', 'provider-auth', {
      alarmDescription: says('a platform refused the gateway\'s credentials (APNs 403 InvalidProviderToken, FCM 401/403). No wake reaches that platform until the secret is fixed'),
      metric: derived('WakesProviderAuth', 'wakes_provider_auth', 'wakes', 'provider_auth'),
      threshold: 1,
      comparisonOperator: atLeast,
      evaluationPeriods: 1,
    });

    alarm('ProviderUnavailable', 'provider-unavailable', {
      alarmDescription: says('more than 5 % of wakes answered provider_unavailable for 10 minutes (FCM or APNs down or throttling)'),
      metric: new cloudwatch.MathExpression({
        label: 'provider_unavailable, % of wakes',
        expression: 'IF(FILL(total, 0) > 0, 100 * FILL(unavailable, 0) / FILL(total, 1), 0)',
        usingMetrics: {
          unavailable: derived('WakesProviderUnavailable', 'wakes_provider_unavailable', 'wakes', 'provider_unavailable'),
          total: derived('WakesTotal', 'wakes_total', 'wakes'),
        },
        period: five,
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
    });

    alarm('Internal', 'internal', {
      alarmDescription: says('a request was answered 500 internal: a bug or a broken task; read the service log'),
      metric: own('internal_errors'),
      threshold: 1,
      comparisonOperator: atLeast,
      evaluationPeriods: 1,
    });

    // The gateway refreshes every 10 minutes (every minute while it has no
    // manifest), so each 15-minute period holds at least one attempt.
    const quarter = cdk.Duration.minutes(15);
    alarm('ManifestRefresh', 'manifest-refresh', {
      alarmDescription: says('the release manifest could not be refreshed for an hour. The last good one stays trusted, so a newly published release cannot register and a retired one still can'),
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

    alarm('AttestationFailures', 'attestation-failures', {
      alarmDescription: says(`more than ${PUSH_ATTESTATION_FAILURES_PER_HOUR} registrations refused for their attestation in an hour (metric attestation_failures, by reason)`),
      metric: derived('AttestationFailuresTotal', 'attestation_failures_total', 'attestation_failures').with({ period: cdk.Duration.hours(1) }),
      threshold: PUSH_ATTESTATION_FAILURES_PER_HOUR,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });

    // Not in §10.5's list, and the one it needs: every alarm above reads a
    // silent gateway as healthy.
    const down = alarm('NoHealthyTask', 'no-healthy-task', {
      alarmDescription: says('the load balancer has had no healthy task for 3 minutes: the gateway is down (wakes fail, the vault retries). OK when one is back'),
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HealthyHostCount',
        dimensionsMap: { TargetGroup: targetGroup.targetGroupFullName, LoadBalancer: shared.alb.fullName },
        statistic: 'Minimum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    down.addOkAction(action);

    new cdk.CfnOutput(this, 'Url', { value: `https://${host}` });
    new cdk.CfnOutput(this, 'TaskRoleArn', { value: taskRole.roleArn, description: 'What the Google workload identity pool trusts (PUSH-GATEWAY 10.3)' });
  }
}
