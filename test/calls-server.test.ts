import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';
import { loadConfig } from '../lib/config';

/** The calling service's TURN server (CALLING-SERVICE §4.1, §7, §8.2, §10). */
const DIGEST = '4ada26eab8236cdae5a170c924012aa0cbe3e98968c4f83628061b1cf53040e5';
const IMAGE = `ghcr.io/vettid/vettid-calls/turn@sha256:${DIGEST}`;
const of = (json: any, type: string): any[] => Object.values<any>(json.Resources ?? {}).filter((r) => r.Type === type);
const cfg = (context: Record<string, unknown>) => loadConfig(new cdk.App({ context }).node);

function synth(context: Record<string, unknown>) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], stage: 'staging', callsStages: 'staging', callsIssuerStub: true, ...context } });
  buildApp(app);
  const out = new Map<string, any>();
  for (const c of app.node.children) if (c instanceof cdk.Stack) out.set(c.stackName, Template.fromStack(c).toJSON());
  return out;
}
/** Flatten a template value with intrinsics into one string (intrinsics become `<…>`). */
function text(v: any): string {
  if (typeof v === 'string') return v;
  if (v?.['Fn::Base64'] !== undefined) return text(v['Fn::Base64']);
  if (v?.['Fn::Join']) return v['Fn::Join'][1].map(text).join('');
  if (v?.Ref) return `<${v.Ref}>`;
  return `<${JSON.stringify(v)}>`;
}

const t = synth({ stagingCallsTurnImage: IMAGE });
const svc = t.get('VettidOrgCallsStack');
const data = t.get('VettidOrgCallsDataStack');

describe('context', () => {
  test('the image must be a digest, and callsStages must name the stage', () => {
    expect(cfg({ stage: 'staging', callsStages: 'staging', stagingCallsTurnImage: IMAGE }).calls?.turnImage).toBe(IMAGE);
    expect(cfg({ stage: 'staging', callsStages: 'staging' }).calls?.turnImage).toBeUndefined();
    expect(() => cfg({ stage: 'staging', callsStages: 'staging', stagingCallsTurnImage: 'ghcr.io/vettid/vettid-calls/turn:latest' })).toThrow(/pinned by digest/);
    expect(() => cfg({ stage: 'staging', stagingCallsTurnImage: IMAGE })).toThrow(/does not name/);
  });
  test('without the image no server is built, and the data stack holds no address', () => {
    const none = synth({});
    for (const type of ['AWS::EC2::VPC', 'AWS::AutoScaling::AutoScalingGroup', 'AWS::EC2::LaunchTemplate']) expect(of(none.get('VettidOrgCallsStack'), type)).toEqual([]);
    expect(of(none.get('VettidOrgCallsDataStack'), 'AWS::EC2::EIP')).toEqual([]);
  });
});

describe('the data stack owns the address', () => {
  test('a retained Elastic IP, published for the service stack', () => {
    const [eip] = of(data, 'AWS::EC2::EIP');
    expect([eip.Properties.Domain, eip.DeletionPolicy]).toEqual(['vpc', 'RetainExceptOnCreate']);
    expect(of(data, 'AWS::SSM::Parameter').map((p) => p.Properties.Name).sort()).toEqual([
      '/vettid-org/staging/calls/eip-address', '/vettid-org/staging/calls/eip-allocation-id', '/vettid-org/staging/calls/key-arn',
    ]);
  });
  test('the service stack creates no address and no stateful resource', () => {
    for (const type of ['AWS::EC2::EIP', 'AWS::Logs::LogGroup', 'AWS::S3::Bucket', 'AWS::KMS::Key', 'AWS::SNS::Topic', 'AWS::SecretsManager::Secret']) expect(of(svc, type)).toEqual([]);
  });
});

describe('network', () => {
  test('one dual-stack public subnet, an internet gateway, no NAT, no flow logs', () => {
    expect(of(svc, 'AWS::EC2::VPC')).toHaveLength(1);
    expect(of(svc, 'AWS::EC2::Subnet')).toHaveLength(1);
    expect(of(svc, 'AWS::EC2::VPCCidrBlock')[0].Properties.AmazonProvidedIpv6CidrBlock).toBe(true);
    expect(of(svc, 'AWS::EC2::NatGateway')).toEqual([]);
    expect(of(svc, 'AWS::EC2::FlowLog')).toEqual([]);
    expect(of(svc, 'AWS::EC2::Route').map((r) => r.Properties.DestinationCidrBlock ?? r.Properties.DestinationIpv6CidrBlock).sort()).toEqual(['0.0.0.0/0', '::/0']);
  });
  test('security group: exactly the inbound and outbound of §8.2', () => {
    const [sg] = of(svc, 'AWS::EC2::SecurityGroup');
    const norm = (rules: any[]) => rules.map((r) => `${r.IpProtocol} ${r.FromPort}-${r.ToPort} ${r.CidrIp ?? r.CidrIpv6}`).sort();
    expect(norm(sg.Properties.SecurityGroupIngress)).toEqual([
      'tcp 3478-3478 0.0.0.0/0', 'tcp 3478-3478 ::/0',
      'udp 3478-3478 0.0.0.0/0', 'udp 3478-3478 ::/0',
      'udp 49152-65535 0.0.0.0/0', 'udp 49152-65535 ::/0',
    ].sort());
    expect(norm(sg.Properties.SecurityGroupEgress)).toEqual([
      'tcp 443-443 0.0.0.0/0', 'tcp 443-443 ::/0',
      'udp 0-65535 0.0.0.0/0', 'udp 0-65535 ::/0',
    ].sort());
    expect(of(svc, 'AWS::EC2::SecurityGroupIngress')).toEqual([]);
  });
});

describe('instance', () => {
  const [lt] = of(svc, 'AWS::EC2::LaunchTemplate');
  const d = lt.Properties.LaunchTemplateData;
  const ud = text(d.UserData);
  test('t4g.small, arm64 AL2023 image, IMDSv2 required, no key pair, encrypted disk', () => {
    expect(d.InstanceType).toBe('t4g.small');
    expect(JSON.stringify(svc.Parameters)).toMatch(/al2023-ami-kernel-[0-9.]*-arm64/);
    expect(d.MetadataOptions).toMatchObject({ HttpTokens: 'required', HttpEndpoint: 'enabled' });
    expect(d.KeyName).toBeUndefined();
    expect(d.BlockDeviceMappings[0].Ebs.Encrypted).toBe(true);
    expect(JSON.stringify(lt)).not.toMatch(/KeyName/);
  });
  test('a group of one, min 0 so that the daily stop can set it to zero; tagged', () => {
    const [g] = of(svc, 'AWS::AutoScaling::AutoScalingGroup');
    expect([g.Properties.MinSize, g.Properties.MaxSize, g.Properties.DesiredCapacity]).toEqual(['0', '1', '1']);
    expect(g.Properties.Tags).toEqual(expect.arrayContaining([{ Key: 'vettid-service', PropagateAtLaunch: true, Value: 'calls' }]));
  });
  test('user data: the image by digest, no log driver, host network, restart, env, fixed addresses', () => {
    expect(ud).toContain(` ${IMAGE}`);
    expect(ud).toMatch(/--log-driver none/);
    expect(ud).not.toMatch(/--log-driver (?!none)|awslogs|journald|json-file|syslog/);
    expect(ud).toContain('--network host');
    expect(ud).toContain('--restart unless-stopped');
    expect(ud).toContain('CALLS_TURN_HOST=turn.staging.vettid.org');
    expect(ud).toContain('CALLS_SECRET_ID=vettid-org/staging/calls/turn-secret');
    expect(ud).toContain('CALLS_METRICS_NAMESPACE=vettid-org/staging/calls');
    expect(ud).toContain('AWS_REGION=');
    expect(ud).toMatch(/CALLS_OWN_NETWORKS=10\.44\.0\.0\/24,</);
    expect(ud).toMatch(/CALLS_PRIVATE_IPV4="\$PRIVATE_IPV4"/);
    expect(ud).toMatch(/CALLS_PUBLIC_IPV4=<[^>]*eipaddress/);
    expect(ud).toMatch(/aws ec2 associate-address --allocation-id <[^>]*eipallocationid/);
    expect(ud).toMatch(/aws ec2 assign-ipv6-addresses/);
    expect(ud).toMatch(/dnf install -y docker/);
    expect(ud.match(/@sha256:/g)).toHaveLength(1);
  });
});

describe('IAM', () => {
  const roleId = Object.keys(svc.Resources).find((k) => svc.Resources[k].Properties?.RoleName === 'vettid-org-staging-calls-server')!;
  const role = svc.Resources[roleId];
  const policies = of(svc, 'AWS::IAM::Policy').filter((p) => JSON.stringify(p.Properties.Roles).includes(roleId));
  const st: any[] = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
  test('role: fixed name (the key policy names it), SSM core policy, no other managed policy', () => {
    expect(role.Properties.RoleName).toBe('vettid-org-staging-calls-server');
    expect(JSON.stringify(role.Properties.ManagedPolicyArns)).toContain('AmazonSSMManagedInstanceCore');
    expect(role.Properties.ManagedPolicyArns).toHaveLength(1);
  });
  test('the one secret, the one key through Secrets Manager, the one namespace', () => {
    const get = st.find((s) => s.Sid === 'TurnSecret');
    expect(get.Action).toBe('secretsmanager:GetSecretValue');
    expect(text(get.Resource)).toContain('secret:vettid-org/staging/calls/turn-secret-??????');
    const dec = st.find((s) => s.Sid === 'TurnSecretKey');
    expect(dec.Action).toBe('kms:Decrypt');
    expect(JSON.stringify(dec.Resource)).toContain('callskeyarn');
    expect(dec.Condition.StringEquals['kms:ViaService']).toMatch(/^secretsmanager\./);
    expect(JSON.stringify(dec.Condition.StringLike)).toContain('turn-secret-??????');
    const put = st.find((s) => s.Sid === 'OwnMetrics');
    expect([put.Action, put.Condition]).toEqual(['cloudwatch:PutMetricData', { StringEquals: { 'cloudwatch:namespace': 'vettid-org/staging/calls' } }]);
  });
  test('address grants are as tight as IAM allows; nothing else', () => {
    expect(st.find((s) => s.Sid === 'TakeFixedIpv4Address').Action).toBe('ec2:AssociateAddress');
    expect(JSON.stringify(st.find((s) => s.Sid === 'TakeFixedIpv4Address').Resource)).toContain('elastic-ip/');
    expect(st.find((s) => s.Sid === 'TakeFixedIpv4AddressInstance').Condition).toEqual({ StringEquals: { 'ec2:ResourceTag/vettid-service': 'calls' } });
    expect(st.find((s) => s.Sid === 'TakeFixedIpv6Address').Action).toBe('ec2:AssignIpv6Addresses');
    expect(JSON.stringify(st.find((s) => s.Sid === 'TakeFixedIpv6Address').Condition)).toContain('ec2:Subnet');
    const actions = st.flatMap((s) => [].concat(s.Action)).sort();
    expect(actions).toEqual(['cloudwatch:PutMetricData', 'ec2:AssignIpv6Addresses', 'ec2:AssociateAddress', 'ec2:AssociateAddress', 'kms:Decrypt', 'secretsmanager:GetSecretValue']);
  });
});

describe('DNS', () => {
  test('A and AAAA for turn.staging.vettid.org, next to the issuer\'s own records', () => {
    const rs = of(svc, 'AWS::Route53::RecordSet').filter((r) => r.Properties.Name === 'turn.staging.vettid.org.');
    expect(rs.map((r) => r.Properties.Type).sort()).toEqual(['A', 'AAAA']);
    expect(JSON.stringify(rs.find((r) => r.Properties.Type === 'A').Properties.ResourceRecords)).toContain('eipaddress');
    expect(of(svc, 'AWS::Route53::RecordSet')).toHaveLength(4);
  });
});

describe('alarms and the daily stop', () => {
  const alarms = of(svc, 'AWS::CloudWatch::Alarm');
  const by = (n: string) => alarms.find((a) => a.Properties.AlarmName === `vettid-org-staging-calls-${n}`)?.Properties;
  const TOPIC = 'vettid-org-calls-alerts';
  test('the §10 alarms exist and notify the data stack\'s topic', () => {
    for (const n of ['no-turn-heartbeat', 'relay-volume-day', 'relay-stopped', 'relay-capacity', 'turn-auth-failures']) {
      expect(by(n)).toBeDefined();
      expect(JSON.stringify(by(n).AlarmActions)).toContain(TOPIC);
    }
  });
  test('heartbeat: 5 minutes, missing is bad, tells on recovery', () => {
    const a = by('no-turn-heartbeat');
    expect([a.MetricName, a.Namespace, a.Period, a.TreatMissingData, a.ComparisonOperator]).toEqual(['heartbeat', 'vettid-org/staging/calls', 300, 'breaching', 'LessThanThreshold']);
    expect(JSON.stringify(a.OKActions)).toContain(TOPIC);
  });
  test('5 GB a day and 30 GB a day', () => {
    expect([by('relay-volume-day').Threshold, by('relay-volume-day').Period]).toEqual([5e9, 86400]);
    expect([by('relay-stopped').Threshold, by('relay-stopped').Period]).toEqual([30e9, 86400]);
  });
  test('relay-stopped sets the group to zero', () => {
    const [p] = of(svc, 'AWS::AutoScaling::ScalingPolicy');
    expect(p.Properties).toMatchObject({ PolicyType: 'StepScaling', AdjustmentType: 'ExactCapacity', StepAdjustments: [{ ScalingAdjustment: 0, MetricIntervalLowerBound: 0 }] });
    expect(by('relay-stopped').AlarmActions).toHaveLength(2);
    expect(JSON.stringify(by('relay-stopped').AlarmActions)).toContain(JSON.stringify({ Ref: Object.keys(svc.Resources).find((k) => svc.Resources[k] === p) }));
    // only the stop alarm acts on the group
    expect(alarms.filter((a) => JSON.stringify(a.Properties.AlarmActions).includes('DailyStop'))).toHaveLength(1);
  });
  test('relay-capacity: 80 of 100 allocations or any quota_total / capacity refusal, for 10 minutes', () => {
    const a = by('relay-capacity');
    expect([a.EvaluationPeriods, a.DatapointsToAlarm]).toEqual([2, 2]);
    const q = JSON.stringify(a.Metrics);
    expect(q).toContain('>= 80');
    for (const x of ['allocations_refused', 'quota_total', '"capacity"', '"allocations"']) expect(q).toContain(x);
  });
  test('auth failures: placeholder baseline', () => {
    expect([by('turn-auth-failures').MetricName, by('turn-auth-failures').Threshold]).toEqual(['auth_failures', 1000]);
  });
  test('the cost budget: $30 a month on the calls tag', () => {
    const [b] = of(svc, 'AWS::Budgets::Budget');
    expect(b.Properties.Budget.BudgetLimit).toEqual({ Amount: 30, Unit: 'USD' });
    expect(JSON.stringify(b.Properties.Budget)).toContain('vettid-service');
  });
});
