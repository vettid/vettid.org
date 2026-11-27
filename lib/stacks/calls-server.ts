import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import { readRef } from '../constructs/ssm-refs';
import { callsMetricsNamespace, callsName, callsSecretName, callsServerRoleName } from './calls-data-stack';

/** Dual-stack network of the server (CALLING-SERVICE §8.2): one public subnet, no NAT. */
export const CALLS_VPC_CIDR = '10.44.0.0/24';
/** The fixed host part of the server's IPv6 address inside the subnet's /64. */
export const CALLS_IPV6_HOST = '53';
/** §7.3: an alarm at 5 GB out in a day; at 30 GB the group is set to zero. Decimal GB. */
export const CALLS_DAY_ALARM_BYTES = 5e9;
export const CALLS_DAY_STOP_BYTES = 30e9;
/**
 * §7.2 `max-bps`: 3 Mbit/s per allocation, each direction, for C4's video
 * (D15 b; the image's default is voice's 256).
 */
export const CALLS_MAX_KBPS = 3000;
/** §7.2 `bps-capacity` and `total-quota`: the image's defaults on staging. */
export const CALLS_CAPACITY_KBPS = 120000;
export const CALLS_TOTAL_QUOTA = 100;
/**
 * The allocations the server admits: coturn reserves `max-bps` out of
 * `bps-capacity` for each one, and the last one gets what is left (as
 * turn-agent counts it), so 40 at 3 Mbit/s, under `total-quota`.
 */
export const CALLS_ALLOCATIONS_MAX = Math.min(CALLS_TOTAL_QUOTA, Math.ceil(CALLS_CAPACITY_KBPS / CALLS_MAX_KBPS));
/** §10 `relay-capacity`: 80 % of the allocations the server admits (32 of 40). */
export const CALLS_ALLOCATIONS_ALARM = Math.floor(CALLS_ALLOCATIONS_MAX * 0.8);
/**
 * §10 `turn-auth-failures`: a PLACEHOLDER. A public TURN server is probed
 * constantly; the baseline is set from the first week's numbers.
 */
export const CALLS_AUTH_FAILURES_PER_HOUR = 1000;

export interface CallsServerProps {
  readonly config: AppConfig;
  readonly image: string;
  readonly zone: route53.IHostedZone;
  /** The data stack's alarm topic ARN. */
  readonly topicArn: string;
}

/**
 * The calling service's TURN/STUN server (CALLING-SERVICE §4.1, §7, §8.2,
 * §10): the network, security group, role, launch template, Auto Scaling
 * group of one, DNS records, alarms and the daily stop. Everything stateful
 * (key, Elastic IP, log groups, alarm topic) is VettidOrgCallsDataStack's.
 */
export class CallsServer extends Construct {
  constructor(scope: Construct, id: string, props: CallsServerProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const { config, image, zone } = props;
    const calls = config.calls!;
    const namespace = callsMetricsNamespace(config);
    const name = callsName(config, 'server');
    const secretArn = `arn:${stack.partition}:secretsmanager:${stack.region}:${stack.account}:secret:${callsSecretName(config)}-??????`;
    const tag = { key: 'vettid-service', value: 'calls' };

    // ---- Network: one public subnet, IPv4 and IPv6, no NAT, NO FLOW LOGS (§10) ----
    const vpc = new ec2.CfnVPC(this, 'Vpc', {
      cidrBlock: CALLS_VPC_CIDR, enableDnsSupport: true, enableDnsHostnames: true, tags: [{ key: 'Name', value: name }],
    });
    const v6 = new ec2.CfnVPCCidrBlock(this, 'VpcV6', { vpcId: vpc.ref, amazonProvidedIpv6CidrBlock: true });
    // The amazon-provided /56. Reading it from the VPC does NOT depend on the
    // association (`v6`): anything that uses `vpcV6` must depend on `v6`
    // itself (the subnet and the launch template do). The addresses below are
    // read from the subnet, which does.
    const vpcV6 = cdk.Fn.select(0, vpc.attrIpv6CidrBlocks);
    const subnet = new ec2.CfnSubnet(this, 'Subnet', {
      vpcId: vpc.ref,
      availabilityZone: stack.availabilityZones[0],
      cidrBlock: CALLS_VPC_CIDR,
      ipv6CidrBlock: cdk.Fn.select(0, cdk.Fn.cidr(vpcV6, 1, '64')),
      mapPublicIpOnLaunch: false,
      tags: [{ key: 'Name', value: name }],
    });
    subnet.addDependency(v6);
    const igw = new ec2.CfnInternetGateway(this, 'Igw', { tags: [{ key: 'Name', value: name }] });
    const attach = new ec2.CfnVPCGatewayAttachment(this, 'IgwAttach', { vpcId: vpc.ref, internetGatewayId: igw.ref });
    const routes = new ec2.CfnRouteTable(this, 'Routes', { vpcId: vpc.ref, tags: [{ key: 'Name', value: name }] });
    const routesAssoc = new ec2.CfnSubnetRouteTableAssociation(this, 'RoutesAssoc', { subnetId: subnet.ref, routeTableId: routes.ref });
    const r4 = new ec2.CfnRoute(this, 'Route4', { routeTableId: routes.ref, destinationCidrBlock: '0.0.0.0/0', gatewayId: igw.ref });
    const r6 = new ec2.CfnRoute(this, 'Route6', { routeTableId: routes.ref, destinationIpv6CidrBlock: '::/0', gatewayId: igw.ref });
    r4.addDependency(attach);
    r6.addDependency(attach);
    // The launch template reads the VPC's /56 (CALLS_OWN_NETWORKS), see `vpcV6`.

    // The server's IPv6 address: fixed host part inside the subnet's /64, so
    // replacing the instance keeps it. Fixed for the life of the VPC only.
    // Read from the subnet's own attribute: the subnet depends on `v6`, so
    // this cannot resolve before the /56 is associated.
    const subnetV6 = cdk.Fn.select(0, cdk.Fn.split('/', cdk.Fn.select(0, subnet.attrIpv6CidrBlocks)));
    const ipv6 = cdk.Fn.join('', [subnetV6, CALLS_IPV6_HOST]); // "<prefix>::" + "53"

    // ---- Security group: exactly §8.2 ----------------------------------------
    const both = [{ cidrIp: '0.0.0.0/0' }, { cidrIpv6: '::/0' }];
    const rule = (protocol: string, from: number, to: number, d: { cidrIp?: string; cidrIpv6?: string }, text: string): ec2.CfnSecurityGroup.IngressProperty =>
      ({ ipProtocol: protocol, fromPort: from, toPort: to, description: text, ...d });
    const sg = new ec2.CfnSecurityGroup(this, 'Sg', {
      groupDescription: 'VettID calling service TURN server (CALLING-SERVICE 8.2)',
      vpcId: vpc.ref,
      securityGroupIngress: both.flatMap((d) => [
        rule('udp', 3478, 3478, d, 'STUN/TURN UDP'),
        rule('tcp', 3478, 3478, d, 'STUN/TURN TCP'),
        rule('udp', 49152, 65535, d, 'TURN relay ports'),
      ]),
      // UDP to anywhere is the relay; TCP 443 is the image registry, Secrets
      // Manager, CloudWatch and Systems Manager.
      securityGroupEgress: both.flatMap((d) => [
        rule('udp', 0, 65535, d, 'relayed media, DNS'),
        rule('tcp', 443, 443, d, 'registry, AWS APIs'),
      ]),
      tags: [{ key: 'Name', value: name }],
    });

    // ---- The instance's role ---------------------------------------------------
    const role = new iam.Role(this, 'Role', {
      roleName: callsServerRoleName(config),
      description: 'VettID calling service TURN server: Session Manager, reads the TURN secret, puts its own metrics, takes its fixed addresses',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    // Session Manager only, in place of AmazonSSMManagedInstanceCore (which
    // grants ssm:GetParameter* on every parameter of the account, among them
    // the member service's and the vault's refs). Session Manager needs the
    // agent's registration and the ssmmessages channels; the current agent
    // does not need ec2messages for sessions (that is Run Command's).
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'SessionManager',
      actions: [
        'ssm:UpdateInstanceInformation',
        'ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel',
      ],
      resources: ['*'], // none of these takes a resource
    }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'TurnSecret', actions: ['secretsmanager:GetSecretValue'], resources: [secretArn] }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'TurnSecretKey',
      actions: ['kms:Decrypt'],
      resources: [readRef(this, config, 'calls/key-arn')],
      conditions: {
        StringEquals: { 'kms:ViaService': `secretsmanager.${stack.region}.amazonaws.com` },
        StringLike: { 'kms:EncryptionContext:SecretARN': secretArn },
      },
    }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'OwnMetrics',
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'], // PutMetricData has no resource-level permissions
      conditions: { StringEquals: { 'cloudwatch:namespace': namespace } },
    }));
    const ec2Arn = (type: string, id: string) => `arn:${stack.partition}:ec2:${stack.region}:${stack.account}:${type}/${id}`;
    // associate-address: the one Elastic IP, and an instance that carries the
    // service's tag (a condition on the instance resource only: the address
    // has no tag to match).
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'TakeFixedIpv4Address',
      actions: ['ec2:AssociateAddress'],
      resources: [ec2Arn('elastic-ip', readRef(this, config, 'calls/eip-allocation-id'))],
    }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'TakeFixedIpv4AddressInstance',
      actions: ['ec2:AssociateAddress'],
      resources: [ec2Arn('instance', '*')],
      conditions: { StringEquals: { 'ec2:ResourceTag/vettid-service': 'calls' } },
    }));
    // In case EC2 also checks the primary interface for associate-address.
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'TakeFixedIpv4AddressInterface',
      actions: ['ec2:AssociateAddress'],
      resources: [ec2Arn('network-interface', '*')],
      conditions: { ArnEquals: { 'ec2:Subnet': ec2Arn('subnet', subnet.ref) } },
    }));
    // A boot that fails marks its own instance unhealthy, so that the group
    // replaces it and no dead instance holds the addresses. By name: the
    // group is created after the role.
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'MarkOwnInstanceUnhealthy',
      actions: ['autoscaling:SetInstanceHealth'],
      resources: [`arn:${stack.partition}:autoscaling:${stack.region}:${stack.account}:autoScalingGroup:*:autoScalingGroupName/${name}`],
    }));
    // assign-ipv6-addresses: network interfaces in the service's subnet only
    // (IAM cannot name the interface before it exists).
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'TakeFixedIpv6Address',
      actions: ['ec2:AssignIpv6Addresses'],
      resources: [ec2Arn('network-interface', '*')],
      conditions: { ArnEquals: { 'ec2:Subnet': ec2Arn('subnet', subnet.ref) } },
    }));
    const profile = new iam.CfnInstanceProfile(this, 'Profile', { roles: [role.roleName] });

    // ---- User data ---------------------------------------------------------------
    const eipId = readRef(this, config, 'calls/eip-allocation-id');
    const eipAddress = readRef(this, config, 'calls/eip-address');
    const userData = [
      '#!/bin/bash',
      'set -euo pipefail',
      '# Instance boot (CALLING-SERVICE 8.2): take the fixed addresses, run the pinned image.',
      '# retry <tries> <command...>: backoff 6 s, 12 s, ... capped at 60 s.',
      'retry() { local n=$1 i; shift; for ((i=1; i<=n; i++)); do "$@" && return 0; [ "$i" -lt "$n" ] && sleep $(( i < 10 ? i * 6 : 60 )); done; return 1; }',
      'TOKEN=$(retry 10 curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")',
      'md() { curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }',
      'IID=$(retry 10 md instance-id)',
      `export AWS_DEFAULT_REGION=${stack.region}`,
      '# Any failure below marks this instance unhealthy: the group replaces it and',
      '# a dead instance does not keep the addresses.',
      `fail() { aws autoscaling set-instance-health --instance-id "$IID" --health-status Unhealthy --no-should-respect-grace-period || true; exit 1; }`,
      'trap fail ERR',
      'MAC=$(retry 10 md mac)',
      'ENI=$(retry 10 md "network/interfaces/macs/$MAC/interface-id")',
      'PRIVATE_IPV4=$(retry 10 md local-ipv4)',
      `retry 10 aws ec2 associate-address --allocation-id ${eipId} --instance-id "$IID" --allow-reassociation`,
      '# An old interface may still hold the IPv6 address during a replacement: about 5 minutes.',
      `retry 10 aws ec2 assign-ipv6-addresses --network-interface-id "$ENI" --ipv6-addresses ${ipv6}`,
      `for i in $(seq 1 60); do ip -6 addr show scope global | grep -iF "${ipv6}/" >/dev/null && break; [ "$i" -lt 60 ] || false; sleep 5; done`,
      'retry 10 dnf install -y docker',
      'systemctl enable --now docker',
      `retry 8 docker pull ${image}`,
      // No log driver: coturn's log names every client address and username and
      // is never kept or shipped (CALLING-SERVICE 10).
      'docker run --detach --name turn --restart unless-stopped --network host --read-only --log-driver none \\',
      '  --tmpfs /run/vettid-calls:rw,mode=0700,uid=65534,gid=65534 \\',
      `  -e CALLS_TURN_HOST=${calls.turnHost} \\`,
      '  -e CALLS_PRIVATE_IPV4="$PRIVATE_IPV4" \\',
      `  -e CALLS_PUBLIC_IPV4=${eipAddress} \\`,
      `  -e CALLS_IPV6=${ipv6} \\`,
      `  -e CALLS_OWN_NETWORKS=${CALLS_VPC_CIDR},${vpcV6} \\`,
      `  -e CALLS_SECRET_ID=${callsSecretName(config)} \\`,
      `  -e AWS_REGION=${stack.region} \\`,
      `  -e CALLS_METRICS_NAMESPACE=${namespace} \\`,
      `  -e CALLS_MAX_KBPS=${CALLS_MAX_KBPS} \\`,
      `  ${image}`,
      '',
    ].join('\n');

    // ---- Launch template and Auto Scaling group of one --------------------------------
    const ami = ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }).getImage(this).imageId;
    const lt = new ec2.CfnLaunchTemplate(this, 'Template', {
      launchTemplateData: {
        imageId: ami,
        instanceType: 't4g.small',
        // No keyName: Systems Manager sessions only.
        iamInstanceProfile: { arn: profile.attrArn },
        // Hop limit 1: with host networking the container IS the host's network
        // namespace and reaches IMDS (it needs the instance role); what stops a
        // relay to the metadata address is coturn's denied-peer list (§7.2).
        metadataOptions: { httpTokens: 'required', httpEndpoint: 'enabled', httpPutResponseHopLimit: 1 },
        // A public address to reach the APIs before the Elastic IP is taken.
        networkInterfaces: [{ deviceIndex: 0, associatePublicIpAddress: true, groups: [sg.attrGroupId], deleteOnTermination: true }],
        blockDeviceMappings: [{ deviceName: '/dev/xvda', ebs: { volumeSize: 8, volumeType: 'gp3', encrypted: true, deleteOnTermination: true } }],
        userData: cdk.Fn.base64(userData),
        tagSpecifications: ['instance', 'volume'].map((resourceType) => ({
          resourceType, tags: [{ key: 'Name', value: name }, tag],
        })),
      },
    });
    const asg = new autoscaling.CfnAutoScalingGroup(this, 'Group', {
      autoScalingGroupName: name,
      minSize: '0', // the daily stop sets the desired capacity to 0
      maxSize: '1',
      desiredCapacity: '1',
      vpcZoneIdentifier: [subnet.ref],
      launchTemplate: { launchTemplateId: lt.ref, version: lt.attrLatestVersionNumber },
      healthCheckType: 'EC2',
      tags: [{ key: 'Name', value: name, propagateAtLaunch: true }, { key: tag.key, value: tag.value, propagateAtLaunch: true }],
    });
    asg.cfnOptions.updatePolicy = { autoScalingRollingUpdate: { minInstancesInService: 0, maxBatchSize: 1 } };
    asg.addDependency(r4);
    asg.addDependency(r6);
    asg.addDependency(routesAssoc);
    lt.addDependency(v6);
    asg.node.addDependency(role);

    // ---- DNS: the fixed addresses, in the stage's zone ----------------------------------
    new route53.ARecord(this, 'TurnA', { zone, recordName: calls.turnHost, target: route53.RecordTarget.fromValues(eipAddress) });
    new route53.AaaaRecord(this, 'TurnAaaa', { zone, recordName: calls.turnHost, target: route53.RecordTarget.fromValues(ipv6) });

    // ---- The daily stop (§7.3) and alarms (§10) -----------------------------------------
    const topic = { bind: () => ({ alarmActionArn: props.topicArn }) };
    const stop = new autoscaling.CfnScalingPolicy(this, 'DailyStop', {
      autoScalingGroupName: asg.ref,
      policyType: 'StepScaling',
      adjustmentType: 'ExactCapacity',
      stepAdjustments: [{ scalingAdjustment: 0, metricIntervalLowerBound: 0 }],
    });
    const stopAction = { bind: () => ({ alarmActionArn: stop.ref }) };
    const five = cdk.Duration.minutes(5);
    const own = (metricName: string, statistic: string, period: cdk.Duration, dimensionsMap?: Record<string, string>) =>
      new cloudwatch.Metric({ namespace, metricName, dimensionsMap, statistic, period });
    const alarm = (cid: string, alarmName: string, a: Omit<cloudwatch.AlarmProps, 'alarmName'>, actions: cloudwatch.IAlarmAction[] = [topic]) => {
      const x = new cloudwatch.Alarm(this, cid, { alarmName: `${callsName(config)}-${alarmName}`, ...a });
      for (const action of actions) x.addAlarmAction(action);
      return x;
    };
    const says = (text: string) => `Calling service TURN server: ${text} (RUNBOOK "Calling service" → Alarms).`;
    const atLeast = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;

    const heartbeat = alarm('NoHeartbeat', 'no-turn-heartbeat', {
      alarmDescription: says('no heartbeat from turn-agent for 5 minutes: the instance, the container or the agent is down'),
      metric: own('heartbeat', 'Sum', five),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    heartbeat.addOkAction(topic); // and on recovery

    // The instance group's own NetworkOut (basic monitoring) counts everything
    // sent, live calls included; turn-agent's bytes_relayed only counts
    // finished sessions (vettid-calls README "Metrics of the server").
    const sentPerDay = new cloudwatch.Metric({
      namespace: 'AWS/EC2', metricName: 'NetworkOut', dimensionsMap: { AutoScalingGroupName: asg.ref },
      statistic: 'Sum', period: cdk.Duration.days(1),
    });
    alarm('VolumeDay', 'relay-volume-day', {
      alarmDescription: says('more than 5 GB sent in a day (at 30 GB the relay is stopped, relay-stopped)'),
      metric: sentPerDay,
      threshold: CALLS_DAY_ALARM_BYTES,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm('Stopped', 'relay-stopped', {
      alarmDescription: says('30 GB sent in a day: the instance group was set to ZERO and the relay is OFF. The stop is repeated every minute while this alarm stays in ALARM, and nothing raises the capacity afterwards: the relay stays at 0 until the operator sets the desired capacity to 1, which holds only once this alarm is OK (the trailing 24 hours below 30 GB). An earlier restart needs disable-alarm-actions on this alarm first, which also silences its notification; see RUNBOOK "Calling service" → After the daily stop'),
      metric: sentPerDay,
      threshold: CALLS_DAY_STOP_BYTES,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }, [topic, stopAction]);
    alarm('Capacity', 'relay-capacity', {
      alarmDescription: says(`allocations at 80 % of what the relay admits (${CALLS_ALLOCATIONS_ALARM} of ${CALLS_ALLOCATIONS_MAX}), or any refusal for quota_total or capacity, for 10 minutes`),
      metric: new cloudwatch.MathExpression({
        label: 'relay full or filling',
        expression: `IF(FILL(alloc, 0) >= ${CALLS_ALLOCATIONS_ALARM} OR FILL(total, 0) + FILL(capacity, 0) > 0, 1, 0)`,
        usingMetrics: {
          alloc: own('allocations', 'Maximum', five),
          total: own('allocations_refused', 'Sum', five, { reason: 'quota_total' }),
          capacity: own('allocations_refused', 'Sum', five, { reason: 'capacity' }),
        },
        period: five,
      }),
      threshold: 1,
      comparisonOperator: atLeast,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm('AgentErrors', 'turn-agent-errors', {
      alarmDescription: says('turn-agent reported an error (agent_errors: secret, config, start, exit, scrape or metrics; its log is dropped, so this is the only sign)'),
      metric: new cloudwatch.MathExpression({
        label: 'agent errors',
        expression: 'FILL(secret, 0) + FILL(config, 0) + FILL(start, 0) + FILL(exit, 0) + FILL(scrape, 0) + FILL(metrics, 0)',
        usingMetrics: Object.fromEntries(['secret', 'config', 'start', 'exit', 'scrape', 'metrics'].map((k) => [k, own('agent_errors', 'Sum', five, { kind: k })])),
        period: five,
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // TODO(first week of operation): CALLS_AUTH_FAILURES_PER_HOUR is a
    // placeholder. A public TURN server is probed constantly; set the
    // baseline from the first week's `auth_failures` numbers (CALLING-SERVICE §10).
    alarm('AuthFailures', 'turn-auth-failures', {
      alarmDescription: says(`more than ${CALLS_AUTH_FAILURES_PER_HOUR} authentication failures in an hour (PLACEHOLDER baseline until the first week's numbers)`),
      metric: own('auth_failures', 'Sum', cdk.Duration.hours(1)),
      threshold: CALLS_AUTH_FAILURES_PER_HOUR,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cdk.CfnOutput(this, 'ServerGroup', { value: asg.ref, description: 'After the daily stop the group stays at 0 until the operator sets its desired capacity to 1 (holds only once relay-stopped is OK; an early restart needs disable-alarm-actions first)' });
    new cdk.CfnOutput(this, 'ServerIpv6', { value: ipv6 });
  }
}
