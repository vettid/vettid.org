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
  /**
   * The push gateways of the main account (PUSH-GATEWAY §10): one per
   * channel listed in context `pushStages`, in the prod app only (the
   * staging gateway is a second service next to production's, §10.4).
   * Empty: no push stack exists and the relay stack publishes nothing for
   * one.
   */
  readonly push: { readonly gateways: readonly PushGatewayConfig[] };
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
  /**
   * The staging-only switch-over of MEMBER-API 2.0.0 (ENROLLMENT-CODES §8
   * step 3): the member API still admits portal-style sessions on the app
   * routes (`enclave`, `enroll`, `unlock`, recovery `register`) next to app
   * keys, so the apps of before 2.0.0 keep working until the staging
   * cut-over. Context `<stage>VaultLegacySessionAuth` (`true`); refused in
   * production, where the API never accepts cookies on the app routes.
   */
  readonly vaultLegacySessionAuth?: boolean;
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
  /**
   * The push gateway host on the enclave host's egress allowlist
   * (PUSH-GATEWAY §10.1, §10.4; VAULT-MESSAGING §11.10.8, §14.3). The
   * channel's release constants pin the gateway URL `https://<pushHost>`
   * (vettid-vault `enclave/releasecfg/<channel>.json`): production
   * `push.vettid.org`, staging `push.staging.vettid.org`. Channels never
   * cross: each host allows only its own channel's gateway.
   */
  readonly pushHost: string;
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
      pushHost: 'push.vettid.org',
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
      // The staging gateway (PUSH-GATEWAY §10.4), unlike the relay.
      pushHost: 'push.staging.vettid.org',
    },
  },
};

export type PushChannel = 'prod' | 'staging';
export type PushPlatform = 'fcm' | 'apns';

/** One push gateway (github.com/vettid/vettid-push; PUSH-GATEWAY §10.1, §10.4). */
export interface PushGatewayConfig {
  /** `PUSH_CHANNEL`: selects the pinned manifest, the APNs environments and the secret names. */
  readonly channel: PushChannel;
  /** The channel's `pushHost`, the same name its vault hosts may reach (lib/vault/egress.ts). */
  readonly host: string;
  /**
   * Gateway image, pinned by digest. Context `pushImage` (prod),
   * `stagingPushImage` (staging). Empty: the channel has its secrets, log
   * group and (staging) zone, but no service yet.
   */
  readonly image: string;
  /**
   * `PUSH_PLATFORMS`: the platforms with credentials. Context
   * `pushPlatforms` / `stagingPushPlatforms`, a comma-separated list of
   * `fcm` and `apns`. Default **none**: a gateway starts before any
   * credential exists and answers `platform_invalid` (§5.1 step 3). A
   * listed platform must have its secret filled, or the tasks do not start.
   */
  readonly platforms: readonly PushPlatform[];
  /** `PUSH_FCM_APP_IDS`: Android application ids accepted for `fcm` (§10.4). */
  readonly fcmAppIds: readonly string[];
  /** `PUSH_APNS_APP_IDS`: iOS bundle ids (the `apns-topic`) accepted for `apns` (§10.4). */
  readonly apnsAppIds: readonly string[];
  /**
   * `PUSH_FCM_PROJECT` (§10.2): context `pushFcmProject` /
   * `stagingPushFcmProject`. Empty: the gateway takes `project_id` from
   * the `fcm` secret (a service-account key has it; a federation
   * configuration needs it added, or this set).
   */
  readonly fcmProject: string;
}

/**
 * What each channel's gateway accepts (PUSH-GATEWAY §10.4). An Android
 * registration's `app_id` is the app's application id, which is the
 * channel's `android_package` (VAULT-MESSAGING 0.26.0 §11.10.8, "Android
 * package"; ANDROID-PLAN 0.1.35 §5): `com.vettid.app` in production,
 * `com.vettid.app.staging` in staging from staging release S10 on (until
 * then the staging build had production's id). The staging iOS app has its
 * own bundle id too. An iOS registration's `app_id` is the app's bundle id
 * (the `apns-topic`), never the notification service extension's.
 */
const PUSH_APP_IDS: Record<PushChannel, { fcm: string[]; apns: string[] }> = {
  prod: { fcm: ['com.vettid.app'], apns: ['com.vettid.app'] },
  staging: { fcm: ['com.vettid.app.staging'], apns: ['com.vettid.app.staging'] },
};

const PUSH_CHANNELS: readonly PushChannel[] = ['prod', 'staging'];

/** Context key of a channel's gateway setting: `pushImage` (prod), `stagingPushImage` (staging). */
export function pushContextKey(channel: PushChannel, setting: 'Image' | 'Platforms' | 'FcmProject'): string {
  return channel === 'prod' ? `push${setting}` : `${channel}Push${setting}`;
}

const csv = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((v) => String(v).trim()).filter(Boolean);

/**
 * The push gateways from context (prod app only; see {@link AppConfig.push}):
 *
 *   -c pushStages=staging -c stagingPushImage=ghcr.io/vettid/vettid-push@sha256:…
 *
 * `pushStages` lists the channels whose gateway exists (`staging`, `prod`);
 * a channel's image, platforms and Firebase project are refused unless the
 * channel is listed, so a typo never silently deploys nothing.
 */
function loadPush(node: Node, stage: string): PushGatewayConfig[] {
  if (stage !== PROD_STAGE) return [];
  const listed = csv(node.tryGetContext('pushStages'));
  for (const c of listed) {
    if (!PUSH_CHANNELS.includes(c as PushChannel)) throw new Error(`context pushStages: expected "staging", "prod" or both, got ${JSON.stringify(c)}`);
  }
  const gateways: PushGatewayConfig[] = [];
  for (const channel of PUSH_CHANNELS) {
    const key = (s: 'Image' | 'Platforms' | 'FcmProject') => pushContextKey(channel, s);
    const image = String(node.tryGetContext(key('Image')) ?? '');
    const platforms = [...new Set(csv(node.tryGetContext(key('Platforms'))))];
    const fcmProject = String(node.tryGetContext(key('FcmProject')) ?? '');
    if (!listed.includes(channel)) {
      for (const [k, v] of [[key('Image'), image], [key('Platforms'), platforms.join(',')], [key('FcmProject'), fcmProject]]) {
        if (v) throw new Error(`context ${k} is set but pushStages does not list "${channel}"`);
      }
      continue;
    }
    // A tag can be moved; only a digest names one image (as relayImage).
    if (image && !/^[a-z0-9][a-z0-9._\/-]*@sha256:[0-9a-f]{64}$/.test(image)) {
      throw new Error(`context ${key('Image')}: expected an image pinned by digest (…@sha256:<64 hex>), got ${JSON.stringify(image)}`);
    }
    for (const p of platforms) {
      if (p !== 'fcm' && p !== 'apns') throw new Error(`context ${key('Platforms')}: expected a list of "fcm" and "apns", got ${JSON.stringify(p)}`);
    }
    // Firebase project ids: 6–30 lowercase letters, digits and hyphens.
    if (fcmProject && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(fcmProject)) {
      throw new Error(`context ${key('FcmProject')}: expected a Firebase project id, got ${JSON.stringify(fcmProject)}`);
    }
    const host = STAGE_ACCOUNTS[channel]?.vault?.pushHost;
    if (!host) throw new Error(`no push host for channel ${channel}`);
    gateways.push({
      channel,
      host,
      image,
      platforms: platforms as PushPlatform[],
      fcmAppIds: PUSH_APP_IDS[channel].fcm,
      apnsAppIds: PUSH_APP_IDS[channel].apns,
      fcmProject,
    });
  }
  return gateways;
}

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

/** One stage's Android app, as its account site's Digital Asset Links statement names it. */
export interface AndroidAppLinks {
  /** The app's application id: the channel's `android_package` (VAULT-MESSAGING §11.10.8). */
  readonly packageName: string;
  /** SHA-256 of each certificate the app may be signed with: uppercase hex, colon-separated. */
  readonly sha256CertFingerprints: readonly string[];
}

/**
 * The Android app's same-device setup link (VAULT-MESSAGING §11.12.1): each
 * stage's account site publishes /.well-known/assetlinks.json so that
 * https://account.<zone>/vault/enroll/... opens in that stage's app as a
 * verified App Link. One statement per stage, never both: the app of one
 * channel is not named on the other's site (VAULT-MESSAGING 0.26.0
 * §11.10.8, "Android package"; STAGING-DEVELOPMENT-PLAN D5).
 *
 * - `prod` (account.vettid.org): `com.vettid.app`, signed with the upload
 *   key (builds signed by the owner) now; the Play app-signing key is added
 *   once the Play Console shows it (VAULT-RELEASES O8).
 * - `staging` (account.staging.vettid.org, the only host the staging
 *   build's manifest adds, vettid-android app/src/staging/AndroidManifest.xml):
 *   `com.vettid.app.staging`, the staging build's id from the build that
 *   goes with staging release S10 (ANDROID-PLAN 0.1.35 §5), signed with the
 *   owner's staging signing key or the automation key.
 *
 * The package and the digests are the channel's `android_package` and
 * `android_signers` in vettid-vault enclave/releasecfg/<channel>.json (there
 * in lowercase hex without colons); a change there is a change here. A
 * stage with no entry publishes no statement.
 */
export const ANDROID_APP_LINKS: Readonly<Record<string, AndroidAppLinks>> = {
  prod: {
    packageName: 'com.vettid.app',
    sha256CertFingerprints: [
      '31:A1:96:13:AA:10:F2:09:E0:89:45:F9:47:F9:4F:7C:E3:E6:E5:AC:34:24:57:FF:99:69:A6:79:86:92:8E:65', // upload key (2026-10-04)
    ],
  },
  staging: {
    packageName: 'com.vettid.app.staging',
    // The two staging `android_signers`, in the vault's order.
    sha256CertFingerprints: [
      'BD:83:A0:75:3F:AA:6A:F6:F8:D8:1B:9F:76:A0:4A:C1:A4:99:EA:6C:7F:46:C6:F1:11:3D:4B:57:87:EC:B2:C4',
      '2F:ED:27:B7:27:46:79:7A:93:1F:D4:14:FF:3D:AC:4C:D9:69:FA:0C:2F:F3:62:09:AE:05:36:5F:58:00:14:F2',
    ],
  },
};

/**
 * The Digital Asset Links statement list of a stage's account site
 * ({@link ANDROID_APP_LINKS}); null for a stage that has no app.
 */
export function androidAssetLinks(stage: string): unknown[] | null {
  const links = Object.prototype.hasOwnProperty.call(ANDROID_APP_LINKS, stage) ? ANDROID_APP_LINKS[stage] : undefined;
  if (!links) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: links.packageName,
      sha256_cert_fingerprints: [...links.sha256CertFingerprints],
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

/**
 * The AWS organization (docs/AWS-ACCOUNTS.md). Security alerts are matched
 * and emailed in one place, the management account's VettidOrgAuditStack;
 * every member account forwards its CloudTrail events to the management
 * account's default event bus (VettidOrg*AlertForwardStack; RUNBOOK
 * "Security alerts").
 */
export const ORG = {
  id: 'o-kualrldevn',
  management: '449757308783', // VettID
  members: {
    vaultProd: '369484479783', // vettid-vault-prod
    vaultStaging: '347272280361', // vettid-vault-staging
    proteus: '605628228301', // proteus
  },
} as const;

/**
 * The vault service pause (MEMBER-API "Vault service pause"): an SSM
 * parameter in the stage's main account, written by operators only (admin
 * API or CLI), never by a deploy. Absent means on.
 */
export const vaultServiceParamName = (config: Pick<AppConfig, 'stage'>): string => `/vettid-org/${config.stage}/switch/vault-service`;

/**
 * The setup codes' HMAC key `k_code` (MEMBER-API 2.0.0 "Setup codes"): an
 * SSM SecureString in the stage's main account, created once by an
 * operator (RUNBOOK "Setup codes"), never by a deploy, and read only by the
 * member API's vault routes.
 */
export const enrollCodeKeyParamName = (config: Pick<AppConfig, 'stage'>): string => `/vettid-org/${config.stage}/member/enroll-code-key`;

/**
 * The member API's account-push function (MEMBER-API 2.0.0 "Account
 * snapshot to the vault"): a fixed name, so the admin API can invoke it
 * without a cross-stack reference.
 */
export const accountPushFunctionName = (config: AppConfig): string => resourceName(config, 'member-account-push');

/** Member account ids, in a fixed order. */
export const ORG_MEMBER_ACCOUNTS: readonly string[] = Object.values(ORG.members);

/**
 * The role each member account's forwarding rule uses to put events on the
 * management account's bus. Fixed (no stage suffix; one per account): the
 * management bus policy admits exactly this role in each member account.
 */
export const ALERT_FORWARDER_ROLE_NAME = 'vettid-org-security-alert-forwarder';
/** The forwarding rule in each member account (fixed; the alert rules watch it). */
export const ALERT_FORWARDER_RULE_NAME = 'vettid-org-security-alert-forward';
/**
 * The hourly heartbeat each member account sends to the management bus
 * through the same role; VettidOrgAuditStack alarms when one stops arriving.
 */
export const ALERT_HEARTBEAT_RULE_NAME = 'vettid-org-security-alert-heartbeat';

export function vaultRoleArn(vault: VaultConfig, role: keyof typeof VAULT_ROLE_NAMES): string {
  return `arn:aws:iam::${vault.account}:role/${VAULT_ROLE_NAMES[role]}`;
}

const PROD_STAGE = 'prod';

/**
 * The stage's public vault release log (RELEASE-UPDATES §5, VAULT-RELEASES
 * §7): on the site that serves the stage's manifest, https://<zoneName>.
 * The notice job's RELEASE_LOG_URL and the account site's release_log_url.
 */
export const releaseLogBaseUrl = (config: Pick<AppConfig, 'zoneName'>) => `https://${config.zoneName}/security/releases/`;

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
  const legacyKey = `${stage}VaultLegacySessionAuth`;
  const legacyRaw = node.tryGetContext(legacyKey);
  const vaultLegacySessionAuth = legacyRaw === true || legacyRaw === 'true';
  if (stage === PROD_STAGE && (node.tryGetContext('vaultLegacySessionAuth') !== undefined || legacyRaw !== undefined)) {
    throw new Error('vault legacy session auth is staging-only: production never accepts cookies on the app routes (MEMBER-API 2.0.0)');
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
    push: { gateways: loadPush(node, stage) },
    adminAccess: {
      headscaleLoginServer: String(node.tryGetContext('headscaleLoginServer') ?? ''),
    },
    accounts: { main: STAGE_ACCOUNTS[stage]?.main },
    vault: STAGE_ACCOUNTS[stage]?.vault
      ? { ...STAGE_ACCOUNTS[stage].vault!, vaultsStreamArn: String(node.tryGetContext(streamKey) ?? '') }
      : undefined,
    ...(androidAppUrl ? { androidAppUrl } : {}),
    ...(vaultLegacySessionAuth ? { vaultLegacySessionAuth } : {}),
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
  return nameServersFromContext(node, `${stage}ZoneNs`, `${stage}.vettid.org`);
}

/**
 * The delegation of `push.<stage>.vettid.org` from the stage's zone to the
 * push gateway's zone in the main account (VettidOrgStagePushDelegationStack,
 * deployed in the stage's account; PUSH-GATEWAY §10.4): the four name
 * servers of that zone (VettidOrgPushDataStack's output
 * StagingZoneNameServers). Context `<stage>PushZoneNs`, as `<stage>ZoneNs`.
 * Empty: no delegation stack.
 */
export function stagePushZoneNs(node: Node, stage: string): string[] {
  return nameServersFromContext(node, `${stage}PushZoneNs`, `push.${stage}.vettid.org`);
}

function nameServersFromContext(node: Node, key: string, zone: string): string[] {
  const raw = node.tryGetContext(key);
  if (raw === undefined || raw === null || raw === '') return [];
  const ns = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((v) => String(v).trim().replace(/\.$/, '').toLowerCase())
    .filter(Boolean);
  const awsNs = /^ns-\d{1,4}\.awsdns-\d{1,2}\.(com|net|org|co\.uk)$/;
  if (ns.length !== 4 || !ns.every((n) => awsNs.test(n)) || new Set(ns).size !== 4) {
    throw new Error(`context ${key}: expected the four Route 53 name servers of ${zone}, got ${JSON.stringify(raw)}`);
  }
  return ns;
}
