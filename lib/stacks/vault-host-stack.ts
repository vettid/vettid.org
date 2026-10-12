import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53resolver from 'aws-cdk-lib/aws-route53resolver';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { AppConfig, VAULT_ROLE_NAMES, resourceName, vaultRoleArn } from '../config';
import { ApiFunction } from '../constructs/api-function';
import { publishRef, readRef, ssmParamName } from '../constructs/ssm-refs';
import { STREAM_READ_ACTIONS, vaultControlQueuePrefix, vaultDlqName, vaultTableArn, vaultTableName } from '../vault/access';
import { vaultHostDnsAllowlist } from '../vault/egress';
import { SCALER_TAGS, VAULT_SCALER_LIMITS, VaultReleaseSpec, releaseGroupThing } from '../vault/releases';

export interface VettidOrgVaultHostStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** The releases with a host group; their PCR0s may use the smoke-test key (§10.1 step 8). */
  readonly releases: readonly VaultReleaseSpec[];
}

/**
 * Limits behind the alarms on the parent's metrics (VAULT-RELEASES §8.7,
 * VAULT-RELAY-SCALING §6). The parent of a release from staging S11 on
 * writes one embedded-metric record a minute to its log (vettid-vault
 * parent/metrics.go): namespace `VettID/Vault`, the one dimension
 * `InstanceId`. Instances come and go, so each alarm asks for the worst
 * instance (or the sum over all of them) with a Metrics Insights query,
 * as the control-queue age alarm does.
 */
export const VAULT_HOST_METRIC_LIMITS = {
  /** Unlocked vaults on one instance: time to look, long before ~900 (§8.8). */
  unlockedVaults: 400,
  /** The enclave's bound on connections to the relay per host (VAULT-MESSAGING §12.2.1), and the streams the relay's load balancer allows on each. */
  relayConnections: 16,
  relayStreams: 128,
  /** Relay requests in flight on one instance, as a share of the most it can have (connections × streams). */
  inFlightShare: 0.8,
  /** Longest wait for a relay stream, milliseconds. */
  streamWaitMs: 1000,
  /**
   * Churn: relay connections opened in an hour, over every instance.
   * Ordinary: the load balancer closes each connection about once an hour
   * (8 connections at 900 vaults; 16 at most), so a host opens 8 to 16 an
   * hour, and 32 when a full set is replaced twice, which is also the
   * burst the pool may dial at once. 64 is twice that. A host whose
   * connections are closed as they open dials at the pool's steady rate
   * of 2 a second, 7,200 an hour.
   */
  relayOpenedPerHour: 64,
  /** The stream limit Go's HTTP/2 client assumes before the relay announced one (VAULT-RELAY-SCALING §10.4). */
  assumedStreams: 100,
} as const;

/** The parent's metrics, by instance (the schema of the Metrics Insights queries). */
export const VAULT_HOST_METRIC_SCHEMA = 'SCHEMA("VettID/Vault", InstanceId)';

/** The two AZs the host groups span (both offer m7g.large in both vault accounts; checked 2026-10-04). */
export const VAULT_HOST_AZS = ['a', 'b'];

/**
 * Stateless vault host stack, in the vault account (VAULT-RELEASES §8.2–8.7,
 * W6). Everything the per-release stacks share:
 *
 *  - the HOST VPC: two AZs, public subnets only, no NAT; S3 and DynamoDB
 *    gateway endpoints limited to this account's resources; flow logs;
 *    Route 53 Resolver DNS Firewall (allowlist, NXDOMAIN for the rest,
 *    fail closed, query logs); the host security group (no inbound,
 *    outbound TCP 443 only);
 *  - a separate BUILD VPC for EC2 Image Builder (the builder needs GitHub
 *    and the package repositories, which the host firewall must not admit),
 *    the builder role and the infrastructure configuration;
 *  - the shared DLQ, the host log group, the deletable smoke-test key;
 *  - the release SCALER and the MANIFEST SYNC Lambdas;
 *  - alarms and CloudTrail rules to SNS → the admin address, among them
 *    the alarms on the parent's own metrics (§8.7; hosts from staging
 *    release S11 write them).
 *
 * Refs for the release stacks and the hosts' boot go to SSM
 * (`/vettid-org/<stage>/vault/*`); nothing is exported.
 */
export class VettidOrgVaultHostStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;
  readonly hostSecurityGroup: ec2.SecurityGroup;
  readonly scaler: lambda.Function;
  readonly manifestSync: lambda.Function;
  readonly alerts: sns.Topic;

  constructor(scope: Construct, id: string, props: VettidOrgVaultHostStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vault = config.vault;
    if (!vault) throw new Error(`stage ${config.stage} has no vault account`);
    if (props.env?.account !== vault.account) {
      throw new Error(`VettidOrgVaultHostStack must be deployed into the ${vault.channel} vault account ${vault.account}`);
    }
    const region = config.region;
    const account = vault.account;
    const stagePath = `/vettid-org/${config.stage}`;
    const logGroup = (cid: string, name: string) =>
      new logs.LogGroup(this, cid, { logGroupName: name, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY });

    // ---- alerts ---------------------------------------------------------------------
    this.alerts = new sns.Topic(this, 'Alerts', { topicName: resourceName(config, 'vault-alerts'), displayName: `VettID vault alerts (${vault.channel})` });
    this.alerts.addSubscription(new subs.EmailSubscription(config.adminEmail));
    // CloudWatch alarms publish as the CloudWatch service, which an SNS
    // topic admits only when its policy names it. The statements CDK adds
    // for the CloudTrail rule targets below cover events.amazonaws.com
    // alone, and they replace the topic's default policy: without this
    // statement no alarm of this stack or of a release stack can notify
    // ("not authorized to perform: SNS:Publish" in the alarm's history;
    // the same fault as the security-alerts topic had, #214). Only this
    // account's alarms, never another's.
    this.alerts.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AlarmsOfThisAccount',
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alerts.topicArn],
        conditions: {
          StringEquals: { 'aws:SourceAccount': account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:cloudwatch:${region}:${account}:alarm:*` },
        },
      }),
    );
    const alarmAction = new cwActions.SnsAction(this.alerts);
    const alarm = (cid: string, a: cloudwatch.AlarmProps) => {
      const x = new cloudwatch.Alarm(this, cid, { treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, ...a });
      x.addAlarmAction(alarmAction);
      return x;
    };
    const vaultMetric = (component: string, metricName: string, statistic = 'Maximum', minutes = 1) =>
      new cloudwatch.Metric({ namespace: 'VettID/Vault', metricName, dimensionsMap: { Component: component }, statistic, period: cdk.Duration.minutes(minutes) });

    // ---- host VPC (§8.4) --------------------------------------------------------------
    const flowLogs = logGroup('FlowLogs', `${stagePath}/vault-flow-logs`);
    this.vpc = new ec2.Vpc(this, 'HostVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.45.0.0/24'),
      availabilityZones: VAULT_HOST_AZS.map((z) => `${region}${z}`),
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      flowLogs: { all: { destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogs), trafficType: ec2.FlowLogTrafficType.ALL } },
    });
    // Gateway endpoints (free) carry S3 and DynamoDB; their policies admit
    // only this account's buckets and tables, so they cannot be used to
    // reach another account's bucket.
    for (const [cid, service] of [['S3Endpoint', ec2.GatewayVpcEndpointAwsService.S3], ['DynamoDbEndpoint', ec2.GatewayVpcEndpointAwsService.DYNAMODB]] as const) {
      const ep = this.vpc.addGatewayEndpoint(cid, { service });
      ep.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ThisAccountOnly',
          principals: [new iam.AnyPrincipal()],
          actions: ['*'],
          resources: ['*'],
          conditions: { StringEquals: { 'aws:ResourceAccount': account } },
        }),
      );
    }

    this.hostSecurityGroup = new ec2.SecurityGroup(this, 'HostSg', {
      vpc: this.vpc,
      securityGroupName: resourceName(config, 'vault-host'),
      description: 'Vault enclave hosts: no inbound; outbound TCP 443 only (names limited by DNS Firewall)',
      allowAllOutbound: false,
    });
    this.hostSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS (AWS APIs, relay, KMS, Google attestation)');

    // ---- DNS Firewall (§8.4 control 3) ---------------------------------------------
    const allow = new route53resolver.CfnFirewallDomainList(this, 'DnsAllowList', {
      name: resourceName(config, 'vault-host-allow'),
      domains: vaultHostDnsAllowlist(config, vault),
    });
    const blockAll = new route53resolver.CfnFirewallDomainList(this, 'DnsBlockAll', {
      name: resourceName(config, 'vault-host-block-all'),
      domains: ['*'],
    });
    const ruleGroup = new route53resolver.CfnFirewallRuleGroup(this, 'DnsFirewall', {
      name: resourceName(config, 'vault-host-dns'),
      firewallRules: [
        {
          priority: 100,
          firewallDomainListId: allow.attrId,
          action: 'ALLOW',
          // AWS and relay names are CNAME chains (e.g. to ELB or S3 names):
          // an allowed name may redirect.
          firewallDomainRedirectionAction: 'TRUST_REDIRECTION_DOMAIN',
        },
        { priority: 200, firewallDomainListId: blockAll.attrId, action: 'BLOCK', blockResponse: 'NXDOMAIN' },
      ],
    });
    new route53resolver.CfnFirewallRuleGroupAssociation(this, 'DnsFirewallAssociation', {
      name: resourceName(config, 'vault-host-dns'),
      firewallRuleGroupId: ruleGroup.attrId,
      vpcId: this.vpc.vpcId,
      priority: 101,
      mutationProtection: 'ENABLED',
    });
    // Query logs: the audit trail of what the hosts tried to resolve (and
    // which names the firewall refused). The resolver's failure mode is the
    // default, fail closed (FirewallFailOpen DISABLED).
    const dnsLogs = logGroup('DnsQueryLogs', `${stagePath}/vault-dns`);
    new logs.ResourcePolicy(this, 'DnsQueryLogsDelivery', {
      resourcePolicyName: resourceName(config, 'vault-dns-query-logs'),
      policyStatements: [
        new iam.PolicyStatement({
          principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${dnsLogs.logGroupArn}`],
          conditions: { StringEquals: { 'aws:SourceAccount': account } },
        }),
      ],
    });
    const queryLog = new route53resolver.CfnResolverQueryLoggingConfig(this, 'DnsQueryLogging', {
      name: resourceName(config, 'vault-host-dns'),
      destinationArn: dnsLogs.logGroupArn,
    });
    new route53resolver.CfnResolverQueryLoggingConfigAssociation(this, 'DnsQueryLoggingAssociation', {
      resolverQueryLogConfigId: queryLog.attrId,
      resourceId: this.vpc.vpcId,
    });
    new logs.MetricFilter(this, 'DnsBlockedMetric', {
      logGroup: dnsLogs,
      filterPattern: logs.FilterPattern.stringValue('$.firewall_rule_action', '=', 'BLOCK'),
      metricNamespace: 'VettID/Vault',
      metricName: 'DnsQueriesBlocked',
      metricValue: '1',
    });

    // ---- build VPC and Image Builder infrastructure (§8.3) ---------------------------
    const buildVpc = new ec2.Vpc(this, 'BuildVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.46.0.0/26'),
      availabilityZones: [`${region}${VAULT_HOST_AZS[0]}`],
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 28 }],
    });
    const buildSg = new ec2.SecurityGroup(this, 'BuildSg', {
      vpc: buildVpc,
      description: 'Vault AMI builder: no inbound; outbound HTTPS (GitHub release assets, AL2023 repos, Image Builder)',
      allowAllOutbound: false,
    });
    buildSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    // The builder is NOT the host role: it never touches vault data.
    const builderRole = new iam.Role(this, 'ImageBuilderRole', {
      roleName: resourceName(config, 'vault-image-builder'),
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'EC2 Image Builder instances for vault release AMIs (no vault data access)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'),
      ],
    });
    const builderProfile = new iam.InstanceProfile(this, 'ImageBuilderProfile', {
      instanceProfileName: resourceName(config, 'vault-image-builder'),
      role: builderRole,
    });
    const infra = new imagebuilder.CfnInfrastructureConfiguration(this, 'ImageBuilderInfra', {
      name: resourceName(config, 'vault-image-builder'),
      description: 'Builds vault release AMIs (VettidOrgVaultRelease<N>Stack) in the build VPC',
      instanceProfileName: builderProfile.instanceProfileName,
      instanceTypes: ['t4g.medium'],
      subnetId: buildVpc.publicSubnets[0].subnetId,
      securityGroupIds: [buildSg.securityGroupId],
      terminateInstanceOnFailure: true,
      instanceMetadataOptions: { httpTokens: 'required', httpPutResponseHopLimit: 1 },
    });

    // ---- shared queue, logs, smoke key ----------------------------------------------
    const dlq = new sqs.Queue(this, 'Dlq', {
      queueName: vaultDlqName(config),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    const hostLogs = logGroup('HostLogs', `${stagePath}/vault-host`);

    // The deletable smoke-test key for `vault-parent -selftest` on a release's
    // canary host (§10.1 step 8, §11.2): it keeps an administrator statement,
    // so the enclave's §11.10.7 check is expected to refuse it (check 6);
    // the attested round trip is what it verifies, for the configured
    // releases' PCR0s only.
    const smokeKey = new kms.Key(this, 'SmokeKey', {
      alias: resourceName(config, 'vault-smoke'),
      description: 'DELETABLE vault smoke-test key (not a release key; the §11.10.7 check refuses it by design)',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(7),
    });
    const hostPrincipal = new iam.ArnPrincipal(vaultRoleArn(vault, 'host'));
    smokeKey.addToResourcePolicy(
      new iam.PolicyStatement({ sid: 'HostReadsMetadata', principals: [hostPrincipal], actions: ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:ListGrants'], resources: ['*'] }),
    );
    const pcr0s = props.releases.map((r) => r.pcr0);
    if (pcr0s.length) {
      for (const [sid, action] of [['AttestedDecrypt', 'kms:Decrypt'], ['AttestedGenerateDataKey', 'kms:GenerateDataKey']]) {
        smokeKey.addToResourcePolicy(
          new iam.PolicyStatement({
            sid,
            principals: [hostPrincipal],
            actions: [action],
            resources: ['*'],
            conditions: {
              StringEqualsIgnoreCase: { 'kms:RecipientAttestation:ImageSha384': pcr0s },
              StringEquals: { 'kms:CallerAccount': account },
            },
          }),
        );
      }
    }

    // ---- scaler (§8.6) -------------------------------------------------------------------
    const releasesTableArn = vaultTableArn(config, vault, 'vault-releases');
    const instancesTableArn = vaultTableArn(config, vault, 'vault-instances');
    this.scaler = new ApiFunction(this, 'Scaler', {
      entry: 'lambda/vault/scaler.ts',
      functionName: resourceName(config, 'vault-scaler'),
      timeout: cdk.Duration.seconds(60),
      reservedConcurrentExecutions: 1,
      description: 'Starts and stops vault release instance groups (VAULT-RELEASES §8.6)',
      environment: {
        TABLE_VAULT_RELEASES: vaultTableName(config, 'vault-releases'),
        TABLE_VAULT_INSTANCES: vaultTableName(config, 'vault-instances'),
        CAP_PER_RELEASE: String(VAULT_SCALER_LIMITS.perRelease),
        CAP_TOTAL: String(VAULT_SCALER_LIMITS.total),
        IDLE_MINUTES: String(VAULT_SCALER_LIMITS.idleMinutes),
      },
    }).fn;
    const sc = (actions: string[], resources: string[], conditions?: Record<string, unknown>) =>
      this.scaler.addToRolePolicy(new iam.PolicyStatement({ actions, resources, conditions }));
    sc(['dynamodb:Scan'], [releasesTableArn]);
    // Its own markers only.
    sc(['dynamodb:UpdateItem'], [releasesTableArn], { 'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['release', 'start_issued_at', 'busy_at'] } });
    sc(['dynamodb:Query'], [`${instancesTableArn}/index/release-index`]);
    sc(['autoscaling:DescribeAutoScalingGroups'], ['*']);
    sc(
      ['autoscaling:SetDesiredCapacity'],
      [`arn:aws:autoscaling:${region}:${account}:autoScalingGroup:*:autoScalingGroupName/${resourceName(config, 'vault-r')}*`],
      { StringEquals: { [`aws:ResourceTag/${SCALER_TAGS.managed}`]: 'managed' } },
    );
    // Start requests from the member API arrive on the vault-releases stream.
    const releasesStreamArn = readRef(this, config, 'vault/vault-releases-stream-arn');
    sc([...STREAM_READ_ACTIONS], [releasesStreamArn]);
    sc(['dynamodb:ListStreams'], ['*']);
    new lambda.EventSourceMapping(this, 'ScalerStartRequests', {
      target: this.scaler,
      eventSourceArn: releasesStreamArn,
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(1),
      retryAttempts: 2,
      bisectBatchOnError: true,
      maxRecordAge: cdk.Duration.minutes(10),
      filters: [
        lambda.FilterCriteria.filter({
          eventName: lambda.FilterRule.isEqual('MODIFY'),
          dynamodb: { NewImage: { start_requested_at: { S: lambda.FilterRule.exists() } } },
        }),
      ],
    });
    new events.Rule(this, 'ScalerSchedule', {
      description: 'vault scaler: reconcile every minute (start requests, idle stops, alarms)',
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(this.scaler, { retryAttempts: 0 })],
    });

    // ---- manifest sync (§7) ------------------------------------------------------------
    const dataBucket = `${resourceName(config, 'vault-data')}-${account}`;
    this.manifestSync = new ApiFunction(this, 'ManifestSync', {
      entry: 'lambda/vault/manifest-sync.ts',
      functionName: resourceName(config, 'vault-manifest-sync'),
      timeout: cdk.Duration.seconds(60),
      description: 'Verifies the signed release manifest and upserts vault-releases routing rows (VAULT-RELEASES §7)',
      environment: {
        MANIFEST_URL: vault.manifestUrl,
        PINNED_KEYS: JSON.stringify(vault.manifestKeys),
        TABLE_VAULT_RELEASES: vaultTableName(config, 'vault-releases'),
        DATA_BUCKET: dataBucket,
        SSM_RELEASES_PATH: `${stagePath}/vault/releases/`,
      },
    }).fn;
    const ms = (actions: string[], resources: string[], conditions?: Record<string, unknown>) =>
      this.manifestSync.addToRolePolicy(new iam.PolicyStatement({ actions, resources, conditions }));
    ms(['dynamodb:Scan', 'dynamodb:DeleteItem'], [releasesTableArn]);
    // Routing attributes only: never start requests, scaler markers or rescue.
    ms(['dynamodb:UpdateItem'], [releasesTableArn], {
      'ForAllValues:StringEquals': {
        'dynamodb:Attributes': ['release', 'release_number', 'status', 'seal_key', 'available', 'ends_at', 'manifest_serial', 'manifest_sha256', 'synced_at'],
      },
    });
    ms(['s3:GetObject'], [`arn:aws:s3:::${dataBucket}/manifests/*`]);
    ms(['s3:ListBucket'], [`arn:aws:s3:::${dataBucket}`], { StringLike: { 's3:prefix': ['manifests/*'] } });
    ms(['ssm:GetParametersByPath'], [`arn:aws:ssm:${region}:${account}:parameter${stagePath}/vault/releases`, `arn:aws:ssm:${region}:${account}:parameter${stagePath}/vault/releases/*`]);
    new events.Rule(this, 'ManifestSyncSchedule', {
      description: 'vault manifest sync every 5 minutes',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(this.manifestSync, { retryAttempts: 0 })],
    });

    // ---- alarms (§8.7) ----------------------------------------------------------------------
    alarm('DlqNotEmpty', {
      alarmName: resourceName(config, 'vault-dlq-not-empty'),
      alarmDescription: 'A vault control message failed 3 receives and is in the DLQ',
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
    });
    // Per-instance queues come and go, so the age alarm is a Metrics
    // Insights query over every control queue (the DLQ has its own alarm).
    const queueAge = new cloudwatch.CfnAlarm(this, 'ControlQueueAge', {
      alarmName: resourceName(config, 'vault-control-queue-age'),
      alarmDescription: 'A vault control queue holds a message older than 60 s (its instance is not consuming)',
      comparisonOperator: 'GreaterThanThreshold',
      threshold: 60,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: 'notBreaching',
      metrics: [
        {
          id: 'age',
          returnData: true,
          period: 60,
          expression: `SELECT MAX(ApproximateAgeOfOldestMessage) FROM SCHEMA("AWS/SQS", QueueName) WHERE QueueName != '${vaultDlqName(config)}'`,
        },
      ],
      alarmActions: [this.alerts.topicArn],
    });
    queueAge.node.addDependency(this.alerts);
    alarm('StartUnfulfilled', {
      alarmName: resourceName(config, 'vault-start-unfulfilled'),
      alarmDescription: 'A release start was issued 10+ minutes ago and is still requested, with no live instance',
      metric: vaultMetric('scaler', 'StartsUnfulfilled', 'Maximum', 5),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
    });
    alarm('StartBlocked', {
      alarmName: resourceName(config, 'vault-start-blocked'),
      alarmDescription: 'A release start request cannot be served: no instance group, or a cap (2 per release, 6 total) is reached',
      metric: vaultMetric('scaler', 'StartsBlocked', 'Sum', 5),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
    });
    alarm('ActiveReleaseDown', {
      alarmName: resourceName(config, 'vault-active-release-down'),
      alarmDescription: 'The newest active release keeps an always-on minimum but has had no live (heartbeating) instance for 10 minutes',
      metric: vaultMetric('scaler', 'ActiveMinimumUnmet'),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 10,
      datapointsToAlarm: 10,
    });
    for (const [cid, fn, what] of [['ScalerErrors', this.scaler, 'scaler'], ['ManifestSyncErrors', this.manifestSync, 'manifest sync']] as const) {
      alarm(cid, {
        alarmName: resourceName(config, `vault-${cid === 'ScalerErrors' ? 'scaler' : 'manifest-sync'}-errors`),
        alarmDescription: `The vault ${what} Lambda keeps failing`,
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
      });
    }
    alarm('ManifestRejected', {
      alarmName: resourceName(config, 'vault-manifest-rejected'),
      alarmDescription: 'The served release manifest failed verification (signature, pinned key, format or serial); routing rows were not updated',
      metric: vaultMetric('manifest-sync', 'ManifestRejected', 'Maximum', 5),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
    });
    alarm('ManifestNotInBucket', {
      alarmName: resourceName(config, 'vault-manifest-not-in-bucket'),
      alarmDescription: 'The published manifest has no manifests/<sha256>.json copy in the data bucket: hosts cannot supply it (M1)',
      metric: vaultMetric('manifest-sync', 'ManifestMissingInBucket', 'Maximum', 5),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
    });

    // ---- alarms on the parent's metrics (§8.7; VAULT-RELAY-SCALING §6) -----------------
    // Nothing here exists until a host of a release from staging S11 on
    // runs: until then (and whenever no instance runs) the queries return
    // nothing and missing data is not breaching.
    const L = VAULT_HOST_METRIC_LIMITS;
    const parentQuery = (fn: 'MAX' | 'SUM', metricName: string) => `SELECT ${fn}(${metricName}) FROM ${VAULT_HOST_METRIC_SCHEMA}`;
    // One Metrics Insights query per alarm, and nothing beside it.
    const parentAlarm = (
      cid: string,
      name: string,
      alarmDescription: string,
      p: { metrics: cloudwatch.CfnAlarm.MetricDataQueryProperty[]; threshold: number; periods: number },
    ) => {
      const x = new cloudwatch.CfnAlarm(this, cid, {
        alarmName: resourceName(config, name),
        alarmDescription,
        comparisonOperator: 'GreaterThanThreshold',
        threshold: p.threshold,
        evaluationPeriods: p.periods,
        datapointsToAlarm: p.periods,
        treatMissingData: 'notBreaching',
        metrics: p.metrics,
        alarmActions: [this.alerts.topicArn],
      });
      x.node.addDependency(this.alerts);
      return x;
    };
    const worst = (fn: 'MAX' | 'SUM', metricName: string): cloudwatch.CfnAlarm.MetricDataQueryProperty[] => [
      { id: 'q', returnData: true, period: 60, expression: parentQuery(fn, metricName) },
    ];
    parentAlarm('ParentUnlockedVaults', 'vault-unlocked-vaults', `An instance has held more than ${L.unlockedVaults} unlocked vaults for 5 minutes: time to look at capacity (about 900 fit)`, {
      metrics: worst('MAX', 'UnlockedVaults'),
      threshold: L.unlockedVaults,
      periods: 5,
    });
    // Connections are filled one after the other (a new one only when the
    // open ones are full), so in-flight against the connections OPEN is
    // near or above 80 % in ordinary operation from the fifth connection
    // on. The share is therefore taken of the most a host can have.
    const inFlightLimit = Math.floor(L.inFlightShare * L.relayConnections * L.relayStreams);
    parentAlarm(
      'ParentRelayInFlight',
      'vault-relay-in-flight',
      `An instance has more than ${inFlightLimit} relay requests in flight: ${L.inFlightShare * 100} % of what its ${L.relayConnections} connections of ${L.relayStreams} streams carry`,
      { metrics: worst('MAX', 'RelayRequestsInFlight'), threshold: inFlightLimit, periods: 3 },
    );
    // The metric is the longest wait of this minute and the one before:
    // one record is enough.
    parentAlarm('ParentRelayStreamWait', 'vault-relay-stream-wait', `A relay request on an instance waited more than ${L.streamWaitMs} ms for a stream`, {
      metrics: worst('MAX', 'RelayStreamWaitMax'),
      threshold: L.streamWaitMs,
      periods: 1,
    });
    parentAlarm('ParentRelayGrowthRefused', 'vault-relay-growth-refused', 'Relay requests on an instance waited because a bound forbade another connection (16 connections, or a relay announcing fewer than 32 streams); which bound is in the metrics record (relay_refused_max_conns, relay_refused_min_streams)', {
      metrics: worst('SUM', 'RelayGrowthRefused'),
      threshold: 0,
      periods: 1,
    });
    // Connections opened in an hour, over every instance, against a fixed
    // number. Not against the connections open, as the plan has it: an
    // alarm takes ONE Metrics Insights query (CloudWatch refuses a second
    // with "Invalid metrics list", seen on staging 2026-10-12), and
    // without a query the two metrics could only be read by naming
    // instances.
    parentAlarm(
      'ParentRelayChurn',
      'vault-relay-connection-churn',
      `Relay connections churn: more than ${L.relayOpenedPerHour} opened in an hour over all instances (8 to 16 an hour per host is the load balancer's hourly close; 32 a full set replaced twice)`,
      {
        metrics: [{ id: 'q', returnData: true, period: 3600, expression: parentQuery('SUM', 'EgressOpenedRelay') }],
        threshold: L.relayOpenedPerHour,
        periods: 1,
      },
    );
    // relay_streams and relay_waiting are plain fields of the record, not
    // metrics: a filter on the host log counts the records in which
    // requests wait while the stream limit reads 0 (none announced) or 100
    // (the client's assumption: a front end that announces exactly 100 is
    // filled slowly for good, VAULT-RELAY-SCALING §10.4).
    const streamLimitSuspect = new logs.MetricFilter(this, 'RelayStreamLimitSuspectMetric', {
      logGroup: hostLogs,
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.stringValue('$.msg', '=', 'metrics'),
        logs.FilterPattern.numberValue('$.relay_waiting', '>', 0),
        logs.FilterPattern.any(logs.FilterPattern.numberValue('$.relay_streams', '=', 0), logs.FilterPattern.numberValue('$.relay_streams', '=', L.assumedStreams)),
      ),
      metricNamespace: 'VettID/Vault',
      metricName: 'RelayStreamLimitSuspect',
      metricValue: '1',
    });
    alarm('ParentRelayStreamLimit', {
      alarmName: resourceName(config, 'vault-relay-stream-limit'),
      alarmDescription: `Relay requests on an instance wait for a stream while the relay's stream limit reads 0 or ${L.assumedStreams} (2 records in 3 minutes): check what the relay's front end announces (RUNBOOK "Relay", ${L.relayStreams} expected)`,
      metric: streamLimitSuspect.metric({ statistic: 'Sum', period: cdk.Duration.minutes(1) }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
    });

    // ---- CloudTrail rules (§8.7; AuditStack's pattern, in the vault account) ----------
    const ctRule = (cid: string, description: string, source: string, detail: Record<string, unknown>) =>
      new events.Rule(this, cid, {
        description,
        eventPattern: { source: [source], detailType: ['AWS API Call via CloudTrail'], detail },
        targets: [
          new targets.SnsTopic(this.alerts, {
            message: events.RuleTargetInput.fromText(
              `VettID vault alert (${vault.channel}): ${description}\n\n` +
                `event:   ${events.EventField.fromPath('$.detail.eventName')}\n` +
                `error:   ${events.EventField.fromPath('$.detail.errorCode')}\n` +
                `who:     ${events.EventField.fromPath('$.detail.userIdentity.arn')}\n` +
                `from:    ${events.EventField.fromPath('$.detail.sourceIPAddress')}\n` +
                `time:    ${events.EventField.fromPath('$.time')}\n\n` +
                'Look up the full event in CloudTrail (Event history) by time and event name. See RUNBOOK "Vault".',
            ),
          }),
        ],
      });
    ctRule('KmsKeyLifecycle', 'release-key lifecycle or policy change (schedule/cancel deletion, enable, disable, put key policy)', 'aws.kms', {
      eventName: ['ScheduleKeyDeletion', 'CancelKeyDeletion', 'EnableKey', 'DisableKey', 'PutKeyPolicy'],
    });
    ctRule('KmsBypassCreate', 'a KMS key was created (or attempted) with BypassPolicyLockoutSafetyCheck', 'aws.kms', {
      eventName: ['CreateKey'],
      requestParameters: { bypassPolicyLockoutSafetyCheck: [true] },
    });
    ctRule('PinnedRoleChange', 'the enclave host or key retirement role (named in every release key policy) was deleted or its trust changed', 'aws.iam', {
      eventName: ['DeleteRole', 'UpdateAssumeRolePolicy', 'DeleteInstanceProfile', 'RemoveRoleFromInstanceProfile'],
      $or: [
        { requestParameters: { roleName: [VAULT_ROLE_NAMES.host, VAULT_ROLE_NAMES.retirement] } },
        { requestParameters: { instanceProfileName: [VAULT_ROLE_NAMES.host] } },
      ],
    });

    // ---- refs ---------------------------------------------------------------------------------
    publishRef(this, config, 'vault/dlq-arn', dlq.queueArn);
    publishRef(this, config, 'vault/relay-host', vault.relayHost);
    publishRef(this, config, 'vault/host-log-group', hostLogs.logGroupName);
    publishRef(this, config, 'vault/host-security-group-id', this.hostSecurityGroup.securityGroupId);
    publishRef(this, config, 'vault/host-subnet-ids', this.vpc.publicSubnets.map((s) => s.subnetId).join(','));
    publishRef(this, config, 'vault/image-builder-infra-arn', infra.attrArn);
    publishRef(this, config, 'vault/alerts-topic-arn', this.alerts.topicArn);
    publishRef(this, config, 'vault/smoke-key-arn', smokeKey.keyArn);

    new cdk.CfnOutput(this, 'AlertTopicArn', { value: this.alerts.topicArn });
    new cdk.CfnOutput(this, 'SmokeKeyArn', { value: smokeKey.keyArn });
    new cdk.CfnOutput(this, 'ControlQueuePrefix', { value: vaultControlQueuePrefix(config) });
    new cdk.CfnOutput(this, 'ReleaseGroupNamePattern', { value: resourceName(config, releaseGroupThing(0)).replace(/0$/, '<N>') });
    new cdk.CfnOutput(this, 'QueuePolicyParameter', { value: ssmParamName(config, 'vault/control-queue-policy') });
  }
}
