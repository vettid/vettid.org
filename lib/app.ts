import * as cdk from 'aws-cdk-lib/core';
import { loadConfig } from './config';
import { VettidOrgStack } from './stacks/web-stack';
import { VettidOrgDnsStack } from './stacks/dns-stack';
import { VettidOrgSignupStack } from './stacks/signup-stack';
import { VettidDevRedirectStack } from './stacks/dev-redirect-stack';
import { VettidOrgPlaybooksStack } from './stacks/playbooks-stack';
import { VettidOrgAuthStack } from './stacks/auth-stack';
import { VettidOrgDataStack } from './stacks/data-stack';
import { VettidOrgAdminAccessStack } from './stacks/admin-access-stack';
import { VettidOrgAdminApiStack } from './stacks/admin-api-stack';
import { VettidOrgAdminSiteStack } from './stacks/admin-site-stack';
import { VettidOrgMemberApiStack } from './stacks/member-api-stack';
import { VettidOrgAccountSiteStack } from './stacks/account-site-stack';
import { VettidOrgAuditStack } from './stacks/audit-stack';
import { VettidOrgRelayStack } from './stacks/relay-stack';
import { VettidOrgRelayDataStack } from './stacks/relay-data-stack';
import { VettidOrgVaultSmokeStack } from './stacks/vault-smoke-stack';
import { VettidOrgVaultStack, vaultEnv } from './stacks/vault-stack';
import { VettidOrgVaultHostStack } from './stacks/vault-host-stack';
import { VettidOrgVaultReleaseStack, releaseStackId } from './stacks/vault-release-stack';
import { VAULT_RELEASES, validateReleaseList } from './vault/releases';

/**
 * Builds every stack in the vettid.org app. Kept out of bin/ so tests can
 * synthesize the whole app (see test/app-guardrails.test.ts).
 *
 * Stack groups (see docs/ACCOUNT-ADMIN-PLAN.md §3):
 *  - public site: Dns, Signup, Playbooks, VettidOrgStack, VettidDevRedirect
 *    (pre-existing; their construct IDs must not change)
 *  - stateful:  Auth, Data, AdminAccess, RelayData (rarely deployed, RETAIN)
 *  - stateless: MemberApi, AccountSite, AdminApi, AdminSite
 *  Stateful → stateless references go through SSM (lib/constructs/ssm-refs.ts),
 *  never CloudFormation exports.
 */
export function buildApp(app: cdk.App): void {
  const config = loadConfig(app.node);

  // Everything lives in us-east-1: CloudFront certs and CLOUDFRONT-scope WAF
  // require it, and one region keeps the growing environment simple.
  // The main account is pinned per stage (lib/config.ts), so deploying a
  // vault stack with the vault account's profile still synthesizes these
  // stacks against their own account and cached lookups.
  const env = {
    account: config.accounts.main ?? process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  };

  const domainName = config.domainName;

  // The vault account's stacks (VAULT-RELEASES §8.2), in deploy order:
  // VaultStack (stateful) → VaultHostStack → one VaultRelease<N>Stack per
  // release in lib/vault/releases.ts (none yet). Later stacks read the
  // earlier ones' refs from SSM at deploy time; nothing is exported.
  const vaultStacks = () => {
    if (!config.vault) return;
    const venv = vaultEnv(config, config.vault);
    const releases = VAULT_RELEASES[config.vault.channel];
    validateReleaseList(releases, config.vault.channel);
    const vault = new VettidOrgVaultStack(app, 'VettidOrgVaultStack', {
      config,
      env: venv,
      terminationProtection: true,
      // Release keys come from vault/releases.json (W7). None exist yet.
      releaseKeys: [],
    });
    const host = new VettidOrgVaultHostStack(app, 'VettidOrgVaultHostStack', { config, env: venv, releases });
    host.addDependency(vault);
    for (const spec of releases) {
      const rel = new VettidOrgVaultReleaseStack(app, releaseStackId(spec.release), { config, env: venv, spec });
      rel.addDependency(host);
    }
  };

  // A stage whose main stacks are not stood up yet (staging, until W9):
  // only its vault account's stack.
  if (config.vault && !config.accounts.main) {
    vaultStacks();
    cdk.Annotations.of(app).addInfoV2('vettid:vault-only', `stage ${config.stage}: only the vault account's stacks (no main account yet)`);
    return;
  }

  // Stacks holding state (zone, pools, tables, buckets, the exit node + EIP)
  // can't be deleted without first turning this off in code — a stray
  // `cdk destroy` fails instead of orphaning or deleting them.
  const stateful = { env, terminationProtection: true };

  // Deploy order: SignupStack and DnsStack first, then VettidOrgStack
  // (the web stack consumes both via props, and resolves the signup
  // stack's origin-verify secret by name at deploy time).
  //   npx cdk deploy VettidOrgDnsStack VettidOrgSignupStack VettidOrgStack

  const dns = new VettidOrgDnsStack(app, 'VettidOrgDnsStack', {
    domainName,
    ...stateful,
  });

  const signup = new VettidOrgSignupStack(app, 'VettidOrgSignupStack', { hostedZone: dns.zone, ...stateful });

  const playbooks = new VettidOrgPlaybooksStack(app, 'VettidOrgPlaybooksStack', stateful);

  new VettidOrgStack(app, 'VettidOrgStack', {
    domainName,
    enableCustomDomain: true,
    hostedZone: dns.zone,
    apiDomain: signup.apiDomain,
    playbooksBucket: playbooks.bucket,
    env,
  });

  // The whole remaining vettid.dev footprint: a blanket 301 to vettid.org.
  // Deploy only after the old VettIDStack is deleted (alias exclusivity).
  new VettidDevRedirectStack(app, 'VettidDevRedirectStack', { env });

  // ---- Account + admin (docs/ACCOUNT-ADMIN-PLAN.md) ----
  // Deploy order: Auth, Data → AdminAccess (reads the admin pool ARN via SSM)
  //   → AdminApi, AdminSite (read pool/client IDs, egress IP, web ACL via SSM)
  //   → MemberApi → AccountSite (reads the API domain + origin secret).
  new VettidOrgAuthStack(app, 'VettidOrgAuthStack', { config, ...stateful });
  new VettidOrgDataStack(app, 'VettidOrgDataStack', { config, ...stateful });
  if (config.adminAccess.headscaleLoginServer) {
    new VettidOrgAdminAccessStack(app, 'VettidOrgAdminAccessStack', { config, ...stateful });
  } else {
    cdk.Annotations.of(app).addWarningV2(
      'vettid:admin-access-unconfigured',
      'VettidOrgAdminAccessStack skipped: set context "headscaleLoginServer" in ~/.cdk.json',
    );
  }
  new VettidOrgAdminApiStack(app, 'VettidOrgAdminApiStack', { config, env });
  new VettidOrgAdminSiteStack(app, 'VettidOrgAdminSiteStack', { config, env });
  new VettidOrgMemberApiStack(app, 'VettidOrgMemberApiStack', { config, env });
  new VettidOrgAccountSiteStack(app, 'VettidOrgAccountSiteStack', { config, env });

  // ---- Relay (docs/RELAY-PROTOCOL.md; code: github.com/vettid/vettid-relay) ----
  // Deploy order: RelayData (table + blob bucket, stateful) → Relay (VPC,
  // Valkey, ECS service, ALB; reads the data refs via SSM).
  new VettidOrgRelayDataStack(app, 'VettidOrgRelayDataStack', { config, ...stateful });
  if (config.relay.image) {
    new VettidOrgRelayStack(app, 'VettidOrgRelayStack', { config, relayImage: config.relay.image, env });
  } else {
    cdk.Annotations.of(app).addInfoV2('vettid:relay-unconfigured', 'VettidOrgRelayStack skipped: set context relayImage (digest-pinned)');
  }

  // ---- TEMPORARY vault hardware smoke test (VAULT-PLAN V5). Only with
  // `-c vaultSmoke=true`; destroy it when the test is done. ----
  if (app.node.tryGetContext('vaultSmoke') === 'true' || app.node.tryGetContext('vaultSmoke') === true) {
    new VettidOrgVaultSmokeStack(app, 'VettidOrgVaultSmokeStack', {
      config,
      pcr0: String(app.node.tryGetContext('vaultSmokePcr0') ?? ''),
      env,
    });
  }

  // ---- Vault (docs/VAULT-RELEASES.md §8; deployed into the vault account) ----
  // Deploy with that account's profile, VaultStack before the member API
  // that reads its tables (RUNBOOK "Vault"):
  //   npx cdk deploy VettidOrgVaultStack VettidOrgVaultHostStack --profile vault-prod
  vaultStacks();

  // ---- Account-level audit & detection (CloudTrail, GuardDuty, alerts) ----
  new VettidOrgAuditStack(app, 'VettidOrgAuditStack', { config, ...stateful });
}
