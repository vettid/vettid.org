import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../lib/config';
import { VettidOrgRelayStack } from '../lib/stacks/relay-stack';

const app = new cdk.App();
const t = Template.fromStack(
  new VettidOrgRelayStack(app, 'Relay', {
    config: loadConfig(app.node),
    relayImage: 'ghcr.io/vettid/vettid-relay@sha256:' + 'a'.repeat(64),
    litestreamImage: 'litestream/litestream@sha256:' + 'b'.repeat(64),
    env: { account: '123456789012', region: 'us-east-1' },
  }),
);

test('exactly one task, and deploys never overlap (single SQLite writer)', () => {
  t.hasResourceProperties('AWS::ECS::Service', {
    DesiredCount: 1,
    DeploymentConfiguration: Match.objectLike({
      MinimumHealthyPercent: 0,
      MaximumPercent: 100,
      DeploymentCircuitBreaker: { Enable: true, Rollback: true },
    }),
  });
});

test('restore runs to completion before the relay; replication starts once the relay is healthy', () => {
  const td = Object.values<any>(t.findResources('AWS::ECS::TaskDefinition'))[0].Properties;
  const byName = Object.fromEntries(td.ContainerDefinitions.map((c: any) => [c.Name, c]));
  expect(byName.Restore.Essential).toBe(false);
  expect(byName.Restore.EntryPoint).toEqual(['/bin/sh', '-c']);
  const restoreCmd = JSON.stringify(byName.Restore.Command[0]); // Fn::Join with the bucket ref
  expect(restoreCmd).toContain('litestream restore -if-db-not-exists -if-replica-exists -integrity-check quick -o /data/relay.db s3://');
  expect(restoreCmd).toContain('&& chown -R 65532:65532 /data');
  expect(byName.Replicate.User).toBe('65532:65532');
  expect(byName.Relay.DependsOn).toEqual([{ ContainerName: 'Restore', Condition: 'SUCCESS' }]);
  expect(byName.Relay.HealthCheck.Command).toEqual(['CMD', '/relay', '-healthcheck']);
  expect(byName.Replicate.DependsOn).toEqual([{ ContainerName: 'Relay', Condition: 'HEALTHY' }]);
  expect(byName.Relay.Image).toMatch(/@sha256:[0-9a-f]{64}$/);
  expect(byName.Relay.Environment).toEqual(expect.arrayContaining([{ Name: 'RELAY_BASE_URL', Value: 'https://relay.vettid.org' }, { Name: 'RELAY_TRUST_PROXY', Value: 'true' }]));
});

test('task accepts traffic only from the ALB; no NAT gateways', () => {
  const sgs = Object.values<any>(t.findResources('AWS::EC2::SecurityGroupIngress'));
  const toTask = sgs.filter((s) => s.Properties.FromPort === 8080);
  expect(toTask).toHaveLength(1);
  expect(toTask[0].Properties.SourceSecurityGroupId).toBeDefined();
  t.resourceCountIs('AWS::EC2::NatGateway', 0);
});

test('ALB: post-quantum TLS policy, HTTP→HTTPS redirect, idle timeout above the 25 s long-poll', () => {
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 443, SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09' });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    Port: 80,
    DefaultActions: [Match.objectLike({ Type: 'redirect' })],
  });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    LoadBalancerAttributes: Match.arrayWith([{ Key: 'idle_timeout.timeout_seconds', Value: '75' }]),
  });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { HealthCheckPath: '/healthz' });
});

test('replica bucket is private, TLS-only, versioned and retained', () => {
  t.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({ VersioningConfiguration: { Status: 'Enabled' } }),
  });
});
