import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';
import { publishRef, readRef } from '../constructs/ssm-refs';

export interface VettidOrgAdminAccessStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/** Name of the secret holding the Headscale pre-auth key. Created by hand (see RUNBOOK). */
export function headscaleKeySecretName(config: AppConfig): string {
  return `${resourceName(config, 'admin-access')}/headscale-preauth-key`;
}

/**
 * Everything that decides *who can reach admin* (docs/ACCOUNT-ADMIN-PLAN.md §4):
 *
 *  - a Tailscale exit node in AWS, joined to the operator's Headscale, with a
 *    fixed Elastic IP. Admins turn this exit node on to use admin.
 *  - WAF allowlists keyed to that IP: a REGIONAL web ACL associated with the
 *    admin Cognito pool (hosted-UI login), and a CLOUDFRONT web ACL that the
 *    admin site stack attaches. The admin API's resource policy reads the
 *    same IP from SSM.
 *
 * Kept apart from the auth stack so a change to the admin network never
 * touches the user pools.
 */
export class VettidOrgAdminAccessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAdminAccessStackProps) {
    super(scope, id, props);
    const { config } = props;
    const loginServer = config.adminAccess.headscaleLoginServer;
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(loginServer)) {
      throw new Error('Set context "headscaleLoginServer" (https://...) in cdk.json for the admin exit node');
    }

    // ---- Network: one public subnet, no NAT, nothing inbound but WireGuard.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.42.0.0/24'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 28 }],
    });

    const sg = new ec2.SecurityGroup(this, 'ExitNodeSg', {
      vpc,
      description: 'Tailscale exit node: WireGuard in, anything out',
      allowAllOutbound: true,
    });
    // Lets tailnet peers connect directly instead of via DERP relays.
    // WireGuard drops anything not from an authorized peer key. No SSH: admin
    // of the box is SSM Session Manager only.
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(41641), 'Tailscale WireGuard (direct peers)');

    const role = new iam.Role(this, 'ExitNodeRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    const keySecret = secretsmanager.Secret.fromSecretNameV2(this, 'HeadscaleKey', headscaleKeySecretName(config));
    keySecret.grantRead(role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      // Unattended security updates.
      'dnf install -y dnf-automatic',
      "sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf",
      'systemctl enable --now dnf-automatic.timer',
      // Tailscale from its official repo.
      'dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo',
      'dnf install -y tailscale',
      "printf 'net.ipv4.ip_forward = 1\\nnet.ipv6.conf.all.forwarding = 1\\n' > /etc/sysctl.d/99-tailscale.conf",
      'sysctl -p /etc/sysctl.d/99-tailscale.conf',
      'systemctl enable --now tailscaled',
      // Join Headscale as an exit node. The key is read at boot, never baked in.
      `KEY=$(aws secretsmanager get-secret-value --region ${config.region} --secret-id ${headscaleKeySecretName(config)} --query SecretString --output text)`,
      `tailscale up --login-server=${loginServer} --authkey="$KEY" --advertise-exit-node --hostname=${resourceName(config, 'admin-exit')}`,
      'unset KEY',
    );

    const instance = new ec2.Instance(this, 'ExitNode', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      // Pinned in cdk.context.json: a newer AMI must never silently replace
      // the node (that would drop it from the tailnet). Patching is dnf-automatic.
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        cachedInContext: true,
      }),
      securityGroup: sg,
      role,
      userData,
      requireImdsv2: true,
      blockDevices: [
        { deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(8, { encrypted: true, volumeType: ec2.EbsDeviceVolumeType.GP3 }) },
      ],
    });

    const eip = new ec2.CfnEIP(this, 'EgressIp', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: resourceName(config, 'admin-egress') }],
    });
    // Keep the address even if the stack goes: allowlists elsewhere may hold it.
    eip.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    new ec2.CfnEIPAssociation(this, 'EgressIpAssoc', {
      allocationId: eip.attrAllocationId,
      instanceId: instance.instanceId,
    });
    const egressCidr = cdk.Fn.join('', [eip.ref, '/32']);

    // ---- WAF allowlists keyed to the egress IP.
    const allowOnly = (scope: 'REGIONAL' | 'CLOUDFRONT', idPrefix: string, metric: string) => {
      const ipSet = new wafv2.CfnIPSet(this, `${idPrefix}IpSet`, {
        name: resourceName(config, `admin-${scope.toLowerCase()}`),
        scope,
        ipAddressVersion: 'IPV4',
        addresses: [egressCidr],
        description: 'Admin tailnet exit node egress IP',
      });
      return new wafv2.CfnWebACL(this, `${idPrefix}Acl`, {
        name: resourceName(config, `admin-${scope.toLowerCase()}`),
        scope,
        defaultAction: { block: {} },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: metric, sampledRequestsEnabled: true },
        rules: [
          {
            name: 'allow-admin-exit-node',
            priority: 0,
            action: { allow: {} },
            statement: { ipSetReferenceStatement: { arn: ipSet.attrArn } },
            visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `${metric}-allow`, sampledRequestsEnabled: true },
          },
        ],
      });
    };

    const loginAcl = allowOnly('REGIONAL', 'Login', 'vettid-org-admin-login');
    new wafv2.CfnWebACLAssociation(this, 'LoginAclAssoc', {
      resourceArn: readRef(this, config, 'auth/admin-pool-arn'),
      webAclArn: loginAcl.attrArn,
    });

    const siteAcl = allowOnly('CLOUDFRONT', 'Site', 'vettid-org-admin-site');

    publishRef(this, config, 'admin-access/egress-ip', eip.ref);
    publishRef(this, config, 'admin-access/site-web-acl-arn', siteAcl.attrArn);

    new cdk.CfnOutput(this, 'EgressIpOut', { value: eip.ref, description: 'Admin exit node public IP (allowlisted)' });
    new cdk.CfnOutput(this, 'ExitNodeInstanceId', {
      value: instance.instanceId,
      description: 'aws ssm start-session --target <id> to administer the node',
    });
  }
}
