import { AppConfig, VaultConfig, resourceName } from '../config';

/**
 * Cross-account access between the member API (its account) and the vault
 * account (docs/VAULT-RELEASES.md §8.1).
 *
 * The vault tables live in the vault account (VettidOrgVaultStack). Three
 * member API functions reach them, and the per-instance control queues,
 * with their own fixed-name roles. Cross-account access needs both sides:
 *  - the vault account's resource policies (table, stream, queue) allow
 *    exactly these grants to exactly these role ARNs; this is the boundary
 *    the vault account controls;
 *  - the member API's identity policies grant the same (member-api-stack).
 * Both are rendered from the matrix below, so they cannot drift.
 *
 * No role is assumed and nothing is imported: the role ARNs are derived from
 * fixed names, the table ARNs from fixed names and the vault account id.
 * Lambda code addresses the tables by ARN (DynamoDB accepts a table ARN as
 * TableName), so the handlers are unchanged.
 */

export const VAULT_TABLES = ['vaults', 'vault-instances', 'vault-requests', 'vault-releases'] as const;
export type VaultTable = (typeof VAULT_TABLES)[number];

export type VaultApiConsumer = 'vault' | 'cleanup' | 'vault-alarms' | 'vault-notices';
export const VAULT_API_CONSUMERS: VaultApiConsumer[] = ['vault', 'cleanup', 'vault-alarms', 'vault-notices'];

/** The vaults table's index of vaults by sealed release (keys plus user_guid and state), for the notice job (W8). */
export const SEALED_RELEASE_INDEX = 'sealed-release-index';

export interface VaultTableGrant {
  readonly table: VaultTable;
  /** DynamoDB actions without the `dynamodb:` prefix. */
  readonly actions: string[];
  /**
   * Also the table's indexes (Query on a GSI): `true` for the table and all
   * its indexes; a list for those indexes only (not the table itself).
   */
  readonly indexes?: boolean | readonly string[];
  /**
   * Fine-grained access control: the request may only name these
   * attributes (`ForAllValues:StringEquals dynamodb:Attributes`). Vacuously
   * true for a request without an attribute list, so it narrows a grant and
   * never widens it.
   */
  readonly attributes?: string[];
}

export interface VaultApiAccess {
  readonly tables: VaultTableGrant[];
  /** sqs:SendMessage to the per-instance control queues. */
  readonly sendsToControlQueues: boolean;
  /** Reads the vault table's stream (Lambda event source). */
  readonly readsVaultsStream: boolean;
}

/**
 * What each member API function may do in the vault account. The API never
 * writes a lease, a sealed release, lifecycle state or a release's status;
 * the instance registry is read-only to it.
 */
export const VAULT_API_ACCESS: Record<VaultApiConsumer, VaultApiAccess> = {
  // /api/vault: alternate channel (VAULT-MESSAGING §11).
  vault: {
    tables: [
      { table: 'vaults', actions: ['GetItem'] },
      { table: 'vaults', actions: ['PutItem', 'UpdateItem'], attributes: ['vault_id', 'user_guid', 'state', 'created_at', 'updated_at', 'current_vault_id', 'recovery'] },
      { table: 'vault-instances', actions: ['GetItem', 'Query'], indexes: true },
      { table: 'vault-requests', actions: ['GetItem', 'PutItem', 'UpdateItem'] },
      { table: 'vault-releases', actions: ['GetItem', 'Query'], indexes: true },
      { table: 'vault-releases', actions: ['UpdateItem'], attributes: ['release', 'start_requested_at', 'start_requests'] },
    ],
    sendsToControlQueues: true,
    readsVaultsStream: false,
  },
  // Daily cleanup: canceled accounts' vaults are asked to delete themselves
  // (§12.5); never-sealed rows and pointer rows are deleted here.
  cleanup: {
    tables: [
      { table: 'vaults', actions: ['Query', 'Scan', 'DeleteItem'], indexes: true },
      { table: 'vaults', actions: ['UpdateItem'], attributes: ['vault_id', 'deletion_requested_at'] },
      { table: 'vault-instances', actions: ['GetItem', 'Query'], indexes: true },
      { table: 'vault-releases', actions: ['GetItem'] },
      { table: 'vault-releases', actions: ['UpdateItem'], attributes: ['release', 'start_requested_at', 'start_requests'] },
    ],
    sendsToControlQueues: true,
    readsVaultsStream: false,
  },
  // Credential-clone alarms and deletion notices (§11.5, §12.5), fed by the
  // vaults stream; may only clear the alarm flag and delete a deleted
  // vault's rows.
  'vault-alarms': {
    tables: [
      { table: 'vaults', actions: ['UpdateItem'], attributes: ['vault_id', 'alarm', 'alarm_pending'] },
      { table: 'vaults', actions: ['DeleteItem'] },
    ],
    sendsToControlQueues: false,
    readsVaultsStream: true,
  },
  // Daily release notices (VAULT-RELEASES §3.5, §10.2; W8): reads the
  // release rows, and finds the vaults sealed to a release through an index
  // that projects only vault_id, user_guid and state. Writes nothing here.
  'vault-notices': {
    tables: [
      { table: 'vault-releases', actions: ['Query'], indexes: true },
      { table: 'vaults', actions: ['Query'], indexes: [SEALED_RELEASE_INDEX] },
    ],
    sendsToControlQueues: false,
    readsVaultsStream: false,
  },
};

/** Fixed name of a member API function's role (in the API account). */
export function vaultApiRoleName(config: AppConfig, consumer: VaultApiConsumer): string {
  return resourceName(config, `member-${consumer}`);
}

export function vaultApiRoleArn(config: AppConfig, vault: VaultConfig, consumer: VaultApiConsumer): string {
  return `arn:aws:iam::${vault.apiAccount}:role/${vaultApiRoleName(config, consumer)}`;
}

/** The vault tables' fixed names (the same in every vault account, per stage). */
export function vaultTableName(config: AppConfig, table: VaultTable): string {
  return resourceName(config, table);
}

export function vaultTableArn(config: AppConfig, vault: VaultConfig, table: VaultTable): string {
  return `arn:aws:dynamodb:${config.region}:${vault.account}:table/${vaultTableName(config, table)}`;
}

/** The resources a grant covers: the table and all its indexes, the table alone, or only the named indexes. */
export function vaultGrantResources(config: AppConfig, vault: VaultConfig, grant: VaultTableGrant): string[] {
  const arn = vaultTableArn(config, vault, grant.table);
  if (Array.isArray(grant.indexes)) return grant.indexes.map((i: string) => `${arn}/index/${i}`);
  return grant.indexes ? [arn, `${arn}/index/*`] : [arn];
}

/** Per-instance control queues: `<prefix><instance_id>`, created by the parent. */
export function vaultControlQueuePrefix(config: AppConfig): string {
  return `${resourceName(config, 'vault-control')}-`;
}

export function vaultControlQueueArnPattern(config: AppConfig, vault: VaultConfig): string {
  return `arn:aws:sqs:${config.region}:${vault.account}:${vaultControlQueuePrefix(config)}*`;
}

export function vaultControlQueueUrlPrefix(config: AppConfig, vault: VaultConfig): string {
  return `https://sqs.${config.region}.amazonaws.com/${vault.account}/${vaultControlQueuePrefix(config)}`;
}

/** The shared dead-letter queue (created by the host stack, W6). Outside the control prefix. */
export function vaultDlqName(config: AppConfig): string {
  return resourceName(config, 'vault-dlq');
}

const attributeCondition = (attrs: string[] | undefined) =>
  attrs ? { 'ForAllValues:StringEquals': { 'dynamodb:Attributes': attrs } } : {};

/**
 * Resource-policy statements (plain JSON) for one vault table: every grant of
 * every consumer on it, each to the account root of the API account narrowed
 * to the consumer's role by `aws:PrincipalArn`. (A role ARN as Principal
 * would have to exist before the vault stack deploys; this form does not.)
 */
export function vaultTableResourceStatements(config: AppConfig, vault: VaultConfig, table: VaultTable): Record<string, unknown>[] {
  const arn = vaultTableArn(config, vault, table);
  const out: Record<string, unknown>[] = [];
  for (const consumer of VAULT_API_CONSUMERS) {
    VAULT_API_ACCESS[consumer].tables.forEach((g, i) => {
      if (g.table !== table) return;
      out.push({
        Sid: sid(`MemberApi-${consumer}-${i}`),
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${vault.apiAccount}:root` },
        Action: g.actions.map((a) => `dynamodb:${a}`),
        Resource: g.indexes ? vaultGrantResources(config, vault, g) : arn,
        Condition: {
          ArnEquals: { 'aws:PrincipalArn': vaultApiRoleArn(config, vault, consumer) },
          ...attributeCondition(g.attributes),
        },
      });
    });
  }
  return out;
}

/** The actions a Lambda event source mapping needs on a stream. */
export const STREAM_READ_ACTIONS = ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator'];

/** Stream resource policy for the vaults table: the stream readers only. */
export function vaultsStreamResourceStatements(config: AppConfig, vault: VaultConfig): Record<string, unknown>[] {
  const readers = VAULT_API_CONSUMERS.filter((c) => VAULT_API_ACCESS[c].readsVaultsStream);
  return readers.map((consumer) => ({
    Sid: sid(`MemberApiStream-${consumer}`),
    Effect: 'Allow',
    Principal: { AWS: `arn:aws:iam::${vault.apiAccount}:root` },
    Action: STREAM_READ_ACTIONS,
    // The policy is attached to the stream itself (whose ARN carries a
    // creation label), so "*" means that stream only.
    Resource: '*',
    Condition: { ArnEquals: { 'aws:PrincipalArn': vaultApiRoleArn(config, vault, consumer) } },
  }));
}

/**
 * The policy the parent sets on every control queue it creates (published
 * as SSM `vault/control-queue-policy`): the member API's senders may send,
 * nothing else. Same-account principals (the host role) need no statement.
 */
export function vaultControlQueuePolicy(config: AppConfig, vault: VaultConfig): Record<string, unknown> {
  const senders = VAULT_API_CONSUMERS.filter((c) => VAULT_API_ACCESS[c].sendsToControlQueues);
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'MemberApiSends',
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${vault.apiAccount}:root` },
        Action: 'sqs:SendMessage',
        Resource: vaultControlQueueArnPattern(config, vault),
        Condition: { ArnEquals: { 'aws:PrincipalArn': senders.map((c) => vaultApiRoleArn(config, vault, c)) } },
      },
    ],
  };
}

const sid = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
