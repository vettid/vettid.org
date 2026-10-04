import * as cdk from 'aws-cdk-lib';
import * as accessanalyzer from 'aws-cdk-lib/aws-accessanalyzer';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';
import { readRef } from '../constructs/ssm-refs';

/** AWS Organizations organization (docs/AWS-ACCOUNTS.md). */
const ORG_ID = 'o-kualrldevn';

export interface VettidOrgAuditStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Account-level audit and detection (security review, 2026-10-01):
 *  - CloudTrail: one multi-region trail with log-file validation into a
 *    dedicated, retained bucket; S3 data events on the membership-terms bucket
 *  - GuardDuty detector (us-east-1)
 *  - IAM Access Analyzer (account scope) for anything shared externally
 *  - EventBridge → SNS → email alerts for high-signal events. CDK deploys
 *    create roles and security groups all the time, so rules exclude
 *    CloudFormation's deploy role rather than alerting on every deploy.
 *
 * The SNS email subscription must be confirmed once from the inbox.
 * Alert rules run in us-east-1, where global (IAM, sign-in) events land.
 */
export class VettidOrgAuditStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgAuditStackProps) {
    super(scope, id, props);
    const { config } = props;

    // ---- CloudTrail -------------------------------------------------------
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      bucketName: `${resourceName(config, 'cloudtrail')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [{ storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: cdk.Duration.days(90) }],
          expiration: cdk.Duration.days(400),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    const trail = new cloudtrail.Trail(this, 'Trail', {
      trailName: resourceName(config, 'trail'),
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
      // Organization trail: also records every member account (vault prod,
      // vault staging, proteus — docs/AWS-ACCOUNTS.md). Members can't stop or
      // change it; the SCP baseline protects their side as well.
      isOrganizationTrail: true,
      orgId: ORG_ID,
    });
    // Who read or wrote membership terms (data events; cents per month).
    const termsBucket = s3.Bucket.fromBucketName(this, 'TermsBucket', readRef(this, config, 'data/terms-bucket-name'));
    trail.addS3EventSelector([{ bucket: termsBucket }], { readWriteType: cloudtrail.ReadWriteType.ALL, includeManagementEvents: false });

    // ---- GuardDuty + Access Analyzer ---------------------------------------
    new guardduty.CfnDetector(this, 'GuardDuty', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      features: [{ name: 'S3_DATA_EVENTS', status: 'ENABLED' }],
    });
    new accessanalyzer.CfnAnalyzer(this, 'AccessAnalyzer', {
      analyzerName: resourceName(config, 'access-analyzer'),
      type: 'ACCOUNT',
    });

    // ---- Alerts -------------------------------------------------------------
    const topic = new sns.Topic(this, 'Alerts', {
      topicName: resourceName(config, 'security-alerts'),
      displayName: 'VettID security alerts',
    });
    topic.addSubscription(new subs.EmailSubscription(config.adminEmail));

    // "Not CloudFormation's CDK deploy role." anything-but never matches a
    // MISSING field, and IAM-user/root calls have no session issuer, so those
    // must be matched explicitly or they'd slip through unalerted.
    const notDeploy = {
      $or: [
        { userIdentity: { sessionContext: { sessionIssuer: { userName: events.Match.anythingButPrefix('cdk-') } } } },
        { userIdentity: { sessionContext: { sessionIssuer: { userName: events.Match.doesNotExist() } } } },
      ],
    };
    const apiCall = (id: string, description: string, source: string[], detail: Record<string, unknown>) =>
      new events.Rule(this, id, {
        description,
        eventPattern: { source, detailType: ['AWS API Call via CloudTrail'], detail },
        targets: [
          new targets.SnsTopic(topic, {
            message: events.RuleTargetInput.fromText(
              `VettID security alert: ${description}\n\n` +
                `event:   ${events.EventField.fromPath('$.detail.eventName')}\n` +
                `who:     ${events.EventField.fromPath('$.detail.userIdentity.arn')}\n` +
                `from:    ${events.EventField.fromPath('$.detail.sourceIPAddress')}\n` +
                `region:  ${events.EventField.fromPath('$.region')}\n` +
                `time:    ${events.EventField.fromPath('$.time')}\n\n` +
                'Look up the full event in CloudTrail (Event history) by time and event name.',
            ),
          }),
        ],
      });

    new events.Rule(this, 'RootActivity', {
      description: 'Any use of the root user',
      eventPattern: {
        detailType: ['AWS API Call via CloudTrail', 'AWS Console Sign In via CloudTrail'],
        detail: { userIdentity: { type: ['Root'] } },
      },
      targets: [
        new targets.SnsTopic(topic, {
          message: events.RuleTargetInput.fromText(
            'VettID security alert: the ROOT user was used.\n\n' +
              `event:   ${events.EventField.fromPath('$.detail.eventName')}\n` +
              `from:    ${events.EventField.fromPath('$.detail.sourceIPAddress')}\n` +
              `time:    ${events.EventField.fromPath('$.time')}\n\n` +
              'If this was not you, treat the account as compromised.',
          ),
        }),
      ],
    });

    new events.Rule(this, 'ConsoleSignInRisk', {
      description: 'Console sign-in that failed or did not use MFA',
      eventPattern: {
        detailType: ['AWS Console Sign In via CloudTrail'],
        detail: {
          $or: [{ responseElements: { ConsoleLogin: ['Failure'] } }, { additionalEventData: { MFAUsed: ['No'] } }],
        },
      },
      targets: [
        new targets.SnsTopic(topic, {
          message: events.RuleTargetInput.fromText(
            'VettID security alert: console sign-in failed or did not use MFA.\n\n' +
              `who:     ${events.EventField.fromPath('$.detail.userIdentity.arn')}\n` +
              `result:  ${events.EventField.fromPath('$.detail.responseElements.ConsoleLogin')}\n` +
              `MFA:     ${events.EventField.fromPath('$.detail.additionalEventData.MFAUsed')}\n` +
              `from:    ${events.EventField.fromPath('$.detail.sourceIPAddress')}\n` +
              `time:    ${events.EventField.fromPath('$.time')}`,
          ),
        }),
      ],
    });

    apiCall('IamCredentialChanges', 'IAM users, credentials or MFA changed', ['aws.iam'], {
      eventName: [
        'CreateUser',
        'CreateAccessKey',
        'UpdateAccessKey',
        'CreateLoginProfile',
        'UpdateLoginProfile',
        'AttachUserPolicy',
        'PutUserPolicy',
        'AddUserToGroup',
        'DeactivateMFADevice',
        'DeleteVirtualMFADevice',
        'UpdateAccountPasswordPolicy',
      ],
      ...notDeploy,
    });

    apiCall('AuditTampering', 'audit/detection settings changed (CloudTrail, GuardDuty, Access Analyzer)', ['aws.cloudtrail', 'aws.guardduty', 'aws.access-analyzer'], {
      eventName: ['StopLogging', 'DeleteTrail', 'UpdateTrail', 'PutEventSelectors', 'DeleteDetector', 'UpdateDetector', 'DeleteAnalyzer'],
      ...notDeploy,
    });

    apiCall('SecurityGroupOpenToWorld', 'security group opened to the whole internet (outside a deploy)', ['aws.ec2'], {
      eventName: ['AuthorizeSecurityGroupIngress'],
      requestParameters: { ipPermissions: { items: { ipRanges: { items: { cidrIp: ['0.0.0.0/0'] } } } } },
      ...notDeploy,
    });

    new events.Rule(this, 'GuardDutyFindings', {
      description: 'GuardDuty findings, medium severity and above',
      eventPattern: { source: ['aws.guardduty'], detailType: ['GuardDuty Finding'], detail: { severity: events.Match.greaterThanOrEqual(4) } },
      targets: [
        new targets.SnsTopic(topic, {
          message: events.RuleTargetInput.fromText(
            `VettID GuardDuty finding (severity ${events.EventField.fromPath('$.detail.severity')}): ${events.EventField.fromPath('$.detail.title')}\n\n` +
              `type:    ${events.EventField.fromPath('$.detail.type')}\n` +
              `time:    ${events.EventField.fromPath('$.time')}\n\n` +
              'Details: GuardDuty console → Findings.',
          ),
        }),
      ],
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', { value: topic.topicArn });
  }
}
