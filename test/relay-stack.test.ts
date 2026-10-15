import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../lib/config';
import {
  VettidOrgRelayStack, RELAY_ALARM_LIMITS, RELAY_LOG_INGEST_BYTES_PER_DAY, RELAY_MAX_TASKS, RELAY_MIN_TASKS, RELAY_TASK_MEMORY_MIB, RELAY_VALKEY_LIMITS, RELAY_WAF_RATE_LIMIT,
} from '../lib/stacks/relay-stack';
import { VettidOrgRelayDataStack, RELAY_TABLE_LIMITS } from '../lib/stacks/relay-data-stack';

const app = new cdk.App();
const env = { account: '123456789012', region: 'us-east-1' };
const config = loadConfig(app.node);
const relayStack = new VettidOrgRelayStack(app, 'Relay', {
  config,
  relayImage: 'ghcr.io/vettid/vettid-relay@sha256:' + 'a'.repeat(64),
  env,
});
const dataStack = new VettidOrgRelayDataStack(app, 'RelayData', { config, env });
const t = Template.fromStack(relayStack);
const data = Template.fromStack(dataStack);

const relayContainer = () => {
  const td = Object.values<any>(t.findResources('AWS::ECS::TaskDefinition'))[0].Properties;
  expect(td.ContainerDefinitions).toHaveLength(1); // no Litestream sidecars
  return td.ContainerDefinitions[0];
};

describe('service (stateless)', () => {
  test('several tasks, rolling deploys that never drop below full capacity, circuit breaker', () => {
    t.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: RELAY_MIN_TASKS,
      AvailabilityZoneRebalancing: 'ENABLED',
      DeploymentConfiguration: Match.objectLike({
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
    expect(RELAY_MIN_TASKS).toBeGreaterThanOrEqual(2);
  });

  test('tasks spread over two AZs (two public subnets)', () => {
    const svc = Object.values<any>(t.findResources('AWS::ECS::Service'))[0].Properties;
    expect(svc.NetworkConfiguration.AwsvpcConfiguration.Subnets).toHaveLength(2);
    t.resourceCountIs('AWS::EC2::Subnet', 2);
  });

  test('target-tracking autoscaling on CPU and memory', () => {
    t.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', { MinCapacity: RELAY_MIN_TASKS, MaxCapacity: RELAY_MAX_TASKS });
    const policies = Object.values<any>(t.findResources('AWS::ApplicationAutoScaling::ScalingPolicy')).map(
      (p) => p.Properties.TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification.PredefinedMetricType,
    );
    expect(policies.sort()).toEqual(['ECSServiceAverageCPUUtilization', 'ECSServiceAverageMemoryUtilization']);
  });

  test('relay container: shared store, Valkey over TLS with IAM auth, read-only root, digest-pinned', () => {
    const c = relayContainer();
    expect(c.Image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(c.ReadonlyRootFilesystem).toBe(true);
    expect(c.HealthCheck.Command).toEqual(['CMD', '/relay', '-healthcheck']);
    const envs = Object.fromEntries(c.Environment.map((e: any) => [e.Name, e.Value]));
    expect(envs).toMatchObject({
      RELAY_BASE_URL: 'https://relay.vettid.org',
      RELAY_TRUST_PROXY: 'true',
      RELAY_STORE: 'dynamodb',
      RELAY_VALKEY_TLS: 'true',
      RELAY_VALKEY_IAM_USER: 'vettid-org-relay',
      RELAY_VALKEY_CACHE_NAME: 'vettid-org-relay',
      RELAY_MAX_TOKEN_LIFETIME: '9600h',
      RELAY_OPEN_TOKEN_MAX_LIFETIME: '168h',
      RELAY_CLAIM_TTL: '168h',
    });
    expect(envs.RELAY_DB_PATH).toBeUndefined();
    // Data refs come from SSM (no CloudFormation imports).
    expect(JSON.stringify(t.toJSON())).toContain('/vettid-org/prod/relay/table-name');
    expect(JSON.stringify(t.toJSON())).not.toContain('Fn::ImportValue');
  });

  test('task role: table + index, blob objects, elasticache:Connect — nothing broader', () => {
    const statements = Object.values<any>(t.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const bySid = Object.fromEntries(statements.filter((s) => s.Sid).map((s) => [s.Sid, s]));
    expect(bySid.RelayTable.Action).toEqual(expect.arrayContaining(['dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:ConditionCheckItem']));
    expect(bySid.RelayTable.Action).not.toContain('dynamodb:Scan');
    expect(JSON.stringify(bySid.RelayBlobs.Resource)).toContain('/blobs/*');
    expect(bySid.RelayValkeyIam.Action).toBe('elasticache:Connect');
    for (const s of statements) expect(s.Action).not.toBe('*');
  });

  test('Valkey: serverless, IAM-only user scoped to the relay namespace, reachable only from tasks', () => {
    t.hasResourceProperties('AWS::ElastiCache::ServerlessCache', {
      Engine: 'valkey',
      ServerlessCacheName: 'vettid-org-relay',
      CacheUsageLimits: Match.objectLike({ ECPUPerSecond: { Maximum: 100000 } }),
    });
    t.hasResourceProperties('AWS::ElastiCache::User', {
      Engine: 'valkey',
      UserId: 'vettid-org-relay',
      UserName: 'vettid-org-relay',
      AuthenticationMode: { Type: 'iam' },
      AccessString: 'on ~relay:* &relay:* +@all',
    });
    const ingress = Object.values<any>(t.findResources('AWS::EC2::SecurityGroupIngress')).filter((s) => s.Properties.FromPort === 6379);
    expect(ingress).toHaveLength(1);
    expect(ingress[0].Properties.SourceSecurityGroupId).toBeDefined();
  });

  test('task accepts traffic only from the ALB; no NAT; DynamoDB and S3 gateway endpoints', () => {
    const toTask = Object.values<any>(t.findResources('AWS::EC2::SecurityGroupIngress')).filter((s) => s.Properties.FromPort === 8080);
    expect(toTask).toHaveLength(1);
    expect(toTask[0].Properties.SourceSecurityGroupId).toBeDefined();
    t.resourceCountIs('AWS::EC2::NatGateway', 0);
    const endpoints = Object.values<any>(t.findResources('AWS::EC2::VPCEndpoint'));
    expect(endpoints.map((e) => e.Properties.VpcEndpointType ?? 'Gateway')).toEqual(['Gateway', 'Gateway']);
    expect(JSON.stringify(endpoints)).toContain('.dynamodb');
    expect(JSON.stringify(endpoints)).toContain('.s3');
  });

  test('ALB unchanged: post-quantum TLS policy, HTTP→HTTPS redirect, 75 s idle, 30 s drain', () => {
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 443, SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09' });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: Match.arrayWith([{ Key: 'idle_timeout.timeout_seconds', Value: '75' }]),
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/healthz',
      TargetGroupAttributes: Match.arrayWith([{ Key: 'deregistration_delay.timeout_seconds', Value: '30' }]),
    });
  });

  test('SQLite-era resources are gone from the stack (deleted by hand after cutover); new service log group', () => {
    t.resourceCountIs('AWS::S3::Bucket', 0);
    const groups = Object.values<any>(t.findResources('AWS::Logs::LogGroup'));
    expect(groups.map((g) => g.Properties.LogGroupName)).toEqual(['/vettid-org/prod/relay-service', '/vettid-org/prod/relay-vpc-flow']);
    for (const g of groups) expect(g.DeletionPolicy).toBe('Retain');
    // New task-definition construct id: the running SQLite task's role and
    // policy are only removed in CloudFormation's cleanup phase.
    expect(Object.keys(t.findResources('AWS::ECS::TaskDefinition'))[0]).toMatch(/^TaskMulti/);
  });
});

describe('alarms on the `rate limits` line (RELAY-PROTOCOL §7.2)', () => {
  // The stack as deployed: production's main account (the management account).
  const prodApp = new cdk.App();
  const prod = Template.fromStack(
    new VettidOrgRelayStack(prodApp, 'RelayProd', {
      config: loadConfig(prodApp.node),
      relayImage: 'ghcr.io/vettid/vettid-relay@sha256:' + 'a'.repeat(64),
      env: { account: '449757308783', region: 'us-east-1' },
    }),
  );
  const alarmsOf = (x: Template) => Object.values<any>(x.findResources('AWS::CloudWatch::Alarm')).map((a) => a.Properties);
  const byName = (x: Template, n: string) => alarmsOf(x).find((a) => a.AlarmName === `vettid-org-relay-${n}`)!;
  const TOPIC = /arn:.*:sns:us-east-1:449757308783:vettid-org-security-alerts/;
  const flat = (x: unknown) => JSON.stringify(x).replace(/["{}\[\],]|Fn::Join|Ref|AWS::Partition/g, '');

  test('six metric filters on the service log, each reading one field of the line, without dimensions', () => {
    const filters = Object.values<any>(prod.findResources('AWS::Logs::MetricFilter')).map((f) => f.Properties);
    expect(filters).toHaveLength(6);
    for (const f of filters) {
      expect(f.FilterPattern).toBe('{ $.msg = "rate limits" }');
      expect(f.LogGroupName).toEqual({ Ref: expect.stringMatching(/^ServiceLogs/) });
      expect(f.MetricTransformations).toHaveLength(1);
      expect(f.MetricTransformations[0].MetricNamespace).toBe('VettID/Relay');
      expect(f.MetricTransformations[0].Dimensions).toBeUndefined();
    }
    expect(Object.fromEntries(filters.map((f) => [f.MetricTransformations[0].MetricName, f.MetricTransformations[0].MetricValue]))).toEqual({
      AddressRefused: '$.address_refused',
      KeyRefused: '$.key_refused',
      RegisterRefused: '$.register_refused',
      AddressBusiestPerMin: '$.address_busiest_per_min',
      Collectors: '$.collectors',
      WsSessions: '$.ws_sessions',
    });
  });

  test.each([
    ['address-refused', 'AddressRefused'],
    ['key-refused', 'KeyRefused'],
    ['register-refused', 'RegisterRefused'],
  ])('%s: refusals in 3 of 5 minutes, summed over the tasks', (name, metric) => {
    expect(byName(prod, name)).toMatchObject({
      Namespace: 'VettID/Relay', MetricName: metric, Statistic: 'Sum', Period: 60,
      ComparisonOperator: 'GreaterThanThreshold', Threshold: 0, EvaluationPeriods: 5, DatapointsToAlarm: 3, TreatMissingData: 'notBreaching',
    });
  });

  test('address-busy: the busiest address at half the flood guard for 5 minutes', () => {
    expect(RELAY_ALARM_LIMITS.addressBusiestPerMin).toBe((100 * 60) / 2);
    expect(byName(prod, 'address-busy')).toMatchObject({
      MetricName: 'AddressBusiestPerMin', Statistic: 'Maximum', Period: 60,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: 3000, EvaluationPeriods: 5, DatapointsToAlarm: 5, TreatMissingData: 'notBreaching',
    });
  });

  test.each([
    ['collectors', 'Collectors', RELAY_ALARM_LIMITS.collectorsPerTask, 42],
    ['ws-sessions', 'WsSessions', RELAY_ALARM_LIMITS.wsSessionsPerTask, 45],
  ])('%s: the worst task, at a threshold that is a small part of its memory', (name, metric, limit, kib) => {
    expect(byName(prod, name)).toMatchObject({
      MetricName: metric, Statistic: 'Maximum', Period: 60,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: 2000, EvaluationPeriods: 5, DatapointsToAlarm: 3, TreatMissingData: 'notBreaching',
    });
    // Under a fifth of the task each: both at their thresholds stay under half.
    expect((limit * kib) / 1024).toBeLessThan(RELAY_TASK_MEMORY_MIB / 5);
  });

  test('rate-limits-silent: no line from any task for 5 minutes; missing data is the fault', () => {
    expect(byName(prod, 'rate-limits-silent')).toMatchObject({
      MetricName: 'Collectors', Statistic: 'SampleCount', Period: 300,
      ComparisonOperator: 'LessThanThreshold', Threshold: 1, EvaluationPeriods: 1, TreatMissingData: 'breaching',
    });
    expect(flat(byName(prod, 'rate-limits-silent').OKActions)).toMatch(TOPIC);
  });

  // The table's own metrics (AWS/DynamoDB), by the table name the data stack publishes.
  const TABLE = { Name: 'TableName', Value: { Ref: expect.stringMatching(/^SsmParameterValuevettidorgprodrelaytablename/) } };

  test.each([
    ['table-writes-high', 'ConsumedWriteCapacityUnits', RELAY_ALARM_LIMITS.tableWritesBusyPerSecond, RELAY_TABLE_LIMITS.maxWriteRequestUnits],
    ['table-reads-high', 'ConsumedReadCapacityUnits', RELAY_ALARM_LIMITS.tableReadsBusyPerSecond, RELAY_TABLE_LIMITS.maxReadRequestUnits],
  ])('%s: a fixed rate for 5 minutes, well below the table\'s ceiling', (name, metric, perSecond, ceiling) => {
    // 1,000 a second, not a share of the ceiling: raising the write ceiling
    // to 10,000 must not make a flood five times bigger before anyone hears.
    expect(perSecond).toBe(1000);
    expect(perSecond).toBeLessThanOrEqual(ceiling / 2);
    expect(byName(prod, name)).toMatchObject({
      Namespace: 'AWS/DynamoDB', MetricName: metric, Dimensions: [TABLE], Statistic: 'Sum', Period: 60,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: perSecond * 60, EvaluationPeriods: 5, DatapointsToAlarm: 5, TreatMissingData: 'notBreaching',
    });
  });

  test('table-write-volume: an hour of writes far above the measured use and far below the ceiling', () => {
    expect(byName(prod, 'table-write-volume')).toMatchObject({
      Namespace: 'AWS/DynamoDB', MetricName: 'ConsumedWriteCapacityUnits', Dimensions: [TABLE], Statistic: 'Sum', Period: 3600,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: RELAY_ALARM_LIMITS.tableWriteUnitsPerHour, EvaluationPeriods: 1, TreatMissingData: 'notBreaching',
    });
    const perSecond = RELAY_ALARM_LIMITS.tableWriteUnitsPerHour / 3600;
    expect(perSecond).toBeGreaterThan(10 * (5486 / 3600)); // the busiest hour measured (2026-10)
    expect(perSecond).toBeLessThanOrEqual(RELAY_TABLE_LIMITS.maxWriteRequestUnits / 10);
  });

  test('table-throttled: any throttling of the table or its index in 3 of 5 minutes; a metric without data counts as 0', () => {
    const a = byName(prod, 'table-throttled');
    expect(a).toMatchObject({ ComparisonOperator: 'GreaterThanThreshold', Threshold: 0, EvaluationPeriods: 5, DatapointsToAlarm: 3, TreatMissingData: 'notBreaching' });
    const expr = a.Metrics.filter((m: any) => m.Expression);
    expect(expr).toEqual([expect.objectContaining({ Expression: 'FILL(tw, 0) + FILL(tr, 0) + FILL(iw, 0) + FILL(ir, 0) + FILL(tx, 0)', ReturnData: true })]);
    const INDEX = { Name: 'GlobalSecondaryIndexName', Value: 'due' };
    const read = Object.fromEntries(
      a.Metrics.filter((m: any) => m.MetricStat).map((m: any) => {
        expect(m.MetricStat).toMatchObject({ Period: 60, Stat: 'Sum', Metric: { Namespace: 'AWS/DynamoDB' } });
        return [m.Id, [m.MetricStat.Metric.MetricName, m.MetricStat.Metric.Dimensions]];
      }),
    );
    expect(read).toEqual({
      tw: ['WriteThrottleEvents', [TABLE]],
      tr: ['ReadThrottleEvents', [TABLE]],
      iw: ['WriteThrottleEvents', [INDEX, TABLE]],
      ir: ['ReadThrottleEvents', [INDEX, TABLE]],
      tx: ['ThrottledRequests', [{ Name: 'Operation', Value: 'TransactWriteItems' }, TABLE]],
    });
  });

  // ElastiCache Serverless metrics, by the cache's name.
  const CACHE = [{ Name: 'clusterId', Value: 'vettid-org-relay' }];

  test('valkey-storage: 75 % of the 1 GB limit (where eviction starts) in 3 of 5 minutes', () => {
    expect(RELAY_VALKEY_LIMITS).toEqual({ dataStorageGb: 1, ecpuPerSecond: 100000, alarmShare: 0.75 });
    expect(byName(prod, 'valkey-storage')).toMatchObject({
      Namespace: 'AWS/ElastiCache', MetricName: 'BytesUsedForCache', Dimensions: CACHE, Statistic: 'Maximum', Period: 60,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: 750_000_000, EvaluationPeriods: 5, DatapointsToAlarm: 3, TreatMissingData: 'notBreaching',
    });
    // The alarm and the cache's own limit come from the same numbers.
    t.hasResourceProperties('AWS::ElastiCache::ServerlessCache', {
      CacheUsageLimits: { DataStorage: { Maximum: 1, Unit: 'GB' }, ECPUPerSecond: { Maximum: 100000 } },
    });
  });

  test('valkey-ecpu: 75 % of 100,000 ECPU a second, as a one-minute sum, in 3 of 5 minutes', () => {
    expect(byName(prod, 'valkey-ecpu')).toMatchObject({
      Namespace: 'AWS/ElastiCache', MetricName: 'ElastiCacheProcessingUnits', Dimensions: CACHE, Statistic: 'Sum', Period: 60,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: 0.75 * 100000 * 60, EvaluationPeriods: 5, DatapointsToAlarm: 3, TreatMissingData: 'notBreaching',
    });
  });

  test('valkey-evictions: any eviction', () => {
    expect(byName(prod, 'valkey-evictions')).toMatchObject({
      Namespace: 'AWS/ElastiCache', MetricName: 'Evictions', Dimensions: CACHE, Statistic: 'Sum', Period: 60,
      ComparisonOperator: 'GreaterThanThreshold', Threshold: 0, EvaluationPeriods: 1, TreatMissingData: 'notBreaching',
    });
  });

  test('valkey-errors: any throttled command, throttled IAM authentication or authorization failure', () => {
    const a = byName(prod, 'valkey-errors');
    expect(a).toMatchObject({ ComparisonOperator: 'GreaterThanThreshold', Threshold: 0, EvaluationPeriods: 1, TreatMissingData: 'notBreaching' });
    expect(a.Metrics.filter((m: any) => m.Expression)).toEqual([
      expect.objectContaining({ Expression: 'FILL(thr, 0) + FILL(iam, 0) + FILL(cmd, 0) + FILL(key, 0) + FILL(chan, 0)', ReturnData: true }),
    ]);
    const read = Object.fromEntries(
      a.Metrics.filter((m: any) => m.MetricStat).map((m: any) => {
        expect(m.MetricStat).toMatchObject({ Period: 60, Stat: 'Sum', Metric: { Namespace: 'AWS/ElastiCache', Dimensions: CACHE } });
        return [m.Id, m.MetricStat.Metric.MetricName];
      }),
    );
    expect(read).toEqual({
      thr: 'ThrottledCmds',
      iam: 'IamAuthenticationThrottling',
      cmd: 'CommandAuthorizationFailures',
      key: 'KeyAuthorizationFailures',
      chan: 'ChannelAuthorizationFailures',
    });
  });

  test('log-volume: 500 MB a day ingested by the service log and the flow log together', () => {
    expect(RELAY_LOG_INGEST_BYTES_PER_DAY).toBe(500_000_000);
    const a = byName(prod, 'log-volume');
    expect(a).toMatchObject({ ComparisonOperator: 'GreaterThanOrEqualToThreshold', Threshold: 500_000_000, EvaluationPeriods: 1, TreatMissingData: 'notBreaching' });
    expect(a.Metrics.filter((m: any) => m.Expression)).toEqual([expect.objectContaining({ Expression: 'FILL(svc, 0) + FILL(flow, 0)', ReturnData: true })]);
    const groups = Object.fromEntries(
      a.Metrics.filter((m: any) => m.MetricStat).map((m: any) => {
        expect(m.MetricStat).toMatchObject({ Period: 86400, Stat: 'Sum', Metric: { Namespace: 'AWS/Logs', MetricName: 'IncomingBytes' } });
        return [m.Id, m.MetricStat.Metric.Dimensions[0].Value.Ref];
      }),
    );
    expect(groups.svc).toMatch(/^ServiceLogs/);
    expect(groups.flow).toMatch(/^FlowLogs/);
  });

  test('every alarm notifies the security-alerts topic of the management account; no topic of its own', () => {
    const all = alarmsOf(prod);
    expect(all.map((a) => a.AlarmName).sort()).toEqual(
      [
        'address-busy', 'address-refused', 'collectors', 'key-refused', 'log-volume', 'rate-limits-silent', 'register-refused',
        'table-reads-high', 'table-throttled', 'table-write-volume', 'table-writes-high',
        'valkey-ecpu', 'valkey-errors', 'valkey-evictions', 'valkey-storage', 'waf-rate-limit', 'ws-sessions',
      ].map((n) => `vettid-org-relay-${n}`),
    );
    for (const a of all) {
      expect(a.AlarmActions).toHaveLength(1);
      expect(flat(a.AlarmActions)).toMatch(TOPIC);
      expect(a.AlarmDescription).toContain('RUNBOOK "Relay"');
    }
    prod.resourceCountIs('AWS::SNS::Topic', 0);
    prod.resourceCountIs('AWS::SNS::TopicPolicy', 0);
  });

  test('anywhere else the alarms exist without an action (the topic is the management account\'s)', () => {
    const all = alarmsOf(t);
    expect(all).toHaveLength(17);
    for (const a of all) expect(a.AlarmActions).toBeUndefined();
  });

  test('the alarms change nothing else: one task definition, one service, the same log group', () => {
    prod.resourceCountIs('AWS::ECS::TaskDefinition', 1);
    prod.resourceCountIs('AWS::ECS::Service', 1);
    prod.resourceCountIs('AWS::Logs::LogGroup', 2); // the service log and the VPC flow log
    expect(Object.values<any>(t.findResources('AWS::ECS::TaskDefinition'))[0].Properties.Memory).toBe(String(RELAY_TASK_MEMORY_MIB));
  });
});

describe('edge: WAF, deletion protection, no access log, flow log', () => {
  test('a regional web ACL on the relay ALB: one rate-based rule, 60,000 requests per 5 minutes per source IP', () => {
    expect(RELAY_WAF_RATE_LIMIT).toMatchObject({ requests: 60000, windowSeconds: 300, retryAfterSeconds: 60 });
    const acls = Object.values<any>(t.findResources('AWS::WAFv2::WebACL')).map((a) => a.Properties);
    expect(acls).toHaveLength(1);
    const acl = acls[0];
    expect(acl).toMatchObject({ Name: 'vettid-org-relay', Scope: 'REGIONAL', DefaultAction: { Allow: {} } });
    expect(acl.Rules).toHaveLength(1);
    expect(acl.Rules[0]).toMatchObject({
      Name: 'rate-limit-per-ip',
      Statement: { RateBasedStatement: { Limit: 60000, EvaluationWindowSec: 300, AggregateKeyType: 'IP' } },
      VisibilityConfig: { CloudWatchMetricsEnabled: true, MetricName: 'vettid-org-relay-rate-limit', SampledRequestsEnabled: true },
    });
    expect(acl.Rules[0].Statement.RateBasedStatement.ScopeDownStatement).toBeUndefined();
    // The relay's own error body (RELAY-PROTOCOL §7.1), ready for block mode.
    expect(JSON.parse(acl.CustomResponseBodies['rate-limited'].Content)).toEqual({ code: 'rate_limited', message: expect.stringContaining('at least'), retry_after: 60 });
    // Attached to the stack's load balancer.
    const assoc = Object.values<any>(t.findResources('AWS::WAFv2::WebACLAssociation')).map((a) => a.Properties);
    expect(assoc).toHaveLength(1);
    expect(assoc[0].ResourceArn).toEqual({ Ref: expect.stringMatching(/^Alb/) });
    expect(assoc[0].WebACLArn).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^WebAcl/), 'Arn'] });
  });

  test('the rule deploys in COUNT mode: it blocks nothing until switched to block', () => {
    expect(RELAY_WAF_RATE_LIMIT.mode).toBe('count');
    const acl = Object.values<any>(t.findResources('AWS::WAFv2::WebACL'))[0].Properties;
    expect(acl.Rules[0].Action).toEqual({ Count: {} });
  });

  test('block mode answers 429 with the relay\'s body and Retry-After (a minimum)', () => {
    const blockApp = new cdk.App();
    const saved = RELAY_WAF_RATE_LIMIT.mode;
    (RELAY_WAF_RATE_LIMIT as { mode: string }).mode = 'block';
    try {
      const b = Template.fromStack(new VettidOrgRelayStack(blockApp, 'RelayBlock', { config: loadConfig(blockApp.node), relayImage: 'ghcr.io/vettid/vettid-relay@sha256:' + 'a'.repeat(64), env }));
      const rule = Object.values<any>(b.findResources('AWS::WAFv2::WebACL'))[0].Properties.Rules[0];
      expect(rule.Action).toEqual({
        Block: {
          CustomResponse: {
            ResponseCode: 429,
            CustomResponseBodyKey: 'rate-limited',
            ResponseHeaders: [{ Name: 'Retry-After', Value: '60' }, { Name: 'Cache-Control', Value: 'no-store' }],
          },
        },
      });
      const a = Object.values<any>(b.findResources('AWS::CloudWatch::Alarm')).map((x) => x.Properties).find((x) => x.AlarmName === 'vettid-org-relay-waf-rate-limit');
      expect(a.MetricName).toBe('BlockedRequests');
    } finally {
      (RELAY_WAF_RATE_LIMIT as { mode: string }).mode = saved;
    }
  });

  test('waf-rate-limit: any request the rule counts (count mode), by the ACL, region and rule metric', () => {
    const a = Object.values<any>(t.findResources('AWS::CloudWatch::Alarm')).map((x) => x.Properties).find((x) => x.AlarmName === 'vettid-org-relay-waf-rate-limit');
    expect(a).toMatchObject({
      Namespace: 'AWS/WAFV2', MetricName: 'CountedRequests', Statistic: 'Sum', Period: 300,
      ComparisonOperator: 'GreaterThanThreshold', Threshold: 0, EvaluationPeriods: 1, TreatMissingData: 'notBreaching',
    });
    expect(Object.fromEntries(a.Dimensions.map((d: any) => [d.Name, d.Value]))).toEqual({
      WebACL: 'vettid-org-relay', Region: 'us-east-1', Rule: 'vettid-org-relay-rate-limit',
    });
  });

  test('the WAF limit is twice the flood guard, and a 900-vault host is well under it', () => {
    const perWindow = (perSecond: number) => perSecond * RELAY_WAF_RATE_LIMIT.windowSeconds;
    expect(RELAY_WAF_RATE_LIMIT.requests).toBe(2 * perWindow(100)); // flood guard 100/s (§7.2)
    // §7.2: a host of 900 vaults sends 36/s idle, about 81/s at a message a minute per vault.
    expect(perWindow(81)).toBeLessThan(RELAY_WAF_RATE_LIMIT.requests / 2);
    // Even an address at the flood guard plus its whole burst is not blocked by WAF.
    expect(perWindow(100) + 300).toBeLessThan(RELAY_WAF_RATE_LIMIT.requests);
  });

  test('ALB: deletion protection on, no access log', () => {
    const alb = Object.values<any>(t.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer'))[0].Properties;
    const attrs = Object.fromEntries(alb.LoadBalancerAttributes.map((a: any) => [a.Key, a.Value]));
    expect(attrs['deletion_protection.enabled']).toBe('true');
    // No access log (paths carry mailbox ids) and no connection log: no
    // attribute turns either on, and no bucket exists to receive one.
    const logAttrs = Object.entries(attrs).filter(([k]) => k.startsWith('access_logs.') || k.startsWith('connection_logs.'));
    for (const [k, v] of logAttrs) expect([k, v]).toEqual([k, 'false']);
    t.resourceCountIs('AWS::S3::Bucket', 0);
  });

  test('VPC flow log: rejected traffic only, to CloudWatch Logs kept 30 days', () => {
    const logs = Object.values<any>(t.findResources('AWS::EC2::FlowLog')).map((f) => f.Properties);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ ResourceType: 'VPC', TrafficType: 'REJECT', LogDestinationType: 'cloud-watch-logs' });
    expect(logs[0].ResourceId).toEqual({ Ref: expect.stringMatching(/^Vpc/) });
    expect(logs[0].LogGroupName).toEqual({ Ref: expect.stringMatching(/^FlowLogs/) });
    t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: '/vettid-org/prod/relay-vpc-flow', RetentionInDays: 30 });
    // The role it assumes trusts VPC Flow Logs only for this account's flow logs.
    const roleId = logs[0].DeliverLogsPermissionArn['Fn::GetAtt'][0];
    const trust = t.toJSON().Resources[roleId].Properties.AssumeRolePolicyDocument.Statement;
    expect(trust).toHaveLength(1);
    expect(trust[0]).toMatchObject({
      Principal: { Service: 'vpc-flow-logs.amazonaws.com' },
      Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' }, ArnLike: { 'aws:SourceArn': expect.anything() } },
    });
  });

  test('every log group of the stack has a retention', () => {
    const groups = Object.values<any>(t.findResources('AWS::Logs::LogGroup')).map((g) => g.Properties);
    for (const g of groups) expect(g.RetentionInDays).toBe(30);
  });
});

describe('data (stateful)', () => {
  test('table: on-demand, pk/sk, TTL on ttl_s, KEYS_ONLY "due" index, retained and deletion-protected', () => {
    data.hasResource('AWS::DynamoDB::GlobalTable', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: Match.objectLike({
        TableName: 'vettid-org-relay',
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        TimeToLiveSpecification: { AttributeName: 'ttl_s', Enabled: true },
        GlobalSecondaryIndexes: [
          Match.objectLike({
            IndexName: 'due',
            KeySchema: [
              { AttributeName: 'gpk', KeyType: 'HASH' },
              { AttributeName: 'gsk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'KEYS_ONLY' },
          }),
        ],
        Replicas: [Match.objectLike({ DeletionProtectionEnabled: true })],
      }),
    });
    data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      AttributeDefinitions: Match.arrayWith([{ AttributeName: 'gsk', AttributeType: 'N' }]),
    });
  });

  test('table: a ceiling on on-demand throughput, on the table and on its index', () => {
    const L = RELAY_TABLE_LIMITS;
    data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      WriteOnDemandThroughputSettings: { MaxWriteRequestUnits: L.maxWriteRequestUnits },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'due', WriteOnDemandThroughputSettings: { MaxWriteRequestUnits: L.indexMaxWriteRequestUnits } })],
      Replicas: [
        Match.objectLike({
          ReadOnDemandThroughputSettings: { MaxReadRequestUnits: L.maxReadRequestUnits },
          GlobalSecondaryIndexes: [{ IndexName: 'due', ReadOnDemandThroughputSettings: { MaxReadRequestUnits: L.indexMaxReadRequestUnits } }],
        }),
      ],
    });
    // One address at the whole flood guard (100 requests a second), every
    // request a transactional deposit of 8 KB (4 + 2 × KB write units),
    // stays within the ceiling; so does ten times the busiest minute measured.
    expect(L.maxWriteRequestUnits).toBeGreaterThanOrEqual(100 * (4 + 2 * 8));
    expect(L.maxWriteRequestUnits).toBeGreaterThan(10 * (1634 / 60));
    expect(L.maxReadRequestUnits).toBeGreaterThan(10 * (494 / 60));
    // And far below the account's per-table quota, which was the only bound.
    // One full host or one address at the flood guard (about 2,000 write
    // units a second with collects and acks) is at most a quarter of it.
    expect(L.maxWriteRequestUnits).toBeGreaterThanOrEqual(4 * 2000);
    expect(L.maxWriteRequestUnits).toBeLessThanOrEqual(40000 / 4);
    expect(L.maxReadRequestUnits).toBeLessThanOrEqual(40000 / 10);
    // Still one table, one logical id: an in-place update, never a replacement.
    expect(Object.keys(data.findResources('AWS::DynamoDB::GlobalTable'))).toEqual(['TableCD117FA1']);
  });

  test('blob bucket: private, TLS-only, expires a day after the blob TTL, retained', () => {
    data.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, RestrictPublicBuckets: true }),
        LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 8, Status: 'Enabled' })] },
      }),
    });
    data.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) }),
    });
  });

  test('publishes table name/ARN and bucket name through SSM', () => {
    for (const k of ['table-name', 'table-arn', 'blob-bucket-name']) {
      data.hasResourceProperties('AWS::SSM::Parameter', { Name: `/vettid-org/prod/relay/${k}` });
    }
  });
});
