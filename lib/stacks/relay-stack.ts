import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { AppConfig, ORG, hostName, resourceName } from '../config';
import { publishRef, readRef } from '../constructs/ssm-refs';
import { RELAY_TABLE_LIMITS } from './relay-data-stack';

export interface VettidOrgRelayStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Relay container image, pinned by digest (e.g. ghcr.io/vettid/vettid-relay@sha256:...). */
  readonly relayImage: string;
  /**
   * Publish the VPC, the ALB and its HTTPS listener through SSM for
   * VettidOrgPushStack, whose services sit behind this load balancer
   * (PUSH-GATEWAY §10.1). Only when a push gateway is configured: without
   * one this stack's template is exactly what it was before push existed.
   * Adds SSM parameters and nothing else: no existing resource changes.
   */
  readonly publishPushRefs?: boolean;
}

const RELAY_PORT = 8080;
const VALKEY_PORTS = ec2.Port.tcpRange(6379, 6380); // serverless: 6379 primary, 6380 reader

/** Service scaling bounds (two tasks = one per AZ at minimum). */
export const RELAY_MIN_TASKS = 2;
export const RELAY_MAX_TASKS = 8;

/** The task's memory (MiB). */
export const RELAY_TASK_MEMORY_MIB = 512;

/** Namespace of the metrics taken from the relay's `rate limits` log line. */
export const RELAY_METRICS_NAMESPACE = 'VettID/Relay';

/**
 * Thresholds of the alarms on the relay's `rate limits` line (one a
 * minute from each task; RELAY-PROTOCOL §7.2, RUNBOOK "Relay").
 */
export const RELAY_ALARM_LIMITS = {
  /**
   * `address_busiest_per_min`: half the flood guard's steady rate
   * (100 requests/s = 6,000 a minute). The RUNBOOK's trigger for raising
   * `RELAY_RATE_IP_RPS`.
   */
  addressBusiestPerMin: 3000,
  /**
   * Long-polls (`collectors`) and WebSocket sessions (`ws_sessions`) on
   * one task; nothing caps either yet. Measured: about 42 KiB per parked
   * long-poll and 45 KiB per session, so 2,000 are about 82 and 88 MiB:
   * a sixth of the task's 512 MiB each, and a third together. That is
   * well below the 70 % at which the service adds tasks, and far above
   * what the preview needs (a vault host holds at most 1,024 long-polls,
   * spread over the tasks): time to look, and to bring back the caps,
   * long before memory is short.
   */
  collectorsPerTask: 2000,
  wsSessionsPerTask: 2000,
  /**
   * The table's consumed units a second, held for 5 minutes, at which
   * `table-writes-high` / `table-reads-high` fire. Fixed numbers, not a
   * share of the ceiling (RELAY_TABLE_LIMITS): the write ceiling was raised
   * to 10,000 (2026-10-15) to leave room for a full host, and the alarm
   * stays where a flood or a host near its limit is worth a look. 1,000
   * writes a second is a tenth of the write ceiling, about half of one
   * full host or one address at the flood guard, 36 times the busiest
   * minute measured, and about $54 a day if it lasted. Reads: half their
   * ceiling of 2,000.
   */
  tableWritesBusyPerSecond: 1000,
  tableReadsBusyPerSecond: 1000,
  /**
   * Write units in one hour: 100 a second on average, a twentieth of the
   * ceiling and 65 times the busiest hour measured (5,486). Written bytes
   * have no metric of their own; write units are their measure (a unit
   * is 1 KB, 2 units in a transaction), so this is at most 180 MB of
   * messages stored in the hour, and what a slow fill below the other
   * alarms would show as. A vault host of the projected size (900 vaults,
   * about 300 a second) is above it: raise it with the membership.
   */
  tableWriteUnitsPerHour: 360_000,
} as const;

/**
 * The Valkey cache's usage limits and the share of each at which its
 * alarms fire (AWS's advice for ElastiCache Serverless: 75 %). At the
 * storage limit the cache evicts keys with a TTL (every relay key has
 * one), so replay records can go early; at the ECPU limit it throttles,
 * and every signed request is refused while the replay check fails.
 */
export const RELAY_VALKEY_LIMITS = {
  dataStorageGb: 1,
  ecpuPerSecond: 100_000,
  alarmShare: 0.75,
} as const;

/**
 * What the relay's log groups (the service log and the VPC flow log) may
 * ingest in a day before an alarm: 500 MB, about 250 times the service
 * log's measured 1 to 2 MB a day (October 2026).
 */
export const RELAY_LOG_INGEST_BYTES_PER_DAY = 500_000_000;

/** How long the relay VPC's flow log is kept. */
export const RELAY_FLOW_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

/**
 * The web ACL's rate-based rule on the relay's load balancer: requests a
 * source address may make in the evaluation window before WAF answers
 * `429` (AWS WAF counts the requests of the window looking back from now,
 * per source IP, and blocks near the limit, not exactly at it).
 *
 * 60,000 per 5 minutes is 200 a second, twice the relay's flood guard
 * (100/s, RELAY-PROTOCOL §7.2). The two do not refuse alike: the flood
 * guard only slows an address down to its rate (requests over it are
 * answered `429`, the rest go through), while WAF, once an address's
 * 5-minute estimate passes the limit, blocks *every* request from it
 * until the estimate drops, which can take minutes. A client retrying
 * faster than about 200 a second (a vault host whose retries run away)
 * would then lose all of its relay traffic for minutes, not just the
 * excess. In return WAF stops a flood before it costs task CPU, log lines
 * or Valkey ECPU. A vault host of 900 vaults (the projected size) sends
 * 36 requests a second idle and about 81 at a message a minute per vault:
 * 10,800 and 24,300 in 5 minutes, 18 % and 41 % of the limit. Raise this
 * with the flood guard (keep it at twice the guard).
 *
 * `mode`: the rule starts in `count` (WAF only counts the addresses it
 * would block; the `waf-rate-limit` alarm says when one does). Switch it
 * to `block` after a week of normal traffic without a count (RUNBOOK
 * "Relay" → "The load balancer's web ACL"): a one-line, reviewed change.
 */
export const RELAY_WAF_RATE_LIMIT: {
  readonly requests: number;
  readonly windowSeconds: number;
  readonly retryAfterSeconds: number;
  readonly mode: 'count' | 'block';
} = {
  requests: 60_000,
  windowSeconds: 300,
  /**
   * `retry_after` and `Retry-After` of the refusal: a minimum. The block
   * lasts until WAF's estimate falls below the limit, which can be longer.
   */
  retryAfterSeconds: 60,
  mode: 'count',
};

/**
 * relay.vettid.org — the VettID mailbox relay (github.com/vettid/vettid-relay,
 * docs/RELAY-PROTOCOL.md) on ECS Fargate, hosting option B: several
 * identical tasks behind the ALB on one shared store.
 *
 *  - State: DynamoDB table + S3 blob bucket in VettidOrgRelayDataStack
 *    (stateful, read here through SSM refs). Any task can serve any request;
 *    every operation the protocol needs to be atomic (deposit + quota +
 *    open-token use, leases, claim single fetch, rotation) is a DynamoDB
 *    transaction or conditional write.
 *  - Coordination: ElastiCache Serverless for Valkey holds the replay cache
 *    (§4.1), rate-limit buckets (§7.2) and wake-on-deposit pub/sub (§6.2),
 *    so a long-poll or WebSocket parked on one task wakes for a deposit
 *    taken by another. TLS in transit, IAM authentication (no password).
 *  - Deploys are rolling (100% min / 200% max): new tasks join, old tasks
 *    are deregistered, drained for 30 s (longer than a 25 s long-poll), then
 *    stopped — no downtime. Target tracking scales on CPU and memory.
 *  - Network: public subnets in two AZs, no NAT. Tasks get public IPs for
 *    image pulls and logs; their security group admits only the ALB.
 *    DynamoDB and S3 go through free gateway endpoints; Valkey is in-VPC.
 *
 * The SQLite/Litestream design this replaces had a replica bucket and a
 * log group, both RETAIN. They are no longer in this stack, so CloudFormation
 * leaves them in place (it never deletes RETAIN resources); they are deleted
 * by hand after cutover (docs/RUNBOOK.md "Relay"), because the old task keeps
 * replicating into the bucket until the new tasks have replaced it. For the
 * same reason the task definition has a new construct id: the old task's
 * role and policy stay untouched until CloudFormation's cleanup phase, after
 * the service has moved to the new tasks.
 */
export class VettidOrgRelayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgRelayStackProps) {
    super(scope, id, props);
    const { config } = props;
    const host = hostName(config, 'relay');
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.domainName });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.43.0.0/24'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
        DynamoDB: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB },
      },
    });

    const tableName = readRef(this, config, 'relay/table-name');
    const tableArn = readRef(this, config, 'relay/table-arn');
    const blobBucket = readRef(this, config, 'relay/blob-bucket-name');

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'relay ALB: HTTPS from anywhere' });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (redirects to HTTPS)');
    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', { vpc, description: 'relay task: only the ALB may connect', allowAllOutbound: true });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(RELAY_PORT), 'from the relay ALB');
    const cacheSg = new ec2.SecurityGroup(this, 'CacheSg', { vpc, description: 'relay Valkey: only relay tasks may connect', allowAllOutbound: false });
    cacheSg.addIngressRule(taskSg, VALKEY_PORTS, 'from relay tasks');

    // ---- Valkey (ElastiCache Serverless): replay cache, rate limits, wake.
    // Serverless rather than a node: ~$6/month at idle (100 MB minimum),
    // multi-AZ, TLS-only, no patching or failover to manage. The ECPU cap
    // bounds a runaway bill (100k ECPU/s, ~3x the 100k-user estimate).
    const cacheName = resourceName(config, 'relay');
    const valkeyUser = new elasticache.CfnUser(this, 'ValkeyUser', {
      engine: 'valkey',
      userId: cacheName, // IAM auth: user id must equal user name
      userName: cacheName,
      authenticationMode: { Type: 'iam' },
      // Only the relay's namespace (keys and pub/sub channels "relay:*").
      accessString: 'on ~relay:* &relay:* +@all',
    });
    const valkeyUsers = new elasticache.CfnUserGroup(this, 'ValkeyUsers', {
      engine: 'valkey',
      userGroupId: cacheName,
      userIds: [valkeyUser.userId],
    });
    valkeyUsers.addResourceDependency(valkeyUser);
    const cache = new elasticache.CfnServerlessCache(this, 'Valkey', {
      serverlessCacheName: cacheName,
      engine: 'valkey',
      majorEngineVersion: '8',
      description: 'VettID relay: replay cache, rate limits, wake-on-deposit (ephemeral)',
      securityGroupIds: [cacheSg.securityGroupId],
      subnetIds: vpc.publicSubnets.map((s) => s.subnetId),
      userGroupId: valkeyUsers.userGroupId,
      cacheUsageLimits: {
        dataStorage: { maximum: RELAY_VALKEY_LIMITS.dataStorageGb, unit: 'GB' },
        ecpuPerSecond: { maximum: RELAY_VALKEY_LIMITS.ecpuPerSecond },
      },
      snapshotRetentionLimit: 0, // nothing worth restoring
    });
    cache.addResourceDependency(valkeyUsers);

    const cluster = new ecs.Cluster(this, 'Cluster', { clusterName: resourceName(config, 'relay'), vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskMulti', {
      cpu: 256,
      memoryLimitMiB: RELAY_TASK_MEMORY_MIB,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'RelayTable',
        // TransactWriteItems is authorised per contained action.
        actions: [
          'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
          'dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem', 'dynamodb:ConditionCheckItem',
        ],
        resources: [tableArn, `${tableArn}/index/*`],
      }),
    );
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'RelayBlobs',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`arn:${this.partition}:s3:::${blobBucket}/blobs/*`],
      }),
    );
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'RelayValkeyIam',
        actions: ['elasticache:Connect'],
        resources: [cache.attrArn, valkeyUser.attrArn],
      }),
    );

    // A new name: the SQLite-era group (/vettid-org/<stage>/relay) is
    // retained outside the stack until it is deleted by hand after cutover.
    // RETAIN so a failed deploy (which rolls the stack back) leaves evidence.
    const logGroup = new logs.LogGroup(this, 'ServiceLogs', {
      logGroupName: `/vettid-org/${config.stage}/relay-service`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // VPC flow log: rejected traffic only (what the security groups turned
    // away: scans of the tasks' and the load balancer's public addresses,
    // anything trying a port that is not open). Accepted flows are not
    // logged: they would grow with every request a flood brings, and the
    // relay counts its own traffic. CloudWatch Logs, kept 30 days.
    const flowLogGroup = new logs.LogGroup(this, 'FlowLogs', {
      logGroupName: `/vettid-org/${config.stage}/relay-vpc-flow`,
      retention: RELAY_FLOW_LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // The role VPC Flow Logs assumes to write the group: only for this
    // account's flow logs (confused-deputy guard).
    const flowLogRole = new iam.Role(this, 'FlowLogRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:ec2:${this.region}:${this.account}:vpc-flow-log/*` },
        },
      }),
    });
    // From 2027-04-26 DescribeLogStreams (a log-group action) is authorized only
    // on the log-group ARN, without `:*`; the grant CDK adds on `:*` stays.
    flowLogRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:DescribeLogStreams'],
      resources: [this.formatArn({ service: 'logs', resource: 'log-group', resourceName: flowLogGroup.logGroupName, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME })],
    }));
    vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup, flowLogRole),
      trafficType: ec2.FlowLogTrafficType.REJECT,
    });

    taskDef.addContainer('Relay', {
      image: ecs.ContainerImage.fromRegistry(props.relayImage),
      essential: true,
      portMappings: [{ containerPort: RELAY_PORT }],
      readonlyRootFilesystem: true, // no local state at all now
      environment: {
        RELAY_LISTEN_ADDR: `:${RELAY_PORT}`,
        RELAY_BASE_URL: `https://${host}`,
        RELAY_TRUST_PROXY: 'true',
        RELAY_STORE: 'dynamodb',
        RELAY_DYNAMODB_TABLE: tableName,
        RELAY_BLOB_BUCKET: blobBucket,
        RELAY_VALKEY_ADDR: `${cache.attrEndpointAddress}:${cache.attrEndpointPort}`,
        RELAY_VALKEY_TLS: 'true',
        RELAY_VALKEY_IAM_USER: valkeyUser.userId,
        RELAY_VALKEY_CACHE_NAME: cacheName,
        AWS_REGION: this.region,
        // Protocol 0.3 policy (docs/RELAY-PROTOCOL.md §5.2, §5.6, §6.9): 400-day
        // low-quota reconnect tokens; open tokens and claims up to 7 days for
        // remote invitations (docs/VAULT-MESSAGING.md).
        RELAY_MAX_TOKEN_LIFETIME: '9600h',
        RELAY_OPEN_TOKEN_MAX_LIFETIME: '168h',
        RELAY_CLAIM_TTL: '168h',
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'relay' }),
      stopTimeout: cdk.Duration.seconds(40), // drain long-polls / WebSockets on SIGTERM
      // Distroless image: the binary checks its own /healthz.
      healthCheck: {
        command: ['CMD', '/relay', '-healthcheck'],
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(3),
        retries: 3,
        startPeriod: cdk.Duration.seconds(10),
      },
    });

    const service = new ecs.FargateService(this, 'Service', {
      serviceName: resourceName(config, 'relay'),
      cluster,
      taskDefinition: taskDef,
      desiredCount: RELAY_MIN_TASKS,
      // Rolling deploys: start the new tasks first, keep full capacity.
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
    service.node.addDependency(cache);

    const scaling = service.autoScaleTaskCount({ minCapacity: RELAY_MIN_TASKS, maxCapacity: RELAY_MAX_TASKS });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 50, scaleOutCooldown: cdk.Duration.seconds(60), scaleInCooldown: cdk.Duration.minutes(5) });
    scaling.scaleOnMemoryUtilization('Memory', { targetUtilizationPercent: 70, scaleOutCooldown: cdk.Duration.seconds(60), scaleInCooldown: cdk.Duration.minutes(5) });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: host,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: cdk.Duration.seconds(75), // > 25 s long-poll; WebSockets ping within this
      dropInvalidHeaderFields: true,
      deletionProtection: true,
      // No access log, on purpose: it would record each request's full
      // path, which carries mailbox and message ids, next to the client's
      // address (RELAY-PROTOCOL §8). WAF's sampled requests serve an incident.
    });
    alb.addRedirect({ sourcePort: 80, targetPort: 443 });

    // ---- WAF on the load balancer: a per-address rate limit -------------------
    // One rate-based rule (RELAY_WAF_RATE_LIMIT), keyed on the source
    // address of the connection to the load balancer (the client's: nothing
    // sits in front of it). WAF sees each HTTP request and a WebSocket's
    // upgrade, not the frames inside a session. In `block` mode the refusal
    // is the relay's own `rate_limited` error, so clients back off as they
    // would for the flood guard; in `count` mode (the start) WAF only
    // counts. The push gateway's requests on this load balancer are
    // counted too. No managed rule groups: the relay authenticates every
    // request that does anything.
    const W = RELAY_WAF_RATE_LIMIT;
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: resourceName(config, 'relay'),
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      customResponseBodies: {
        'rate-limited': {
          contentType: 'APPLICATION_JSON',
          content: JSON.stringify({ code: 'rate_limited', message: 'too many requests from this address; retry after at least retry_after seconds', retry_after: W.retryAfterSeconds }),
        },
      },
      rules: [
        {
          name: 'rate-limit-per-ip',
          priority: 0,
          action: W.mode === 'block'
            ? {
              block: {
                customResponse: {
                  responseCode: 429,
                  customResponseBodyKey: 'rate-limited',
                  responseHeaders: [
                    { name: 'Retry-After', value: String(W.retryAfterSeconds) },
                    { name: 'Cache-Control', value: 'no-store' },
                  ],
                },
              },
            }
            : { count: {} },
          statement: { rateBasedStatement: { limit: W.requests, evaluationWindowSec: W.windowSeconds, aggregateKeyType: 'IP' } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: resourceName(config, 'relay-rate-limit'), sampledRequestsEnabled: true },
        },
      ],
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: resourceName(config, 'relay-waf'), sampledRequestsEnabled: true },
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', { resourceArn: alb.loadBalancerArn, webAclArn: webAcl.attrArn });
    const listener = alb.addListener('Https', {
      port: 443,
      certificates: [certificate],
      // TLS 1.3/1.2 with hybrid post-quantum key exchange (docs/PQC-MIGRATION.md).
      sslPolicy: elbv2.SslPolicy.TLS13_12_RES_PQ,
    });
    listener.addTargets('Relay', {
      port: RELAY_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      // Longer than a 25 s long-poll: a deregistered task finishes its
      // long-polls before ECS stops it, and new requests go elsewhere.
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: { path: '/healthz', healthyHttpCodes: '200', interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 },
    });

    const target = route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(alb));
    new route53.ARecord(this, 'Alias', { zone: hostedZone, recordName: host, target });

    if (props.publishPushRefs) {
      publishRef(this, config, 'relay/vpc-id', vpc.vpcId);
      publishRef(this, config, 'relay/public-subnet-ids', cdk.Fn.join(',', vpc.publicSubnets.map((s) => s.subnetId)));
      publishRef(this, config, 'relay/alb-security-group-id', albSg.securityGroupId);
      publishRef(this, config, 'relay/https-listener-arn', listener.listenerArn);
      publishRef(this, config, 'relay/alb-dns-name', alb.loadBalancerDnsName);
      publishRef(this, config, 'relay/alb-hosted-zone-id', alb.loadBalancerCanonicalHostedZoneId);
      publishRef(this, config, 'relay/alb-full-name', alb.loadBalancerFullName);
    }

    // ---- Alarms on the `rate limits` line (RELAY-PROTOCOL §7.2) ---------------
    // Each task writes one JSON line a minute (relay ≥ protocol 0.7.0) with
    // the minute's peaks and refusals by limiter and what the task carries.
    // Metric filters turn the fields into metrics without a dimension (the
    // line names no task, address or key): Sum adds the tasks up, Maximum is
    // the worst task, SampleCount the number of lines.
    const line = logs.FilterPattern.stringValue('$.msg', '=', 'rate limits');
    const fromLine = (cid: string, metricName: string, field: string) =>
      new logs.MetricFilter(this, cid, { logGroup, filterPattern: line, metricNamespace: RELAY_METRICS_NAMESPACE, metricName, metricValue: `$.${field}` });
    const minute = cdk.Duration.minutes(1);
    const says = (text: string) => `Relay: ${text} (RUNBOOK "Relay" → Alarms).`;
    const alarms: cloudwatch.Alarm[] = [];
    const alarm = (cid: string, name: string, a: Omit<cloudwatch.AlarmProps, 'alarmName'>) => {
      const x = new cloudwatch.Alarm(this, cid, { alarmName: resourceName(config, `relay-${name}`), treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, ...a });
      alarms.push(x);
      return x;
    };
    // Refusals: in 3 of 5 minutes, so that one scanner's burst is not an alarm.
    const refused = (cid: string, name: string, field: string, metricName: string, text: string) =>
      alarm(cid, name, {
        alarmDescription: says(text),
        metric: fromLine(`${cid}Metric`, metricName, field).metric({ statistic: 'Sum', period: minute }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 5,
        datapointsToAlarm: 3,
      });
    refused('AddressRefused', 'address-refused', 'address_refused', 'AddressRefused', 'the flood guard (per source address, 100/s, burst 300) refused requests in 3 of 5 minutes');
    refused('KeyRefused', 'key-refused', 'key_refused', 'KeyRefused', 'a key was refused at its own limit (20/s, burst 100) in 3 of 5 minutes');
    refused('RegisterRefused', 'register-refused', 'register_refused', 'RegisterRefused', 'an address was refused new mailboxes (1/s, burst 30) in 3 of 5 minutes');
    const L = RELAY_ALARM_LIMITS;
    const atLeast = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    alarm('AddressBusy', 'address-busy', {
      alarmDescription: says(`the busiest address made ${L.addressBusiestPerMin} or more requests a minute for 5 minutes: half the flood guard (a vault host near 550 active vaults)`),
      metric: fromLine('AddressBusiestMetric', 'AddressBusiestPerMin', 'address_busiest_per_min').metric({ statistic: 'Maximum', period: minute }),
      threshold: L.addressBusiestPerMin,
      comparisonOperator: atLeast,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
    });
    const collectors = fromLine('CollectorsMetric', 'Collectors', 'collectors');
    alarm('Collectors', 'collectors', {
      alarmDescription: says(`a task carries ${L.collectorsPerTask} or more long-polls (about 42 KiB each; nothing caps them per task yet) in 3 of 5 minutes`),
      metric: collectors.metric({ statistic: 'Maximum', period: minute }),
      threshold: L.collectorsPerTask,
      comparisonOperator: atLeast,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
    });
    alarm('WsSessions', 'ws-sessions', {
      alarmDescription: says(`a task carries ${L.wsSessionsPerTask} or more WebSocket sessions (about 45 KiB each; nothing caps them per task yet) in 3 of 5 minutes`),
      metric: fromLine('WsSessionsMetric', 'WsSessions', 'ws_sessions').metric({ statistic: 'Maximum', period: minute }),
      threshold: L.wsSessionsPerTask,
      comparisonOperator: atLeast,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
    });
    // ---- The table's ceiling (RELAY_TABLE_LIMITS, VettidOrgRelayDataStack) ---
    // DynamoDB's own metrics for the table. They have data only in minutes
    // with requests (or throttling), so missing data is not a breach.
    const tableDims = { TableName: tableName };
    const indexDims = { ...tableDims, GlobalSecondaryIndexName: 'due' };
    const tableMetric = (metricName: string, dimensionsMap: Record<string, string>, period = minute) =>
      new cloudwatch.Metric({ namespace: 'AWS/DynamoDB', metricName, dimensionsMap, statistic: 'Sum', period });
    const T = RELAY_TABLE_LIMITS;
    const busy = (cid: string, name: string, metricName: string, what: string, busyPerSecond: number, ceiling: number) =>
      alarm(cid, name, {
        alarmDescription: says(`the table took ${busyPerSecond * 60} or more ${what} units a minute for 5 minutes (${busyPerSecond} a second; its ceiling is ${ceiling} a second, above which DynamoDB throttles every tenant)`),
        metric: tableMetric(metricName, tableDims),
        threshold: busyPerSecond * 60,
        comparisonOperator: atLeast,
        evaluationPeriods: 5,
        datapointsToAlarm: 5,
      });
    busy('TableWritesHigh', 'table-writes-high', 'ConsumedWriteCapacityUnits', 'write', L.tableWritesBusyPerSecond, T.maxWriteRequestUnits);
    busy('TableReadsHigh', 'table-reads-high', 'ConsumedReadCapacityUnits', 'read', L.tableReadsBusyPerSecond, T.maxReadRequestUnits);
    alarm('TableWriteVolume', 'table-write-volume', {
      alarmDescription: says(`the table took ${L.tableWriteUnitsPerHour} or more write units in an hour (100 a second on average; up to 180 MB of messages stored): far above the preview's use, and how a slow fill of the table shows`),
      metric: tableMetric('ConsumedWriteCapacityUnits', tableDims, cdk.Duration.hours(1)),
      threshold: L.tableWriteUnitsPerHour,
      comparisonOperator: atLeast,
      evaluationPeriods: 1,
    });
    // Throttling, whatever its cause (the ceiling, the index's, a hot
    // partition): the table's and the index's read and write events, and
    // throttled deposits (a deposit is a TransactWriteItems request).
    alarm('TableThrottled', 'table-throttled', {
      alarmDescription: says('DynamoDB throttled the relay\'s table or its index in 3 of 5 minutes: requests are failing or slow for every tenant'),
      metric: new cloudwatch.MathExpression({
        expression: 'FILL(tw, 0) + FILL(tr, 0) + FILL(iw, 0) + FILL(ir, 0) + FILL(tx, 0)',
        label: 'throttle events',
        period: minute,
        usingMetrics: {
          tw: tableMetric('WriteThrottleEvents', tableDims),
          tr: tableMetric('ReadThrottleEvents', tableDims),
          iw: tableMetric('WriteThrottleEvents', indexDims),
          ir: tableMetric('ReadThrottleEvents', indexDims),
          tx: tableMetric('ThrottledRequests', { ...tableDims, Operation: 'TransactWriteItems' }),
        },
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
    });
    // ---- Valkey (RELAY_VALKEY_LIMITS) ------------------------------------------
    // ElastiCache Serverless metrics, by the cache's name (dimension clusterId).
    const V = RELAY_VALKEY_LIMITS;
    const cacheMetric = (metricName: string, statistic: string) =>
      new cloudwatch.Metric({ namespace: 'AWS/ElastiCache', metricName, dimensionsMap: { clusterId: cacheName }, statistic, period: minute });
    const storageBytes = V.alarmShare * V.dataStorageGb * 1_000_000_000;
    alarm('ValkeyStorage', 'valkey-storage', {
      alarmDescription: says(`Valkey holds ${storageBytes / 1_000_000} MB or more in 3 of 5 minutes: ${V.alarmShare * 100} % of its ${V.dataStorageGb} GB limit, at which it evicts keys (replay records among them)`),
      metric: cacheMetric('BytesUsedForCache', 'Maximum'),
      threshold: storageBytes,
      comparisonOperator: atLeast,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
    });
    const ecpuPerMinute = V.alarmShare * V.ecpuPerSecond * 60;
    alarm('ValkeyEcpu', 'valkey-ecpu', {
      alarmDescription: says(`Valkey used ${ecpuPerMinute} or more ECPUs a minute in 3 of 5 minutes: ${V.alarmShare * 100} % of its limit of ${V.ecpuPerSecond} a second, at which it throttles commands`),
      metric: cacheMetric('ElastiCacheProcessingUnits', 'Sum'),
      threshold: ecpuPerMinute,
      comparisonOperator: atLeast,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
    });
    alarm('ValkeyEvictions', 'valkey-evictions', {
      alarmDescription: says('Valkey evicted keys: it is full, and replay records may have gone before their time (replay protection is weakened until it is not)'),
      metric: cacheMetric('Evictions', 'Sum'),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });
    // Errors: throttled commands (the ECPU limit: signed requests are refused
    // while it lasts), IAM authentication throttled (new connections fail),
    // and commands, keys or channels outside the relay user's access string.
    alarm('ValkeyErrors', 'valkey-errors', {
      alarmDescription: says('Valkey throttled commands, refused connections (IAM authentication throttled) or refused a command, key or channel outside the relay\'s access: the relay\'s coordination is failing'),
      metric: new cloudwatch.MathExpression({
        expression: 'FILL(thr, 0) + FILL(iam, 0) + FILL(cmd, 0) + FILL(key, 0) + FILL(chan, 0)',
        label: 'Valkey errors',
        period: minute,
        usingMetrics: {
          thr: cacheMetric('ThrottledCmds', 'Sum'),
          iam: cacheMetric('IamAuthenticationThrottling', 'Sum'),
          cmd: cacheMetric('CommandAuthorizationFailures', 'Sum'),
          key: cacheMetric('KeyAuthorizationFailures', 'Sum'),
          chan: cacheMetric('ChannelAuthorizationFailures', 'Sum'),
        },
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });
    // ---- Log volume (RELAY_LOG_INGEST_BYTES_PER_DAY) ---------------------------
    const ingested = (group: logs.LogGroup) =>
      new cloudwatch.Metric({ namespace: 'AWS/Logs', metricName: 'IncomingBytes', dimensionsMap: { LogGroupName: group.logGroupName }, statistic: 'Sum', period: cdk.Duration.days(1) });
    alarm('LogVolume', 'log-volume', {
      alarmDescription: says(`the relay's log groups (service and VPC flow log) ingested ${RELAY_LOG_INGEST_BYTES_PER_DAY / 1_000_000} MB or more in a day: about 250 times normal, and $0.50 a GB`),
      metric: new cloudwatch.MathExpression({
        expression: 'FILL(svc, 0) + FILL(flow, 0)',
        label: 'bytes ingested',
        period: cdk.Duration.days(1),
        usingMetrics: { svc: ingested(logGroup), flow: ingested(flowLogGroup) },
      }),
      threshold: RELAY_LOG_INGEST_BYTES_PER_DAY,
      comparisonOperator: atLeast,
      evaluationPeriods: 1,
    });
    // ---- The web ACL's rate rule (RELAY_WAF_RATE_LIMIT) -------------------------
    // WAF's own metric for the rule (dimension Rule = the rule's metric
    // name): requests it counted (count mode) or blocked (block mode).
    alarm('WafRateLimit', 'waf-rate-limit', {
      alarmDescription: says(`WAF's rate rule (${W.requests} requests per ${W.windowSeconds / 60} minutes per address) ${W.mode === 'block' ? 'blocked' : 'would have blocked (count mode)'} requests in the last 5 minutes: one address is above twice the flood guard. A vault host? Then raise the limit with the flood guard`),
      metric: new cloudwatch.Metric({
        namespace: 'AWS/WAFV2',
        metricName: W.mode === 'block' ? 'BlockedRequests' : 'CountedRequests',
        dimensionsMap: { WebACL: resourceName(config, 'relay'), Region: this.region, Rule: resourceName(config, 'relay-rate-limit') },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });
    // Liveness of the line itself (and so of the alarms on it, which rest
    // on it): every task writes it every minute, so five minutes without
    // one means no task is logging. Missing data is the fault here.
    const silent = alarm('RateLimitsSilent', 'rate-limits-silent', {
      alarmDescription: says('no task has written its `rate limits` line for 5 minutes: the relay is down, logs at a level above info, or its log does not arrive; the other relay alarms are blind meanwhile'),
      metric: collectors.metric({ statistic: 'SampleCount', period: cdk.Duration.minutes(5) }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    // The relay runs in production's main account, the management account,
    // home of the security-alerts topic (VettidOrgAuditStack; it admits this
    // account's CloudWatch alarms since #214). The member API's alarms go
    // there the same way. No topic of its own.
    if (this.account === ORG.management && config.stage === 'prod') {
      const alertsTopicArn = `arn:${this.partition}:sns:${this.region}:${this.account}:${resourceName(config, 'security-alerts')}`;
      const action = { bind: () => ({ alarmActionArn: alertsTopicArn }) };
      for (const a of alarms) a.addAlarmAction(action);
      silent.addOkAction(action); // the line is back
    }

    new cdk.CfnOutput(this, 'RelayUrl', { value: `https://${host}` });
  }
}
