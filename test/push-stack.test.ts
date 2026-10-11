import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';
import { loadConfig, stagePushZoneNs } from '../lib/config';
import { OWNER_PERMISSION_SET } from '../lib/constructs/owner-trust';
import { PUSH_ATTESTATION_FAILURES_PER_HOUR, PUSH_TASKS, VettidOrgPushStack } from '../lib/stacks/push-stack';
import { PUSH_KEY_ALIAS, VettidOrgPushDataStack, pushSecretsRead } from '../lib/stacks/push-data-stack';
import { vaultHostDnsAllowlist } from '../lib/vault/egress';

/**
 * The push gateways (PUSH-GATEWAY §10): VettidOrgPushDataStack (key, log
 * groups, the staging zone, alarm topic; the secrets are the operator's,
 * no stack creates them), VettidOrgPushStack (one Fargate service per
 * channel behind the relay's load balancer) and, in the staging app, the
 * delegation of push.staging.vettid.org.
 */

const MAIN = '449757308783';
const STAGING_ACCOUNT = '347272280361';
const env = { account: MAIN, region: 'us-east-1' };
const IMAGE = 'ghcr.io/vettid/vettid-push@sha256:' + 'b'.repeat(64);
const IMAGE2 = 'ghcr.io/vettid/vettid-push@sha256:' + 'c'.repeat(64);
const RELAY_IMAGE = 'ghcr.io/vettid/vettid-relay@sha256:' + 'a'.repeat(64);
const NS = ['ns-1.awsdns-01.org', 'ns-2.awsdns-02.co.uk', 'ns-3.awsdns-03.com', 'ns-4.awsdns-04.net'];

const str = (x: unknown) => JSON.stringify(x);
const of = (json: any, type: string): any[] => Object.values<any>(json.Resources ?? {}).filter((r) => r.Type === type);
const entries = (json: any, type: string): [string, any][] => Object.entries<any>(json.Resources ?? {}).filter(([, r]) => r.Type === type);
const cfg = (context: Record<string, unknown>) => loadConfig(new cdk.App({ context }).node);

/** The two stacks, built directly (no other stack of the app). */
function stacks(context: Record<string, unknown>) {
  const app = new cdk.App({ context });
  const config = loadConfig(app.node);
  const dataStack = new VettidOrgPushDataStack(app, 'PushData', { config, env });
  const pushStack = config.push.gateways.some((g) => g.image) ? new VettidOrgPushStack(app, 'Push', { config, env }) : undefined;
  const data = Template.fromStack(dataStack).toJSON();
  const push = pushStack ? Template.fromStack(pushStack).toJSON() : undefined;
  return { data, push: push as any };
}

// Staging first, FCM only, production absent: the first deployment.
const stagingOnly = stacks({ pushStages: 'staging', stagingPushImage: IMAGE, stagingPushPlatforms: 'fcm' });
// Later: both channels, production with both platforms and its own image.
const both = stacks({
  pushStages: 'staging,prod', stagingPushImage: IMAGE, stagingPushPlatforms: 'fcm',
  pushImage: IMAGE2, pushPlatforms: 'fcm,apns', pushFcmProject: 'vettid-prod',
});

const container = (json: any, family: string) => {
  const td = of(json, 'AWS::ECS::TaskDefinition').find((t) => t.Properties.Family === family).Properties;
  expect(td.ContainerDefinitions).toHaveLength(1);
  return { td, c: td.ContainerDefinitions[0], env: Object.fromEntries(td.ContainerDefinitions[0].Environment.map((e: any) => [e.Name, e.Value])) };
};
/** ARNs as IAM will see them: `Fn::Join` with the partition resolved. */
const arns = (x: unknown): string[] =>
  [x].flat().map((a: any) => (typeof a === 'string' ? a : a['Fn::Join'][1].map((p: any) => (typeof p === 'string' ? p : p.Ref === 'AWS::Partition' ? 'aws' : `<${str(p)}>`)).join('')));
const policyOf = (json: any, roleName: string) => {
  const [roleId] = entries(json, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === roleName)!;
  return of(json, 'AWS::IAM::Policy').filter((p) => str(p.Properties.Roles).includes(roleId)).flatMap((p) => p.Properties.PolicyDocument.Statement);
};

describe('context', () => {
  test('no pushStages: no gateway; a staging app never has one', () => {
    expect(cfg({}).push.gateways).toEqual([]);
    expect(cfg({ stage: 'staging', pushStages: 'staging', stagingPushImage: IMAGE }).push.gateways).toEqual([]);
  });

  test('a channel is listed before it has an image; platforms default to none', () => {
    expect(cfg({ pushStages: 'staging' }).push.gateways).toEqual([
      {
        channel: 'staging', host: 'push.staging.vettid.org', image: '', platforms: [],
        fcmAppIds: ['com.vettid.app'], apnsAppIds: ['com.vettid.app.staging'], fcmProject: '',
      },
    ]);
    const g = cfg({ pushStages: ['prod', 'staging'], pushImage: IMAGE, pushPlatforms: 'apns, fcm' }).push.gateways;
    expect(g.map((x) => [x.channel, x.host, x.image, x.platforms, x.apnsAppIds])).toEqual([
      ['prod', 'push.vettid.org', IMAGE, ['apns', 'fcm'], ['com.vettid.app']],
      ['staging', 'push.staging.vettid.org', '', [], ['com.vettid.app.staging']],
    ]);
  });

  test('the gateway host is the one the channel\'s vault hosts may reach', () => {
    for (const channel of ['prod', 'staging'] as const) {
      const stageConfig = cfg({ stage: channel });
      const host = cfg({ pushStages: channel }).push.gateways[0].host;
      expect(host).toBe(stageConfig.vault!.pushHost);
      expect(vaultHostDnsAllowlist(stageConfig, stageConfig.vault!)).toContain(host);
    }
  });

  test('refused: an image by tag, an unknown stage or platform, a setting for an unlisted channel', () => {
    expect(() => cfg({ pushStages: 'staging', stagingPushImage: 'ghcr.io/vettid/vettid-push:latest' })).toThrow(/pinned by digest/);
    expect(() => cfg({ pushStages: 'dev' })).toThrow(/pushStages/);
    expect(() => cfg({ pushStages: 'staging', stagingPushPlatforms: 'fcm,webpush' })).toThrow(/stagingPushPlatforms/);
    expect(() => cfg({ pushStages: 'staging', pushImage: IMAGE })).toThrow(/pushImage is set but pushStages does not list "prod"/);
    expect(() => cfg({ stagingPushImage: IMAGE })).toThrow(/does not list "staging"/);
    expect(() => cfg({ pushStages: 'prod', pushFcmProject: 'Not A Project' })).toThrow(/pushFcmProject/);
  });

  test('the delegation\'s name servers: four Route 53 names or nothing', () => {
    const node = (context: Record<string, unknown>) => new cdk.App({ context }).node;
    expect(stagePushZoneNs(node({}), 'staging')).toEqual([]);
    expect(stagePushZoneNs(node({ stagingPushZoneNs: NS.join(',') }), 'staging')).toEqual(NS);
    expect(() => stagePushZoneNs(node({ stagingPushZoneNs: 'ns1.example.com' }), 'staging')).toThrow(/push\.staging\.vettid\.org/);
  });
});

describe('data stack (stateful)', () => {
  test('no stack creates a secret, and no secret value is in any template', () => {
    // CloudFormation cannot create a secret under the key (CreateSecret
    // needs kms:Decrypt for its caller, which no deployment role has): the
    // operator creates them, and the stacks name them.
    for (const json of [stagingOnly.data, stagingOnly.push, both.data, both.push, stacks({ pushStages: 'prod', pushImage: IMAGE2 }).push]) {
      const types = Object.values<any>(json.Resources).map((r) => r.Type as string);
      expect(types.filter((x) => x.startsWith('AWS::SecretsManager::'))).toEqual([]);
      const text = str(json);
      expect(text).not.toMatch(/SecretString|GenerateSecretString|resolve:secretsmanager|resolve:ssm-secure|BEGIN [A-Z ]*PRIVATE KEY|private_key/);
      // The task definition takes no secret from the execution role either.
      for (const td of of(json, 'AWS::ECS::TaskDefinition')) expect(td.Properties.ContainerDefinitions[0].Secrets).toBeUndefined();
    }
  });

  test('a channel that is not listed has no log group or service', () => {
    // (The key policy names both channels from the start; nothing else of production exists.)
    expect(of(stagingOnly.data, 'AWS::Logs::LogGroup').map((g) => g.Properties.LogGroupName)).toEqual(['/vettid-org/staging/push-service']);
    expect(Object.values<any>(stagingOnly.data.Resources).map((r) => r.Type).sort()).toEqual([
      'AWS::KMS::Alias', 'AWS::KMS::Key', 'AWS::Logs::LogGroup', 'AWS::Route53::HostedZone', 'AWS::Route53::RecordSet',
      'AWS::SNS::Subscription', 'AWS::SNS::Topic', 'AWS::SSM::Parameter', 'AWS::SSM::Parameter',
    ]);
  });

  test('the key: alias/vettid-org-push, retained, rotating; Decrypt only for the two task roles and the owner, who alone can write', () => {
    expect(of(stagingOnly.data, 'AWS::KMS::Alias').map((a) => a.Properties.AliasName)).toEqual([PUSH_KEY_ALIAS]);
    expect(PUSH_KEY_ALIAS).toBe('alias/vettid-org-push');
    const key = of(stagingOnly.data, 'AWS::KMS::Key')[0];
    expect(key.DeletionPolicy).toBe('Retain');
    expect(key.Properties.EnableKeyRotation).toBe(true);
    const statements: any[] = key.Properties.KeyPolicy.Statement;
    for (const s of statements) expect(s.Effect).toBe('Allow');

    const actions = (s: any): string[] => [s.Action].flat();
    const admin = statements.find((s) => s.Sid === 'AdministerButNotDecrypt');
    // Nothing that reads, and nothing that could hand reading to another principal.
    for (const a of actions(admin)) {
      expect(a).not.toMatch(/^kms:(\*|Decrypt|Encrypt|ReEncrypt|GenerateDataKey|CreateGrant|Create\*)/);
    }
    expect(admin.Condition).toBeUndefined();

    // Every cryptographic action of the policy, by statement: nothing but these.
    const crypto = statements.filter((s) => actions(s).some((a) => /^kms:(\*|Decrypt|Encrypt|ReEncrypt|GenerateDataKey|CreateGrant)/.test(a)));
    expect(crypto.map((s) => [s.Sid, actions(s)]).sort()).toEqual([
      ['GatewayProdDecrypts', ['kms:Decrypt']],
      ['GatewayStagingDecrypts', ['kms:Decrypt']],
      ['OwnerWritesAndReadsSecrets', ['kms:GenerateDataKey', 'kms:Decrypt']],
    ]);
    for (const s of crypto) {
      // Through Secrets Manager only, and never for the account as a whole:
      // each names one role (a deployment role matches none of them).
      expect(s.Condition.StringEquals).toEqual({ 'kms:ViaService': 'secretsmanager.us-east-1.amazonaws.com' });
      expect(s.Principal).toEqual({ AWS: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:iam::${MAIN}:root`]] } });
      expect(Object.keys({ ...s.Condition.ArnLike, ...s.Condition.ArnEquals })).toEqual(['aws:PrincipalArn']);
    }
    const by = Object.fromEntries(crypto.map((s) => [s.Sid, s]));
    // The owner creates and rotates the secrets: CreateSecret and
    // PutSecretValue need a data key and Decrypt for their caller. The
    // owner's statement has no encryption-context condition (both channels).
    expect(by.OwnerWritesAndReadsSecrets.Condition).toEqual({
      StringEquals: { 'kms:ViaService': 'secretsmanager.us-east-1.amazonaws.com' },
      ArnLike: { 'aws:PrincipalArn': `arn:aws:iam::${MAIN}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_${OWNER_PERMISSION_SET}_*` },
    });
    // Each gateway: its own role, and only its own channel's secrets, by
    // the name prefix in the secret's ARN (whoever created the secret).
    for (const [sid, role, channel] of [['GatewayProdDecrypts', 'vettid-org-push-gateway', 'prod'], ['GatewayStagingDecrypts', 'vettid-org-staging-push-gateway', 'staging']]) {
      expect(str(by[sid].Condition.ArnEquals['aws:PrincipalArn'])).toContain(`:iam::${MAIN}:role/${role}"`);
      expect(str(by[sid].Condition.StringLike['kms:EncryptionContext:SecretARN'])).toContain(`:secretsmanager:us-east-1:${MAIN}:secret:vettid-org/${channel}/push/*`);
    }
    expect(statements.map((s) => s.Sid)).toEqual(['AdministerButNotDecrypt', 'OwnerWritesAndReadsSecrets', 'GatewayProdDecrypts', 'GatewayStagingDecrypts']);
    // The policy is the same whichever channels are listed: adding production never touches the key.
    expect(of(both.data, 'AWS::KMS::Key')[0]).toEqual(key);
  });

  test('log group per channel: /vettid-org/<stage>/push-service, 14 days, retained', () => {
    expect(of(both.data, 'AWS::Logs::LogGroup').map((g) => [g.Properties.LogGroupName, g.Properties.RetentionInDays, g.DeletionPolicy]).sort()).toEqual([
      ['/vettid-org/prod/push-service', 14, 'Retain'],
      ['/vettid-org/staging/push-service', 14, 'Retain'],
    ]);
  });

  test('staging: the zone push.staging.vettid.org (retained, Amazon-only CAA), its id through SSM, its name servers as an output', () => {
    const zones = of(stagingOnly.data, 'AWS::Route53::HostedZone');
    expect(zones.map((z) => [z.Properties.Name, z.DeletionPolicy])).toEqual([['push.staging.vettid.org.', 'Retain']]);
    const records = of(stagingOnly.data, 'AWS::Route53::RecordSet');
    expect(records.map((r) => [r.Properties.Type, r.Properties.Name])).toEqual([['CAA', 'push.staging.vettid.org.']]);
    expect(records[0].Properties.ResourceRecords).toEqual(expect.arrayContaining(['0 issue "amazon.com"', '0 issuewild ";"']));
    expect(of(stagingOnly.data, 'AWS::SSM::Parameter').map((p) => p.Properties.Name).sort()).toEqual([
      '/vettid-org/prod/push/key-arn', '/vettid-org/prod/push/staging-zone-id',
    ]);
    expect(stagingOnly.data.Outputs.StagingZoneNameServers).toBeDefined();
    // Production's host is a record in vettid.org itself: no zone for it.
    const prodOnly = stacks({ pushStages: 'prod' });
    expect(of(prodOnly.data, 'AWS::Route53::HostedZone')).toHaveLength(0);
    expect(prodOnly.push).toBeUndefined();
  });

  test('alarm topic: vettid-org-push-alerts, emailed to the admin address, no custom policy', () => {
    expect(of(stagingOnly.data, 'AWS::SNS::Topic').map((t) => t.Properties.TopicName)).toEqual(['vettid-org-push-alerts']);
    expect(of(stagingOnly.data, 'AWS::SNS::Subscription').map((s) => [s.Properties.Protocol, s.Properties.Endpoint])).toEqual([['email', 'admin@vettid.org']]);
    // The default access policy is what lets CloudWatch alarms publish.
    expect(of(stagingOnly.data, 'AWS::SNS::TopicPolicy')).toHaveLength(0);
  });
});

describe('service stack: staging only (the first deployment)', () => {
  const t = stagingOnly.push;

  test('one service, production\'s absent', () => {
    expect(of(t, 'AWS::ECS::Service').map((s) => s.Properties.ServiceName)).toEqual(['vettid-org-staging-push']);
    expect(str(t)).not.toContain('push.vettid.org');
    expect(str(t.Resources)).not.toContain('vettid-org/prod/');
    expect(str(t)).not.toContain('vettid-org-push-gateway');
    // No lookup of vettid.org either: the staging host lives in its own zone.
    expect(str(t)).not.toContain('DUMMY');
  });

  test('two tasks in the relay\'s cluster and subnets, rolling deploys with the circuit breaker', () => {
    const svc = of(t, 'AWS::ECS::Service')[0].Properties;
    expect(svc).toMatchObject({
      Cluster: 'vettid-org-relay',
      DesiredCount: PUSH_TASKS,
      LaunchType: 'FARGATE',
      AvailabilityZoneRebalancing: 'ENABLED',
      EnableExecuteCommand: false,
      DeploymentConfiguration: { MinimumHealthyPercent: 100, MaximumPercent: 200, DeploymentCircuitBreaker: { Enable: true, Rollback: true } },
    });
    expect(PUSH_TASKS).toBe(2);
    const net = svc.NetworkConfiguration.AwsvpcConfiguration;
    expect(net.Subnets).toHaveLength(2);
    expect(str(net.Subnets)).toContain('SsmParameterValuevettidorgprodrelaypublicsubnetids');
    expect(net.SecurityGroups).toHaveLength(1);
    // Shared things come from SSM, never from CloudFormation exports, and none is created here.
    expect(str(t)).not.toContain('Fn::ImportValue');
    for (const type of ['AWS::EC2::VPC', 'AWS::ECS::Cluster', 'AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::ElasticLoadBalancingV2::Listener', 'AWS::KMS::Key', 'AWS::Logs::LogGroup']) {
      expect(of(t, type)).toHaveLength(0);
    }
  });

  test('container: the runtime contract (port 8080, health check, read-only root, digest-pinned, 0.25 vCPU / 0.5 GB)', () => {
    const { td, c, env: e } = container(t, 'vettid-org-staging-push');
    expect(td).toMatchObject({ Cpu: '256', Memory: '512', NetworkMode: 'awsvpc', RequiresCompatibilities: ['FARGATE'] });
    expect(c.Image).toBe(IMAGE);
    expect(c.Image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(c.ReadonlyRootFilesystem).toBe(true);
    expect(c.PortMappings).toEqual([expect.objectContaining({ ContainerPort: 8080 })]);
    expect(c.HealthCheck.Command).toEqual(['CMD', '/vettid-push', '-healthcheck']);
    expect(c.LogConfiguration.Options).toMatchObject({ 'awslogs-group': '/vettid-org/staging/push-service', 'awslogs-stream-prefix': 'push' });
    expect(e).toEqual({
      PUSH_CHANNEL: 'staging',
      PUSH_LISTEN_ADDR: ':8080',
      PUSH_TRUST_PROXY: 'true',
      PUSH_PLATFORMS: 'fcm',
      PUSH_FCM_APP_IDS: 'com.vettid.app',
      PUSH_APNS_APP_IDS: 'com.vettid.app.staging',
      PUSH_SECRETS: 'aws',
      PUSH_SECRET_PREFIX: 'vettid-org/staging/push',
      PUSH_METRICS_NAMESPACE: 'vettid-org/staging/push',
      AWS_REGION: 'us-east-1',
    });
  });

  test('a gateway before any credential: PUSH_PLATFORMS is set and empty, and only the blob keys are readable', () => {
    const none = stacks({ pushStages: 'staging', stagingPushImage: IMAGE }).push;
    const { c } = container(none, 'vettid-org-staging-push');
    // Present with an empty value: unset would mean the gateway's default, both platforms.
    expect(c.Environment).toContainEqual({ Name: 'PUSH_PLATFORMS', Value: '' });
    const secrets = policyOf(none, 'vettid-org-staging-push-gateway').find((s) => s.Sid === 'PushSecrets');
    expect(arns(secrets.Resource)).toEqual([`arn:aws:secretsmanager:us-east-1:${MAIN}:secret:vettid-org/staging/push/blob-keys-??????`]);
    expect(pushSecretsRead([])).toEqual(['blob-keys']);
    expect(pushSecretsRead(['apns', 'fcm'])).toEqual(['apns', 'fcm', 'blob-keys']);
  });

  test('task role: its channel\'s secrets and Decrypt through Secrets Manager; nothing of the relay\'s, nothing broader', () => {
    const statements = policyOf(t, 'vettid-org-staging-push-gateway');
    expect(statements.map((s) => s.Sid).sort()).toEqual(['PushSecrets', 'PushSecretsKey']);
    const by = Object.fromEntries(statements.map((s) => [s.Sid, s]));
    expect(by.PushSecrets.Action).toBe('secretsmanager:GetSecretValue');
    // By name (no stack owns the secrets), with the ARN's random suffix and
    // nothing wider. FCM only: the APNs key is not readable.
    expect(arns(by.PushSecrets.Resource)).toEqual(['fcm', 'blob-keys'].map((n) => `arn:aws:secretsmanager:us-east-1:${MAIN}:secret:vettid-org/staging/push/${n}-??????`));
    expect(by.PushSecrets.Condition).toBeUndefined();
    expect(str(t)).not.toMatch(/Fn::ImportValue|AWS::SecretsManager/);
    expect(by.PushSecretsKey.Action).toBe('kms:Decrypt');
    expect(str(by.PushSecretsKey.Resource)).toContain('SsmParameterValuevettidorgprodpushkeyarn');
    expect(by.PushSecretsKey.Condition.StringEquals).toEqual({ 'kms:ViaService': 'secretsmanager.us-east-1.amazonaws.com' });
    expect(Object.keys(by.PushSecretsKey.Condition).sort()).toEqual(['StringEquals', 'StringLike']);
    expect(arns(by.PushSecretsKey.Condition.StringLike['kms:EncryptionContext:SecretARN'])).toEqual([`arn:aws:secretsmanager:us-east-1:${MAIN}:secret:vettid-org/staging/push/*`]);

    // Every statement of the stack (task and execution roles): no wildcard
    // action or resource, and no relay data.
    const all = of(t, 'AWS::IAM::Policy').flatMap((p) => p.Properties.PolicyDocument.Statement);
    for (const s of all) {
      expect(s.Effect).toBe('Allow');
      for (const a of [s.Action].flat()) expect(a).toMatch(/^(secretsmanager:GetSecretValue|kms:Decrypt|logs:CreateLogStream|logs:PutLogEvents)$/);
      expect(s.Resource).not.toBe('*');
    }
    expect(str(all)).not.toMatch(/dynamodb|s3:|elasticache|relay/);
    expect(of(t, 'AWS::IAM::ManagedPolicy')).toHaveLength(0);
    for (const r of of(t, 'AWS::IAM::Role')) {
      expect(r.Properties.ManagedPolicyArns).toBeUndefined();
      expect(r.Properties.AssumeRolePolicyDocument.Statement).toEqual([
        { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' } },
      ]);
    }
  });

  test('network: in from the relay\'s ALB only, on 8080; out on 443 only; the ALB\'s group is not changed', () => {
    const groups = of(t, 'AWS::EC2::SecurityGroup');
    expect(groups).toHaveLength(1);
    expect(groups[0].Properties.SecurityGroupIngress).toBeUndefined();
    expect(groups[0].Properties.SecurityGroupEgress).toEqual([expect.objectContaining({ CidrIp: '0.0.0.0/0', IpProtocol: 'tcp', FromPort: 443, ToPort: 443 })]);
    const ingress = of(t, 'AWS::EC2::SecurityGroupIngress');
    expect(ingress).toHaveLength(1);
    expect(ingress[0].Properties).toMatchObject({ IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080 });
    expect(str(ingress[0].Properties.SourceSecurityGroupId)).toContain('SsmParameterValuevettidorgprodrelayalbsecuritygroupid');
    expect(str(ingress[0].Properties.GroupId)).toContain('StagingTaskSg');
    expect(of(t, 'AWS::EC2::SecurityGroupEgress')).toHaveLength(0);
  });

  test('load balancer: own target group, a host rule and an own certificate on the relay\'s HTTPS listener', () => {
    const listenerRef = 'SsmParameterValuevettidorgprodrelayhttpslistenerarn';
    const tg = of(t, 'AWS::ElasticLoadBalancingV2::TargetGroup');
    expect(tg).toHaveLength(1);
    expect(tg[0].Properties).toMatchObject({ Port: 8080, Protocol: 'HTTP', TargetType: 'ip', HealthCheckPath: '/v1/health', Matcher: { HttpCode: '200' } });
    const rules = of(t, 'AWS::ElasticLoadBalancingV2::ListenerRule');
    expect(rules).toHaveLength(1);
    expect(rules[0].Properties.Conditions).toEqual([{ Field: 'host-header', HostHeaderConfig: { Values: ['push.staging.vettid.org'] } }]);
    expect(rules[0].Properties.Actions).toEqual([expect.objectContaining({ Type: 'forward' })]);
    expect(str(rules[0].Properties.ListenerArn)).toContain(listenerRef);
    expect(of(t, 'AWS::CertificateManager::Certificate').map((c) => [c.Properties.DomainName, c.Properties.ValidationMethod])).toEqual([['push.staging.vettid.org', 'DNS']]);
    const attached = of(t, 'AWS::ElasticLoadBalancingV2::ListenerCertificate');
    expect(attached).toHaveLength(1);
    expect(str(attached[0].Properties.ListenerArn)).toContain(listenerRef);
    // The service waits for the rule: a target group must be on a load balancer first.
    expect(str(Object.values<any>(t.Resources).find((r) => r.Type === 'AWS::ECS::Service').DependsOn)).toContain('StagingHostRule');
  });

  test('DNS: the certificate validates and the alias lives in the delegated zone, in this account', () => {
    const zoneRef = 'SsmParameterValuevettidorgprodpushstagingzoneid';
    expect(str(of(t, 'AWS::CertificateManager::Certificate')[0].Properties.DomainValidationOptions)).toContain(zoneRef);
    const records = of(t, 'AWS::Route53::RecordSet');
    expect(records.map((r) => [r.Properties.Type, r.Properties.Name])).toEqual([['A', 'push.staging.vettid.org.']]);
    expect(str(records[0].Properties.HostedZoneId)).toContain(zoneRef);
    expect(str(records[0].Properties.AliasTarget.DNSName)).toContain('SsmParameterValuevettidorgprodrelayalbdnsname');
    expect(str(t)).not.toContain(STAGING_ACCOUNT);
  });

  test('alarms: every one of §10.5 (and "no healthy task"), each to the push alarm topic', () => {
    const alarms = of(t, 'AWS::CloudWatch::Alarm');
    expect(alarms.map((a) => a.Properties.AlarmName).sort()).toEqual([
      'vettid-org-staging-push-attestation-failures',
      'vettid-org-staging-push-internal',
      'vettid-org-staging-push-manifest-refresh',
      'vettid-org-staging-push-no-healthy-task',
      'vettid-org-staging-push-provider-auth',
      'vettid-org-staging-push-provider-unavailable',
    ]);
    for (const a of alarms) {
      expect(a.Properties.AlarmActions).toHaveLength(1);
      expect(str(a.Properties.AlarmActions)).toContain(`:sns:us-east-1:${MAIN}:vettid-org-push-alerts`);
      expect(a.Properties.AlarmDescription).toContain('Push gateway (staging)');
    }
    const by = Object.fromEntries(alarms.map((a) => [a.Properties.AlarmName.replace('vettid-org-staging-push-', ''), a.Properties]));
    const series = (p: any) => (p.Metrics ?? []).filter((m: any) => m.MetricStat).map((m: any) => [m.Id, m.MetricStat.Metric.Namespace, m.MetricStat.Metric.MetricName, m.MetricStat.Metric.Dimensions ?? [], m.MetricStat.Period]);

    // Provider auth failures: any, within 5 minutes.
    expect(by['provider-auth']).toMatchObject({
      Namespace: 'vettid-org/staging/push/alarms', MetricName: 'wakes_provider_auth', Statistic: 'Sum', Period: 300,
      Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold', EvaluationPeriods: 1, TreatMissingData: 'notBreaching',
    });
    // provider_unavailable above 5 % of all wakes for 10 minutes.
    expect(by['provider-unavailable']).toMatchObject({ Threshold: 5, ComparisonOperator: 'GreaterThanThreshold', EvaluationPeriods: 2, DatapointsToAlarm: 2 });
    expect(series(by['provider-unavailable'])).toEqual([
      ['unavailable', 'vettid-org/staging/push/alarms', 'wakes_provider_unavailable', [], 300],
      ['total', 'vettid-org/staging/push/alarms', 'wakes_total', [], 300],
    ]);
    // Any internal: the gateway's own metric, which has no dimension.
    expect(by.internal).toMatchObject({ Namespace: 'vettid-org/staging/push', MetricName: 'internal_errors', Statistic: 'Sum', Period: 300, Threshold: 1, EvaluationPeriods: 1 });
    expect(by.internal.Dimensions).toBeUndefined();
    // Manifest refresh failing for an hour: four quarters with errors and no success.
    expect(by['manifest-refresh']).toMatchObject({ Threshold: 1, EvaluationPeriods: 4, DatapointsToAlarm: 4 });
    expect(series(by['manifest-refresh'])).toEqual([
      ['errors', 'vettid-org/staging/push', 'manifest_refresh', [{ Name: 'outcome', Value: 'error' }], 900],
      ['ok', 'vettid-org/staging/push', 'manifest_refresh', [{ Name: 'outcome', Value: 'ok' }], 900],
    ]);
    // Attestation failures above the baseline, per hour.
    expect(by['attestation-failures']).toMatchObject({
      Namespace: 'vettid-org/staging/push/alarms', MetricName: 'attestation_failures_total', Period: 3600,
      Threshold: PUSH_ATTESTATION_FAILURES_PER_HOUR, ComparisonOperator: 'GreaterThanThreshold',
    });
    // The gateway is down: a silent gateway must not read as a healthy one.
    expect(by['no-healthy-task']).toMatchObject({
      Namespace: 'AWS/ApplicationELB', MetricName: 'HealthyHostCount', Statistic: 'Minimum', Threshold: 1,
      ComparisonOperator: 'LessThanThreshold', EvaluationPeriods: 3, TreatMissingData: 'breaching',
    });
    expect(by['no-healthy-task'].OKActions).toHaveLength(1);
  });

  test('the sums over dimensions are metric filters on the gateway\'s own metric lines (its log group)', () => {
    const filters = of(t, 'AWS::Logs::MetricFilter').map((f) => [
      f.Properties.MetricTransformations[0].MetricName, f.Properties.FilterPattern, f.Properties.MetricTransformations[0].MetricValue, f.Properties.LogGroupName,
    ]);
    const group = '/vettid-org/staging/push-service';
    expect(filters.sort()).toEqual([
      ['attestation_failures_total', '{ $.attestation_failures > 0 }', '$.attestation_failures', group],
      ['wakes_provider_auth', '{ ($.outcome = "provider_auth") && ($.wakes > 0) }', '$.wakes', group],
      ['wakes_provider_unavailable', '{ ($.outcome = "provider_unavailable") && ($.wakes > 0) }', '$.wakes', group],
      ['wakes_total', '{ $.wakes > 0 }', '$.wakes', group],
    ]);
  });
});

describe('service stack: both channels', () => {
  const t = both.push;

  test('adding production leaves every staging resource as it was', () => {
    for (const [id, r] of Object.entries<any>(stagingOnly.push.Resources)) {
      expect({ id, resource: t.Resources[id] }).toEqual({ id, resource: r });
    }
  });

  test('two services with their own roles, target groups, rules, certificates and images', () => {
    expect(of(t, 'AWS::ECS::Service').map((s) => s.Properties.ServiceName).sort()).toEqual(['vettid-org-push', 'vettid-org-staging-push']);
    expect(of(t, 'AWS::ElasticLoadBalancingV2::TargetGroup')).toHaveLength(2);
    expect(of(t, 'AWS::EC2::SecurityGroup')).toHaveLength(2);
    const rules = of(t, 'AWS::ElasticLoadBalancingV2::ListenerRule').map((r) => [r.Properties.Conditions[0].HostHeaderConfig.Values, r.Properties.Priority]);
    expect(rules.sort()).toEqual([[['push.staging.vettid.org'], 20], [['push.vettid.org'], 10]]);
    expect(of(t, 'AWS::CertificateManager::Certificate').map((c) => c.Properties.DomainName).sort()).toEqual(['push.staging.vettid.org', 'push.vettid.org']);
    expect(of(t, 'AWS::CloudWatch::Alarm')).toHaveLength(12);

    const prod = container(t, 'vettid-org-push');
    expect(prod.c.Image).toBe(IMAGE2);
    expect(prod.env).toMatchObject({
      PUSH_CHANNEL: 'prod', PUSH_PLATFORMS: 'fcm,apns', PUSH_FCM_APP_IDS: 'com.vettid.app', PUSH_APNS_APP_IDS: 'com.vettid.app',
      PUSH_FCM_PROJECT: 'vettid-prod', PUSH_SECRET_PREFIX: 'vettid-org/prod/push', PUSH_METRICS_NAMESPACE: 'vettid-org/prod/push',
    });
    expect(prod.c.LogConfiguration.Options['awslogs-group']).toBe('/vettid-org/prod/push-service');
    expect(container(t, 'vettid-org-staging-push').c.Image).toBe(IMAGE);
  });

  test('channels cannot cross: each role reads only its own channel\'s secrets', () => {
    const prod = str(policyOf(t, 'vettid-org-push-gateway'));
    const staging = str(policyOf(t, 'vettid-org-staging-push-gateway'));
    expect(arns(policyOf(t, 'vettid-org-push-gateway').find((s) => s.Sid === 'PushSecrets').Resource)).toEqual(
      ['apns', 'fcm', 'blob-keys'].map((n) => `arn:aws:secretsmanager:us-east-1:${MAIN}:secret:vettid-org/prod/push/${n}-??????`),
    );
    expect(prod).not.toContain('vettid-org/staging/');
    expect(staging).not.toContain('vettid-org/prod/');
  });

  test('production\'s host: a record and a validation in vettid.org itself', () => {
    const record = of(t, 'AWS::Route53::RecordSet').find((r) => r.Properties.Name === 'push.vettid.org.');
    expect(record.Properties.Type).toBe('A');
    expect(str(record.Properties.HostedZoneId)).not.toContain('pushstagingzoneid');
  });
});

describe('app wiring', () => {
  function synth(context: Record<string, unknown>) {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], headscaleLoginServer: 'https://headscale.example.net', relayImage: RELAY_IMAGE, ...context } });
    buildApp(app);
    const out = new Map<string, { stack: cdk.Stack; json: any }>();
    for (const c of app.node.children) {
      if (c instanceof cdk.Stack) out.set(c.stackName, { stack: c, json: Template.fromStack(c).toJSON() });
    }
    return out;
  }
  const base = synth({});
  const listed = synth({ pushStages: 'staging' });
  const deployed = synth({ pushStages: 'staging', stagingPushImage: IMAGE, stagingPushPlatforms: 'fcm' });
  const pushStacks = (m: Map<string, unknown>) => [...m.keys()].filter((n) => /Push/.test(n)).sort();

  test('without the context there is no push stack, and the relay stack publishes nothing', () => {
    expect(pushStacks(base)).toEqual([]);
    expect(str(base.get('VettidOrgRelayStack')!.json)).not.toMatch(/relay\/(vpc-id|https-listener-arn|alb-)/);
  });

  test('pushStages alone: the data stack (protected), no service stack yet', () => {
    expect(pushStacks(listed)).toEqual(['VettidOrgPushDataStack']);
    const data = listed.get('VettidOrgPushDataStack')!.stack;
    expect([data.account, data.terminationProtection]).toEqual([MAIN, true]);
  });

  test('with an image: the service stack, after the data stack and the relay; staging only', () => {
    expect(pushStacks(deployed)).toEqual(['VettidOrgPushDataStack', 'VettidOrgPushStack']);
    const push = deployed.get('VettidOrgPushStack')!;
    expect([push.stack.account, push.stack.terminationProtection]).toEqual([MAIN, false]);
    expect(push.stack.dependencies.map((s) => s.stackName).sort()).toEqual(['VettidOrgPushDataStack', 'VettidOrgRelayStack']);
    expect(of(push.json, 'AWS::ECS::Service').map((s) => s.Properties.ServiceName)).toEqual(['vettid-org-staging-push']);
    expect(Object.keys(push.json.Resources).length).toBeLessThan(200);
    // The data stack does not change when the image arrives.
    expect(deployed.get('VettidOrgPushDataStack')!.json).toEqual(listed.get('VettidOrgPushDataStack')!.json);
  });

  test('existing stacks: the relay stack gains seven SSM parameters and nothing else; no other stack changes', () => {
    for (const [name, { json }] of base) {
      if (name === 'VettidOrgRelayStack') continue;
      expect({ name, same: str(deployed.get(name)!.json) === str(json) }).toEqual({ name, same: true });
    }
    const before = base.get('VettidOrgRelayStack')!.json;
    const after = JSON.parse(str(deployed.get('VettidOrgRelayStack')!.json));
    const added = Object.keys(after.Resources).filter((id) => !(id in before.Resources));
    expect(added.map((id) => [after.Resources[id].Type, after.Resources[id].Properties.Name]).sort()).toEqual(
      ['alb-dns-name', 'alb-full-name', 'alb-hosted-zone-id', 'alb-security-group-id', 'https-listener-arn', 'public-subnet-ids', 'vpc-id']
        .map((k) => ['AWS::SSM::Parameter', `/vettid-org/prod/relay/${k}`]),
    );
    for (const id of added) delete after.Resources[id];
    // Listener, certificate, load balancer, target group, service: byte for byte what is deployed today.
    expect(after).toEqual(before);
    expect(listed.get('VettidOrgRelayStack')!.json).toEqual(deployed.get('VettidOrgRelayStack')!.json);
  });

  test('a gateway needs the relay\'s load balancer', () => {
    expect(() => buildApp(new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], relayImage: '', pushStages: 'staging' } }))).toThrow(/relayImage/);
  });

  test('staging app: with stagingPushZoneNs, one NS record for push.staging.vettid.org in the staging zone', () => {
    const staging = synth({ stage: 'staging', stagingPushZoneNs: NS.join(','), pushStages: 'staging', stagingPushImage: IMAGE });
    expect(pushStacks(staging)).toEqual(['VettidOrgStagePushDelegationStack']);
    const { stack, json } = staging.get('VettidOrgStagePushDelegationStack')!;
    expect(stack.account).toBe(STAGING_ACCOUNT);
    expect(stack.dependencies.map((s) => s.stackName)).toEqual(['VettidOrgStageDnsStack']);
    expect(Object.values<any>(json.Resources).map((r) => r.Type)).toEqual(['AWS::Route53::RecordSet']);
    const record = of(json, 'AWS::Route53::RecordSet')[0].Properties;
    expect(record).toMatchObject({ Name: 'push.staging.vettid.org.', Type: 'NS', TTL: '3600', ResourceRecords: NS.map((n) => `${n}.`) });
    expect(str(record.HostedZoneId)).toContain('SsmParameterValuevettidorgstagingdnszoneid');
    // Without the context the staging app is what it was.
    expect(pushStacks(synth({ stage: 'staging' }))).toEqual([]);
  });
});
