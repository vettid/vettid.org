import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { readRef } from '../constructs/ssm-refs';

export interface VettidOrgRelayStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Relay container image, pinned by digest (e.g. ghcr.io/vettid/vettid-relay@sha256:...). */
  readonly relayImage: string;
}

const RELAY_PORT = 8080;
const VALKEY_PORTS = ec2.Port.tcpRange(6379, 6380); // serverless: 6379 primary, 6380 reader

/** Service scaling bounds (two tasks = one per AZ at minimum). */
export const RELAY_MIN_TASKS = 2;
export const RELAY_MAX_TASKS = 8;

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
        dataStorage: { maximum: 1, unit: 'GB' },
        ecpuPerSecond: { maximum: 100000 },
      },
      snapshotRetentionLimit: 0, // nothing worth restoring
    });
    cache.addResourceDependency(valkeyUsers);

    const cluster = new ecs.Cluster(this, 'Cluster', { clusterName: resourceName(config, 'relay'), vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskMulti', {
      cpu: 256,
      memoryLimitMiB: 512,
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
    });
    alb.addRedirect({ sourcePort: 80, targetPort: 443 });
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

    new cdk.CfnOutput(this, 'RelayUrl', { value: `https://${host}` });
  }
}
