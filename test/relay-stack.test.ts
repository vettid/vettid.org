import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../lib/config';
import { VettidOrgRelayStack, RELAY_ALARM_LIMITS, RELAY_MAX_TASKS, RELAY_MIN_TASKS, RELAY_TASK_MEMORY_MIB } from '../lib/stacks/relay-stack';
import { VettidOrgRelayDataStack } from '../lib/stacks/relay-data-stack';

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
    expect(groups.map((g) => g.Properties.LogGroupName)).toEqual(['/vettid-org/prod/relay-service']);
    expect(groups[0].DeletionPolicy).toBe('Retain');
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

  test('every alarm notifies the security-alerts topic of the management account; no topic of its own', () => {
    const all = alarmsOf(prod);
    expect(all.map((a) => a.AlarmName).sort()).toEqual(
      ['address-busy', 'address-refused', 'collectors', 'key-refused', 'rate-limits-silent', 'register-refused', 'ws-sessions'].map((n) => `vettid-org-relay-${n}`),
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
    expect(all).toHaveLength(7);
    for (const a of all) expect(a.AlarmActions).toBeUndefined();
  });

  test('the alarms change nothing else: one task definition, one service, the same log group', () => {
    prod.resourceCountIs('AWS::ECS::TaskDefinition', 1);
    prod.resourceCountIs('AWS::ECS::Service', 1);
    prod.resourceCountIs('AWS::Logs::LogGroup', 1);
    expect(Object.values<any>(t.findResources('AWS::ECS::TaskDefinition'))[0].Properties.Memory).toBe(String(RELAY_TASK_MEMORY_MIB));
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
