import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';

export interface VettidOrgRelayStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Relay container image, pinned by digest (e.g. ghcr.io/vettid/vettid-relay@sha256:...). */
  readonly relayImage: string;
  /** Litestream image, pinned by digest. */
  readonly litestreamImage: string;
}

const DATA_DIR = '/data';
const DB_FILE = `${DATA_DIR}/relay.db`;
const RELAY_PORT = 8080;

/**
 * relay.vettid.org — the VettID mailbox relay (github.com/vettid/vettid-relay,
 * docs/RELAY-PROTOCOL.md) on ECS Fargate.
 *
 * The relay is one Go binary with SQLite and MUST have a single writer, so:
 *  - the service runs exactly one task, and deployments stop the old task
 *    before starting the new one (min 0% / max 100%);
 *  - Litestream continuously replicates the database to S3; a replacement
 *    task (failure, deploy, AZ loss) restores it before the relay starts, so
 *    recovery takes a minute or two and loses at most seconds of writes.
 *    Clients already retry with backoff and dedupe by message id.
 *  - an ALB gives a stable address, TLS, health checks, and carries long-poll
 *    and WebSocket collects.
 * Scale-out is more relays (mailboxes are assigned to relays), not more tasks.
 */
export class VettidOrgRelayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgRelayStackProps) {
    super(scope, id, props);
    const { config } = props;
    const host = hostName(config, 'relay');
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.domainName });

    // Two AZs of public subnets, no NAT (cost): the task gets a public IP for
    // image pulls but its security group admits only the ALB. S3 (Litestream)
    // goes through a free gateway endpoint.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.43.0.0/24'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });

    const replica = new s3.Bucket(this, 'Replica', {
      bucketName: `${resourceName(config, 'relay-replica')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(14) }],
    });
    const replicaUrl = `s3://${replica.bucketName}/relay.db`;

    const cluster = new ecs.Cluster(this, 'Cluster', { clusterName: resourceName(config, 'relay'), vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      volumes: [{ name: 'data' }],
    });
    replica.grantReadWrite(taskDef.taskRole);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/vettid-org/${config.stage}/relay`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const logging = (prefix: string) => ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: prefix });
    const mountData = (c: ecs.ContainerDefinition) => c.addMountPoints({ containerPath: DATA_DIR, sourceVolume: 'data', readOnly: false });

    // 1. Restore the latest replica (no-op on the very first start).
    const restore = taskDef.addContainer('Restore', {
      image: ecs.ContainerImage.fromRegistry(props.litestreamImage),
      essential: false,
      command: ['restore', '-if-db-not-exists', '-if-replica-exists', '-o', DB_FILE, replicaUrl],
      environment: { AWS_REGION: this.region },
      logging: logging('restore'),
    });
    mountData(restore);

    // 2. The relay, once the restore has completed successfully.
    const relay = taskDef.addContainer('Relay', {
      image: ecs.ContainerImage.fromRegistry(props.relayImage),
      essential: true,
      portMappings: [{ containerPort: RELAY_PORT }],
      environment: {
        RELAY_LISTEN_ADDR: `:${RELAY_PORT}`,
        RELAY_BASE_URL: `https://${host}`,
        RELAY_DB_PATH: DB_FILE,
        RELAY_TRUST_PROXY: 'true',
      },
      logging: logging('relay'),
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
    relay.addContainerDependencies({ container: restore, condition: ecs.ContainerDependencyCondition.SUCCESS });
    mountData(relay);

    // 3. Continuous replication to S3 alongside the relay.
    const replicate = taskDef.addContainer('Replicate', {
      image: ecs.ContainerImage.fromRegistry(props.litestreamImage),
      essential: true,
      command: ['replicate', DB_FILE, replicaUrl],
      environment: { AWS_REGION: this.region },
      logging: logging('replicate'),
      stopTimeout: cdk.Duration.seconds(30),
    });
    // Start once the relay is healthy (it creates the WAL-mode DB on startup).
    replicate.addContainerDependencies({ container: relay, condition: ecs.ContainerDependencyCondition.HEALTHY });
    mountData(replicate);

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'relay ALB: HTTPS from anywhere' });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (redirects to HTTPS)');
    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', { vpc, description: 'relay task: only the ALB may connect', allowAllOutbound: true });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(RELAY_PORT), 'from the relay ALB');

    const service = new ecs.FargateService(this, 'Service', {
      serviceName: resourceName(config, 'relay'),
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      // Never two writers: stop the old task before starting the new one.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { enable: true, rollback: true },
      assignPublicIp: true,
      securityGroups: [taskSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      enableExecuteCommand: false,
    });

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
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: { path: '/healthz', healthyHttpCodes: '200', interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 },
    });

    const target = route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(alb));
    new route53.ARecord(this, 'Alias', { zone: hostedZone, recordName: host, target });

    new cdk.CfnOutput(this, 'RelayUrl', { value: `https://${host}` });
    new cdk.CfnOutput(this, 'ReplicaBucket', { value: replica.bucketName });
  }
}
