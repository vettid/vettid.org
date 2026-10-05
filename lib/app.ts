import * as cdk from 'aws-cdk-lib/core';
import { join } from 'node:path';
import { loadConfig, stageZoneNs } from './config';
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
import { VettidOrgStageDnsStack } from './stacks/stage-dns-stack';
import { VettidOrgStageSiteStack } from './stacks/stage-site-stack';
import { VettidOrgStageDelegationStack } from './stacks/stage-delegation-stack';
import { VettidOrgStageTestMailStack } from './stacks/stage-test-mail-stack';
import { VettidOrgCiReadOnlyStack } from './stacks/ci-readonly-stack';
import { hostSpecs, keySpecs, readReleaseFile } from './vault/release-list';

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
  // release with a `host` in vault/releases/<channel>.json (none yet). Later
  // stacks read the earlier ones' refs from SSM at deploy time; nothing is
  // exported.
  const vaultStacks = (): cdk.Stack | undefined => {
    if (!config.vault) return undefined;
    const venv = vaultEnv(config, config.vault);
    // Validated here (synth fails on a malformed list) and in CI (check:manifest).
    const list = readReleaseFile(join(__dirname, '..'), config.vault.channel, config.vault.account);
    const releases = hostSpecs(list);
    const vault = new VettidOrgVaultStack(app, 'VettidOrgVaultStack', {
      config,
      env: venv,
      terminationProtection: true,
      // One sealing key per listed release (§6.2); none yet.
      releaseKeys: keySpecs(list),
    });
    const host = new VettidOrgVaultHostStack(app, 'VettidOrgVaultHostStack', { config, env: venv, releases });
    host.addDependency(vault);
    for (const spec of releases) {
      const rel = new VettidOrgVaultReleaseStack(app, releaseStackId(spec.release), { config, env: venv, spec });
      rel.addDependency(host);
    }
    return vault;
  };

  // A stage whose main stacks are not stood up yet: only its vault
  // account's stack.
  if (config.vault && !config.accounts.main) {
    vaultStacks();
    cdk.Annotations.of(app).addInfoV2('vettid:vault-only', `stage ${config.stage}: only the vault account's stacks (no main account yet)`);
    return;
  }

  // Stacks holding state (zone, pools, tables, buckets, the exit node + EIP)
  // can't be deleted without first turning this off in code — a stray
  // `cdk destroy` fails instead of orphaning or deleting them.
  const stateful = { env, terminationProtection: true };

  // ---- A non-prod stage (staging, VAULT-RELEASES §11.1, W9) ----
  // A copy of what a vault end-to-end test needs, in the stage's own
  // account and zone (<stage>.vettid.org), nothing more:
  //   StageDns (zone + SES domain identity) → Auth, Data → (Vault stacks)
  //   → MemberApi → AccountSite; StageSite (the channel's manifest host);
  //   StageTestMail (a mailbox for automated tests, RUNBOOK "Test mail").
  // Left out on purpose (RUNBOOK "Staging"): the public site, signup and
  // playbooks (prod content), the admin exit node, admin API and site (the
  // drill seeds data from the CLI: scripts/staging/seed.ts), the relay
  // (staging images pin the production relay), push, the vettid.dev
  // redirect, and the audit stack (the organization trail and GuardDuty,
  // administered from the management account, already cover this account).
  // Dependencies only order `cdk deploy --all`; nothing is exported.
  if (config.stage !== 'prod') {
    const dnsStack = new VettidOrgStageDnsStack(app, 'VettidOrgStageDnsStack', { config, ...stateful });
    const auth = new VettidOrgAuthStack(app, 'VettidOrgAuthStack', { config, ...stateful });
    auth.addStackDependency(dnsStack); // Cognito's SES sender needs the domain identity
    const data = new VettidOrgDataStack(app, 'VettidOrgDataStack', { config, ...stateful });
    const vault = vaultStacks();
    const memberApi = new VettidOrgMemberApiStack(app, 'VettidOrgMemberApiStack', { config, env });
    memberApi.addStackDependency(auth);
    memberApi.addStackDependency(data);
    if (vault) memberApi.addStackDependency(vault); // tables and stream policies name its roles
    const accountSite = new VettidOrgAccountSiteStack(app, 'VettidOrgAccountSiteStack', { config, env });
    accountSite.addStackDependency(memberApi);
    accountSite.addStackDependency(dnsStack);
    const site = new VettidOrgStageSiteStack(app, 'VettidOrgStageSiteStack', { config, env });
    site.addStackDependency(dnsStack);
    // Test infrastructure: a mailbox at test.<zone> that automated tests
    // read (sign-in and SES verification links). Never in prod.
    const testMail = new VettidOrgStageTestMailStack(app, 'VettidOrgStageTestMailStack', { config, env });
    testMail.addStackDependency(dnsStack);
    return;
  }

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

  // ---- Delegation of staging.vettid.org to the staging account's zone ----
  // Only once context stagingZoneNs (VettidOrgStageDnsStack's output
  // NameServers, committed in cdk.json) is set; RUNBOOK "Staging".
  const stagingNs = stageZoneNs(app.node, 'staging');
  if (stagingNs.length) {
    new VettidOrgStageDelegationStack(app, 'VettidOrgStagingDelegationStack', { config, stage: 'staging', nameServers: stagingNs, env });
  }

  // ---- Account-level audit & detection (CloudTrail, GuardDuty, alerts) ----
  new VettidOrgAuditStack(app, 'VettidOrgAuditStack', { config, ...stateful });

  // ---- Production drift check (RUNBOOK "Production drift") ----
  // The read-only role .github/workflows/drift.yml assumes, in each
  // production account; the vault account's with the vault-prod profile.
  new VettidOrgCiReadOnlyStack(app, 'VettidOrgCiReadOnlyStack', { config, env });
  if (config.vault) {
    new VettidOrgCiReadOnlyStack(app, 'VettidOrgVaultCiReadOnlyStack', { config, env: vaultEnv(config, config.vault) });
  }
}
