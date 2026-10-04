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
   * channel's `enclave/releasecfg/<channel>.json` (VAULT-RELEASES §6.1).
   * Public data, from `aws kms get-public-key` on the channel's
   * `alias/<resourceName(vault-manifest)>`. A served document carries one
   * signature, by the key its `key_id` names (§11.10.1): any pinned key
   * verifies it. Empty: the manifest sync does nothing.
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
      manifestKeys: [
        // Key A: KMS ECC_NIST_P256 in vettid-vault-prod, alias/vettid-org-vault-manifest
        // (key 5197fbf9-0863-4e79-986e-2dcd9cb90e7d); key_id 4353463f85c4012f.
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7xDU6CSVsFDJvP7UXigsN9SDB+KIppU85Y3DRvo0oMQZYKHZ1S/3OaNdFk2/HJX+hohYdyU6QIFPXiDBirflCQ==',
        // TODO(O3, before production release 1): key B, the offline hardware
        // token's P-256 SubjectPublicKeyInfo. Until then manifests are signed
        // with key A only. That is the format (one signature per document,
        // `key_id` selects the pinned key, §11.10.1), not a weakening: key B
        // is the standby for losing key A. It must be pinned in release 1's
        // image and the app, because a key an image does not pin can only be
        // introduced by a new release.
      ],
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
      manifestKeys: [
        // The staging key: KMS ECC_NIST_P256 in vettid-vault-staging,
        // alias/vettid-org-staging-vault-manifest (key a9d50ed4-b390-456e-9803-bbbf4371e208); key_id e9b3a403423120ac.
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEok8gqeC5VcGx4KL+B5fL7UgENBXf+59RigkR0TZ0NqjiWM2VK6V1+paNoqRTBx7nXXN3L/2ehjsTb31GGVkEAw==',
      ],
      // Staging images pin the production relay at first (VAULT-RELEASES §11.1).
      relayHost: 'relay.vettid.org',
    },
  },
};

/**
 * A channel's vault configuration and stage, for tools outside the CDK app
 * (scripts/vault/*): the channel `prod` is stage `prod`, `staging` is stage
 * `staging`.
 */
export function channelVault(channel: 'prod' | 'staging'): { stage: string; vault: VaultConfig } {
  const v = STAGE_ACCOUNTS[channel]?.vault;
  if (!v || v.channel !== channel) throw new Error(`no vault configuration for channel ${channel}`);
  return { stage: channel, vault: { ...v, vaultsStreamArn: '' } };
}

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
