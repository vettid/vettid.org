import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';
import { publishRef } from '../constructs/ssm-refs';
import { WafLogging } from '../constructs/waf-logging';

/** CloudWatch log group for SSM Session Manager transcripts of the exit node. */
export function ssmSessionLogGroupName(config: AppConfig): string {
  return config.stage === 'prod' ? '/vettid-org/ssm-sessions' : `/vettid-org/${config.stage}/ssm-sessions`;
}

/**
 * nftables table that drops anything the exit node would FORWARD to
 * link-local / the instance metadata service. Tailnet clients route
 * everything through this box; without it, a peer could reach
 * 169.254.169.254 "through" the exit node and lift the instance role's
 * credentials (IMDSv2 + hop limit 1 is the second layer).
 *
 * A separate nft table with its own forward-hook chain at a priority before
 * the iptables-nft `filter` table: a drop in ANY base chain is final, so no
 * ACCEPT that tailscaled adds to FORWARD (ts-forward) can bypass it, and it
 * doesn't depend on rule order when tailscaled re-inserts its chains.
 */
const LINK_LOCAL_DROP_NFT = [
  'table inet vettid_linklocal {',
  '  chain forward {',
  '    type filter hook forward priority -10; policy accept;',
  '    ip daddr 169.254.0.0/16 drop',
  '    ip6 daddr fd00:ec2::/32 drop',
  '  }',
  '}',
];
const LINK_LOCAL_DROP_UNIT = [
  '[Unit]',
  'Description=Drop forwarded traffic to link-local (instance metadata)',
  'Before=network-pre.target tailscaled.service',
  'Wants=network-pre.target',
  '',
  '[Service]',
  'Type=oneshot',
  'RemainAfterExit=yes',
  'ExecStartPre=-nft delete table inet vettid_linklocal',
  'ExecStart=nft -f /etc/nftables/vettid-linklocal.nft',
  'ExecStop=nft delete table inet vettid_linklocal',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
];
/** Shell line writing `lines` to `path` (printf with one %s per line; no quoting surprises). */
const writeFile = (path: string, lines: string[]) =>
  `printf '%s\\n' ${lines.map((l) => `'${l.replace(/'/g, `'\\''`)}'`).join(' ')} > ${path}`;

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
 *  - a CLOUDFRONT web ACL allowing only that IP, attached by the admin site
 *    stack. The admin API's resource policy reads the same IP from SSM.
 *    (The admin Cognito pool deliberately has no WAF — see below.)
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
      throw new Error('Set context "headscaleLoginServer" (https://...) in ~/.cdk.json (kept out of the repo) for the admin exit node');
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

    // Session Manager transcripts. Point the account's Session Manager
    // preferences at this group (RUNBOOK); the instance role writes them.
    const sessionLogs = new logs.LogGroup(this, 'SsmSessionLogs', {
      logGroupName: ssmSessionLogGroupName(config),
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      resources: [sessionLogs.logGroupArn],
    }));
    // The SSM agent checks the group exists before streaming; DescribeLogGroups
    // has no resource-level scoping (read-only metadata).
    role.addToPolicy(new iam.PolicyStatement({ actions: ['logs:DescribeLogGroups'], resources: ['*'] }));

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      // A t4g.nano has 512 MB; dnf's metadata load gets OOM-killed without swap.
      'if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=1024 && chmod 600 /swapfile && mkswap /swapfile; fi',
      'swapon /swapfile || true',
      "grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap defaults 0 0' >> /etc/fstab",
      // Unattended security updates.
      'dnf install -y dnf-automatic',
      "sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf",
      'systemctl enable --now dnf-automatic.timer',
      // Never forward to link-local (IMDS) — in place before forwarding is on.
      'dnf install -y nftables',
      'mkdir -p /etc/nftables',
      writeFile('/etc/nftables/vettid-linklocal.nft', LINK_LOCAL_DROP_NFT),
      writeFile('/etc/systemd/system/vettid-linklocal-drop.service', LINK_LOCAL_DROP_UNIT),
      'systemctl daemon-reload',
      'systemctl enable --now vettid-linklocal-drop.service',
      // Tailscale from its official repo.
      'dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo',
      'dnf install -y tailscale',
      "printf 'net.ipv4.ip_forward = 1\\nnet.ipv6.conf.all.forwarding = 1\\n' > /etc/sysctl.d/99-tailscale.conf",
      'sysctl -p /etc/sysctl.d/99-tailscale.conf',
      'systemctl enable --now tailscaled',
      // Join Headscale as an exit node. The key is read at boot, never baked in.
      `KEY=$(aws secretsmanager get-secret-value --region ${config.region} --secret-id ${headscaleKeySecretName(config)} --query SecretString --output text)`,
      // --accept-dns=false: Headscale's DNS (MagicDNS → the operator's home
      // resolvers) is unreachable from AWS; the node must keep the VPC resolver
      // or every lookup — including exit-node traffic — hangs.
      `tailscale up --login-server=${loginServer} --authkey="$KEY" --advertise-exit-node --accept-dns=false --hostname=${resourceName(config, 'admin-exit')}`,
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
      // IMDSv2 only, and a PUT hop limit of 1: a token request that has been
      // forwarded (e.g. from a tailnet peer) can't get a response.
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 1,
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
    const allowOnly = (scope: 'CLOUDFRONT', idPrefix: string, metric: string) => {
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

    // No WAF on the admin user pool: the classic hosted UI makes some calls
    // (e.g. the first-login "set new password" step) from Cognito's own
    // servers, so an IP allowlist there blocks legitimate sign-ins (found on
    // first deploy: blocked from 50.17.x.x, an AWS address). The pool keeps
    // TOTP MFA; tokens it issues are only usable through the IP-locked site
    // and API.
    const siteAcl = allowOnly('CLOUDFRONT', 'Site', 'vettid-org-admin-site');
    new WafLogging(this, 'SiteAclLogging', {
      webAclArn: siteAcl.attrArn,
      logGroupName: `aws-waf-logs-${resourceName(config, 'admin')}`,
    });

    publishRef(this, config, 'admin-access/egress-ip', eip.ref);
    publishRef(this, config, 'admin-access/site-web-acl-arn', siteAcl.attrArn);

    new cdk.CfnOutput(this, 'EgressIpOut', { value: eip.ref, description: 'Admin exit node public IP (allowlisted)' });
    new cdk.CfnOutput(this, 'ExitNodeInstanceId', {
      value: instance.instanceId,
      description: 'aws ssm start-session --target <id> to administer the node',
    });
  }
}
