import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { ApiFunction } from '../constructs/api-function';
import { ownerTrust } from '../constructs/owner-trust';
import { publishRef } from '../constructs/ssm-refs';
import { stageZone } from '../constructs/stage-zone';

/** Where SES writes each received message (one raw MIME object per message). */
export const TEST_MAIL_PREFIX = 'inbound/';
/** Days a received message is kept. */
export const TEST_MAIL_RETENTION_DAYS = 7;

export interface VettidOrgStageTestMailStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Non-prod stages only, TEST INFRASTRUCTURE (RUNBOOK "Staging" → "Test
 * mail"): a mailbox automated tests can read, so they can follow the sign-in
 * links and SES verification links that the staging copy sends.
 *
 *  - `test.<zone>` (test.staging.vettid.org): an MX to SES inbound in
 *    us-east-1. Any address at it is a test address.
 *  - The receipt rule set `<resourceName(test-mail)>` with one rule: every
 *    recipient at that domain, TLS required, spam/virus scan, raw message to
 *    S3 `inbound/`, stop. A custom resource makes it the active set (one per
 *    account and region; it refuses if another set is active).
 *  - The bucket: 7-day expiry, private, destroyed with the stack.
 *  - The reader role (fixed name, owner only): list and read `inbound/`.
 *
 * No SES identity for test.<zone>: the stage's domain identity <zone>
 * (VettidOrgStageDnsStack) already covers its subdomains, so in the SES
 * sandbox mail may be sent to any address at test.<zone> (identity
 * inheritance). No SPF/DMARC records: nothing is sent from test.<zone>,
 * and nothing here touches <zone>'s own mail records.
 */
export class VettidOrgStageTestMailStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly readerRole: iam.Role;
  readonly mailDomain: string;

  constructor(scope: Construct, id: string, props: VettidOrgStageTestMailStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.stage === 'prod') throw new Error('VettidOrgStageTestMailStack is test infrastructure for non-prod stages; never in prod');
    const account = this.account;
    if (cdk.Token.isUnresolved(account)) throw new Error('VettidOrgStageTestMailStack needs an explicit account (env)');

    this.mailDomain = hostName(config, 'test');
    const ruleSetName = resourceName(config, 'test-mail');
    const ruleName = resourceName(config, 'test-mail-s3');

    // ---- the receiving domain ------------------------------------------------------
    new route53.MxRecord(this, 'Mx', {
      zone: stageZone(this, config),
      recordName: this.mailDomain,
      values: [{ priority: 10, hostName: `inbound-smtp.${config.region}.amazonaws.com` }],
      ttl: cdk.Duration.minutes(5),
    });

    // ---- the bucket ------------------------------------------------------------------
    // Test data only, kept a week: destroying the stack may take it along
    // (autoDeleteObjects empties it first). No versioning: nothing here is
    // worth keeping.
    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `${resourceName(config, 'test-mail')}-${account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { expiration: cdk.Duration.days(TEST_MAIL_RETENTION_DAYS), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
      ],
    });
    // SES writes, for this one rule only (the confused-deputy conditions
    // AWS documents for receipt-rule S3 actions).
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'SesReceiptRuleWrites',
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [this.bucket.arnForObjects(`${TEST_MAIL_PREFIX}*`)],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': account,
            'aws:SourceArn': `arn:aws:ses:${config.region}:${account}:receipt-rule-set/${ruleSetName}:receipt-rule/${ruleName}`,
          },
        },
      }),
    );

    // ---- the receipt rule set ------------------------------------------------------
    const ruleSet = new ses.ReceiptRuleSet(this, 'RuleSet', { receiptRuleSetName: ruleSetName });
    const bucketName = this.bucket.bucketName;
    const rule = ruleSet.addRule('ToS3', {
      receiptRuleName: ruleName,
      recipients: [this.mailDomain], // the domain: every address at it
      enabled: true,
      scanEnabled: true,
      tlsPolicy: ses.TlsPolicy.REQUIRE,
      actions: [
        // Not sesActions.S3: that adds its own, looser bucket statement.
        { bind: () => ({ s3Action: { bucketName, objectKeyPrefix: TEST_MAIL_PREFIX } }) },
        new sesActions.Stop(),
      ],
    });
    // SES test-writes into the bucket when the rule is created.
    rule.node.addDependency(this.bucket.policy!);

    // ---- activation (SES: one active rule set per account and region) --------------
    const activator = new ApiFunction(this, 'RuleSetActivator', {
      entry: 'lambda/staging/test-mail-rule-set.ts',
      timeout: cdk.Duration.seconds(30),
      description: `Activates receipt rule set ${ruleSetName} (refuses if another is active); deactivates it on delete`,
    }).fn;
    activator.configureAsyncInvoke({ retryAttempts: 0 });
    activator.addToRolePolicy(
      new iam.PolicyStatement({
        // Neither action supports resource-level permissions.
        actions: ['ses:DescribeActiveReceiptRuleSet', 'ses:SetActiveReceiptRuleSet'],
        resources: ['*'],
      }),
    );
    const active = new cdk.CustomResource(this, 'ActiveRuleSet', {
      serviceToken: activator.functionArn,
      resourceType: 'Custom::VettidActiveReceiptRuleSet',
      properties: { RuleSetName: ruleSetName },
    });
    // Activated after the rule exists; deactivated before the set is deleted.
    active.node.addDependency(rule);

    // ---- the reader (owner only) ----------------------------------------------------
    this.readerRole = new iam.Role(this, 'ReaderRole', {
      roleName: resourceName(config, 'test-mail-reader'),
      description: `Reads ${config.stage} test mail (${TEST_MAIL_PREFIX} in ${resourceName(config, 'test-mail')}-${account}). Owner only. Test data.`,
      assumedBy: ownerTrust(account),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    this.readerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': [`${TEST_MAIL_PREFIX}*`] } },
      }),
    );
    this.readerRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [this.bucket.arnForObjects(`${TEST_MAIL_PREFIX}*`)] }),
    );

    publishRef(this, config, 'test-mail/bucket-name', bucketName);
    publishRef(this, config, 'test-mail/reader-role-arn', this.readerRole.roleArn);
    new cdk.CfnOutput(this, 'ReaderRoleArn', { value: this.readerRole.roleArn, description: 'role_arn of the vault-staging-test-mail profile (RUNBOOK "Test mail")' });
    new cdk.CfnOutput(this, 'BucketName', { value: bucketName });
    new cdk.CfnOutput(this, 'MailDomain', { value: this.mailDomain, description: 'Test addresses: anything@ this domain' });
  }
}
