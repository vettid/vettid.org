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
 * Ceiling on the table's on-demand throughput, in request units a second
 * (RUNBOOK "Relay" → "Table throughput ceiling"). On-demand has no ceiling
 * of its own below the account quota (40,000 units a second per table),
 * and the relay's limits are per address, per key and per mailbox: without
 * one, what the table can be made to cost is bounded only by that quota.
 *
 * Sizing. A write unit is 1 KB written, doubled inside a transaction; a
 * deposit is a transaction (counters, the message, the token's usage) and
 * an ack deletes the message: about 4 + 2 × KB units to deposit and
 * 1 + KB to ack.
 *
 *  - Measured, 10 days to 2026-10-13 (ten members, four staging vaults):
 *    busiest minute 1,634 write units (27 a second) and 494 read units
 *    (8 a second); busiest hour 5,486 write units (1.5 a second).
 *  - Projected (RELAY-PROTOCOL §7.2): a vault host of 900 vaults at a
 *    message a minute each is 15 messages a second, about 300 write units
 *    a second at 4 KB a message.
 *  - The most one address may ask for is the flood guard, 100 requests a
 *    second. If every one of them were a deposit of 8 KB that is
 *    100 × (4 + 2 × 8) = 2,000 write units a second; a real mix (a third
 *    each of collects, acks and deposits, 4 KB) is under 600.
 *
 * Counting every write of a message (RELAY-PROTOCOL 0.9.4 §7.2 "Where the
 * numbers come from": deposit transaction, collect lease, ack delete and
 * counter adjust) a 4 KB message costs about 21 write units, so one full
 * host of 900 vaults at three messages a minute is about 1,800 to 1,900 a
 * second, and one address at the flood guard 1,600 to 2,500. The owner
 * raised the write ceiling from 2,000 to 10,000 on 2026-10-15: one such
 * address or host is then about a quarter of it. Reads: an owner request costs one or two strongly consistent
 * reads, so a flood guard of them is about 200 a second; 2,000 is ten
 * times that. The index holds only the keys of rotated mailboxes (one
 * small write per rotation, at most one a second per address).
 *
 * At the ceiling DynamoDB throttles: the relay's requests fail or are
 * retried, for every tenant, until the load is back under it. That is the
 * trade: the ceiling is below what the table would otherwise serve at once
 * (the write ceiling is now above its warm throughput of 4,000 write units a
 * second; DynamoDB serves bursts above that as it scales the table), and in
 * return the bill is bounded at about $540 a day in writes and $22 in reads ($0.625 and $0.125 a million units)
 * instead of $2,160 and $432 at the quota. The ceiling is a target, not
 * exact: DynamoDB lets short bursts exceed it. Health checks read the
 * table, which is one more reason the read ceiling is far above real load.
 */
export const RELAY_TABLE_LIMITS = {
  maxWriteRequestUnits: 10000,
  maxReadRequestUnits: 2000,
  indexMaxWriteRequestUnits: 100,
  indexMaxReadRequestUnits: 100,
} as const;

/**
 * The relay's durable state (hosting option B), kept apart from the service
 * so the service stack deploys freely (RUNBOOK "CDK conventions"):
 *
 *  - one DynamoDB table — mailboxes, messages, leases, denylists, quota
 *    counters, consumed open tokens, claims, blob metadata. Layout and the
 *    reference definition: vettid-relay internal/store/dynamo (pk/sk
 *    strings, TTL attribute ttl_s, KEYS_ONLY GSI "due" on gpk/gsk).
 *    On-demand capacity: no capacity planning, idles at $0; a ceiling
 *    on its throughput (RELAY_TABLE_LIMITS) bounds what it can cost.
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
      billing: dynamodb.Billing.onDemand({
        maxReadRequestUnits: RELAY_TABLE_LIMITS.maxReadRequestUnits,
        maxWriteRequestUnits: RELAY_TABLE_LIMITS.maxWriteRequestUnits,
      }),
      timeToLiveAttribute: 'ttl_s',
      globalSecondaryIndexes: [
        {
          // Rotated mailboxes due for purge (sparse: only they carry gpk).
          indexName: 'due',
          partitionKey: { name: 'gpk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'gsk', type: dynamodb.AttributeType.NUMBER },
          projectionType: dynamodb.ProjectionType.KEYS_ONLY,
          maxReadRequestUnits: RELAY_TABLE_LIMITS.indexMaxReadRequestUnits,
          maxWriteRequestUnits: RELAY_TABLE_LIMITS.indexMaxWriteRequestUnits,
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
