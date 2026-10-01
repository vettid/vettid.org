import { Node } from 'constructs';

/**
 * Deployment-wide configuration for the vettid.org app.
 *
 * There is one environment today (prod). `stage` exists so a staging copy can
 * be stood up later (in its own AWS account, under staging.vettid.org) without
 * renaming anything in prod: physical names only gain a stage suffix when
 * stage !== 'prod'.
 *
 *   npx cdk deploy -c stage=prod   (default)
 */
export interface AppConfig {
  readonly stage: string;
  /** Apex domain; site hosts are subdomains of it (account., admin., ...). */
  readonly domainName: string;
  readonly region: string;
  /** Where operational notifications go (new membership requests, etc.). */
  readonly adminEmail: string;
  /**
   * Sender for all system email. The account has a verified SES *domain*
   * identity for vettid.org; ses:SendEmail grants must stay resources:['*']
   * (see signup-stack.ts — scoping them silently breaks every send).
   */
  readonly senderEmail: string;
  readonly adminAccess: {
    /**
     * Headscale control server the AWS exit node joins (tailscale
     * --login-server). Not secret; the pre-auth key is, and lives only in
     * Secrets Manager (see VettidOrgAdminAccessStack).
     */
    readonly headscaleLoginServer: string;
  };
}

const PROD_STAGE = 'prod';

export function loadConfig(node: Node): AppConfig {
  const stage = String(node.tryGetContext('stage') ?? PROD_STAGE);
  if (!/^[a-z][a-z0-9]{0,11}$/.test(stage)) {
    throw new Error(`Invalid stage "${stage}": lowercase alphanumeric, max 12 chars`);
  }
  return {
    stage,
    domainName: 'vettid.org',
    region: 'us-east-1',
    adminEmail: 'admin@vettid.org',
    senderEmail: 'no-reply@vettid.org',
    adminAccess: {
      headscaleLoginServer: String(node.tryGetContext('headscaleLoginServer') ?? ''),
    },
  };
}

/**
 * Physical resource name: `vettid-org-<thing>` in prod,
 * `vettid-org-<stage>-<thing>` elsewhere. Use for tables, buckets, pools,
 * functions — anything with a name that must stay stable across deploys.
 */
export function resourceName(config: AppConfig, thing: string): string {
  return config.stage === PROD_STAGE ? `vettid-org-${thing}` : `vettid-org-${config.stage}-${thing}`;
}

/** Host under the apex, e.g. hostName(config, 'account') → account.vettid.org */
export function hostName(config: AppConfig, sub: string): string {
  return config.stage === PROD_STAGE
    ? `${sub}.${config.domainName}`
    : `${sub}.${config.stage}.${config.domainName}`;
}
