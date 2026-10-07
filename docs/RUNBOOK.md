# vettid.org Operations Runbook

Everything you need to operate this environment, captured as of 2026-08-15.

## Deploys

```bash
npm run build && npm test && npm run check:site   # what CI runs
npx cdk diff                                      # preview before deploying
npm run deploy:site                               # web stack only (content changes)
npm run deploy:all                                # everything
```

- Content deploys take ~2–4 min: `BucketDeployment` uploads `website/` (HTML/txt/xml/json
  as `no-cache, must-revalidate`; assets 7-day cache) and invalidates CloudFront `/*`.
  Visitors see HTML changes immediately.
- Requires an active AWS SSO session (`aws sso login`); us-east-1 only.
- Stack order when deploying individually: DnsStack → SignupStack → VettidOrgStack
  (props flow left to right in `lib/app.ts`). SignupStack must go first also
  because it creates the `vettid-org-signup/origin-verify` secret that
  VettidOrgStack resolves (by name) into the `/api/*` origin header; until
  VettidOrgStack is redeployed after it, the signup API answers 403.
- Deploy what you merge, from an up-to-date master with `npm ci`'d
  dependencies and the default `cdk.out`. A daily check alerts when
  production differs from master ("Production drift" below).

## Stacks

Stateful stacks (Dns, Signup, Playbooks, Auth, Data, AdminAccess, RelayData, Audit, Vault; in staging StageDns) have
CloudFormation termination protection on (`lib/app.ts`); deleting one means
turning that off in code (or the console) first.

| Stack | Owns |
|---|---|
| `VettidOrgDnsStack` | Route53 zone for vettid.org + ProtonMail mail records |
| `VettidOrgStack` | Site bucket, CloudFront, cert, WAF telemetry, all logging |
| `VettidOrgSignupStack` | Mailing list: DynamoDB, Lambdas, HTTP API, SES domain identity |
| `VettidOrgPlaybooksStack` | Playbooks origin bucket (served at `/playbooks/*` by VettidOrgStack; content deployed from the vettid-playbooks repo) |
| `VettidDevRedirectStack` | The entire vettid.dev footprint: blanket 301 → vettid.org. Permanent. |
| `VettidOrgAuthStack` | Member + admin Cognito pools, clients, groups, admin hosted-UI domain, PIN pepper secret. Stateful. |
| `VettidOrgDataStack` | Account/admin DynamoDB tables (`vettid-org-*`) + terms PDF bucket. Stateful. (The vault tables moved to VettidOrgVaultStack.) |
| `VettidOrgAdminAccessStack` | Admin tailnet exit node (EC2 + EIP) and the CloudFront WAF allowlist keyed to its IP (admin site). |
| `VettidOrgAdminApiStack` | Admin REST API at admin-api.vettid.org (docs/ADMIN-API.md): exit-node-IP resource policy + Cognito authorizer, 4 route-group Lambdas (people, content, system, vault-canary). |
| `VettidOrgAdminSiteStack` | Admin SPA at admin.vettid.org (`sites/admin`), behind the exit-node web ACL. |
| `VettidOrgRelayDataStack` | Relay state: DynamoDB table `vettid-org-relay` and the blob bucket `vettid-org-relay-blobs-<account>` (published via SSM `relay/*`). Stateful. |
| `VettidOrgVaultStack` | **In the vault account** (prod: vettid-vault-prod 369484479783; staging: vettid-vault-staging 347272280361). Vault tables (`vettid-org-vault*`), data bucket `vettid-org-vault-data-<account>`, the fixed-name host and retirement roles, manifest key A and its signer role, the release-key custom resource and one key per release. Stateful; see "Vault". |
| `VettidOrgStagingDelegationStack` | Prod (management account), only once context `stagingZoneNs` is set: the one NS record delegating staging.vettid.org to the staging account's zone. See "Staging". |
| `VettidOrgStageDnsStack` | **Staging only** (vettid-vault-staging): zone `staging.vettid.org`, its CAA, the SES domain identity `staging.vettid.org` (DKIM records), SSM `dns/zone-id`. Stateful. |
| `VettidOrgStageSiteStack` | **Staging only**: https://staging.vettid.org (`sites/staging`), serving the staging channel's manifest from `vault/staging/pcr-manifest.json`. |
| `VettidOrgStageTestMailStack` | **Staging only, test infrastructure**: MX for `test.staging.vettid.org`, the SES receipt rule set storing its mail in `vettid-org-staging-test-mail-<account>` (7 days), the owner-only reader role. See "Staging" → "Test mail". Never in prod. |
| `VettidOrgAuditStack` | Management account: the organization CloudTrail trail and its bucket, the GuardDuty detector (administrator for the organization), Access Analyzer, the security-alert rules and topic `vettid-org-security-alerts`, and the default-bus policy admitting the member accounts' forwarders. Stateful. See "Security alerts". |
| `VettidOrgVaultAlertForwardStack` | **In the vault account** (prod: vettid-vault-prod; staging: vettid-vault-staging): the one rule forwarding its CloudTrail events to the management account's bus. See "Security alerts". |
| `VettidOrgProteusAlertForwardStack` | **In the proteus account** (605628228301): the same forwarder. Deployed from this repository with `--profile proteus`. See "Security alerts". |
| `VettidOrgCiReadOnlyStack`, `VettidOrgVaultCiReadOnlyStack` | Prod only, one per production account (management; vettid-vault-prod with `--profile vault-prod`): the GitHub Actions OIDC provider and the read-only role `vettid-org-ci-drift-readonly` for the drift check. See "Production drift". |
| `VettidOrgRelayStack` | relay.vettid.org: VPC (no NAT; S3 + DynamoDB gateway endpoints), ElastiCache Serverless Valkey (IAM auth, TLS), ECS Fargate service (2–8 tasks, rolling deploys), ALB with PQ TLS. Logs to `/vettid-org/<stage>/relay-service`. Only deployed when `relayImage` is set. |

## Production drift

On 2026-10-05 a security fix (PIN lockout) had been merged for four days
but never deployed. `.github/workflows/drift.yml` makes that visible: every
day at 13:23 UTC, and on demand, it synthesizes master and compares every
production stack's template with the one CloudFormation holds, in the
management account and vettid-vault-prod. Staging is not checked.

- **What counts.** The whole template, minus CDK's version metadata. Lambda
  code and site content are in it as asset hashes (S3 keys), so a merged
  code change that was not deployed shows as a changed `Code/S3Key`.
  Also reported: stacks in master that are not deployed, `Vettid*` stacks
  deployed that master no longer has (a forgotten smoke stack, or one master
  skips: `VettidOrgAdminAccessStack` when `headscaleLoginServer` is unset),
  and stacks it could not check (mid-update, API error). It does **not**
  see console changes to resources (that is CloudFormation drift detection,
  a different thing), nor deploy-time inputs outside the template (SSM
  values, the secret behind a dynamic reference). Context given only on
  the deploy command line (`-c vettidDevMailPolicy=true`) is not in CI's
  synth: once used for good, make it the default in code or `cdk.json`.
- **Asset hashes are path-independent.** A Lambda's asset hash covers its
  source map, whose `sources` esbuild writes relative to the bundling
  directory. `ApiFunction` rewrites them after bundling to what the default
  `cdk.out` produces (`lib/constructs/sourcemap-paths.cjs`), so the same code
  has the same hash whatever the checkout path or `-o` directory. Other
  inputs still matter: deploy from master with `npm ci`'d dependencies (a
  stale `node_modules` bundles different code, and the check rightly says
  so) and with no untracked files under `website/` or `sites/` (they would
  be deployed, and then differ).
- **Non-ASCII.** CloudFormation's GetTemplate returns every non-ASCII
  character of a deployed template as `?`; the comparison folds both sides
  the same way, so a change from `§` to `¶` alone is not seen.
- **Access.** GitHub OIDC → `vettid-org-ci-drift-readonly` in each account
  (`VettidOrgCiReadOnlyStack`, `VettidOrgVaultCiReadOnlyStack`): only
  workflows of vettid/vettid.org running on master can assume it (OIDC
  `sub` `repo:vettid/vettid.org:ref:refs/heads/master`, `aud`
  `sts.amazonaws.com`), and it can only `cloudformation:ListStacks` and
  `cloudformation:GetTemplate` on `Vettid*` stacks. No credentials are
  stored in GitHub. Synth needs no AWS access (lookups are committed in
  `cdk.context.json` and `cdk.json`); the one uncommitted context value,
  `headscaleLoginServer`, comes from the repository **secret**
  `HEADSCALE_LOGIN_SERVER` (masked in logs; the repo is public, and
  variables are not). The workflow never echoes it, discards synth's
  output, and the report and issue name template paths and logical IDs
  only, never values.

**Reading the result.** In sync: the run is green and an open "Production
drift" issue is closed. Drift: the run fails (GitHub emails the failure)
and the issue "Production drift" is opened, or its body replaced (a comment
only when the set of stacks changes). Per stack it shows when it was last
deployed, the template paths that differ (`… (Lambda code)` for code), and
master's commits since that deploy (squash merges, so one per PR). Then:

- *in master, not deployed / differs from master*: deploy it (`npx cdk diff
  <stack>` first, with the right profile); the next run closes the issue.
  Re-run the workflow (Actions → Production drift → Run workflow) to close
  it at once.
- *deployed, not in master*: a stack deployed from a branch that never got
  merged, a temporary stack to destroy, or `VettidOrgAdminAccessStack` with
  the repository secret missing.
- If a difference is deliberate (rare: a deploy held back on purpose), say
  so in the issue; it stays open and the run stays red until it is
  deployed.

**Running it by hand** (read-only; with your SSO session):

```bash
npx cdk synth --quiet       # into the default cdk.out
npm run drift -- check --account 449757308783 --profile default    --out local/drift-main.json
npm run drift -- check --account 369484479783 --profile vault-prod --out local/drift-vault.json
npm run drift -- report local/drift-main.json local/drift-vault.json   # exit 1 = drift
```

**First deployment** (once):

```bash
aws sso login
# 1. The read-only roles (and each account's GitHub OIDC provider; none existed).
npx cdk deploy VettidOrgCiReadOnlyStack
npx cdk deploy VettidOrgVaultCiReadOnlyStack --profile vault-prod
# 2. The one context value not in the repo, as a secret: paste the value of
#    ~/.cdk.json headscaleLoginServer at the prompt (not on the command line).
gh secret set HEADSCALE_LOGIN_SERVER --repo vettid/vettid.org
# 3. Run it once: Actions → Production drift → Run workflow (or:)
gh workflow run drift.yml --repo vettid/vettid.org --ref master
```

A second user of GitHub OIDC in either account must import this stack's
provider (IAM allows one per URL per account), not create another.

## CDK conventions (new stacks)

Applies to everything added from the account/admin work onward
(docs/ACCOUNT-ADMIN-PLAN.md §3); the stacks above are grandfathered and keep
their construct IDs.

- **App wiring** lives in `lib/app.ts` (`bin/` only calls `buildApp`).
  Config — stage, domain, zone, region, sender/admin email — comes from
  `lib/config.ts`; `-c stage=staging` builds the staging copy (see
  "Staging"), the default is `prod`. Physical names come from
  `resourceName()` (`vettid-org-<thing>`); hosts from `hostName()`; a site's
  zone from `stageZone()` (prod: the cached vettid.org lookup; staging: the
  stage zone's SSM ref, no lookup).
- **Stateful vs stateless.** Pools and tables go in stateful stacks
  (Auth, Data) with `RemovalPolicy.RETAIN`; APIs and sites go in stateless
  stacks that deploy freely.
- **No CloudFormation exports between them.** Producers call `publishRef()`,
  consumers `readRef()` (`lib/constructs/ssm-refs.ts`, params under
  `/vettid-org/<stage>/…`). Deploy the producer first.
- **Lambdas** are defined only through `ApiFunction` (Node 24, ARM64, esbuild,
  path-independent source maps, 1-month log group) and served through `HttpRouteGroup`: one function per
  route *group* (`ANY /api/<group>/{proxy+}`), routing in the handler.
- **Static sites** use `StaticSite`: own host, strict CSP (`script-src 'self'`,
  no inline styles, no `data:` images, Trusted Types required — build DOM with
  `createElement`/`textContent`, never HTML strings), same-origin `/api/*`,
  `/config.json` generated at deploy time from CDK tokens, and CloudFront
  access logs in a private per-site bucket (90 days). Dotfiles, `*.swp`, `*~`
  and `*.example.json` under the site directory are never deployed.
  With `notFoundPage`, unknown paths get the site's branded `404.html` with
  a real 404 status, answered by the viewer-request CloudFront Function from
  a file list built at synth (distribution-wide error pages are avoided
  because they would also rewrite the API's JSON errors). The function must
  stay under 10 KB; synth fails loudly if a site outgrows it.
- **Guardrails** (`test/app-guardrails.test.ts`, run in CI): ≤ 200 resources
  per stack, no `Fn::ImportValue` outside the grandfathered stacks, and every
  table/user pool retained.

## Admin access (Headscale exit node)

Admin (site and API) only answers requests from the exit node's Elastic IP.
The Cognito admin login itself is not IP-locked — the classic hosted UI makes
some calls (first-login "set new password") from Cognito's own servers, which
an allowlist blocks — so it relies on TOTP MFA; tokens are useless off the
exit node because the site and API are locked. To use admin: connect to the tailnet and select
the `vettid-org-admin-exit` exit node. Off → 403 everywhere.

**First-time setup** (and after replacing the instance):

1. On the Headscale server, create a pre-auth key:
   `headscale preauthkeys create --user <user> --expiration 1h`
2. Store it — run it yourself; the key should not pass through chat or the repo:
   `aws secretsmanager create-secret --name vettid-org-admin-access/headscale-preauth-key --secret-string <key>`
   (`put-secret-value` if it already exists).
3. Context `headscaleLoginServer` = the Headscale URL, kept **out of the repo**
   in your user-level `~/.cdk.json`:
   `{ "context": { "headscaleLoginServer": "https://<headscale host>" } }`.
   Without it the AdminAccess stack is skipped (with a synth warning).
   Deploy order: `VettidOrgAuthStack VettidOrgDataStack` → `VettidOrgAdminAccessStack`.
4. Approve the exit-node routes: `headscale nodes list-routes` /
   `headscale nodes approve-routes --identifier <id> --routes 0.0.0.0/0,::/0`
   (Headscale < 0.26: `headscale routes list` / `headscale routes enable -r <id>`;
   or an `autoApprovers.exitNode` entry in the Headscale policy).
5. The instance joins at first boot. If it didn't (key expired/missing):
   `aws ssm start-session --target <ExitNodeInstanceId>` then re-run the
   `tailscale up --login-server=... --authkey=... --advertise-exit-node` line.

The node patches itself (dnf-automatic) and has no SSH; admin it with SSM
Session Manager. Its AMI is pinned in `cdk.context.json` so a new Amazon
Linux release never replaces it on deploy. The EIP is retained even if the
stack is deleted.

- **Replacement:** a change to the instance's launch settings (metadata
  options, launch template) replaces the instance on deploy. A user-data-only
  change does *not* (it reboots the box, and user data doesn't re-run), so
  apply such changes by hand over SSM too. A replaced node joins Headscale
  from scratch — put a fresh pre-auth key in the secret (steps 1–2) *before*
  deploying, then re-approve its routes (step 4) and delete the old node in
  Headscale. The EIP re-associates automatically, so allowlists hold.
- **Metadata:** IMDSv2 only with PUT hop limit 1, and the
  `vettid-linklocal-drop` systemd unit loads an nftables table that drops
  anything forwarded to `169.254.0.0/16` — tailnet peers can't reach the
  instance's metadata/credentials through the exit node. Check with
  `sudo nft list table inet vettid_linklocal`.
- **Session logging:** transcripts can go to the `/vettid-org/ssm-sessions`
  log group (90 days; the instance role may write it). One-time, per account:
  Systems Manager → Session Manager → Preferences → CloudWatch logging on,
  group `/vettid-org/ssm-sessions`, "encrypt" off (the group isn't KMS-encrypted).

**Adding an admin:** give them a Headscale node, then
`scripts/create-admin.sh <email>` (run twice: first sends SES verification,
second creates the Cognito user, which emails a temporary password). First
sign-in sets a password and enrolls TOTP. **Removing an admin:** delete
their Headscale node *and* disable/delete the Cognito user.

## Relay (relay.vettid.org)

Hosting option B (decided 2026-10-03): several identical Fargate tasks
behind the ALB on one shared store — DynamoDB (state), S3 (blob bodies),
Valkey (replay cache, rate limits, wake-on-deposit). Any task serves any
request; deploys are rolling with no downtime. Code and design:
github.com/vettid/vettid-relay (`internal/store/dynamo`, `internal/coord`,
README "Multi-process hosting").

```bash
npx cdk deploy VettidOrgRelayDataStack   # first, and rarely: table + bucket + SSM refs
npx cdk deploy VettidOrgRelayStack       # service; reads the refs at deploy time
```

- **Image.** `relayImage` in `cdk.json` is a digest from the relay repo's
  `publish` job (GHCR). The image must support `RELAY_STORE=dynamodb`
  (vettid-relay ≥ the "hosting option B" merge); an older digest fails its
  health check and the circuit breaker rolls back.
- **Deploys.** 100% min / 200% max: two new tasks start and pass health
  checks, the old ones are deregistered, drained 30 s (longer than a 25 s
  long-poll), then sent SIGTERM (40 s stop timeout). WebSockets on a
  stopping task are closed with 1001 and clients reconnect to another task.
- **Scaling.** Target tracking on CPU 50% and memory 70%, 2–8 tasks of
  0.25 vCPU / 512 MB. Raise task size before raising the maximum when
  CPU-bound.
- **Valkey.** `vettid-org-relay`, ElastiCache Serverless, Valkey 8. The
  relay authenticates as user `vettid-org-relay` with IAM (`elasticache:Connect`;
  no password exists) over TLS; that user can touch only `relay:*` keys and
  channels. Limits: 1 GB data, 100k ECPU/s (cost guard). Nothing in it needs
  backing up: losing it costs at most 90 s of replay protection (requests
  are refused, not admitted, while it is unreachable) and some wake-up
  latency.
- **Health.** `/healthz` reads DynamoDB. Metrics worth alarming on (task
  `/metrics`, loopback): `relay_coord_errors_total`, `relay_wake_bus_up`,
  `relay_errors_total{code="internal"}`.
- **Data.** Everything stored is ciphertext the relay cannot read. Table
  has deletion protection, no PITR (messages live ≤ 14 days); the blob
  bucket expires objects after 8 days.
- **Empty hints.** Idle long-polls mostly skip DynamoDB (Valkey knows the
  mailbox is empty); `relay_collect_store_skips_total` vs
  `relay_collect_store_queries_total` shows the ratio, and
  `relay_empty_hint_bump_failures_total` > 0 means some deposits may have
  waited up to 5 min (`RELAY_EMPTY_SKIP_MAX`).

### After the option-B cutover: delete the SQLite-era leftovers (by hand, once)

The SQLite/Litestream relay left a versioned replica bucket and a log group,
both RETAIN, which the new stack no longer manages. Delete them only after
`VettidOrgRelayStack` has finished deploying and the old single task is gone
(its Litestream sidecar writes to the bucket until then):

```bash
# 1. The rollout is over: one deployment left, running the new task definition.
aws ecs describe-services --cluster vettid-org-relay --services vettid-org-relay \
  --query 'services[0].deployments[].[status,rolloutState,taskDefinition]'   # a single PRIMARY / COMPLETED row
# 2. Empty the versioned replica bucket (versions, then delete markers;
#    skip a pass whose file says "Objects": null; repeat if > 1000 keys).
B=vettid-org-relay-replica-$(aws sts get-caller-identity --query Account --output text)
aws s3api list-object-versions --bucket "$B" --max-items 1000 \
  --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}' --output json > /tmp/rv.json
aws s3api delete-objects --bucket "$B" --delete file:///tmp/rv.json
aws s3api list-object-versions --bucket "$B" --max-items 1000 \
  --query '{Objects: DeleteMarkers[].{Key: Key, VersionId: VersionId}}' --output json > /tmp/rm.json
aws s3api delete-objects --bucket "$B" --delete file:///tmp/rm.json
aws s3api delete-bucket --bucket "$B"
# 3. The SQLite-era log group (the service now logs to …/relay-service).
aws logs delete-log-group --log-group-name /vettid-org/prod/relay
```

(Before this step a rollback to the SQLite relay can still restore from the
replica; after it, it cannot.)

## Vault (V5; docs/VAULT-RELEASES.md)

Staging has published releases (S1 and S2, now `removed`, and S3,
`active` since manifest serial 4); production has no release and no
release key yet (release 1: docs/W10-READINESS.md).
Per vault account there are three kinds of stack (VAULT-RELEASES §8.2),
deployed in this order with that account's profile:

1. `VettidOrgVaultStack`: stateful (tables, data bucket, fixed roles, keys).
2. `VettidOrgVaultHostStack`: stateless (VPC, DNS Firewall, build VPC and
   Image Builder infrastructure, DLQ, host log group, smoke-test key,
   scaler, manifest sync, alarms). Reads the stream ARN from (1) via SSM.
3. `VettidOrgVaultRelease<N>Stack`, one per entry with a `host` in
   `vault/releases/<channel>.json` (`lib/vault/release-list.ts`): AMI,
   launch template, group `vettid-org-vault-r<N>`. Reads (2)'s refs via
   SSM.

### Accounts and profiles

| Stage | Vault account | CLI profile | Member API account |
|---|---|---|---|
| `prod` | vettid-vault-prod 369484479783 | `vault-prod` | management 449757308783 (default profile) |
| `staging` | vettid-vault-staging 347272280361 | `vault-staging` | the staging account itself (full copy, W9) |

`lib/config.ts` pins these. A vault stack must be deployed with its
account's profile; CDK refuses a cross-account deploy (bootstrap trust is
per account). A `-c stage=staging` synth also contains the staging copy of
the main stacks, all in 347272280361 (W9, "Staging").

For the owner-only roles, add chained profiles (MFA is Identity Center's,
at sign-in):

```ini
[profile vault-prod-key-retirement]
source_profile = vault-prod
role_arn = arn:aws:iam::369484479783:role/vettid-org-vault-key-retirement
[profile vault-prod-manifest-signer]
source_profile = vault-prod
role_arn = arn:aws:iam::369484479783:role/vettid-org-vault-manifest-signer
```

(and `vault-staging-key-retirement` / `vault-staging-manifest-signer` with
`source_profile = vault-staging` and account 347272280361 for staging).
`npm run vault:manifest` uses `vault-<channel>-manifest-signer` unless
`VAULT_SIGNER_PROFILE` says otherwise.

### First deployment (W5), in order

```bash
aws sso login
# 1. Staging vault account (nothing depends on it yet).
npx cdk diff   VettidOrgVaultStack -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgVaultStack -c stage=staging --profile vault-staging
# 2. Production vault account. The diff shows only new resources.
npx cdk diff   VettidOrgVaultStack --profile vault-prod
npx cdk deploy VettidOrgVaultStack --profile vault-prod
# 3. Put the output VaultsStreamArn into cdk.json "context": "vaultsStreamArn"
#    (commit it), then move the member API to the vault account's tables
#    (renamed fixed-name roles, ARNs in env, the cross-account stream):
npx cdk diff   VettidOrgMemberApiStack
npx cdk deploy VettidOrgMemberApiStack
# 4. DataStack drops the four W4 vault tables (CloudFormation retains them)
#    and their data/vault* SSM refs:
npx cdk diff   VettidOrgDataStack      # only removals of vault tables + refs
npx cdk deploy VettidOrgDataStack
# 5. Delete the orphaned, empty W4 tables by hand (check they are empty):
for t in vettid-org-vaults vettid-org-vault-instances vettid-org-vault-requests vettid-org-vault-releases; do
  aws dynamodb scan --table-name $t --select COUNT --query Count
  aws dynamodb update-table --table-name $t --no-deletion-protection-enabled >/dev/null
  aws dynamodb delete-table --table-name $t >/dev/null
done
# 6. The Vault OU SCP, from the management account (dry run first):
scripts/vault/apply-scp.sh
scripts/vault/apply-scp.sh --apply
```

Step 3 before step 4: the old member API resolves `data/vaults-stream-arn`
at deploy time, the new one does not. Between steps 2 and 3 the deployed
API still points at the (empty) W4 tables, which is harmless while no
release exists.

### Cross-account access

The member API's vault routes, cleanup job and alarm mailer run as fixed
roles (`vettid-org-member-vault`, `-cleanup`, `-vault-alarms`) and address
the vault tables by ARN. The vault account's table and stream resource
policies admit exactly those roles with exactly their grants, rendered
from the same matrix as their IAM policies (`lib/vault/access.ts`).
Control queues are created by the enclave host with the queue policy in
SSM `/vettid-org/<stage>/vault/control-queue-policy` (send only, vault and
cleanup roles only). Renaming one of the three roles breaks the vault
routes until VettidOrgVaultStack is redeployed.

### Never delete or rename

- `vettid-org-vault-host` (role and instance profile) and
  `vettid-org-vault-key-retirement`: every release key's policy names
  them forever. Deleting the host role makes every vault of every release
  unopenable; deleting the retirement role makes every key undeletable
  and fails the enclave's check 8. Retained, guarded by
  `test/vault-stack.test.ts`, and (once applied) by the Vault OU SCP,
  which no principal inside a vault account can override. Their IAM
  policies may change.
- Release keys can never be disabled or have their policy changed. Removing
  a release from the stack leaves its key alone (RETAIN; the custom
  resource's delete does nothing). A changed release entry fails the
  deploy (the key is immutable): add a new release instead.
- Break-glass for any of this: detach or edit `vettid-vault-key-protection`
  from the management account.

### Creating a release key

A key per entry of `vault/releases/<channel>.json` (W7): add release N
with `status: "candidate"`, its PCR0–2, `seal_key: ""`, `notes` (production:
`https://vettid.org/security/releases/<N>/`) and `admitted_pcr0s` = the
PCR0s of every release not `removed` (never changed afterwards). `npm test`
and `npm run check:manifest` validate the file.

1. `npx cdk diff VettidOrgVaultStack --profile vault-prod`: exactly one new
   `Custom::VettidReleaseKey` and its SSM parameter. Read its `Policy`
   (the §11.10.7 shape: no administrator statement; Decrypt for this PCR0;
   GenerateDataKey for this and the admitted PCR0s; reads for the host and
   retirement roles; the two retirement statements with this channel's
   window). `npm test` has already run it through the enclave's rules.
2. `npx cdk deploy VettidOrgVaultStack --profile vault-prod`. The custom
   resource re-checks the policy and calls `CreateKey` with
   `BypassPolicyLockoutSafetyCheck`; a refused policy fails the deploy
   before KMS is called.
3. The ARN: `aws ssm get-parameter --profile vault-prod --name
   /vettid-org/prod/vault/releases/<n>/seal-key-arn --query Parameter.Value --output text`;
   write it into the entry's `seal_key` and commit.
4. Check the live key with the enclave's own code (vettid-vault
   docs/RELEASING.md steps 5–6):
   `AWS_PROFILE=vault-prod-key-retirement vaultctl keycheck -channel prod -key-arn <arn> -manifest draft.json -record keycheck/<n>`.
   The release stops unless it exits 0.

Staging keys have the same shape with a 7-day window and are deleted after
use: `AWS_PROFILE=vault-staging-key-retirement aws kms schedule-key-deletion
--key-id <arn> --pending-window-in-days 7` (any other window is refused).

### Retirement

At a release's end date it is `removed`, its stack deleted and its key
scheduled for deletion **as the retirement role, with exactly the pinned
window** (30 days in production; any other window is refused by the key
policy), with a rescue (cancel, enable, restart, move) on request within
that window (VAULT-RELEASES §3.5, §10.3):
`AWS_PROFILE=vault-prod-key-retirement aws kms schedule-key-deletion --key-id <arn> --pending-window-in-days 30`.

### Host stack (W6), first deployment

```bash
aws sso login
# Once per account: Image Builder's service-linked role (CloudFormation's
# first CreateImage normally creates it; this is harmless if it exists).
aws iam create-service-linked-role --aws-service-name imagebuilder.amazonaws.com --profile vault-staging || true
aws iam create-service-linked-role --aws-service-name imagebuilder.amazonaws.com --profile vault-prod || true
# 1. Staging first.
npx cdk diff   VettidOrgVaultHostStack -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgVaultHostStack -c stage=staging --profile vault-staging
# 2. Production. The diff shows only new resources; VettidOrgVaultStack is unchanged.
npx cdk diff   VettidOrgVaultStack VettidOrgVaultHostStack --profile vault-prod
npx cdk deploy VettidOrgVaultHostStack --profile vault-prod
```

Then confirm the SNS subscription (`vettid-org[-staging]-vault-alerts`)
from the admin inbox. With no release and no pinned manifest key the
scaler finds nothing to do and the manifest sync logs "skipped"; neither
starts anything. Nothing in the member API changes.

### How the scaler works (`vettid-org-vault-scaler`, VAULT-RELEASES §8.6)

- Runs every minute and on each start request (the `vault-releases`
  stream, filtered to rows carrying `start_requested_at`); reserved
  concurrency 1, every run is a full idempotent reconcile.
- **Start:** a release row with a start request newer than 5 minutes and
  newer than its `start_issued_at`, no live instance (heartbeat ≤ 90 s) and
  desired 0 → `start_issued_at` is written, then desired 1. Only for a
  routable release (`active`, `deprecated`, `retired`, or `removed` **with
  `rescue: true`**; `available` not false) whose group exists and is
  tagged with the row's PCR0 and number.
- **Caps:** 2 per release (and the group's max), 6 in total (desired sums
  over all vault groups). A refused start counts `StartsBlocked`.
- **Stop:** a group above its minimum whose live instances all report
  `load` 0 and with no request, issued start or busy report (`busy_at`,
  refreshed every 5 min while an instance holds vaults) for 30 minutes →
  desired = minimum. The `vault-drain` lifecycle hook gives the parent
  5 minutes to lock its vaults. A `removed` release without rescue goes to
  its minimum at once.
- **Hands off:** groups whose PCR0 has no `vault-releases` row (a
  candidate or canary before the manifest lists it) are never started or
  stopped by the scaler: scale them by hand. A hand scale-up of a listed
  release gets 30 idle minutes from the first time the scaler sees it.
- Metrics (`VettID/Vault`, `Component=scaler`) and alarms: start
  unfulfilled after 10 minutes, start blocked, the newest active release
  with minimum 1 and no live instance for 10 minutes, scaler errors.

By hand:

```bash
P=--profile vault-prod
aws autoscaling describe-auto-scaling-groups $P --filters Name=tag:vettid:vault-scaler,Values=managed \
  --query 'AutoScalingGroups[].[AutoScalingGroupName,MinSize,DesiredCapacity,MaxSize,length(Instances)]' --output table
aws autoscaling set-desired-capacity $P --auto-scaling-group-name vettid-org-vault-r<N> --desired-capacity 1
aws logs tail /aws/lambda/vettid-org-vault-scaler $P --since 30m
```

### Manifest sync (`vettid-org-vault-manifest-sync`, VAULT-RELEASES §7)

Every 5 minutes: fetches the channel's served manifest, verifies it under
the keys pinned in `lib/config.ts` (`manifestKeys`: keys A and B in production,
the staging key in staging; while
nothing is served (404, or staging.vettid.org not up yet) it logs "no manifest
published yet" and does nothing), and upserts the `vault-releases`
rows (number, status, seal key, `ends_at`, `available` = the release's
`vault/releases/<N>/group-name` ref exists). It never writes start
requests, scaler markers or `rescue`, refuses a lower serial or the same
serial with other bytes, deletes rows of releases the manifest dropped,
and alarms if `manifests/<sha256>.json` is missing from the data bucket.
After publishing a manifest, run it at once:
`aws lambda invoke --function-name vettid-org-vault-manifest-sync --profile vault-prod /dev/stdout`.

### Adding a release (VAULT-RELEASES §10.1 steps 5–8)

1. From the vettid-vault GitHub release `release/<channel>/<N>` (published
   after the independent rebuild): `sha256sum measurements.json`, the
   commit (`source_commit`), PCR0, and at that commit
   `sha256sum deploy/host/SHA256SUMS`. The current AL2023 arm64 AMI:
   `aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --profile vault-prod --query Parameter.Value --output text`.
2. Add `host` to the release's entry in `vault/releases/<channel>.json`
   (`tag`, `source_commit`, `measurements_sha256`, `host_files_sha256`,
   `nitro_cli_version`, `base_ami`, `ami_revision: 0`, `min_instances: 0`
   for the canary, `max_instances: 2`), `npm test`.
3. The release key first (VaultStack, "Creating a release key" above).
4. `npx cdk diff VettidOrgVaultHostStack VettidOrgVaultRelease<N>Stack --profile vault-prod`:
   the host stack only gains N's PCR0 on the smoke key; the release stack
   is new. Deploy both (`npx cdk deploy VettidOrgVaultHostStack VettidOrgVaultRelease<N>Stack --profile vault-prod`).
   The image build takes about 20–40 minutes; a hash or PCR0 mismatch
   fails the build and the deploy (logs: `/aws/imagebuilder/vettid-org-vault-r<N>-<hash>`).
5. Canary: `aws autoscaling set-desired-capacity --auto-scaling-group-name vettid-org-vault-r<N> --desired-capacity 1`,
   then the self-test through SSM on that instance, per vettid-vault
   docs/SMOKE.md:
   ```bash
   systemctl stop vault-parent      # also stops the enclave (vault-enclave is PartOf the parent)
   systemctl start vault-enclave    # a fresh enclave, which dials the self-test parent
   /opt/vettid/bin/vault-parent -selftest -smoke-key-arn <vault/smoke-key-arn> -smoke-account <account> -bucket <data bucket> -region us-east-1
   systemctl stop vault-enclave
   sleep 60                         # SQS refuses to recreate the instance queue within 60 s of its deletion
   systemctl start vault-enclave vault-parent
   ```
   Expect `"result": "PASS"` with `key_policy_check: 6` (the deletable
   test key is refused, as designed). Without the 60-second wait the
   parent restarts in a loop (`QueueDeletedRecently`) until a minute has
   passed; it recovers by itself. (S1, 2026-10-05: PASS.)
6. After publication, the always-on minimum moves (O7): set
   `min_instances: 1` on N and `0` on N−1, deploy both release stacks.

### Capacity measurement (W9; VAULT-RELEASES §8.8, O6)

From S3 on, the release image's self-test can measure how many vaults one
host holds (vettid-vault docs/SMOKE.md, "Capacity measurement"). Run it on
a host of the release under test, the same way as the canary self-test,
through SSM with `executionTimeout` of at least 7200 s:

```bash
systemctl stop vault-parent      # also stops the enclave (PartOf)
systemctl start vault-enclave    # a fresh enclave for the self-test parent
/opt/vettid/bin/vault-parent -selftest -smoke-key-arn <vault/smoke-key-arn> -smoke-account <account> \
  -bucket <data bucket> -region us-east-1 -capacity 400 \
  >/root/capacity-report.json 2>/root/capacity.log
grep -E '^(PASS|FAIL|INFO|CAPACITY) ' /root/capacity.log
systemctl stop vault-enclave
sleep 60                         # SQS queue-name rule
systemctl start vault-enclave vault-parent
```

It spawns synthetic vault processes (test keys and data only, hardened like
real ones) until 400, the time budget (default 90 min) or a memory floor of
15% of enclave memory, then measures per-vault memory, unlock latency at
concurrency 1/2/4 and idle CPU, and tears everything down. For O6, read
`held` if it stopped at `memory_floor`, otherwise `projected_max_vaults`.
Record the result in VAULT-RELEASES §8.8.

### Publishing a manifest (VAULT-RELEASES §6.1, §7, §10.1 steps 9–10)

One-time setup on the owner's machine: `vaultctl` built at a vettid-vault
release tag (`go build -o ~/bin/vaultctl ./cmd/vaultctl`), and a profile
for the signer role (owner only, Identity Center session with MFA):

```ini
[profile vault-prod-manifest-signer]
role_arn = arn:aws:iam::369484479783:role/vettid-org-vault-manifest-signer
source_profile = vault-prod
region = us-east-1
# staging: [profile vault-staging-manifest-signer], account 347272280361
```

The script `scripts/vault/manifest.ts` (`npm run vault:manifest -- <cmd> --channel prod`)
renders with `vaultctl manifest render`, checks with `vaultctl manifest check`,
signs with key A (`alias/vettid-org-vault-manifest`) through `vaultctl manifest sign`,
and re-checks everything with this repository's own render and verifier:

1. Edit `vault/releases/prod.json` for the publication: N `active` with
   `published_at` and its `log` (summary, changes, security), N−1
   `deprecated`, any `retired`/`ends_at`/`removed` changes (§10.3).
2. `npm run vault:manifest -- sign --channel prod`: serial = max(served,
   `signed_serial`) + 1; `signed_serial` is raised in the file *before*
   signing; output `local/vault/prod/served-<serial>.json`. Commit the
   raised `signed_serial` even if this manifest is never published.
3. Canary (§10.1 step 9): `npm run vault:manifest -- upload --channel prod --in local/vault/prod/served-<s>.json`
   puts `manifests/<sha256>.json` in the data bucket (only the signer role
   may), so hosts can hand it to the enclave; nothing is served. Then add
   the canary row and flag the test member (below), load the document on
   the canary phone ("Canary manifest on the test phone", below), enroll
   and test.
4. Publish: `npm run vault:manifest -- publish --channel prod --in local/vault/prod/served-<s>.json`
   checks again, uploads (idempotent) and confirms the bucket copy, then
   writes `website/.well-known/vettid/pcr-manifest.json`, regenerates the
   release log (`website/security/releases/`) and commits those paths.
   Push, merge (CI runs `check:manifest`), `npm run deploy:site`, and run
   the manifest sync (above) so routing follows at once.

If the canary fails, never publish that document: edit the file (N
`removed`, no `host`), sign the next serial when there is something to
publish, and delete the canary row. `check:manifest` refuses a served
manifest that is not exactly a render of the file, a lower or repeated
serial, a dropped or backwards-moving release, and a serial above
`signed_serial`.

Key B (offline token, only if key A is lost): `vaultctl manifest digest`,
sign the digest on the offline machine, `vaultctl manifest import-sig`
(vettid-vault docs/RELEASING.md), then `publish --in` the result as above.
Key B is pinned (`lib/config.ts`, key_id 1abd49da96970b6e).

### Canary routing (W8)

The canary row and the test member's flag (the member API routes a
`canary` release only for flagged members; MEMBER-API "Canary releases").

**Flag the test member from the admin site** (admin exit node on):
Members → find the member → **Vault canary** switch → confirm. Only
members in state `member` can be flagged. Flagged members are listed under
**Vault canary testers** on the same page, where the flag is also cleared.
Both are audited (`member.vault_canary.set` / `.clear`; ADMIN-API "Vault
canary").

**The release row** has no admin-site control; add it in the vault account:

```bash
# the release under test (no manifest_serial: the sync leaves it alone)
aws dynamodb put-item --profile vault-prod --table-name vettid-org-vault-releases \
  --item '{"release":{"S":"<pcr0>"},"release_number":{"N":"<N>"},"status":{"S":"canary"},"available":{"BOOL":true}}' \
  --condition-expression 'attribute_not_exists(#r)' --expression-attribute-names '{"#r":"release"}'
```

Fallback if the admin site or API is unavailable (main account; this
bypasses the audit log, so note who and why in the canary report):

```bash
aws dynamodb update-item --profile admin --table-name vettid-org-members \
  --key '{"user_guid":{"S":"<guid>"}}' --condition-expression 'attribute_exists(user_guid)' \
  --update-expression 'SET vault_canary = :t' --expression-attribute-values '{":t":{"BOOL":true}}'
# clear: --update-expression 'REMOVE vault_canary' (no values)
```

The scaler manages a `canary` row like any release (start on request, stop
when idle). On publication the manifest sync turns the row into an
`active` one; after a failed canary delete it (`aws dynamodb delete-item
... --key '{"release":{"S":"<pcr0>"}}'`). Clear `vault_canary` from
members who are done testing, but only once their vault is off the canary
release (published, or moved to an active one): a cleared member's vault
sealed to an unpublished canary release is unreachable (410).

Never edit a deployed entry's pins expecting the running hosts to change:
the template change makes a new AMI and launch template version, but
running instances are only replaced by an explicit refresh:

**Host OS patch** (C4: same EIF and parent): set a new `baseAmi` (or bump
`amiRevision`) on that one entry, deploy its stack, then
`aws autoscaling start-instance-refresh --auto-scaling-group-name vettid-org-vault-r<N> --preferences MinHealthyPercentage=100,InstanceWarmup=300 --profile vault-prod`
(instances drain through the lifecycle hook). Old AMIs are not
deregistered by Image Builder; delete them and their snapshots by hand.

### Canary manifest on the test phone (B5; VAULT-RELEASES §10.1)

The canary phone cannot read an unpublished manifest from the site, so
the tester loads the signed document into the app by hand. The app
(vettid-android #63, release builds included) verifies it under the keys
it pins and uses it only while it is newer than the published one
(VAULT-MESSAGING §11.10.1). The canary phone runs the release build
signed with the upload key (W10-READINESS B8). For staging, use the
staging build and `local/vault/staging/served-<s>.json`.

The document must stay private until it is published (VAULT-MESSAGING
§13.9): anyone holding it could move their own vault into the
unpublished release. Do not put it on a public URL, in a bucket other
than the signer's `manifests/` copy, or in an email, chat or cloud drive.

1. Copy it to the phone over USB:

   ```bash
   adb devices -l                                   # pick the canary phone's serial
   adb -s <serial> push local/vault/prod/served-<s>.json /sdcard/Download/
   ```

   (Another private channel is fine, such as a direct cable transfer.)
2. On the phone, open **Files** → Downloads, select `served-<s>.json`,
   **Share** → **VettID**. The app takes a shared file. "Open with" from
   a file manager is not supported. If VettID is not offered, the file
   manager is not labelling the file `application/json`: keep the `.json`
   name, or use the Files app.
3. The app shows **Use a test release manifest?** with the serial, the
   signing key and the releases it lists. Check them against the `sign`
   output: serial `<s>`, key `4353463f85c4012f` (key A; key B is
   `1abd49da96970b6e`; staging `e9b3a403423120ac`), and release N
   `active` along with the earlier releases. Tap **Use it** only if they
   match. If the file is refused instead, the app says why: not signed by
   a pinned key (wrong build, e.g. a staging build with a production
   document), older than what the phone has used, already published, or
   not a manifest.
4. Delete the copy from the phone: `adb -s <serial> shell rm /sdcard/Download/served-<s>.json`
   (the app keeps its own encrypted copy). Settings → Attestation now
   shows **Test release manifest** with the serial.
5. Run the canary (VAULT-RELEASES §10.1 step 9; W10-READINESS §3 step 11
   for release 1).
6. Then either:
   - **Publish** (step 10, "Publishing a manifest" 4). Nothing is needed
     on the phone: the published serial equals the canary's, so the app
     uses the published document and drops its canary copy at the next
     unlock or enrollment. Settings → Attestation no longer shows it.
   - **Canary failed**: on the phone, Settings → Attestation → **Stop
     using the test manifest** → confirm. Then follow "If the canary
     fails" ("Publishing a manifest" above, VAULT-RELEASES §10.1, and for
     release 1 the rollback of W10-READINESS §3 step 11: delete the
     canary vaults from the app before clearing the flag). The phone has
     used serial `<s>`, so it refuses the published `<s>−1`: any vault on
     an older release that it unlocked during the canary opens again
     only once `<s>+1` is published (N `removed`).

The wipe after the phone is replaced also removes the document.

### Pausing the vault service (kill switch)

The off switch for the member API's vault routes (MEMBER-API "Vault
service pause"). Use it when vault activity must stop now and nothing
else should change: a suspected bad release before the next manifest, an
incident in the vault account, a host or queue problem. It touches no
vault, key, manifest, release row or stored state, and is undone by
resuming. While paused, enroll, unlock (and release-update approvals),
the enclave route, recovery requests and recovery register, and (since
MEMBER-API 2.0.0) setup-code issue, redeem and recovery claim answer `503
vault_unavailable`; status, lock, request polling, the recovery status
and recovery cancels, and reading or revoking a setup code keep working. Vaults already unlocked keep running
until they lock; nothing new is started. The account site's Vault tab
says the service is paused for maintenance.

Taking a release out of service for good is still the manifest's job
(VAULT-RELEASES §12.3: a serial with the release `removed`); the pause is
for "stop, look, resume".

**From the admin site** (production; admin exit node on): **Vault
service** → **Pause the vault service** → enter the reason (operators
only; members never see it) → confirm. **Resume the vault service** turns
it back on. Both are audited (`vault.service.pause` / `.resume`; ADMIN-API
"Vault service"). The member API follows within about 30 s.

**Fallback, and staging** (staging has no admin site). In the member
API's account: prod the default (management) profile, staging
`--profile vault-staging`. This bypasses the audit log, so note who and
why in the incident notes; the change email still goes out.

```bash
P="--profile vault-staging"; STAGE=staging   # prod: P=""; STAGE=prod
NAME=/vettid-org/$STAGE/switch/vault-service
# pause
aws ssm put-parameter $P --name $NAME --type String --overwrite \
  --value "{\"enabled\":false,\"reason\":\"<why>\",\"set_by\":\"$(whoami) (cli)\",\"set_at\":\"$(date -u +%FT%TZ)\"}"
# state
aws ssm get-parameter $P --name $NAME --query Parameter.Value --output text
# resume (or delete-parameter: no parameter means on)
aws ssm put-parameter $P --name $NAME --type String --overwrite \
  --value "{\"enabled\":true,\"reason\":null,\"set_by\":\"$(whoami) (cli)\",\"set_at\":\"$(date -u +%FT%TZ)\"}"
# history (every version, with the IAM identity that wrote it)
aws ssm get-parameter-history $P --name $NAME --query 'Parameters[].[Version,LastModifiedDate,LastModifiedUser,Value]' --output text
```

Only a value that is JSON with `"enabled": true` (or no parameter) means
on; anything else written there pauses the service. No deploy creates or
changes the parameter.

**Checks after pausing:** an enroll or unlock from a test phone gets the
"not available" message; `GET /api/vault/status` on the account site
shows the paused notice; the member API's vault function log
(`VettidOrgMemberApiStack`, function `Vault`) shows no `vault service
switch unreadable`.

**Alerts.** Every write to the parameter (admin site or CLI, either
stage) emails the security alerts ("vault service switch changed").
Production also has alarms on the metric `VettID/MemberApi
VaultServicePaused` (written every 5 minutes by the member API's
`VaultServiceWatch` job): `vettid-org-vault-service-paused`
(alarm within about 10 minutes of pausing, OK when resumed) and
`vettid-org-vault-service-paused-24h` (still paused after a day), so a
pause is not forgotten. Both read a missing sample as "not paused", so a
third, `vettid-org-vault-service-watch-silent`, alarms when no sample has
been written for 20 minutes (the watch is failing or not running: an
unreadable switch, a timeout, throttling, a disabled schedule), and says
when it writes again. While it is in alarm the other two are blind: check
the switch by hand (`get-parameter` above) and read the `VaultServiceWatch`
function's log. Staging has the alarms without a recipient.

**Running vaults.** The pause does not lock them. There is no "lock every
vault" action (a follow-up if wanted). If one is needed during an
incident, scale the release's group in (`aws autoscaling
update-auto-scaling-group --auto-scaling-group-name vettid-org-vault-r<N>
--min-size 0 --desired-capacity 0 --profile vault-prod`): the drain hook
gives the parent 5 minutes to lock each vault before its host stops. The
next deploy of that release stack restores its minimum. Start requests
made in the 5 minutes before the pause can still start one host; it
stops after 30 idle minutes.

**After resuming,** the cleanup job's next daily run (07:00 UTC) queues
the account deletions it held back, and members' apps retry on their own.

### Removing a release and rescue

At D (§10.3 step 2): `npx cdk destroy VettidOrgVaultRelease<N>Stack --profile vault-prod`
(instances drain; the `group-name` ref goes, so the next manifest sync sets
`available` false), then remove the entry's `host` in
`vault/releases/<channel>.json` (the entry itself stays while the manifest
lists the release).
Rescue (step 3): cancel and enable the key as the retirement role,
re-add the entry and deploy the release stack, then

```bash
aws dynamodb update-item --profile vault-prod --table-name vettid-org-vault-releases \
  --key '{"release":{"S":"<pcr0>"}}' --update-expression 'SET rescue = :t' --expression-attribute-values '{":t":{"BOOL":true}}'
```

The member API routes the vaults of that release again and the scaler
starts it on demand. `rescue` is release-wide (every vault sealed to it is
routed while it is set). Remove it (`REMOVE rescue`) when the member has
moved; the scaler then stops the group at once.

### Network and egress

Hosts: public subnets in two AZs of the host VPC, no NAT, no inbound,
outbound TCP 443 only, SSM Session Manager only. Route 53 Resolver DNS
Firewall answers only the names in `lib/vault/egress.ts` (NXDOMAIN for the
rest; query logs in `/vettid-org/<stage>/vault-dns`, metric
`DnsQueriesBlocked`); S3 and DynamoDB gateway endpoints admit only this
account's resources. AMIs are built in a separate build VPC without the
firewall (the builder needs GitHub and the package repositories).

### The Android app link (account site)

The account site's Vault tab links to the Android app from
`/config.json`, which the account site stack writes at deploy from CDK
context: `androidAppUrl` (production, the Google Play listing) and
`stagingAndroidAppUrl` (staging, the test build's page). Both are unset
until the link exists, and the page then says the app is not available
yet. To set one, add it to cdk.json `"context"` (https only; the synth
fails otherwise), commit it (PR) and deploy `VettidOrgAccountSiteStack`
for that stage.

### Setup codes and app keys (MEMBER-API 2.0.0)

Apps never sign in: the portal issues a 5-minute setup code
(`POST /api/vault/enroll-code`) and the app redeems it with its app key,
which then signs every app request (`X-VettID-App`; ENROLLMENT-CODES.md).

**`k_code`, once per stage, before the first deploy of 2.0.0.** The HMAC
key of the setup codes is an SSM SecureString in the stage's main account
(production: the management account; staging: the staging account). No
deploy creates or changes it; without it, issuing and redeeming answer
500 (nothing is issued or checked without it).

```bash
aws ssm put-parameter --profile <main profile> --type SecureString \
  --name /vettid-org/<stage>/member/enroll-code-key \
  --value "$(openssl rand -base64 32)"
```

Only the member API's vault routes may read it (`ssm:GetParameter`, the
AWS-managed `aws/ssm` key). Rotating it (`--overwrite`) invalidates the
codes issued in the last 5 minutes and nothing else; the containers pick
it up within 5 minutes. Never print it, paste it or put it in a ticket.

**`MemberEnrollTypedCeiling`** (alarm `vettid-org-member-enroll-typed-ceiling`;
production: security-alerts email): a member's setup code got 800 wrong
typed attempts, so its typed entry is blocked. The member was emailed to
scan the QR instead or get a new code; the QR and every other member are
unaffected, and the code expires within 5 minutes anyway. Look at the
audit log (`vault.enroll_code_typed_blocked`, `vault.enroll_code_failed`
per network and hour) and the WAF logs for the source; nothing needs
undoing.

**A vault enrolled with a stolen code** (the member says "that wasn't me"
after the redemption email): support deletes it with the host `delete` op
(ENROLLMENT-CODES §10 decision 11). Since MEMBER-API 2.1.0 the member can
also do it themselves: "Delete my vault and start over" (below).

**The staging switch-over.** `stagingVaultLegacySessionAuth: true` in
cdk.json context makes the staging member API still accept portal-style
sessions on `enclave`, `enroll`, `unlock` and recovery `register`, for apps
built before 2.0.0, until the staging cut-over (ENROLLMENT-CODES §8 step
5); then remove it and redeploy `VettidOrgMemberApiStack`. The synth
refuses it for production.

**The account snapshot.** `vettid-org-member-account-push` sends a
member's running vault their new account snapshot after terms, subscription
or cancellation changes (the account routes and the admin site's
reinstate and subscription extend invoke it), and (MEMBER-API 2.2.0) after
a name change from the vault was processed. It sends only to a live
leaseholder and never starts anything; a failure is logged and the next
unlock carries a fresh snapshot. Since 2.2.0 every snapshot carries the
member's `first_name`, `last_name` and `name_change`, and every `enroll`
carries one: a member whose names a vault would refuse (empty, over 160
bytes, control characters) cannot enroll (`503 vault_unavailable`) and gets
no snapshot in an unlock; fix the member row.

**Name changes (MEMBER-API 2.2.0).** Members change their names only in
the app. The enclave host writes `name_change` and `name_change_pending` on
the vault row; the `VaultNamesJob` Lambda (role
`vettid-org-member-vault-names`, fed by the vaults stream, filtered on
`name_change_pending = true`) applies or refuses it (`account`,
`invalid`, `too_soon`: one applied change per 30 days, from the member
row's `name_changed_at`), audits `member.name_change` or
`member.name_change_refused`, emails the member after an applied change,
writes `name_change_result` and invokes the account push. A failed run
puts `name_change_pending` back, so the stream retries; a request stuck
with `name_change_pending = true` (the stream's retries exhausted) is
retried by removing the flag and setting it again, in two updates (an
update that changes nothing makes no stream record). Like the alarm mailer, it has no event source until
the vaults stream ARN is in context. No admin route edits names; if one
is ever added, it must push the snapshot as the job does.

### No recovery with the backup off; start over (MEMBER-API 2.1.0)

VAULT-MESSAGING 0.16.0, owner decisions of 2026-10-06: a vault whose
credential backup is off cannot be recovered; the member's only path is to
delete it and set up a new one.

**The backup bit.** The enclave host writes `credential_backup` (bool) on
the vault row from the vault's lifecycle reports (`enrolled`, `unlocked`,
`locked`, the event `credential_backup`). Only the host role may write it
(`VettidOrgVaultStack` grant); it is absent until a 0.16.0 release has
reported it, and then the API forwards a recovery request and the enclave
decides. With `false`, `POST /api/vault/recovery` answers `409
recovery_unavailable` (`reason: no_backup`) before anything is written,
queued, locked or mailed. A request the enclave refuses comes back on its
slot with the host code `recovery_unavailable`; the API then marks the
recovery `unavailable` (audit `vault.recovery_unavailable`). Support has
nothing to undo in either case: the vault was not locked.

**Start over** (`/account/vault/deletion/`; routes `/api/vault/deletion`,
`/cancel`, `/cancel-link`). The member types "delete my vault"; the API
records `deletion {deletion_id, state: pending, requested_at, deletes_at}`
on the vault row and emails a cancel link
(`/vault/deletion/cancel#t=…`, stored as its SHA-256 in the request table
until `deletes_at`). Nothing is queued and the vault is not locked during
the 24 hours. The cleanup job runs every 5 minutes with `{task:
"start_over"}` (rule `StartOverSchedule`): a pending deletion past
`deletes_at` becomes `executing` and gets the host `delete`, exactly as an
account cancellation (`deletion_requested_at`, the daily retries, the
30-day log); `deletion.queued_at` records when it could be queued, and a
deletion not yet queued (no instance running, the service paused) is tried
again at each 5-minute run. The vault's `deleted` report brings the usual
vault_deleted email and removes the rows; the member then gets a new setup
code. Audit: `vault.deletion_request`, `vault.deletion_cancel` (`via:
session | link | app`), `vault.deletion_executed`.

- *Member says "I didn't ask for this"* within the 24 hours: they cancel
  from the email link, the account page or the app. After `executing` it
  cannot be cancelled; the vault is gone once the host deletes it (stored
  versions stay 7 days, sealed, and are not restorable by support).
- *Stuck in `executing`*: as for an account deletion: look at
  `deletion_requested_at`, the release's routability and the host logs;
  the daily retry keeps trying and logs `vault deletion pending` after 30
  days.

**Deploy order for 2.1.0.** `VettidOrgVaultStack` (vault account: the
host's `credential_backup` grant and the API roles' `deletion` attribute in
the table's resource policy) before `VettidOrgMemberApiStack` (routes, the
5-minute rule, the API roles' identity policies), then the account site
(`VettidOrgAccountSiteStack`). No new SSM parameter. The host's 0.16.0
release then reports the bit; until it does, `credential_backup` reads
`null` and nothing is refused upfront.

### Still to come

Production release 1: status, blockers and the release-day steps are in
docs/W10-READINESS.md until it is published.

Instance and lease health in practice, incident classes and first
responses, capacity per host, and the disaster-recovery objectives
(VAULT-RELEASES §11.4). Publishing a release is "Publishing a manifest"
above (W7).

## Staging (W9; VAULT-RELEASES §11.1)

`-c stage=staging --profile vault-staging` builds a copy of what the
vault's end-to-end tests need, entirely in vettid-vault-staging
(347272280361), under its own zone **staging.vettid.org**:

| Stack | What |
|---|---|
| `VettidOrgStageDnsStack` | zone staging.vettid.org (delegated from vettid.org), CAA, SES domain identity (DKIM) for `no-reply@staging.vettid.org` |
| `VettidOrgAuthStack`, `VettidOrgDataStack` | the member pool (and an unused admin pool), PIN pepper, the `vettid-org-staging-*` tables (plus an empty `mailing-list` table that the cleanup job reads), terms bucket |
| `VettidOrgVaultStack`, `VettidOrgVaultHostStack` | as in "Vault" (deployed since W5/W6) |
| `VettidOrgMemberApiStack` | member API with the vault routes, notice job, alarm mailer (stream: context `stagingVaultsStreamArn` in cdk.json), cleanup |
| `VettidOrgAccountSiteStack` | https://account.staging.vettid.org (same site, WAF and API path as prod) |
| `VettidOrgStageSiteStack` | https://staging.vettid.org: a notice page and the staging manifest at `/.well-known/vettid/pcr-manifest.json` |
| `VettidOrgStageTestMailStack` | test infrastructure: a mailbox for automated tests at `*@test.staging.vettid.org` ("Test mail" below) |

Not in staging, on purpose: the public site, signup, playbooks and the
vettid.dev redirect (prod content); the admin exit node, admin API and
admin site (test data comes from `npm run staging:seed`, the canary flag
from the CLI fallback in "Canary routing" with `--profile vault-staging`
and table `vettid-org-staging-members`); the relay (staging images pin
relay.vettid.org; a staging relay is deployed only when relay changes need
testing); push; the audit stack (the organization trail and GuardDuty,
administered from the management account, already cover the account;
`VettidOrgVaultAlertForwardStack` sends the account's events to the
management account's alert rules — "Security alerts").
Staging has no release log (the log is production's); its notice emails
link to the production log.

All system mail comes from `no-reply@staging.vettid.org`. **SES in the
staging account stays in the sandbox**: every recipient must be a
verified identity there. Members' addresses verify themselves through the
membership request (the SES verification email is the opt-in, as in
prod); for the drill that is the owner's address. Request notifications
go to admin@vettid.org, which only arrive if that address is verified in
the staging account too (optional). Never request production access for
staging.

### First stand-up, in order

```bash
aws sso login                       # covers default and vault-staging
C="-c stage=staging --profile vault-staging"
# 1. The zone and the SES identity (nothing resolves yet).
npx cdk diff   VettidOrgStageDnsStack $C --exclusively
npx cdk deploy VettidOrgStageDnsStack $C --exclusively
#    Output NameServers: four ns-*.awsdns-* names.
# 2. Delegation (management account). Put them into cdk.json "context":
#      "stagingZoneNs": "ns-a.awsdns-xx.org,ns-b.awsdns-xx.co.uk,ns-c.awsdns-xx.com,ns-d.awsdns-xx.net"
#    commit it (PR), then:
npx cdk diff   VettidOrgStagingDelegationStack --exclusively   # one NS record, staging.vettid.org
npx cdk deploy VettidOrgStagingDelegationStack --exclusively
dig +short NS staging.vettid.org
# 3. Wait until SES has verified the domain (DKIM through the delegation):
aws sesv2 get-email-identity --email-identity staging.vettid.org --profile vault-staging \
  --query '{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}'
# 4. Pool and tables (Cognito's SES sender needs the verified identity).
npx cdk deploy VettidOrgAuthStack VettidOrgDataStack $C --exclusively
# 5. The vault stacks are already there; the diff must be empty.
npx cdk diff   VettidOrgVaultStack VettidOrgVaultHostStack $C --exclusively
# 6. Member API, then the sites (their certificates validate in the zone).
npx cdk deploy VettidOrgMemberApiStack $C --exclusively
npx cdk deploy VettidOrgAccountSiteStack VettidOrgStageSiteStack $C --exclusively
# 7. Test data (no admin site in staging): terms, then a registration code.
npm run staging:seed -- terms --file local/staging-terms.txt
npm run staging:seed -- invite
npm run staging:seed -- subscription-types    # production's plans (reads prod read-only)
```

Then request membership at https://account.staging.vettid.org/request/
with the code, confirm the SES verification email, sign in, accept the
terms. After that, `npx cdk deploy --all $C` deploys the whole staging
set in dependency order.

### Publishing a staging manifest

As in "Publishing a manifest" with `--channel staging` and the
`vault-staging-manifest-signer` profile; the served file is
`vault/staging/pcr-manifest.json`. After the merge:
`npx cdk deploy VettidOrgStageSiteStack -c stage=staging --profile vault-staging`
(byte for byte at https://staging.vettid.org/.well-known/vettid/pcr-manifest.json),
then run `vettid-org-staging-vault-manifest-sync` with `--profile vault-staging`.

### Test mail

**Test infrastructure, staging only** (never built for prod): automated
tests receive VettID's mail without a human: sign-in links, SES
verification links, notices.

- **Addresses**: anything `@test.staging.vettid.org`. Use a fresh random
  address per test run (`new-address`). MX → SES inbound (us-east-1).
- **Sending to them in the SES sandbox** needs no per-address verification:
  the staging account's verified domain identity `staging.vettid.org`
  covers its subdomains (SES identity inheritance), so SES may send to
  `test.staging.vettid.org` addresses as to any verified domain. The app's
  own opt-in still happens: a membership request with a test address
  makes SES send its verification email to it, which the test follows
  with `link --match 'email-verification\.'`.
- **Storage**: receipt rule set `vettid-org-staging-test-mail` (the
  account's ACTIVE rule set: SES allows one per account and region; a
  custom resource activates it and refuses if another set is active), one
  rule: every recipient at the domain, TLS required, spam/virus scan, raw
  message to `s3://vettid-org-staging-test-mail-347272280361/inbound/`,
  stop. Objects expire after **7 days**; the bucket is destroyed with the
  stack (test data only).
- **Reading**: role `vettid-org-staging-test-mail-reader` (owner's
  Identity Center permission set only; `s3:ListBucket` on `inbound/`,
  `s3:GetObject` on `inbound/*`, nothing else; SSM
  `test-mail/reader-role-arn`, `test-mail/bucket-name`). Add a profile to
  `~/.aws/config`:

  ```ini
  [profile vault-staging-test-mail]
  role_arn = arn:aws:iam::347272280361:role/vettid-org-staging-test-mail-reader
  source_profile = vault-staging
  region = us-east-1
  ```

- **CLI** (`scripts/staging/mail.ts`; refuses any account but
  347272280361; prints only the mail's fields; exit 0 found, 2 timed out,
  1 error):

  ```bash
  npm run -s staging:mail -- new-address [--prefix tester]
  #   tester-<random>@test.staging.vettid.org (no AWS call)
  npm run -s staging:mail -- wait --to ADDRESS [--since ISO] [--timeout 120] [--subject REGEX]
  #   JSON {from, to, subject, date, links, text}; --since defaults to 60 s ago
  npm run -s staging:mail -- link --to ADDRESS [--match REGEX] [--since ISO] [--timeout 120]
  #   the first matching link of the newest matching message, e.g.
  #   --match '/auth/#t='                     (account site sign-in link)
  #   --match 'email-verification\.'          (SES verification link)
  ```

  `--profile` overrides the default `vault-staging-test-mail`. Take
  `--since` from just before the action that sends the mail, so an older
  message to the same address is not picked up.

Deploy (staging account only; after VettidOrgStageDnsStack):

```bash
aws sso login
# At most one active receipt rule set per account+region: expect none (or ours).
aws ses describe-active-receipt-rule-set --profile vault-staging --region us-east-1
npx cdk diff   VettidOrgStageTestMailStack -c stage=staging --profile vault-staging --exclusively
npx cdk deploy VettidOrgStageTestMailStack -c stage=staging --profile vault-staging --exclusively
dig +short MX test.staging.vettid.org          # 10 inbound-smtp.us-east-1.amazonaws.com.
```

Confirm end to end (add the profile above first):

```bash
TO=$(npm run -s staging:mail -- new-address)
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
aws sesv2 send-email --profile vault-staging --region us-east-1 \
  --from-email-address no-reply@staging.vettid.org \
  --destination "ToAddresses=$TO" \
  --content '{"Simple":{"Subject":{"Data":"test mail check"},"Body":{"Text":{"Data":"https://staging.vettid.org/?check=1"}}}}'
npm run -s staging:mail -- wait --to "$TO" --since "$SINCE" --timeout 120
npm run -s staging:mail -- link --to "$TO" --since "$SINCE" --match 'check=1'
```

If the send is rejected with "Email address is not verified", the
sandbox does not treat the subdomain as verified for recipients: add an
SES domain identity for `test.staging.vettid.org` (Easy DKIM, records in
the staging zone) to this stack.

To remove it: `npx cdk destroy VettidOrgStageTestMailStack -c stage=staging
--profile vault-staging --exclusively` (deactivates the rule set, deletes
it, empties and deletes the bucket; the MX goes with it).

### Parking

Between releases the release groups scale to zero (scaler) and nothing
else needs to go: at idle the main stacks cost about $10/month (account
site WAF ~$8, zone $0.50, two secrets ~$0.80, pennies of Lambda,
DynamoDB, CloudFront). Everything stateful is retained and
deletion-protected as in prod; tearing staging down means turning
termination protection off in code first, and the zone (RETAIN) keeps its
name servers unless it is deleted by hand, after which
`stagingZoneNs` and the delegation must be updated.

## Security alerts (every account in the organization)

One place for the rules and the email: **VettidOrgAuditStack** in the
management account (449757308783). Alerts go to SNS topic
`vettid-org-security-alerts` → email to admin@vettid.org (the
subscription is confirmed once, from the inbox). Each email names the
`account`:

| Account | Id |
|---|---|
| VettID (management) | 449757308783 |
| vettid-vault-prod | 369484479783 |
| vettid-vault-staging | 347272280361 |
| proteus | 605628228301 |

How events get there:

- **Member accounts → management bus.** CloudTrail puts an account's events
  on that account's own default event bus only (the organization trail
  stores them centrally but does not put them on the management bus). Each
  member account therefore runs one forwarding rule,
  `vettid-org-security-alert-forward` (role
  `vettid-org-security-alert-forwarder`), that sends every CloudTrail
  write call (read-only calls excluded; refused calls included) and every
  console sign-in to the management account's default bus. Stacks:
  `VettidOrgVaultAlertForwardStack` (vault-prod; in staging, vault-staging)
  and `VettidOrgProteusAlertForwardStack` (proteus; an organization-level
  control, so it lives here, not in the proteus-web-site repository).
- **The management bus policy** (statement
  `vettid-org-member-security-events`, in VettidOrgAuditStack) admits
  `events:PutEvents` only from those three forwarder roles, only from
  inside organization o-kualrldevn.
- **Heartbeat.** Each member account also sends an hourly scheduled event
  (rule `vettid-org-security-alert-heartbeat`) through the same role and
  bus policy. VettidOrgAuditStack counts them per account (rules
  `Heartbeat<Account>`, into a throwaway queue) and the alarm
  `vettid-org-security-alert-heartbeat-<account>` (vaultProd,
  vaultStaging, proteus) emails the same topic when none arrived for 3
  hours (and again when they resume). A heartbeat rather than the member
  rule's `FailedInvocations`: that metric lives in the member account (a
  notification from there needs its own topic per account) and it says
  nothing when the rule is disabled or deleted; and not "no events for
  24 h", since proteus has days without a single write call.
- **Protected by an SCP.** `lib/org/scp-alert-forwarder.json` (policy
  `vettid-alert-forwarder-protection`, on the Workloads OU
  ou-kuf0-q8c9trwg, so every member account) denies changing, disabling or
  deleting the forward and heartbeat rules, and changing, deleting or
  passing the forwarder role, to everyone but CloudFormation's CDK
  execution role (`cdk-*-cfn-exec-role-*`). Attempts are still logged and
  alerted (`AuditTampering`, `IamRoleOrPolicyChanges`, with an error).
  Applied by `scripts/org/apply-alert-forwarder-scp.sh` (dry run by
  default; `--apply`), from the management account. Break-glass: detach
  or edit it there.
- **GuardDuty findings** of all accounts arrive in the management account
  directly: it is the GuardDuty administrator (members auto-enabled).
- us-east-1 only: global events (IAM, STS, sign-in, Organizations,
  Identity Center) land there, and the Workloads SCP denies every other
  region in the member accounts. (Calls attempted in other regions are
  still in the organization trail, just not alerted.)

The rules (all in VettidOrgAuditStack; "outside a deploy" = not by
CloudFormation's CDK execution role `cdk-*-cfn-exec-role-*`, the same
pattern the SCPs exempt):

| Rule | Fires on |
|---|---|
| `RootActivity` | any use of the root user, any account (also refused attempts; members deny root by SCP) |
| `ConsoleSignInRisk` | a failed console sign-in; a root or IAM-user sign-in without MFA (Identity Center sign-ins always record `MFAUsed: No` — MFA happens at the portal — so they are not checked) |
| `NonStandardConsoleSignIn` | a console sign-in or switch-role by anything other than the `VettIDAdmin` permission set (another permission set, `OrganizationAccountAccessRole`, an IAM user) |
| `VaultProdConsoleSignIn` | every successful console sign-in to vettid-vault-prod |
| `IamCredentialChanges` | IAM users, access keys, login profiles, user policies, MFA devices, password policy (outside a deploy) |
| `IamRoleOrPolicyChanges` | role create/delete, trust policy, role/group policies, permission boundaries, policy versions, SAML/OIDC providers (outside a deploy) |
| `AuditTampering` | CloudTrail stop/delete/update; GuardDuty detector, membership, filters and IP sets; Access Analyzer delete/archive rules; EventBridge `DeleteRule`/`DisableRule`/`RemoveTargets`/`PutPermission`/`RemovePermission` (the forwarders and these rules) — outside a deploy, refused attempts included |
| `OrgOrSsoChanges` | Organizations (leave, remove/move/create account, SCP create/update/delete/attach/detach, service access, delegated admins) and Identity Center (permission sets, account assignments, users, group memberships) |
| `CentralRootSession` | `sts:AssumeRoot` (a root session into a member account) |
| `KmsKeyDeletion` | `ScheduleKeyDeletion`, `CancelKeyDeletion`, `DisableKey`, `DeleteImportedKeyMaterial` — always, deploys included (management and proteus) |
| `KmsKeyPolicy` | `PutKeyPolicy` outside a deploy (management and proteus) |
| `S3PublicAccess` | bucket policy, ACL, ownership controls, bucket- or account-level public access block (outside a deploy) |
| `SecurityGroupOpenToWorld` | ingress from `0.0.0.0/0` or `::/0` (outside a deploy) |
| `GuardDutyFindings` | GuardDuty findings of severity ≥ 4 (medium) in any account |
| alarm `vettid-org-security-alert-heartbeat-<account>` | no forwarding heartbeat from that member for 3 hours (OK email when it resumes) |

KMS in the two vault accounts is covered by the vault's own rules
(VettidOrgVaultHostStack: key lifecycle and policy, lockout-bypass key
creation, the pinned roles; topic `vettid-org[-staging]-vault-alerts`,
also emailed to admin@vettid.org), so the central KMS rules skip those
accounts rather than send every key event twice. A release key's
scheduled deletion by the retirement role is expected and is still
reported there.

### Deploying

Management first (the bus policy must exist before the forwarders send),
then the forwarders within three hours (until a member's heartbeats
arrive, its heartbeat alarm is in ALARM and emails once), then the SCP:

```bash
npx cdk diff   VettidOrgAuditStack --exclusively
npx cdk deploy VettidOrgAuditStack --exclusively
npx cdk deploy VettidOrgVaultAlertForwardStack --exclusively -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgVaultAlertForwardStack --exclusively --profile vault-prod
npx cdk deploy VettidOrgProteusAlertForwardStack --exclusively --profile proteus
# The SCP, from the management account (owner's admin session):
scripts/org/apply-alert-forwarder-scp.sh            # dry run
scripts/org/apply-alert-forwarder-scp.sh --apply
```

Later changes to the forwarder stacks deploy as usual: CloudFormation
runs as the CDK execution role, which the SCP exempts.

A new member account: add it to `ORG.members` (lib/config.ts), add its
forwarder stack in `lib/app.ts`, deploy VettidOrgAuditStack (bus policy),
then the forwarder with that account's profile.

### Testing an alert

A harmless IAM change in staging, undone at once (a tagged role with no
permissions, trusted only by the account itself):

```bash
P="--profile vault-staging"
aws iam create-role $P --role-name vettid-org-alert-test \
  --tags Key=purpose,Value=alert-test \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::347272280361:root"},"Action":"sts:AssumeRole"}]}'
aws iam delete-role $P --role-name vettid-org-alert-test
```

Within a few minutes admin@vettid.org gets two "IAM role, trust policy,
permission policy or identity provider changed" emails (`CreateRole`,
`DeleteRole`) with `account: 347272280361`. If nothing arrives:

1. The forwarder: `aws cloudwatch get-metric-statistics $P --namespace
   AWS/Events --metric-name FailedInvocations --dimensions
   Name=RuleName,Value=vettid-org-security-alert-forward --start-time
   <15 min ago> --end-time <now> --period 300 --statistics Sum` (failures
   mean the bus policy or the role is wrong); `Invocations` should be > 0.
2. The management rule: same metrics without `$P`, namespace `AWS/Events`,
   `RuleName` = the `IamRoleOrPolicyChanges…` rule's physical name
   (`aws events list-rules --name-prefix VettidOrgAuditStack-IamRole`).
3. The SNS subscription: `aws sns list-subscriptions-by-topic --topic-arn
   <AlertTopicArn output>` must not say `PendingConfirmation`.

In the management account itself, the same test without `$P` (and the
management account id in the trust document) exercises the rules
directly.

The SCP, once applied (expect `AccessDenied`, and an `AuditTampering`
email showing `error: AccessDenied`; nothing changes):

```bash
aws events disable-rule --name vettid-org-security-alert-forward --profile vault-staging
```

Heartbeats: `aws cloudwatch describe-alarms --alarm-name-prefix
vettid-org-security-alert-heartbeat --query
'MetricAlarms[].[AlarmName,StateValue]' --output text` shows `OK` for
each member once its forwarder is deployed.

## DNS

- Route53 is authoritative for **vettid.org** and **vettid.dev**; the registrar
  (Hover) only points nameservers. **staging.vettid.org** is a separate zone
  in the staging account, delegated by one NS record
  (VettidOrgStagingDelegationStack, TTL 1 hour); see "Staging".
- ProtonMail records (MX/SPF/DKIM/DMARC) live in the DnsStack — change mail
  config in code, not the console.
- ACM certs auto-validate through the zones; renewals are hands-off.
- Both zones carry CAA records allowing only Amazon (ACM) to issue, no
  wildcards (`issuewild ";"`), violation reports to security@vettid.org. A
  wildcard or non-ACM cert would need `amazonOnlyCaa` (dns-stack.ts) changed first.
- vettid.org DMARC is `p=quarantine` with aggregate reports to admin@vettid.org.
- vettid.dev sends no mail. Its intended policy is SPF `v=spf1 -all` + DMARC
  `p=reject` (VettidDevRedirectStack), but the zone still holds hand-made
  vettid-dev-era records at the same names (apex TXT with the old Proton SPF +
  verification, `_dmarc` `p=none`), so those two records are behind a context
  flag. To switch: delete the apex TXT and `_dmarc` TXT in the console (and,
  if vettid.dev mail is truly retired, the Proton MX/DKIM and the old SES
  `_amazonses` / `*._domainkey` records), then
  `npx cdk deploy VettidDevRedirectStack -c vettidDevMailPolicy=true` — and
  keep passing the flag on every later deploy of that stack (or make it the
  default in code).

## Mailing list

- Flow: `POST /api/subscribe` → SES `CreateEmailIdentity` (SES's verification
  email IS the double opt-in) → pending row in `vettid-org-mailing-list` →
  15-min sweep confirms verified addresses.
- Addresses SES has **already** verified (e.g. VettID members) get no SES mail,
  so the API sends its own "Confirm your VettID updates subscription" email
  with a single-use link (`GET /api/subscribe/confirm?t=…`, 48 h; only the
  token's SHA-256 is stored). Rows wait as `status = pending_link` (never
  `pending`, which the sweep would auto-confirm); the link 302s to
  `https://vettid.org/?subscribed=1` (`=0` if stale). Both kinds of mail share
  the 200/hour global send cap.
- The API only serves requests carrying CloudFront's `X-Origin-Verify` secret
  (`vettid-org-signup/origin-verify`), and only `application/json` POSTs (415
  otherwise). Rotating the secret: update it, then redeploy VettidOrgStack
  (the Lambda re-reads it within 5 minutes).
- The sweep reclaims (deletes) SES identities of rows that expired unverified —
  unless the address belongs to a row in `vettid-org-members` (a pending member
  may be mid-verification). It can never delete the `vettid.org` domain
  identity (explicit IAM deny).
- Every confirmation emails **admin@vettid.org** from `no-reply@vettid.org`
  (SES domain identity, DKIM in the zone).
- Export subscribers (the table also holds `#…` counter/link rows and
  unconfirmed rows, so filter):
  `aws dynamodb scan --table-name vettid-org-mailing-list --filter-expression '#s = :c' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":c":{"S":"confirmed"}}' --output json`
- The table has deletion protection on (and RETAIN); turn it off in code first
  if it ever really has to go.
- **SES is in sandbox**: fine for the opt-in flow (verified recipients only by
  design), but bulk sending to the list requires production access — request it
  in the SES console before the first newsletter.

## Logging & analysis

- CloudFront v2 JSON logs → `s3://vettid-org-access-logs/AWSLogs/<acct>/CloudFront/cloudfront-v2/…`
  (90-day retention) → Athena table `vettid_logs.cloudfront_logs_v2`
  (partition projection; pass `distributionid` as injected partition).
- Legacy TSV logs → `vettid.org-logs` (30-day) → `vettid_logs.cloudfront_logs`.
- WAF telemetry (JA3/JA4 fingerprints, ordered headers, cookie/auth redacted) →
  CloudWatch group `aws-waf-logs-vettid-org` (90-day). Join to CloudFront logs
  on request ID.
- account.vettid.org: its web ACL (`vettid-org-account`; per-IP 30/5 min on
  `/api/public/*` + `/api/auth/*`, 300/5 min on `/api/*`, IP reputation in
  count mode) logs to `aws-waf-logs-vettid-org-account`; admin.vettid.org's
  allowlist ACL logs to `aws-waf-logs-vettid-org-admin` (both 90-day,
  cookie/authorization redacted). Their CloudFront access logs (TSV) land in
  each site stack's `LogBucket` under `cloudfront/` (90-day).
- See `docs/logs-analysis.md` for Athena queries; the capture spec is
  `~/VettID/vettid-org-logging-spec.md`.

## Website conventions

- No build step; plain HTML/CSS/JS. Zero inline styles; zero external resources
  (enforced by CSP `default-src 'none'` + self-only sources).
- Design tokens live in `website/assets/site.css` ("Night Watch" system).
- `npm run check:site` enforces: tag/brace balance, no inline styles, no
  vettid.dev references, no broken internal links.
- The CloudFront function handles clean URLs, `/security.txt` → `.well-known`,
  the hostile-path 403 layer (percent-decode normalized, `/.well-known/*`
  exempt), and www→apex 301s.

## Dates to watch

- **security.txt expires 2027-05-25** — bump `Expires:` in
  `website/.well-known/security.txt` before then (and re-sign if it ever gets
  PGP-signed).
- KMS keys from the vettid.dev teardown finish their 7-day deletion window
  ~2026-08-20; after that the old vault data in the archive is the only copy.

## The vettid.dev archive

`~/VettID/data/vettid-dev-archive-20260813/` — all DynamoDB tables (including
the old waitlist and registrations), Cognito users, and every S3 bucket
(including 1.4GB of encrypted vault data). **This is the only copy** — keep a
durable backup.

## Expected monthly cost

~$7–8: WAF telemetry (~$5, intentional), two Route53 zones ($1), CloudFront/
Lambda/DynamoDB/S3 in pennies at current traffic.

Relay (when deployed), at idle: ~$55/month — ALB ~$16, two 0.25 vCPU tasks
~$15, four public IPv4 addresses ~$15, Valkey Serverless minimum ~$6, logs
and DynamoDB a few dollars. It grows with use at roughly $9 per million
messages plus ~$0.003 per always-on long-poll collector per month (DynamoDB
on-demand), with idle collectors mostly served from Valkey (empty hints);
see the relay PRs for the 1k/10k/100k estimates.

Vault host stack, per vault account, with every group parked: about
$6–8/month (scaler and sync custom metrics ~$4, ~10 alarms ~$1–2, smoke
key $1, DNS Firewall, query and flow logs, Lambda within the free tier).
Each running m7g.large host adds ~$60 plus ~$5 for its public IPv4 and
disk; an AMI build costs a few cents of builder time; each release's AMI
snapshot is well under $1/month.
