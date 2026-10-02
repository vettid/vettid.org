import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';

export interface VettidOrgVaultSmokeStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /**
   * PCR0 (96 hex) of the smoke enclave image, once built. Empty on the first
   * deploy: the key then grants no attested use at all.
   */
  readonly pcr0: string;
}

/**
 * TEMPORARY hardware smoke test for the vault (docs/VAULT-PLAN.md V5;
 * vettid-vault docs/SMOKE.md). Deployed only with context vaultSmoke=true and
 * destroyed when the test is done — nothing here is production.
 *
 * - One Graviton host with Nitro Enclaves, public subnet, no NAT, no inbound;
 *   managed through SSM only. The enclave image is built on the host.
 * - A DELETABLE test KMS key (owner decision 2026-10-02): it keeps the
 *   default admin statement, so the enclave's key-policy check (VAULT-MESSAGING
 *   §11.10.7) is expected to REJECT it; the attested GenerateDataKey/Decrypt
 *   round trip is what this key verifies. Real release keys are created
 *   locked and can never be deleted.
 * - A scratch bucket, emptied and deleted with the stack.
 */
export class VettidOrgVaultSmokeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgVaultSmokeStackProps) {
    super(scope, id, props);
    const { config, pcr0 } = props;
    if (pcr0 && !/^[0-9a-f]{96}$/.test(pcr0)) {
      throw new Error('vaultSmokePcr0 must be 96 lowercase hex characters');
    }

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.44.0.0/24'),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });
    const sg = new ec2.SecurityGroup(this, 'HostSg', {
      vpc,
      description: 'vault smoke host: no inbound; outbound for packages, relay, KMS, S3, SSM',
      allowAllOutbound: true,
    });

    const role = new iam.Role(this, 'HostRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });

    const bucket = new s3.Bucket(this, 'Scratch', {
      bucketName: `${resourceName(config, 'vault-smoke')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [bucket.arnForObjects('smoke/*')],
    }));

    const key = new kms.Key(this, 'TestKey', {
      alias: resourceName(config, 'vault-smoke-test'),
      description: 'DELETABLE vault smoke-test key (not a release key; fails the §11.10.7 check by design)',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(7),
    });
    // Metadata the enclave's policy check reads.
    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'SmokeRead',
      principals: [new iam.ArnPrincipal(role.roleArn)],
      actions: ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:ListGrants'],
      resources: ['*'],
    }));
    if (pcr0) {
      // Attested use only, by the smoke image (same shape as a release key).
      for (const [sid, action] of [['SmokeAttestedDecrypt', 'kms:Decrypt'], ['SmokeAttestedGenerateDataKey', 'kms:GenerateDataKey']]) {
        key.addToResourcePolicy(new iam.PolicyStatement({
          sid,
          principals: [new iam.ArnPrincipal(role.roleArn)],
          actions: [action],
          resources: ['*'],
          conditions: {
            StringEqualsIgnoreCase: { 'kms:RecipientAttestation:ImageSha384': pcr0 },
            StringEquals: { 'kms:CallerAccount': this.account },
          },
        }));
      }
    }

    const instance = new ec2.Instance(this, 'Host', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M7G, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      securityGroup: sg,
      role,
      enclaveEnabled: true,
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 1,
      blockDevices: [
        { deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(30, { encrypted: true, volumeType: ec2.EbsDeviceVolumeType.GP3 }) },
      ],
    });

    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'KeyArn', { value: key.keyArn });
    new cdk.CfnOutput(this, 'HostRoleArn', { value: role.roleArn });
  }
}
