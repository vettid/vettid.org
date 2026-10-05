import { Node } from 'constructs';

/**
 * Deployment-wide configuration for the vettid.org app.
 *
 * Two stages: `prod` (default) and `staging`, a copy in its own AWS account
 * under staging.vettid.org (VAULT-RELEASES §11.1, W9). Physical names only
 * gain a stage suffix when stage !== 'prod', so prod never renames anything.
 *
 *   npx cdk deploy -c stage=prod                               (default)
 *   npx cdk deploy -c stage=staging --profile vault-staging    (RUNBOOK "Staging")
 */
export interface AppConfig {
  readonly stage: string;
  /** Apex domain; site hosts are subdomains of it (account., admin., ...). */
  readonly domainName: string;
  readonly region: string;
  /** Where operational notifications go (new membership requests, etc.). */
  readonly adminEmail: string;
  /**
   * The stage's own DNS zone and SES sending domain: vettid.org in prod,
   * `<stage>.vettid.org` elsewhere (a zone in the stage's account, delegated
   * from vettid.org). Site hosts are hostName() names inside it.
   */
  readonly zoneName: string;
  /**
   * Sender for all system email: no-reply@<zoneName>. Each account has a
   * verified SES *domain* identity for its zoneName; ses:SendEmail grants
   * must stay resources:['*'] (see signup-stack.ts — scoping them silently
   * breaks every send).
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
  /**
   * Where members get the Android app (the account site's Vault tab links
   * to it): the Google Play listing in production, the test build's page
   * in staging. Context `androidAppUrl` in prod, `<stage>AndroidAppUrl`
   * elsewhere; an https URL. Unset until one exists: the site then says the
   * app is not available yet (never a placeholder link).
   */
  readonly androidAppUrl?: string;
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
   * `vaultsStreamArn` in prod, `<stage>VaultsStreamArn` elsewhere (so a
   * staging synth never picks up prod's value from cdk.json). Empty: the
   * alarm mailer has no event source yet.
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
        // Key B: the offline standby (YubiKey PIV slot 9c, P-256, PIN and
        // touch on every use; generated on the token 2026-10-04);
        // key_id 1abd49da96970b6e. Used only if key A is lost (O3).
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEIcIodW3liYaxACuOdB0If8igq/oWfVOcLGbWTy1vUNzTlvsVNe3ljfqpqfTCZwtR611EYk7UPTCfjaEEMPLxfQ==',
      ],
      relayHost: 'relay.vettid.org',
    },
  },
  staging: {
    // The staging copy (W9): its zone staging.vettid.org, member pool,
    // tables, member API, account site and the staging.vettid.org site, all
    // in the vault staging account (lib/app.ts, stageStacks).
    main: '347272280361', // vettid-vault-staging
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
 * The Android app's sign-in App Link (MEMBER-API "Auth"): account.vettid.org
 * publishes /.well-known/assetlinks.json so that
 * https://account.vettid.org/auth/... opens in the app. Each entry is the
 * SHA-256 of a certificate the app is signed with: the upload key (builds
 * signed by the owner) now; the Play app-signing key is added once the Play
 * Console shows it (VAULT-RELEASES O8). The same digests are pinned in
 * vettid-vault enclave/releasecfg/prod.json `android_signers`.
 */
export const ANDROID_APP_LINKS = {
  packageName: 'com.vettid.app',
  sha256CertFingerprints: [
    '31:A1:96:13:AA:10:F2:09:E0:89:45:F9:47:F9:4F:7C:E3:E6:E5:AC:34:24:57:FF:99:69:A6:79:86:92:8E:65', // upload key (2026-10-04)
  ],
} as const;

/** The Digital Asset Links statement for {@link ANDROID_APP_LINKS}. */
export function androidAssetLinks(): unknown[] {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_APP_LINKS.packageName,
      sha256_cert_fingerprints: [...ANDROID_APP_LINKS.sha256CertFingerprints],
    },
  }];
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
  const domainName = 'vettid.org';
  const zoneName = stage === PROD_STAGE ? domainName : `${stage}.${domainName}`;
  const streamKey = stage === PROD_STAGE ? 'vaultsStreamArn' : `${stage}VaultsStreamArn`;
  const appUrlKey = stage === PROD_STAGE ? 'androidAppUrl' : `${stage}AndroidAppUrl`;
  const androidAppUrl = String(node.tryGetContext(appUrlKey) ?? '');
  if (androidAppUrl && !/^https:\/\/[^\s"<>]+$/.test(androidAppUrl)) {
    throw new Error(`context ${appUrlKey}: expected an https URL, got ${JSON.stringify(androidAppUrl)}`);
  }
  return {
    stage,
    domainName,
    zoneName,
    region: 'us-east-1',
    adminEmail: 'admin@vettid.org',
    senderEmail: `no-reply@${zoneName}`,
    relay: {
      image: String(node.tryGetContext('relayImage') ?? ''),
    },
    adminAccess: {
      headscaleLoginServer: String(node.tryGetContext('headscaleLoginServer') ?? ''),
    },
    accounts: { main: STAGE_ACCOUNTS[stage]?.main },
    vault: STAGE_ACCOUNTS[stage]?.vault
      ? { ...STAGE_ACCOUNTS[stage].vault!, vaultsStreamArn: String(node.tryGetContext(streamKey) ?? '') }
      : undefined,
    ...(androidAppUrl ? { androidAppUrl } : {}),
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

/**
 * The delegation of a stage's zone from vettid.org (VettidOrgStageDelegationStack,
 * deployed in prod): the four name servers of the stage zone, known only once
 * VettidOrgStageDnsStack exists there (its output NameServers). Context
 * `<stage>ZoneNs`, committed in cdk.json so a later prod deploy keeps it:
 * a comma-separated string or an array. Empty: no delegation stack.
 */
export function stageZoneNs(node: Node, stage: string): string[] {
  const raw = node.tryGetContext(`${stage}ZoneNs`);
  if (raw === undefined || raw === null || raw === '') return [];
  const ns = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((v) => String(v).trim().replace(/\.$/, '').toLowerCase())
    .filter(Boolean);
  const awsNs = /^ns-\d{1,4}\.awsdns-\d{1,2}\.(com|net|org|co\.uk)$/;
  if (ns.length !== 4 || !ns.every((n) => awsNs.test(n)) || new Set(ns).size !== 4) {
    throw new Error(`context ${stage}ZoneNs: expected the four Route 53 name servers of ${stage}.vettid.org, got ${JSON.stringify(raw)}`);
  }
  return ns;
}
