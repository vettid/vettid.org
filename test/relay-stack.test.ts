import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../lib/config';
import { VettidOrgRelayStack, RELAY_MAX_TASKS, RELAY_MIN_TASKS } from '../lib/stacks/relay-stack';
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
      CacheUsageLimits: Match.objectLike({ ECPUPerSecond: { Maximum: 50000 } }),
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

  test('the Litestream-era replica bucket and the log group are kept and retained', () => {
    t.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ VersioningConfiguration: { Status: 'Enabled' } }),
    });
    t.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ LogGroupName: '/vettid-org/prod/relay' }) });
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
