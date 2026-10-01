import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig, hostName, resourceName } from '../config';
import { publishRef } from '../constructs/ssm-refs';

export interface VettidOrgDataStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Stateful: DynamoDB tables and the membership-terms bucket for the account
 * and admin sites. Rarely deployed; everything is retained, deletion-protected
 * and (for tables) point-in-time-recoverable.
 *
 * Tables have fixed names (resourceName) so stateless stacks bind with
 * Table.fromTableName(...) instead of cross-stack exports.
 *
 * Model (docs/ACCOUNT-ADMIN-PLAN.md §3.4, §5.1) — fresh, not vettid-dev's 37:
 *   members            one row per person: lifecycle state, account status,
 *                      terms acceptance, PIN hash, preferences, has_used_trial
 *   invites            invite codes (valid code = auto-registration)
 *   terms              membership terms versions (PDF in the terms bucket)
 *   subscriptions      one row per member
 *   subscription-types plans (free trial now; `paid` flag for later)
 *   audit              append-only admin + security events
 *   ratelimits         rate-limit and PIN-lockout counters (TTL)
 *   magic-links        single-use sign-in tokens, stored hashed (TTL)
 */
export class VettidOrgDataStack extends cdk.Stack {
  readonly tables: Record<string, dynamodb.TableV2> = {};
  readonly termsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: VettidOrgDataStackProps) {
    super(scope, id, props);
    const { config } = props;
    const S = dynamodb.AttributeType.STRING;

    const table = (
      key: string,
      partitionKey: dynamodb.Attribute,
      extra: Partial<dynamodb.TablePropsV2> = {},
    ): dynamodb.TableV2 => {
      const t = new dynamodb.TableV2(this, `Table-${key}`, {
        tableName: resourceName(config, key),
        partitionKey,
        billing: dynamodb.Billing.onDemand(),
        encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        deletionProtection: true,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        ...extra,
      });
      this.tables[key] = t;
      return t;
    };

    // members: PK user_guid. Lookups by email (sign-in, dedupe on request) and
    // by lifecycle state (admin queue, cleanup job) go through GSIs — never
    // scans. The stream drives lifecycle emails (approved, rejected, ...).
    table('members', { name: 'user_guid', type: S }, {
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      globalSecondaryIndexes: [
        { indexName: 'email-index', partitionKey: { name: 'email', type: S } },
        { indexName: 'state-index', partitionKey: { name: 'state', type: S }, sortKey: { name: 'updated_at', type: S } },
      ],
    });

    table('invites', { name: 'code', type: S });

    // terms: PK version_id; `status = current` marks the version members must accept.
    table('terms', { name: 'version_id', type: S }, {
      globalSecondaryIndexes: [
        { indexName: 'status-index', partitionKey: { name: 'status', type: S }, sortKey: { name: 'published_at', type: S } },
      ],
    });

    table('subscriptions', { name: 'user_guid', type: S }, {
      globalSecondaryIndexes: [
        // expiry sweeps (warnings, expiring trials) without scanning
        { indexName: 'status-index', partitionKey: { name: 'status', type: S }, sortKey: { name: 'expires_at', type: S } },
      ],
    });

    table('subscription-types', { name: 'type_id', type: S });

    // audit: append-only. PK = month bucket (YYYY-MM), SK = `<iso ts>#<ulid>`,
    // so "recent events" is one Query; GSIs answer "what did this admin do"
    // and "what happened to this member". Writers get PutItem only.
    table('audit', { name: 'month', type: S }, {
      sortKey: { name: 'ts_id', type: S },
      globalSecondaryIndexes: [
        { indexName: 'actor-index', partitionKey: { name: 'actor', type: S }, sortKey: { name: 'ts_id', type: S } },
        { indexName: 'subject-index', partitionKey: { name: 'subject', type: S }, sortKey: { name: 'ts_id', type: S } },
      ],
    });

    // Counters only; losing them is harmless, so no PITR cost.
    table('ratelimits', { name: 'key', type: S }, {
      timeToLiveAttribute: 'expires_at',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    // magic-links: PK = SHA-256 of the token (the raw token only ever exists
    // in the email). email-index supports per-address rate limiting.
    table('magic-links', { name: 'token_hash', type: S }, {
      timeToLiveAttribute: 'expires_at',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      globalSecondaryIndexes: [
        { indexName: 'email-index', partitionKey: { name: 'email', type: S }, sortKey: { name: 'created_at', type: S } },
      ],
    });

    // Membership terms PDFs. Admins upload via presigned PUT from the admin
    // site (hence CORS); members get short-lived presigned GET URLs.
    this.termsBucket = new s3.Bucket(this, 'TermsBucket', {
      cors: [
        {
          allowedOrigins: [`https://${hostName(config, 'admin')}`],
          allowedMethods: [s3.HttpMethods.PUT],
          allowedHeaders: ['content-type'],
          maxAge: 3600,
        },
      ],
      bucketName: `${resourceName(config, 'terms')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    publishRef(this, config, 'data/terms-bucket-name', this.termsBucket.bucketName);
  }
}
