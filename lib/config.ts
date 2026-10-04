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
  /**
   * Relay container image, pinned by digest. Unset → the relay service stack
   * is skipped (its data stack is not). Context: relayImage.
   */
  readonly relay: { readonly image: string };
  readonly adminAccess: {
    /**
     * Headscale control server the AWS exit node joins (tailscale
     * --login-server). Not secret; the pre-auth key is, and lives only in
     * Secrets Manager (see VettidOrgAdminAccessStack).
     */
    readonly headscaleLoginServer: string;
  };
  /**
   * Where the stack set for this stage is deployed (docs/AWS-ACCOUNTS.md).
   * `main` runs everything except the vault (for prod: the management
   * account); pinned so a deploy with another account's profile still
   * synthesizes the main stacks against their own cached lookups. A stage
   * with a vault but no main account builds only the vault stack.
   */
  readonly accounts: { readonly main: string | undefined };
  /**
   * The vault's channel and account for this stage (docs/VAULT-RELEASES.md
   * §3.1, §8.1). Undefined for stages without a vault account: the vault
   * stacks are then not part of the app.
   */
  readonly vault: VaultConfig | undefined;
}

export interface VaultConfig {
  /** Release channel (VAULT-MESSAGING §11.10.8): `prod` or `staging`. */
  readonly channel: 'prod' | 'staging';
  /** The vault account: release keys, roles, data, tables, hosts. Pinned in every image of the channel. */
  readonly account: string;
  /** The account whose member API reaches into the vault account (tables, control queues). */
  readonly apiAccount: string;
  /** Pinned `retirement_window_days`: 30 in production, 7 in staging (§11.10.7). */
  readonly retirementWindowDays: 30 | 7;
  /**
   * The vault table's stream ARN, from VettidOrgVaultStack's output
   * `VaultsStreamArn` (a stream ARN carries a creation label, so it cannot
   * be derived; and SSM refs do not cross accounts). Context
   * `vaultsStreamArn`. Empty: the alarm mailer has no event source yet.
   */
  readonly vaultsStreamArn: string;
  /**
   * The served release manifest (VAULT-RELEASES §3.1, §7), which the
   * manifest sync turns into routing rows.
   */
  readonly manifestUrl: string;
  /**
   * Pinned manifest public keys (SubjectPublicKeyInfo, base64 DER; key A and
   * key B in production, the staging key in staging), the same as in the
   * channel's `enclave/releasecfg/<channel>.json`. Empty until they are
   * fixed (W7/W10): the manifest sync then does nothing.
   */
  readonly manifestKeys: readonly string[];
  /** The relay host on the enclave host's egress allowlist (pinned in the release as relay_url). */
  readonly relayHost: string;
}

/**
 * Accounts per stage (organization o-kualrldevn, all us-east-1). Staging is
 * a full copy in its own account (VAULT-RELEASES §11.1), so its member API
 * and its vault share one account.
 */
const STAGE_ACCOUNTS: Record<string, { main?: string; vault?: Omit<VaultConfig, 'vaultsStreamArn'> }> = {
  prod: {
    main: '449757308783', // VettID (management)
    vault: {
      channel: 'prod', account: '369484479783', apiAccount: '449757308783', retirementWindowDays: 30, // vettid-vault-prod
      manifestUrl: 'https://vettid.org/.well-known/vettid/pcr-manifest.json',
      manifestKeys: [],
      relayHost: 'relay.vettid.org',
    },
  },
  staging: {
    // main: '347272280361' once the staging copy of the main stacks exists
    // (W9: its own zone and hosts). Until then a staging synth builds only
    // the vault stack, so nothing tries to look up vettid.org there.
    vault: {
      channel: 'staging', account: '347272280361', apiAccount: '347272280361', retirementWindowDays: 7, // vettid-vault-staging
      manifestUrl: 'https://staging.vettid.org/.well-known/vettid/pcr-manifest.json',
      manifestKeys: [],
      // Staging images pin the production relay at first (VAULT-RELEASES §11.1).
      relayHost: 'relay.vettid.org',
    },
  },
};

/**
 * Fixed IAM role names in the vault accounts. The host and retirement roles
 * are named in every release key's policy, which can never change: renaming
 * or deleting either role makes every key fail the enclave's check 8, and
 * deleting the host role makes every vault unopenable (VAULT-RELEASES §6.3).
 * The same names in every vault account (no stage suffix): the staging
 * channel file pins `vettid-org-vault-key-retirement` too. Guarded by
 * test/vault-stack.test.ts and the Vault OU SCP (lib/org/scp-vault.json).
 */
export const VAULT_ROLE_NAMES = {
  host: 'vettid-org-vault-host',
  retirement: 'vettid-org-vault-key-retirement',
  /** The release-key custom resource's role: the only principal allowed BypassPolicyLockoutSafetyCheck (SCP). */
  releaseKeyCreator: 'vettid-org-vault-release-key-creator',
  manifestSigner: 'vettid-org-vault-manifest-signer',
} as const;

/** The release-key custom resource's function (fixed: the SCP names it). */
export const VAULT_RELEASE_KEY_FUNCTION_NAME = 'vettid-org-vault-release-key-creator';

export function vaultRoleArn(vault: VaultConfig, role: keyof typeof VAULT_ROLE_NAMES): string {
  return `arn:aws:iam::${vault.account}:role/${VAULT_ROLE_NAMES[role]}`;
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
    relay: {
      image: String(node.tryGetContext('relayImage') ?? ''),
    },
    adminAccess: {
      headscaleLoginServer: String(node.tryGetContext('headscaleLoginServer') ?? ''),
    },
    accounts: { main: STAGE_ACCOUNTS[stage]?.main },
    vault: STAGE_ACCOUNTS[stage]?.vault
      ? { ...STAGE_ACCOUNTS[stage].vault!, vaultsStreamArn: String(node.tryGetContext('vaultsStreamArn') ?? '') }
      : undefined,
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
