import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig, resourceName } from '../config';
import { publishRef } from '../constructs/ssm-refs';

export interface VettidOrgRelayDataStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/** Relay blob lifetime (vettid-relay RELAY_BLOB_TTL default, 7 days). */
export const RELAY_BLOB_TTL_DAYS = 7;

/**
 * The relay's durable state (hosting option B), kept apart from the service
 * so the service stack deploys freely (RUNBOOK "CDK conventions"):
 *
 *  - one DynamoDB table — mailboxes, messages, leases, denylists, quota
 *    counters, consumed open tokens, claims, blob metadata. Layout and the
 *    reference definition: vettid-relay internal/store/dynamo (pk/sk
 *    strings, TTL attribute ttl_s, KEYS_ONLY GSI "due" on gpk/gsk).
 *    On-demand capacity: no capacity planning, idles at $0.
 *  - one S3 bucket for blob bodies (blobs/<mailbox>/<blob id>), expiring a
 *    day after the relay's blob TTL as a backstop (the relay deletes blobs
 *    on DELETE and when it purges a rotated mailbox).
 *
 * Both are RETAINed and the stack has termination protection. Everything in
 * them is ciphertext the relay cannot read; losing it loses undelivered
 * messages, never confidentiality (docs/RELAY-PROTOCOL.md §8).
 *
 * Valkey is not here: it holds only seconds-to-minutes of coordination state
 * (replay cache, rate-limit buckets, pub/sub) and lives with the service.
 */
export class VettidOrgRelayDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VettidOrgRelayDataStackProps) {
    super(scope, id, props);
    const { config } = props;

    const table = new dynamodb.TableV2(this, 'Table', {
      tableName: resourceName(config, 'relay'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl_s',
      globalSecondaryIndexes: [
        {
          // Rotated mailboxes due for purge (sparse: only they carry gpk).
          indexName: 'due',
          partitionKey: { name: 'gpk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'gsk', type: dynamodb.AttributeType.NUMBER },
          projectionType: dynamodb.ProjectionType.KEYS_ONLY,
        },
      ],
      // Ephemeral ciphertext (messages live ≤ 14 days): no PITR, like the
      // other ephemeral tables. Deletion protection + RETAIN guard the table.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const blobs = new s3.Bucket(this, 'Blobs', {
      bucketName: `${resourceName(config, 'relay-blobs')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        { expiration: cdk.Duration.days(RELAY_BLOB_TTL_DAYS + 1), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) },
      ],
    });

    publishRef(this, config, 'relay/table-name', table.tableName);
    publishRef(this, config, 'relay/table-arn', table.tableArn);
    publishRef(this, config, 'relay/blob-bucket-name', blobs.bucketName);
  }
}
