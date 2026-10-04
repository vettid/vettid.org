import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import { Construct } from 'constructs';
import { AppConfig, VAULT_ROLE_NAMES, resourceName } from '../config';
import { publishRef, readRef, ssmParamName } from '../constructs/ssm-refs';
import { contentHash, renderBuildComponent } from '../vault/image-component';
import { SCALER_TAGS, VAULT_DRAIN_HOOK, VaultReleaseSpec, releaseGroupThing, validateReleaseSpec } from '../vault/releases';

export interface VettidOrgVaultReleaseStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  readonly spec: VaultReleaseSpec;
}

/** The instance type (owner decision O6). The enclave gets 1 vCPU and 5 GiB (deploy/host/allocator.yaml). */
export const VAULT_HOST_INSTANCE_TYPE = 'm7g.large';

/** Stack id of release N: one small stack per live release (VAULT-RELEASES §8.2). */
export const releaseStackId = (n: number) => `VettidOrgVaultRelease${n}Stack`;

/**
 * One live vault release's hosts (VAULT-RELEASES §8.2, §8.3), in the vault
 * account. Stateless; deleting it is how a removed release stops (§10.3).
 *
 *  - The AMI: an EC2 Image Builder component (lib/vault/image-component.ts:
 *    the release's EIF and parent from its GitHub release, verified against
 *    the pinned measurements and PCR0; its own tag's units, C4), a recipe on
 *    the pinned AL2023 arm64 base AMI and an image built at deploy time in
 *    the host stack's build VPC. Names carry a content hash: Image Builder
 *    versions are immutable, so new content is a new resource.
 *  - The launch template: m7g.large, Nitro Enclaves on, IMDSv2 with hop
 *    limit 1, the fixed host instance profile, no key pair, encrypted gp3
 *    root, public IPv4 in the host VPC's public subnets, the host security
 *    group. User data only writes /etc/vettid/host.env (where the SSM refs
 *    live, the release, the group and hook names); the boot reads the rest
 *    from SSM (vettid-vault deploy/host).
 *  - The group `vettid-org-vault-r<N>`: min from the release entry (0 or 1),
 *    max ≤ 2, NO desired capacity in the template (the scaler owns it, and a
 *    deploy never resets it), tags the scaler matches, the termination
 *    lifecycle hook the parent drains on (≤ 5 min), no update policy: a
 *    deploy never replaces running instances (D1; a host patch is an
 *    explicit instance refresh of this group only, RUNBOOK).
 *  - SSM `vault/releases/<N>/group-name` (the manifest sync's `available`)
 *    and an alarm when the group cannot keep its desired capacity in service.
 */
export class VettidOrgVaultReleaseStack extends cdk.Stack {
  readonly groupName: string;
  readonly image: imagebuilder.CfnImage;

  constructor(scope: Construct, id: string, props: VettidOrgVaultReleaseStackProps) {
    super(scope, id, props);
    const { config, spec } = props;
    const vault = config.vault;
    if (!vault) throw new Error(`stage ${config.stage} has no vault account`);
    if (props.env?.account !== vault.account) {
      throw new Error(`${id} must be deployed into the ${vault.channel} vault account ${vault.account}`);
    }
    validateReleaseSpec(spec, vault.channel);
    const n = spec.release;
    this.groupName = resourceName(config, releaseGroupThing(n));

    // ---- AMI (§8.3) ------------------------------------------------------------------
    const componentDoc = renderBuildComponent(spec);
    const hash = contentHash(componentDoc, spec.baseAmi, String(spec.amiRevision));
    const imageName = `${this.groupName}-${hash}`;
    const component = new imagebuilder.CfnComponent(this, 'Component', {
      name: imageName,
      version: '1.0.0',
      platform: 'Linux',
      supportedOsVersions: ['Amazon Linux 2023'],
      description: `Vault ${spec.channel} release ${n}: EIF, parent and host units, verified (${spec.tag})`,
      data: componentDoc,
    });
    const recipe = new imagebuilder.CfnImageRecipe(this, 'Recipe', {
      name: imageName,
      version: '1.0.0',
      parentImage: spec.baseAmi,
      components: [{ componentArn: component.attrArn }],
      blockDeviceMappings: [{ deviceName: '/dev/xvda', ebs: { volumeSize: 20, volumeType: 'gp3', encrypted: true, deleteOnTermination: true } }],
      description: `Vault ${spec.channel} release ${n} host image`,
    });
    this.image = new imagebuilder.CfnImage(this, 'Image', {
      imageRecipeArn: recipe.attrArn,
      infrastructureConfigurationArn: readRef(this, config, 'vault/image-builder-infra-arn'),
      imageTestsConfiguration: { imageTestsEnabled: false },
      enhancedImageMetadataEnabled: false,
      tags: { 'vettid:vault-release': String(n), 'vettid:vault-channel': spec.channel },
    });

    // ---- launch template -------------------------------------------------------------
    const ssmPrefix = ssmParamName(config, 'vault/data-bucket-name').replace(/\/data-bucket-name$/, '');
    const userData = [
      '#cloud-config',
      'write_files:',
      '  - path: /etc/vettid/host.env',
      '    owner: root:root',
      "    permissions: '0644'",
      '    content: |',
      `      VETTID_SSM_PREFIX=${ssmPrefix}`,
      `      VETTID_REGION=${config.region}`,
      `      VETTID_RELEASE=${n}`,
      `      VETTID_ASG_NAME=${this.groupName}`,
      `      VETTID_LIFECYCLE_HOOK=${VAULT_DRAIN_HOOK}`,
      '',
    ].join('\n');
    const commonTags = [
      { key: 'Name', value: this.groupName },
      { key: SCALER_TAGS.release, value: String(n) },
      { key: SCALER_TAGS.pcr0, value: spec.pcr0 },
    ];
    const lt = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateName: this.groupName,
      launchTemplateData: {
        imageId: this.image.attrImageId,
        instanceType: VAULT_HOST_INSTANCE_TYPE,
        iamInstanceProfile: { name: VAULT_ROLE_NAMES.host },
        enclaveOptions: { enabled: true },
        metadataOptions: { httpTokens: 'required', httpPutResponseHopLimit: 1, httpEndpoint: 'enabled', instanceMetadataTags: 'disabled' },
        networkInterfaces: [
          { deviceIndex: 0, associatePublicIpAddress: true, deleteOnTermination: true, groups: [readRef(this, config, 'vault/host-security-group-id')] },
        ],
        blockDeviceMappings: [{ deviceName: '/dev/xvda', ebs: { volumeSize: 20, volumeType: 'gp3', encrypted: true, deleteOnTermination: true } }],
        userData: cdk.Fn.base64(userData),
        tagSpecifications: ['instance', 'volume'].map((resourceType) => ({ resourceType, tags: commonTags })),
      },
    });

    // ---- the group ------------------------------------------------------------------------
    const asg = new autoscaling.CfnAutoScalingGroup(this, 'Group', {
      autoScalingGroupName: this.groupName,
      minSize: String(spec.minInstances),
      maxSize: String(spec.maxInstances),
      launchTemplate: { launchTemplateId: lt.ref, version: lt.attrLatestVersionNumber },
      vpcZoneIdentifier: cdk.Fn.split(',', readRef(this, config, 'vault/host-subnet-ids'), 2),
      healthCheckType: 'EC2',
      healthCheckGracePeriod: 300,
      lifecycleHookSpecificationList: [
        { lifecycleHookName: VAULT_DRAIN_HOOK, lifecycleTransition: 'autoscaling:EC2_INSTANCE_TERMINATING', heartbeatTimeout: 300, defaultResult: 'CONTINUE' },
      ],
      metricsCollection: [{ granularity: '1Minute', metrics: ['GroupDesiredCapacity', 'GroupInServiceInstances'] }],
      tags: [
        ...commonTags.map((t) => ({ ...t, propagateAtLaunch: true })),
        { key: SCALER_TAGS.managed, value: 'managed', propagateAtLaunch: false },
      ],
    });

    // ---- refs and alarm -----------------------------------------------------------------
    publishRef(this, config, `vault/releases/${n}/group-name`, this.groupName).node.addDependency(asg);

    const m = (metricName: string) =>
      new cloudwatch.Metric({ namespace: 'AWS/AutoScaling', metricName, dimensionsMap: { AutoScalingGroupName: this.groupName }, statistic: 'Minimum', period: cdk.Duration.minutes(1) });
    const unhealthy = new cloudwatch.Alarm(this, 'GroupShort', {
      alarmName: `${this.groupName}-short`,
      alarmDescription: `Vault release ${n}: fewer instances in service than desired for 15 minutes (launch, AMI or capacity problem)`,
      metric: new cloudwatch.MathExpression({
        expression: 'desired - inservice',
        usingMetrics: { desired: m('GroupDesiredCapacity'), inservice: m('GroupInServiceInstances') },
        period: cdk.Duration.minutes(1),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 15,
      datapointsToAlarm: 15,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    unhealthy.addAlarmAction({ bind: () => ({ alarmActionArn: readRef(this, config, 'vault/alerts-topic-arn') }) });

    new cdk.CfnOutput(this, 'GroupName', { value: this.groupName });
    new cdk.CfnOutput(this, 'ImageId', { value: this.image.attrImageId });
  }
}
