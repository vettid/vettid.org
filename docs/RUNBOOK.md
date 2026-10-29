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

Stateful stacks (Dns, Signup, Playbooks, Auth, Data, AdminAccess, RelayData, PushData, Audit, Vault; in staging StageDns) have
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
| `VettidOrgDataStack` | Account/admin DynamoDB tables (`vettid-org-*`) + terms PDF bucket. Stateful. (The vault tables moved to VettidOrgVaultStack.) The audit table's TTL (`expires_at`) deletes only the 90-day address records ("Membership requests"). |
| `VettidOrgAdminAccessStack` | Admin tailnet exit node (EC2 + EIP) and the CloudFront WAF allowlist keyed to its IP (admin site). |
| `VettidOrgAdminApiStack` | Admin REST API at admin-api.vettid.org (docs/ADMIN-API.md): exit-node-IP resource policy + Cognito authorizer, 4 route-group Lambdas (people, content, system, vault-canary). |
| `VettidOrgAdminSiteStack` | Admin SPA at admin.vettid.org (`sites/admin`), behind the exit-node web ACL. |
| `VettidOrgRelayDataStack` | Relay state: DynamoDB table `vettid-org-relay` and the blob bucket `vettid-org-relay-blobs-<account>` (published via SSM `relay/*`). Stateful. |
| `VettidOrgVaultStack` | **In the vault account** (prod: vettid-vault-prod 369484479783; staging: vettid-vault-staging 347272280361). Vault tables (`vettid-org-vault*`), data bucket `vettid-org-vault-data-<account>`, the fixed-name host and retirement roles, manifest key A and its signer role, the release-key custom resource and one key per release. Stateful; see "Vault". |
| `VettidOrgStagingDelegationStack` | Prod (management account), only once context `stagingZoneNs` is set: the one NS record delegating staging.vettid.org to the staging account's zone. See "Staging". |
| `VettidOrgStageDnsStack` | **Staging only** (vettid-vault-staging): zone `staging.vettid.org`, its CAA, the SES domain identity `staging.vettid.org` (DKIM records), SSM `dns/zone-id`. Stateful. |
| `VettidOrgStageSiteStack` | **Staging only**: https://staging.vettid.org (`sites/staging`), serving the staging channel's manifest from `vault/staging/pcr-manifest.json`. |
| `VettidOrgStageTestMailStack` | **Staging only, test infrastructure**: MX for `test.staging.vettid.org`, the SES receipt rule set storing its mail in `vettid-org-staging-test-mail-<account>` (7 days), the owner-only reader role. See "Staging" → "Test mail". Never in prod. |
| `VettidOrgAuditStack` | Management account: the organization CloudTrail trail (management events of every account, plus S3 data events on the terms bucket and, writes only, on the two vault data buckets) and its bucket, the GuardDuty detector (administrator for the organization), Access Analyzer, the security-alert rules and topic `vettid-org-security-alerts`, and the default-bus policy admitting the member accounts' forwarders. Stateful. See "Security alerts". |
| `VettidOrgVaultAlertForwardStack` | **In the vault account** (prod: vettid-vault-prod; staging: vettid-vault-staging): the one rule forwarding its CloudTrail events to the management account's bus. See "Security alerts". |
| `VettidOrgProteusAlertForwardStack` | **In the proteus account** (605628228301): the same forwarder. Deployed from this repository with `--profile proteus`. See "Security alerts". |
| `VettidOrgCiReadOnlyStack`, `VettidOrgVaultCiReadOnlyStack` | Prod only, one per production account (management; vettid-vault-prod with `--profile vault-prod`): the GitHub Actions OIDC provider and the read-only role `vettid-org-ci-drift-readonly` for the drift check. See "Production drift". |
| `VettidOrgRelayStack` | relay.vettid.org: VPC (no NAT; S3 + DynamoDB gateway endpoints), ElastiCache Serverless Valkey (IAM auth, TLS), ECS Fargate service (2–8 tasks, rolling deploys), ALB with PQ TLS. Logs to `/vettid-org/<stage>/relay-service`. Only deployed when `relayImage` is set. |
| `VettidOrgPushDataStack` | Only with context `pushStages`. Management account, for both channels: the key `alias/vettid-org-push` (the secrets `vettid-org/<stage>/push/{apns,fcm,blob-keys}` under it are created by the operator, not by a stack), the log groups `/vettid-org/<stage>/push-service` (14 days), the zone `push.staging.vettid.org`, the alarm topic `vettid-org-push-alerts`. Stateful. See "Push gateway". |
| `VettidOrgPushStack` | Only with `pushImage` or `stagingPushImage`. push.vettid.org and push.staging.vettid.org: one Fargate service per channel (2 tasks) in the relay's cluster, behind the relay's ALB (host rule, own certificate, own target group), task role, security group, alarms. No state. |
| `VettidOrgStagePushDelegationStack` | **Staging only**, once context `stagingPushZoneNs` is set: the one NS record delegating push.staging.vettid.org to the management account's zone. |

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

## CI image mirror

The CI of vettid-vault, vettid-relay and vettid-push pulls its container
images from `ghcr.io/vettid/mirror/<name>`, by digest, not from Docker Hub
or Amazon ECR Public: both limit anonymous pulls per IP address, and the
shared GitHub runners hit those limits ("Data limit exceeded"). The images
are the upstream ones byte for byte (same index and per-platform manifest
digests), so nothing a build produces changes.

- The list: `.github/mirror/images.txt` (upstream reference with digest,
  and alternative upstream repositories serving the same digest).
- The copy: `.github/workflows/image-mirror.yml` → `.github/mirror/mirror.sh`
  (skopeo `copy --all --preserve-digests`), weekly, on demand, and on a
  pull request that changes the list. It verifies that the mirror serves
  each pinned digest and warns if an upstream stops serving one.
- Docker Hub is used anonymously (one manifest request per image a week).
  With a `DOCKERHUB_TOKEN` secret and a `DOCKERHUB_USERNAME` variable the
  workflow logs in instead.
- The packages are public (the upstream images are public), so the other
  repositories' workflows, service containers and anyone else pull them
  without credentials. Packages this public repository's workflow creates
  come up public (the first run's ten did); if one ever comes up private,
  set it public once (Package settings → Danger zone → Change visibility;
  there is no API for it): `skopeo inspect --no-creds` on its digest must
  answer without a login.
- Each consumer keeps the upstream reference in a comment or lock next to
  the mirror reference. Locks and Dockerfiles that are inputs to a
  reproducible build (vettid-vault `release/eif-toolchain.lock`,
  `release/kernel/kernel.lock`, the Dockerfiles) keep the upstream
  reference; CI sets `VETTID_IMAGE_MIRROR=ghcr.io/vettid/mirror` and the
  build scripts pull the same digest from the mirror. An independent
  rebuild leaves it unset and pulls from upstream.

Updating an image: first add the new line here and merge it (its pull
request run copies the image; check that run is green), and only then open
the consumer's pull request that uses the new digest: a consumer pointing
at a digest the mirror lacks fails its CI. Keep old lines while released
commits still name them. Dependabot pull requests skip the job (their
token cannot write packages); the weekly run covers them, or run the
workflow by hand after merging one.

Pins nobody bumps automatically, to refresh by hand now and then (resolve
the tag's current digest, add the line, then update the consumers):
`moby/buildkit:buildx-stable-1` (setup-buildx-action `driver-opts`),
`tonistiigi/binfmt:latest` (setup-qemu-action `image`) and
`docker/dockerfile:1` (the relay and push Dockerfiles' `# syntax` line and
their CI's `BUILDKIT_SYNTAX`), in vettid-relay and vettid-push.

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
- **Rate limits** (RELAY-PROTOCOL §7.2, relay ≥ protocol 0.7.0; this is
  the core of a larger design, deployed first on purpose). Per source
  address: a flood guard of **100 requests/s, burst 300**, and 1 new
  mailbox/s (burst 30; re-registration at unlock is free). Per key once a
  request is authenticated: 20/s, burst 100. The task sets none of the
  `RELAY_RATE_*` variables: the defaults are the spec's numbers.
- **When to raise the flood guard.** One address carries a whole vault
  host. Each task logs one `rate limits` line a minute (info level).
  *Rate* (`RELAY_RATE_IP_RPS`, 100): a host's steady traffic reaches it at
  about 2,500 idle vaults, 1,100 at a message a minute each, 700 at two.
  Raise it when, for a known vault host, `address_busiest_per_min` stays
  at 3,000 or more (half the guard). *Burst* (`RELAY_RATE_IP_BURST`,
  300): about 100 vaults can unlock in the same instant, and 300 can
  re-poll at once after a relay deploy; more than that are refused once
  and are back within seconds (500 vaults: 2.5 s; 900: 7 s). Raise it if
  `address_refused` shows up for a known host after deploys or mass
  unlocks and those seconds matter; it is also the size of every
  instantaneous memory cost, so not further than needed. The reviewed
  next step for hosts of 1,000 to 2,000 vaults is 200 / 4,000 together
  with the archived memory bounds. At ten members and four staging vaults
  none of these should be anywhere near.
- **What else the line says.** `key_busiest_per_min`, `key_peak`,
  `key_refused`: one key against its 20/s. `register_refused`: an address
  creating mailboxes faster than 1/s. `addresses_refused`: how many
  addresses the flood guard refused in the minute. `collectors`, `parked`,
  `ws_sessions`: what the task carries (measured: about 42 KiB per parked
  long-poll, 45 KiB per WebSocket session; nothing caps them per task
  yet, so watch them against the task's 512 MiB). Nothing identifies an
  address or key in logs or metrics, by design. No vault-host allowlist
  exists or is needed.
- **Not protected yet** (§7.2 "What does not hold"): one address can cost
  five times what it could (100/s); a vault whose mailbox is gone retries
  every second; parked collectors, WebSocket sessions and stalled deposit
  bodies (from anyone with one registered mailbox) are bounded only by
  the flood guard. The mechanisms for these are archived (relay
  branch `ratelimit-per-key-full`, spec branch
  `spec/relay-rate-limits-full`) and return one by one, sized from the
  numbers above.
  **Watch after the deploy:** task memory and restarts against
  `collectors` and `ws_sessions`; `address_busiest_per_min` and refusals
  by limiter; Valkey data size and ECPU; DynamoDB consumed reads; ECS CPU.
- **HTTP/2 stream limit** (RELAY-PROTOCOL §7.4; VAULT-MESSAGING
  §12.2.1). The front end must not announce exactly 100 concurrent
  streams, and should announce at least 128: vault hosts size their
  shared connections from it, and a front end announcing 100 makes
  every vault of a host wait behind the first long-poll of each new
  connection. The ALB announces **128** (checked 2026-10-12) and has no
  setting for it. Check again before anything else is put in front of
  the relay (another load balancer, a CDN, a proxy), and after such a
  change:

  ```bash
  python3 - relay.vettid.org <<'EOF'
  import socket, ssl, struct, sys
  h = sys.argv[1]
  c = ssl.create_default_context(); c.set_alpn_protocols(["h2"])
  s = c.wrap_socket(socket.create_connection((h, 443), timeout=10), server_hostname=h)
  s.sendall(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n" + b"\x00\x00\x00\x04\x00\x00\x00\x00\x00")
  def rd(n):
      b = b""
      while len(b) < n: b += s.recv(n - len(b))
      return b
  while True:
      hd = rd(9); p = rd(int.from_bytes(hd[:3], "big"))
      if hd[3] == 4 and not hd[4] & 1:   # the server's SETTINGS frame
          print({k: v for k, v in struct.iter_unpack(">HI", p)}.get(3, "not announced")); break
  EOF
  ```

  It prints the announced `SETTINGS_MAX_CONCURRENT_STREAMS` (expected:
  `128`). The same check works for `push.vettid.org` and
  `push.staging.vettid.org`. On a vault host the parent's `metrics`
  record shows what the enclave read, as `relay_streams`; `relay_streams`
  0 or 100 with `relay_waiting` above 0 is the symptom
  (VAULT-RELEASES §8.7).
- **Alarms** on the `rate limits` line: "Alarms on the rate limits
  line" below.
- **Health.** `/healthz` reads DynamoDB. Metrics worth alarming on (task
  `/metrics`, loopback): `relay_coord_errors_total`, `relay_wake_bus_up`,
  `relay_errors_total{code="internal"}`.
- **Data.** Everything stored is ciphertext the relay cannot read. Table
  has deletion protection, no PITR (messages live ≤ 14 days); the blob
  bucket expires objects after 8 days.
- **Table throughput ceiling.** The table is on-demand with a maximum:
  **10,000 write and 2,000 read units a second** (its index `due`: 100
  and 100; writes raised from 2,000 on 2026-10-15), `RELAY_TABLE_LIMITS` in `lib/stacks/relay-data-stack.ts`,
  where the sizing is written out. Above it DynamoDB throttles: deposits,
  acks and registrations fail or are retried, for every tenant, until
  the load is back under it (short bursts may pass; the maximum is a
  target, not exact). Without it the only bound was the account quota of
  40,000 units a second, about $2,160 a day in writes; with it, about
  $540 a day in writes and $22 in reads. Measured use (October 2026, ten
  members): 27 write units a second in the busiest minute. A 4 KB message
  costs about 21 write units with its collect and ack (RELAY-PROTOCOL
  §7.2), so one host of 900 vaults at three messages a minute is about
  1,800 to 1,900, and one address at the flood guard 1,600 to 2,500: a
  quarter of the ceiling. The table's warm throughput is 4,000 write
  units a second; DynamoDB serves more as it scales the table. To raise it:
  change the numbers, PR, `npx cdk diff VettidOrgRelayDataStack` (the
  table must show as modified in place, never replaced), `npx cdk deploy
  VettidOrgRelayDataStack`, then `VettidOrgRelayStack` (the table alarms
  name the ceiling in their text; their thresholds are fixed numbers). In an emergency the same from the CLI,
  and put it in code afterwards, or the next deploy of the data stack
  takes it back:
  `aws dynamodb update-table --table-name vettid-org-relay --on-demand-throughput MaxReadRequestUnits=<n>,MaxWriteRequestUnits=<n>`.
  It caps the rate, not what is stored: nothing limits the table's size
  but the mailbox quotas and the 14-day lifetime
  (`aws dynamodb describe-table --table-name vettid-org-relay --query 'Table.[ItemCount,TableSizeBytes]'`,
  refreshed about every six hours).
- **Empty hints.** Idle long-polls mostly skip DynamoDB (Valkey knows the
  mailbox is empty); `relay_collect_store_skips_total` vs
  `relay_collect_store_queries_total` shows the ratio, and
  `relay_empty_hint_bump_failures_total` > 0 means some deposits may have
  waited up to 5 min (`RELAY_EMPTY_SKIP_MAX`).

### Alarms on the rate limits line

Seventeen alarms, `vettid-org-relay-<name>` (seven on the line, four on the
table: "Alarms on the table" below, six on Valkey, log volume and WAF:
"Alarms on Valkey, log volume and WAF"), to the topic
`vettid-org-security-alerts` → admin@vettid.org (the management
account's topic, which admits this account's CloudWatch alarms since
#214; the member API's alarms use it the same way). Six metric filters
on `/vettid-org/prod/relay-service` read one field each from every
task's line (`{ $.msg = "rate limits" }`) into the namespace
`VettID/Relay`, without dimensions: the line names no task, address or
key, and neither do the metrics. Sum adds the tasks up, Maximum is the
worst task. No alarm says which address or key: by design nothing
does.

| Alarm | Fires when | Do |
|---|---|---|
| `address-refused` | the flood guard refused requests (`address_refused` > 0) in 3 of 5 minutes | One burst (a scanner, a relay deploy, a mass unlock) does not fire it; this is sustained. `addresses_refused` in the line says how many addresses. One, with `address_busiest_per_min` high: a vault host at the guard, raise `RELAY_RATE_IP_RPS` / `RELAY_RATE_IP_BURST` ("When to raise the flood guard" above; reviewed next step 200 / 4,000 with the memory bounds). Many addresses, or none of them a vault host: a flood, the guard is doing its work; watch task CPU and memory. |
| `address-busy` | `address_busiest_per_min` ≥ 3,000 for 5 minutes (half the guard's 6,000 a minute) | A vault host near about 550 active vaults behind one address: raise `RELAY_RATE_IP_RPS` before it is refused (add it to the container environment in `lib/stacks/relay-stack.ts`, PR, `cdk deploy VettidOrgRelayStack`; rolling, no downtime). If no host has that many vaults, it is one address flooding below the guard. |
| `key-refused` | a key was refused at its own 20/s (`key_refused` > 0) in 3 of 5 minutes | One client or vault in a loop. Usual cause: an orphan vault, whose mailbox is gone, retrying every second (§7.2 "What does not hold"): on the vault hosts, `RelayRequestErrors` and the parent's log; the vault's member can lock and unlock. `key_busiest_per_min` shows how hard. Do not raise the limit for it. |
| `register-refused` | an address was refused new mailboxes (`register_refused` > 0, 1/s, burst 30) in 3 of 5 minutes | Someone creating mailboxes in bulk (re-registration at unlock is free, so not a vault host unlocking). DynamoDB item count and consumed writes; nothing to raise. |
| `collectors` | a task carries ≥ 2,000 long-polls in 3 of 5 minutes | About 42 KiB each: 82 MiB of the task's 512 MiB, and nothing caps them per task. Look at task memory and restarts (ECS service metrics); scale out by hand if memory is above 70 % and the service has not (`aws ecs update-service --cluster vettid-org-relay --service vettid-org-relay --desired-count <n>`, up to 8); find out who holds them (a vault host has at most 1,024). Time to bring back the per-task caps (relay branch `ratelimit-per-key-full`). |
| `ws-sessions` | a task carries ≥ 2,000 WebSocket sessions in 3 of 5 minutes | The same, at about 45 KiB each (88 MiB). |
| `rate-limits-silent` | no task wrote the line for 5 minutes (missing data is the alarm) | The relay is down or not logging: `aws ecs describe-services --cluster vettid-org-relay --services vettid-org-relay --query 'services[0].[runningCount,deployments[].rolloutState,events[:5].message]'`, then `aws logs tail /vettid-org/prod/relay-service --since 15m`. An image older than protocol 0.7.0 does not write the line. The other six alarms on the line are blind while this one is on (the four on the table are not). Also sends OK. |

#### Alarms on the table

Four alarms on DynamoDB's own metrics for the table (`AWS/DynamoDB`,
`TableName` = `vettid-org-relay`), which do not depend on the line:
they keep working while `rate-limits-silent` is on. The metrics have
data only in minutes with requests, so missing data is not an alarm.

| Alarm | Fires when | Do |
|---|---|---|
| `table-writes-high` | 60,000 or more write units a minute for 5 minutes (1,000 a second, a tenth of the ceiling of 10,000; a fixed number, `RELAY_ALARM_LIMITS.tableWritesBusyPerSecond`) | Somebody is writing a lot: deposits of large messages, or many of them. With `address-busy` or `address-refused` on: one address. Is it a known vault host (a migration, a mass unlock, real growth)? Then check the ceiling still leaves room ("Table throughput ceiling" above) and raise this alarm with the membership. If not, it is a flood: the bill is bounded (about $540 a day at most at the ceiling, about $54 a day at this alarm's rate), tenants are throttled only once `table-throttled` fires; watch the table's size, and do not raise the ceiling for it. |
| `table-reads-high` | 60,000 or more read units a minute for 5 minutes (1,000 a second, half the read ceiling; `RELAY_ALARM_LIMITS.tableReadsBusyPerSecond`) | The same for reads (collects of large mailboxes). Health checks read the table too, so do not let real use sit at the read ceiling: raise it. |
| `table-write-volume` | 360,000 or more write units in an hour (100 a second on average; at most about 180 MB of messages stored) | 65 times the busiest hour of the preview. A slow fill below the other alarms shows here: table size and item count (`describe-table`, above), `register-refused`, the hour's `ConsumedWriteCapacityUnits` in the console. Real growth reaches it at about 300 vaults at a message a minute: then raise `tableWriteUnitsPerHour`. |
| `table-throttled` | DynamoDB throttled the table or its index (read or write events, or throttled deposit transactions) in 3 of 5 minutes | Tenants are being refused or delayed now. With `table-writes-high` or `table-reads-high`: the ceiling is reached, decide as above (real use: raise it; a flood: leave it, it is what bounds the bill). Without them: a hot partition (one mailbox written or read beyond a partition's 1,000 write or 3,000 read units a second), or the index's ceiling (mass rotation, `register-refused`). |

#### Alarms on Valkey, log volume and WAF

Six more alarms, to the same topic, on AWS's own metrics (they do not
depend on the line either). Valkey: `AWS/ElastiCache`, `clusterId` =
`vettid-org-relay`; limits in `RELAY_VALKEY_LIMITS` (1 GB, 100,000 ECPU
a second; the alarms at 75 %).

| Alarm | Fires when | Do |
|---|---|---|
| `valkey-storage` | Valkey holds 750 MB or more in 3 of 5 minutes | Measured use is tens of KB. At 1 GB the cache evicts keys with a TTL (every relay key has one), replay records included. Look for one address sending signed requests under fresh keys at the flood guard (`address-busy`, `address-refused`). Raising the limit only moves the point where eviction starts. |
| `valkey-ecpu` | 4,500,000 or more ECPUs in a minute, in 3 of 5 minutes (75 % of 100,000 a second) | At the limit Valkey throttles, the replay check fails and every signed request is answered `429`. With `address-busy` on: a flood; otherwise real growth, raise `RELAY_VALKEY_LIMITS.ecpuPerSecond` (about $0.0023 per million ECPU). |
| `valkey-evictions` | any eviction in a minute | Valkey is full: replay protection is weakened while it lasts. As `valkey-storage`. |
| `valkey-errors` | any throttled command, throttled IAM authentication (failed connections), or command, key or channel authorization failure in a minute | Throttling: as `valkey-ecpu`. Authorization failures: the relay used a key or channel outside `relay:*` (a relay bug; its log, warn level). IAM throttling: too many new connections at once (tasks restarting in a loop: ECS service events). |
| `log-volume` | the service log and the VPC flow log ingested 500 MB or more in a day (normal: 1 to 2 MB) | `aws logs tail /vettid-org/prod/relay-service --since 1h` for what repeats; `/vettid-org/prod/relay-vpc-flow` for rejected traffic. Ingestion is $0.50 a GB. |
| `waf-rate-limit` | WAF's rate rule counted (count mode) or blocked (block mode) any request in 5 minutes (`AWS/WAFV2`, rule metric `vettid-org-relay-rate-limit`) | One address is above 60,000 requests in 5 minutes, twice the flood guard. WAF console → web ACL `vettid-org-relay` → Sampled requests shows which. A known vault host: raise `RELAY_WAF_RATE_LIMIT.requests` with the flood guard before the rule blocks. Otherwise a flood: in block mode WAF is doing its work. |

#### The load balancer's web ACL, deletion protection, flow log

- **WAF** (`vettid-org-relay`, regional, on the relay's load balancer):
  one rate-based rule, 60,000 requests per 5 minutes per source address
  (`RELAY_WAF_RATE_LIMIT`), twice the relay's flood guard. It does not
  refuse the way the flood guard does: the guard only slows an address
  to its rate, while WAF, once an address's 5-minute estimate passes the
  limit, blocks every request from it until the estimate drops, which
  can take minutes. A 900-vault host sends about 24,300 in 5 minutes at a
  message a minute per vault. When the flood guard is raised, raise this
  with it (keep it at twice the guard). In block mode the refusal is
  `429` with the relay's `rate_limited` body and `retry_after` 60, a
  minimum: the block can last longer.
  - **It starts in count mode** (`mode: 'count'`): WAF counts what it
    would block and `waf-rate-limit` reports it. **After a week of normal
    traffic with no count**, switch it to block: set `mode: 'block'` in
    `RELAY_WAF_RATE_LIMIT` (`lib/stacks/relay-stack.ts`), PR, then
    `npx cdk deploy VettidOrgRelayStack`.
  - WAF's request fee ($0.60 a million) grows with traffic: about $0.40 a
    month today, about $56 to $126 a month at a 900-vault host's 36 to 81
    requests a second (estimate), on top of $6 for the ACL and rule.
- **Deletion protection** is on: to delete the load balancer (only with
  the stack), turn it off first.
- **No access log**, on purpose: it would record full paths (mailbox and
  message ids) next to client addresses.
- **VPC flow log**: rejected traffic only, in
  `/vettid-org/prod/relay-vpc-flow`, kept 30 days.

The thresholds are in `RELAY_ALARM_LIMITS` (`lib/stacks/relay-stack.ts`).
2,000 long-polls or sessions on a task is a sixth of its memory, well
below the 70 % at which the service adds tasks and far above the
preview's handful: it means "look", not "out of memory". Raise both
with the task size. State:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix vettid-org-relay- \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```

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

## Calling service (calls.staging.vettid.org) - handshake test

Docs: CALLING-SERVICE §8, CALLS-PLAN §13. **Staging app only**
(`-c stage=staging --profile vault-staging`), two stacks, built only when
context `callsStages=staging` names the stage. Nothing here is deployed
without the owner's go. This section covers C2 step 2, the handshake test;
the server stack, the secret and the checks of §11 are steps 4 and 5 and
will extend it.

| Stack | Holds |
|---|---|
| `VettidOrgCallsDataStack` (stateful) | the key `alias/vettid-org-calls`, the log groups `/vettid-org/staging/calls-issuer` and `calls-server` (14 days), the topic `vettid-org-calls-alerts`. No secret (the operator creates it, step 4), no address yet (step 4). |
| `VettidOrgCallsStack` | the issuer's front: ACM certificate, CloudFront (HTTP/2, TLS 1.3 only, https only, no cache, no access log), the origin function (reserved concurrency 4) behind an open function URL (decision in CALLING-SERVICE §8.2), the A/AAAA aliases, the alarm `vettid-org-staging-calls-issuer-invocations` (more than 1,000 in 5 minutes) and the cost tag `vettid-service=calls`. |

| Context | Meaning |
|---|---|
| `callsStages` | `staging`. Without it the staging app has no calls stack. `prod` fails the synth (D25). |
| `callsIssuerStub` | `true`: the origin is the **stub**, for the handshake test only. |
| `stagingCallsIssuer`, `stagingCallsIssuerFile` | The real issuer: `<release URL>@sha256:<hex>` and the downloaded archive's path; the synth fails unless the file has that SHA-256. Never with the stub. |

**The stub** answers `GET /v1/health` with `200 {}` and everything else with
`403 attestation_invalid`, with header `x-vettid-calls-stub: 1`. It reads
nothing from a request, holds no secret and no key (its role may only write
its log stream), emits no metric and runs only when `callsIssuerStub=true`
is on the deploy command (never in cdk.json). Before step 5 (the DNS Firewall
entry) the real archive replaces it and `curl -sI https://calls.staging.vettid.org/v1/health`
must show no `x-vettid-calls-stub` header; stack output `IssuerKind` says
`stub` or `archive`.

### Deploy for the test (on the owner's go)

```bash
npx cdk diff   VettidOrgCallsDataStack VettidOrgCallsStack --exclusively -c stage=staging -c callsStages=staging -c callsIssuerStub=true --profile vault-staging
npx cdk deploy VettidOrgCallsDataStack VettidOrgCallsStack --exclusively -c stage=staging -c callsStages=staging -c callsIssuerStub=true --profile vault-staging
```

`--exclusively` matters: master is ahead of what is deployed to staging, so
a diff of other stacks (Auth, Vault, VaultHost, MemberApi) shows Lambda
`S3Key` changes that are not this change. The 2026-10-29 diff of the two
calls stacks showed only the new stacks.

The certificate validates in the staging zone; the first deploy waits a few
minutes for it and for CloudFront. Reserved concurrency 4 needs the account's
Lambda limit to be at least 14 (staging: 400 total, 399 unreserved, verified
2026-10-29).

### The handshake test

"A development enclave" has no tool of its own for this: `devstack` replaces
the pinned roots with a test root. What exists is the enclave's real egress
transport (`enclave/egress`: TLS 1.3 only, pinned roots, ALPN `h2` required,
no redirects) and the pinned Amazon roots (`vms/pins`). A short program runs
exactly that code over a direct TCP dial. It is not committed to vettid-vault
(no vault code in C2 step 2); its source is below.

**What it does not cover** (each is checked in step 5, below): the vsock
forwarder and the parent's `DefaultAllow` (does the parent forward
`calls.staging.vettid.org`?), the host's DNS Firewall (does the name
resolve?), the enclave's clock (certificate validity uses it), and the
release allowlist built in `cmd/vault-enclave/release.go` (the host entry,
its roots and `HTTP2`). It covers TLS, the chain, ALPN and what CloudFront
and the origin do with a request.

```go
// Command egresscheck: the enclave's egress transport (TLS 1.3 only, pinned
// Amazon roots, ALPN h2 required) against the handshake-test stub, over a
// direct TCP dial. Development check only; not committed to vettid-vault.
// Exits non-zero unless every check below passes.
//
//	go run ./cmd/egresscheck calls.staging.vettid.org [attestation-header-bytes]
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/vettid/vettid-vault/enclave/egress"
	"github.com/vettid/vettid-vault/vms/pins"
)

var failed bool

func check(ok bool, format string, a ...any) {
	if !ok {
		failed = true
		fmt.Printf("FAIL "+format+"\n", a...)
	} else {
		fmt.Printf("ok   "+format+"\n", a...)
	}
}

func main() {
	host := os.Args[1]
	size := 7000
	if len(os.Args) > 2 {
		size, _ = strconv.Atoi(os.Args[2])
	}
	tr, err := egress.New(egress.Config{
		Dialer: egress.DialerFunc(func(ctx context.Context, h string, p uint16) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(h, strconv.Itoa(int(p))))
		}),
		Hosts: []egress.Host{{Name: host, Roots: pins.Pool(pins.AmazonTLSRoots()), HTTP2: true}},
	})
	if err != nil {
		panic(err)
	}
	c := tr.Client(15 * time.Second)
	do := func(req *http.Request) (*http.Response, string) {
		resp, err := c.Do(req)
		if err != nil {
			fmt.Println("FAIL", req.Method, req.URL.Path, "(TLS 1.3, pinned roots, h2):", err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return resp, string(b)
	}
	// The stub's answers only: a CloudFront or function-URL "Forbidden"
	// has the status but not the header or the body.
	g, _ := http.NewRequest("GET", "https://"+host+"/v1/health", nil)
	r, body := do(g)
	check(r.ProtoMajor == 2 && r.Proto == "HTTP/2.0", "GET /v1/health protocol %s", r.Proto)
	check(r.StatusCode == 200, "GET /v1/health status %d", r.StatusCode)
	check(r.Header.Get("x-vettid-calls-stub") == "1", "GET /v1/health has x-vettid-calls-stub: 1")
	check(strings.TrimSpace(body) == "{}", "GET /v1/health body %q", body)

	p, _ := http.NewRequest("POST", "https://"+host+"/v1/credentials", strings.NewReader(`{"count":1}`))
	p.Header.Set("X-VettID-Attestation", strings.Repeat("A", size))
	p.Header.Set("X-VettID-Key", strings.Repeat("A", 44))
	r, body = do(p)
	var e struct{ Code string }
	_ = json.Unmarshal([]byte(body), &e)
	check(r.Proto == "HTTP/2.0", "POST protocol %s", r.Proto)
	check(r.StatusCode == 403, "POST /v1/credentials (%d-byte attestation header) status %d", size, r.StatusCode)
	check(r.Header.Get("x-vettid-calls-stub") == "1", "POST has x-vettid-calls-stub: 1")
	check(e.Code == "attestation_invalid", "POST body code %q", e.Code)
	fmt.Printf("stats: %+v\n", tr.Stats(host))
	if failed {
		os.Exit(1)
	}
}
```

1. Put it in a clean checkout of vettid-vault `origin/main` as
   `cmd/egresscheck/main.go`.
2. `openssl s_client -connect calls.staging.vettid.org:443 -tls1_3 -alpn h2 -servername calls.staging.vettid.org </dev/null`:
   expect `TLSv1.3`, `ALPN protocol: h2`, a chain ending at Amazon Root CA 1.
   (`-tls1_2` must fail: the front is TLS 1.3 only.)
3. `go run ./cmd/egresscheck calls.staging.vettid.org 7000`. **Pass means
   the program prints only `ok` lines and exits 0.** It checks, for the GET
   of `/v1/health`: HTTP/2.0, status 200, header `x-vettid-calls-stub: 1`,
   body `{}`; and for the POST of `/v1/credentials` with a 7000-byte
   `X-VettID-Attestation` header (about the size of a real one): HTTP/2.0,
   status **403 with `x-vettid-calls-stub: 1` and body code
   `attestation_invalid`**. A bare 403 is not a pass: CloudFront or the
   function URL answer `Forbidden` without that header and body. The stats
   line shows `Streams`, CloudFront's announced stream limit (egress opens a
   second connection only if it is 32 or more). The header test shows that
   a header of that size is **not rejected** by CloudFront and the function
   URL; that it arrives intact is for step 5 with the real issuer.
   Negative control, 2026-10-29: the program against
   `push.staging.vettid.org` fails the three stub checks and exits 1; its
   TLS, h2 and 7000-byte header checks pass there (128 streams).
4. Record the results in CALLS-PLAN §13.7. Pass: C2 goes on (step 3 onward).
   Fail: CALLING-SERVICE §13 (the issuer moves behind a load balancer)
   before anything is built on it.

### Right after the test: destroy the stub

An open function URL costs money per invocation, and the reserved
concurrency caps parallel runs, not volume. So the stub does not stay up
(the alarm `vettid-org-staging-calls-issuer-invocations` watches it while it
does). Destroy **only the service stack**; the data stack (key, log groups,
topic) is retained and stays:

```bash
npx cdk destroy VettidOrgCallsStack --exclusively -c stage=staging -c callsStages=staging -c callsIssuerStub=true --profile vault-staging
```

The certificate and the DNS records go with it; the name is re-created with
the real issuer in step 4. Do not destroy `VettidOrgCallsDataStack`.

### Step 5: the same through a real enclave

When the host stack carries the issuer's name (the DNS Firewall entry, the
parent's `DefaultAllow` entry, and the release constant `calls_url` with its
allowlist entry in `release.go`), repeat the check from inside an enclave
on a staging host: the vault's issuer client asks for credentials (or a
debug probe of `GET /v1/health` through the egress transport). It must show
the name resolves, the parent forwards it, the clock is right, and the TLS
handshake completes under the release's allowlist entry. Until that passes
the issuer's name is not trusted as reachable.

### Tear down

`cdk destroy VettidOrgCallsStack` as above removes the front and the origin.

## Push gateway (push.vettid.org, push.staging.vettid.org)

The wake-up push service (docs/PUSH-GATEWAY.md §10; code and runtime
contract: github.com/vettid/vettid-push, README). **Both channels run in
the management account**, as two Fargate services in the relay's cluster
behind the relay's load balancer (§10.4): staging is not in the staging
account. It holds no state; what it has are three secrets per channel,
which **the operator creates by hand**: no stack creates or holds one.

| Context | Meaning |
|---|---|
| `pushStages` | `staging`, `prod` or both: the channels whose gateway exists. Unset: no push stack at all, and the relay stack is untouched. |
| `stagingPushImage`, `pushImage` | The channel's image, **pinned by digest** (`ghcr.io/vettid/vettid-push@sha256:…`, from that repository's publish job; multi-arch, the tasks run arm64). Unset: the channel has its log group but no service. Staging and production are separate so a new image runs on staging first. |
| `stagingPushPlatforms`, `pushPlatforms` | `fcm`, `apns`, `fcm,apns`. **Default: none.** A gateway without platforms starts with no credentials and answers `platform_invalid`. A listed platform's secret must exist first, or the tasks do not start. The task role can read only the listed platforms' secrets. |
| `stagingPushFcmProject`, `pushFcmProject` | The Firebase project id (`vettid-staging`, `vettid-prod`). Needed with workload identity federation, unless `project_id` is added to the secret; a service-account key already has it. |
| `stagingPushZoneNs` | **Staging app**: the four name servers of the zone `push.staging.vettid.org` (step 2). |

Until a value is in `cdk.json`, it must be on **every** production deploy
command, or the stack is built without it: a `VettidOrgRelayStack` deploy
without `pushStages` would delete the seven SSM parameters the push stack
reads (the running services are not affected; the next push deploy fails
until they are back). Commit each value as soon as its deploy has worked
(the drift check reports the difference until then).

### Android app ids per channel (`PUSH_FCM_APP_IDS`)

Not context: `PUSH_APP_IDS` in `lib/config.ts`. A channel's gateway
accepts one Android `app_id`, the channel's `android_package`
(VAULT-MESSAGING 0.26.0 §11.10.8): production `com.vettid.app`, staging
**`com.vettid.app.staging`** (it was `com.vettid.app` until staging
release S10; STAGING-DEVELOPMENT-PLAN D5). The iOS ids did not change.

The change reaches the running staging gateway only with a deploy of
`VettidOrgPushStack` **in the management account, on the owner's
go-ahead**, together with S10 and the first Android build that has the
`.staging` application id:

```bash
npx cdk diff   VettidOrgPushStack --exclusively     # one container environment value: PUSH_FCM_APP_IDS
npx cdk deploy VettidOrgPushStack --exclusively     # a new task definition revision; the service replaces its tasks (rolling)
curl -s -o /dev/null -w '%{http_code}\n' https://push.staging.vettid.org/v1/health     # 200
```

Earlier is harmless, later is not: while `stagingPushPlatforms` is empty
the gateway answers `platform_invalid` to every registration whatever the
list says, so nothing that works today depends on it; but once `fcm` is
on, a gateway still listing `com.vettid.app` refuses the new build's
`push.register`. A registration made under the old id stops waking when
the list changes and is replaced by the new build's (PUSH-GATEWAY §5.2).

### What is where

- **`VettidOrgPushDataStack`** (stateful): the key, the log groups, the
  staging zone and the alarm topic. Deployed once, before anything else,
  because the secrets are created under its key before a service can
  start, and so that a failed service deployment (rolled back and deleted)
  leaves the log that says why.
- **The secrets** `vettid-org/<stage>/push/{blob-keys,fcm,apns}` belong to
  no stack. The operator creates each one with its value, under the key
  (below); the stacks know them by name only (the task role's
  `secretsmanager:GetSecretValue` is on
  `…:secret:vettid-org/<stage>/push/<name>-??????`). CloudFormation cannot
  create them, not even empty: under a customer-managed key Secrets Manager
  requires `kms:Decrypt` of whoever creates a secret, and a deployment role
  with that could read all of them. A secret that does not exist yet is not
  an error for any deploy; only a service that needs it does not start.
- **`VettidOrgRelayStack`** gains seven SSM parameters (`relay/vpc-id`,
  `relay/public-subnet-ids`, `relay/alb-*`, `relay/https-listener-arn`):
  parameters only. The listener, its certificate, the load balancer and the
  relay service are not changed and not replaced; check with `cdk diff`.
- **`VettidOrgPushStack`** adds to the relay's HTTPS listener a host rule
  and a certificate per gateway (SNI; the relay's own certificate is not
  reissued), so the push hosts get the same post-quantum TLS policy.
  Requests for any other host still go to the relay (the default action).
- **push.staging.vettid.org** is a small zone of its own in the management
  account, delegated from `staging.vettid.org` (which lives in the staging
  account) by `VettidOrgStagePushDelegationStack`. The certificate
  validates in it and the alias to the load balancer is in it, so nothing
  in the management account writes to the staging zone.
- **Key policy** (`alias/vettid-org-push`): `kms:Decrypt` only for the two
  task roles `vettid-org-push-gateway` and `vettid-org-staging-push-gateway`
  (each for its own channel's secrets, through Secrets Manager) and for the
  owner's Identity Center role (`VettIDAdmin`), which also has
  `kms:GenerateDataKey` and is therefore the **only** principal that can
  create a secret under the key or put a value (Secrets Manager needs both
  actions of its caller for either). The administrator statement has no
  cryptographic action and no `kms:CreateGrant`. So every `aws
  secretsmanager` command below runs in the owner's session (`aws sso
  login`, default profile), never from CI or a deployment role.

### First deployment (staging first; production's service absent)

```bash
aws sso login                       # covers default and vault-staging
P="-c pushStages=staging"
# 1. Key, log group, zone, alarm topic; and the relay's refs. No secret.
npx cdk diff   VettidOrgPushDataStack VettidOrgRelayStack $P --exclusively
#    VettidOrgRelayStack must show seven [+] AWS::SSM::Parameter and nothing else.
npx cdk deploy VettidOrgPushDataStack VettidOrgRelayStack $P --exclusively
#    Output StagingZoneNameServers: four ns-*.awsdns-* names.
#    Confirm the "VettID push gateway alarms" subscription email (admin@vettid.org).
# 2. Delegation (staging account). Put into cdk.json "context", with pushStages:
#      "pushStages": "staging",
#      "stagingPushZoneNs": "ns-a.awsdns-xx.org,ns-b.awsdns-xx.co.uk,ns-c.awsdns-xx.com,ns-d.awsdns-xx.net"
#    commit it (PR), then:
npx cdk deploy VettidOrgStagePushDelegationStack -c stage=staging --profile vault-staging --exclusively
dig +short NS push.staging.vettid.org      # the four names; the certificate cannot validate before
# 3. The blob keys secret, created by hand under the key (pushctl: `make build`
#    in vettid-push). pushctl's output is the secret: it goes through the pipe
#    and is never on the screen, in a file or in the shell history. The command
#    prints the new secret's ARN only.
pushctl blob-keys new | aws secretsmanager create-secret \
  --name vettid-org/staging/push/blob-keys --kms-key-id alias/vettid-org-push \
  --description 'VettID push gateway (staging): wake-blob keys {current, keys}, from pushctl blob-keys' \
  --secret-string file:///dev/stdin --query ARN --output text
#    Check the key (a secret without --kms-key-id is under the account's default
#    key, which is not this one) and that the value parses; neither prints it.
aws secretsmanager describe-secret --secret-id vettid-org/staging/push/blob-keys --query KmsKeyId --output text   # alias/vettid-org-push
aws secretsmanager get-secret-value --secret-id vettid-org/staging/push/blob-keys --query SecretString --output text \
  | pushctl blob-keys list                                                                                          # key ids only
# 4. The service: no platform yet (no credentials exist), so only blob keys are needed.
npx cdk deploy VettidOrgPushStack $P -c stagingPushImage=ghcr.io/vettid/vettid-push@sha256:<digest> --exclusively
curl -s -o /dev/null -w '%{http_code}\n' https://push.staging.vettid.org/v1/health     # 200
# 5. Commit "stagingPushImage" in cdk.json (PR).
```

If step 4 fails, the tasks did not start: the circuit breaker stops the
deployment and CloudFormation rolls the stack back (first time: deletes
it). The reason is the last lines of `/vettid-org/staging/push-service`
(`aws logs tail /vettid-org/staging/push-service --since 30m`): usually a
missing or malformed secret. Fix it and deploy again.

**Production** later: `pushStages` `staging,prod` (the data stack adds
production's log group; the key and the staging resources do not change),
create `vettid-org/prod/push/blob-keys` as in step 3 (`pushctl blob-keys
new` again: **a different key from staging's**), then deploy with
`pushImage`. Its record and certificate validation are in vettid.org
itself; nothing is delegated.

### Recovering from a failed first deployment of the data stack

A stack whose **first** create fails ends in `ROLLBACK_COMPLETE`: it holds
nothing and can only be deleted. `cdk deploy` would delete it by itself,
but this stack has termination protection, so:

```bash
S=VettidOrgPushDataStack
aws cloudformation describe-stacks --stack-name $S --query 'Stacks[0].StackStatus' --output text      # ROLLBACK_COMPLETE, or stop here
# What the rollback kept (DeletionPolicy Retain is honoured on a rollback too). Note the ids.
aws cloudformation describe-stack-events --stack-name $S --output text \
  --query 'StackEvents[?ResourceStatus==`DELETE_SKIPPED`].[ResourceType,PhysicalResourceId]'
aws cloudformation update-termination-protection --stack-name $S --no-enable-termination-protection
aws cloudformation delete-stack --stack-name $S
aws cloudformation wait stack-delete-complete --stack-name $S
```

Then remove what was kept, **before** deploying again. Otherwise the retry
fails on the log group's name ("already exists"), and it would create a
second key and a second zone next to the orphans:

```bash
aws logs delete-log-group --log-group-name /vettid-org/staging/push-service      # empty: no service has run
# The zone (only its NS and SOA are left). Safe only while step 2 has not delegated to it.
aws route53 list-hosted-zones-by-name --dns-name push.staging.vettid.org \
  --query 'HostedZones[?Name==`push.staging.vettid.org.`].Id' --output text
aws route53 delete-hosted-zone --id <zone id>
# The key: it has no alias (the alias was rolled back), so take its id from the
# events above. Check the description, then schedule the deletion.
aws kms describe-key --key-id <key id> --query 'KeyMetadata.[Description,KeyState]' --output text
aws kms schedule-key-deletion --key-id <key id> --pending-window-in-days 7
# Nothing of the name may be left: both print nothing.
aws kms list-aliases --query 'Aliases[?AliasName==`alias/vettid-org-push`].AliasName' --output text
aws logs describe-log-groups --log-group-name-prefix /vettid-org/staging/push-service --query 'logGroups[].logGroupName' --output text
```

Then start again at step 1. This applies to the first create only: once the stack exists, a failed
update rolls back to the previous state and nothing is left over. A failed
`VettidOrgPushStack` create needs none of this: it has no termination
protection and retains nothing, so `cdk deploy` replaces it.

### Filling the FCM and APNs secrets

Values go straight from their source into Secrets Manager: never through
the repository, a chat or the shell history. The **first** time a secret is
created (`create-secret … --kms-key-id alias/vettid-org-push`, as below);
replacing its value later is `put-secret-value --secret-id <name>` with the
same `--secret-string` (the secret keeps its key). Then list the platform
and deploy (a new task definition: the tasks restart and read the secret).

```bash
new_secret() { aws secretsmanager create-secret --name "vettid-org/staging/push/$1" --kms-key-id alias/vettid-org-push \
  --description "VettID push gateway (staging): $2" --secret-string "$3" --query ARN --output text; }
# FCM, the fallback: the service-account JSON key (PUSH-GATEWAY §14.1 item 1.4).
new_secret fcm 'FCM service-account key' file://<the downloaded key>.json
shred -u <the downloaded key>.json
# FCM, recommended (§10.3): Google's workload identity federation configuration
# for AWS (`gcloud iam workload-identity-pools create-cred-config … --aws`), which
# holds no secret. The pool trusts the task role, stack output TaskRoleArn
# (arn:aws:iam::449757308783:role/vettid-org-staging-push-gateway). It has no
# project_id: deploy with -c stagingPushFcmProject=vettid-staging.
new_secret fcm 'FCM workload identity federation configuration' file://<cred-config>.json

# APNs: {team_id, key_id, p8}. The .p8 downloads once (§14.1 item 2.3); the same key serves both channels.
jq -n --arg team_id <TEAM ID> --arg key_id <KEY ID> --rawfile p8 AuthKey_<KEY ID>.p8 '{team_id: $team_id, key_id: $key_id, p8: $p8}' \
  | new_secret apns 'APNs authentication key {team_id, key_id, p8}' file:///dev/stdin
shred -u AuthKey_<KEY ID>.p8

aws secretsmanager describe-secret --secret-id vettid-org/staging/push/fcm --query KmsKeyId --output text    # alias/vettid-org-push
npx cdk deploy VettidOrgPushStack --exclusively       # with "stagingPushPlatforms": "fcm" (later "fcm,apns") in cdk.json
```

### Rotation

Tasks read the secrets **at start only**: every change below takes effect
with the next deployment of the service, which is rolling (no downtime).
A rotation is a new **value** of the same secret (`put-secret-value`), in
the owner's session; the secret's ARN, and so the task role's permission,
does not change. Do not delete and recreate a secret to change it: a
deleted secret's name stays taken for its recovery window (7 to 30 days;
`restore-secret` undoes a deletion within it).

```bash
restart() { aws ecs update-service --cluster vettid-org-relay --service "$1" --force-new-deployment --query 'service.deployments[0].rolloutState'; }
S=vettid-org/staging/push/blob-keys
# Yearly: a new current blob key. Retired keys stay and still open blobs (the vault gets a reseal).
aws secretsmanager get-secret-value --secret-id $S --query SecretString --output text \
  | pushctl blob-keys rotate \
  | aws secretsmanager put-secret-value --secret-id $S --secret-string file:///dev/stdin
restart vettid-org-staging-push          # production: vettid-org-push
# 400 days after a rotation: delete the retired key (the secret holds no dates; put it on the calendar).
aws secretsmanager get-secret-value --secret-id $S --query SecretString --output text | pushctl blob-keys list
aws secretsmanager get-secret-value --secret-id $S --query SecretString --output text \
  | pushctl blob-keys drop <key id> \
  | aws secretsmanager put-secret-value --secret-id $S --secret-string file:///dev/stdin
```

- **APNs key**, yearly: create the second key at Apple (two may be active),
  put it in both channels' `apns` secrets, `restart` both services, check
  that wakes are `sent`, then revoke the old key at Apple.
- **FCM service-account key** (only without federation): new key in the
  secret, `restart`, delete the old key in Google Cloud.
- **A new image**: change the digest (staging first), deploy
  `VettidOrgPushStack`. The KMS key rotates its own material yearly.

### Alarms

All go to the topic `vettid-org-push-alerts` → admin@vettid.org (a topic
of its own: when it was made `vettid-org-security-alerts` accepted
EventBridge only; since #214 that topic admits its account's CloudWatch
alarms too). Names are
`vettid-org[-staging]-push-<name>`. The gateway's metrics are in the
namespace `vettid-org/<stage>/push`; the sums the alarms need over every
platform are metric filters on its metric lines
(`vettid-org/<stage>/push/alarms`).

| Alarm | Fires when | Do |
|---|---|---|
| `provider-auth` | any wake was refused for the gateway's credentials (APNs `403`, FCM `401`/`403`) in 5 minutes | The secret is wrong, revoked or expired, or (federation) the Google pool no longer trusts the role. Fix the secret, `restart`. |
| `provider-unavailable` | more than 5 % of wakes answered `provider_unavailable` for 10 minutes | FCM or APNs is down or throttling (their status pages); vaults retry. Nothing to deploy unless it lasts. |
| `internal` | any `500 internal` in 5 minutes | A bug or a broken task: read the log group; roll back the image if it began with a deploy. |
| `manifest-refresh` | for an hour every refresh failed (`manifest_refresh{outcome=error}` and no `ok`) | The channel's manifest site is unreachable or serves a document that does not verify. The last good manifest stays trusted: a new release cannot register, a retired one still can. |
| `attestation-failures` | more than 25 refused attestations in an hour (`attestation_failures`, by `reason`) | `pcr0`: a retired release still registering (expected briefly after a retirement). `chain`, `signature`: forged documents. `stale`: clocks. The threshold is a starting value (`PUSH_ATTESTATION_FAILURES_PER_HOUR`). |
| `no-healthy-task` | the load balancer has had no healthy task for 3 minutes | The gateway is down: `aws ecs describe-services --cluster vettid-org-relay --services vettid-org-staging-push`, then the log group. Also sends OK. |

The log holds starts, stops and throttled errors only, never a request
(PUSH-GATEWAY §10.5), and the load balancer's access and connection logs
are off. **Keep them off**: they are per load balancer, so turning them on
for the relay would log every push request too (source address, time).

## Vault (V5; docs/VAULT-RELEASES.md)

Staging has published releases (S1 and S2, now `removed`, and S3,
`active` since manifest serial 4); production has no release and no
release key yet (release 1: docs/W10-READINESS.md).
Per vault account there are three kinds of stack (VAULT-RELEASES §8.2),
deployed in this order with that account's profile:

1. `VettidOrgVaultStack`: stateful (tables, data bucket, fixed roles, keys).
2. `VettidOrgVaultHostStack`: stateless (VPC, DNS Firewall, build VPC and
   Image Builder infrastructure, DLQ, host log group, smoke-test key,
   scaler, manifest sync, alarms, among them those on the parent's
   metrics). Reads the stream ARN from (1) via SSM.
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
- The vault data bucket (`vettid-org[-staging]-vault-data-<account>`):
  there is no export and no snapshot, so its lifecycle rule, its
  versioning and its bucket policy are what stands between a mistake and
  every member's vault. The same SCP denies changing them, and deleting
  the bucket, to everyone but CloudFormation's CDK execution role; every
  such call, a deploy's included, is emailed (`VaultDataBucketConfig`,
  "Security alerts"). Change them only in `lib/stacks/vault-stack.ts`.
- The recovery attempt counter bucket (`vettid-org-vault-recovery-<account>`,
  from vault release R): Object Lock in compliance mode. Once it exists it
  **can never be deleted, by anyone**, and its locked objects cannot be
  deleted or shortened until their dates (in production 100 years for
  most of them; in staging at most 1 day after the write, or the end of
  a longer wait).
  The vault release pins its exact name and account. See "Recovery from
  release R" below.
- The recovery request key (`alias/vettid-org-recovery-request`, staging
  `alias/vettid-org-staging-recovery-request`; in `VettidOrgDataStack`
  of the member API's account): vault releases pin its public key and key
  id. Never schedule its deletion or disable it while a live release pins
  it; a replacement is pinned beside it for one release first.
- Break-glass for any of this: detach or edit `vettid-vault-key-protection`
  from the management account.

### Creating a release key

A key per entry of `vault/releases/<channel>.json` (W7): add release N
with `status: "candidate"`, its PCR0–2, `seal_key: ""`, `notes` (production:
`https://vettid.org/security/releases/<N>/`) and `admitted_pcr0s` = the
PCR0s of every earlier release not `removed`, **and of every `removed`
release that can still be rescued**: one whose `ends_at` is less than
the channel's deletion window ago (30 days in production, 7 in
staging). Never changed afterwards. Why the removed ones: a rescued
vault can only move into an `active` release whose key admits it, so a
key that leaves them out ends their rescue the day its release is
published (VAULT-RELEASES 0.1.24 §3.5, §6.2; owner decision of
2026-10-13). `npm test`, CDK synth and `npm run check:manifest` validate
the file. While `seal_key` is empty they refuse a list that leaves one
of those releases out. A list that names too much, a `removed` release
whose window is over or that has no `ends_at` (a failed canary), is
reported by `npm run check:manifest` and `vault:manifest sign` only:
CDK synth and `npm test` do not fail for it, so no command of the
channel stops working because a window ended. The list is judged at
the time of the check, so write the entry, create the key (step 2) and
write its ARN (step 3) on the same day. If `check:manifest` reports a
release named too much before the key is created, take it out of the
list; if the key already exists with that list, write its ARN (the
extra release is harmless to the key check, but the manifest must list
it while the key lives).

Staging releases 1 to 11 have keys from before this rule. Release 11's
key admits 7 to 10 only, so staging 3 to 6 (removed 2026-10-13) could be
rescued only into release 10, only while it was `active`; release 11 is
`active` since 2026-10-13, so they have no target any more. Their keys
are deleted on 2026-10-20 (release 3's some hours after the others: its
deletion was scheduled again after the rescue rehearsal of 2026-10-13).

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

**Production release 1 is kept for 90 days, not 12 months** (VAULT-RELEASES
0.1.11 §3.5, owner decision D2; release 1 only). Its entry in
`vault/releases/prod.json` carries `"ends_after_days": 90` from the
release entry PR on (W10-READINESS §3 step 5). The member belongs to the
release list alone: it is never in the manifest, the image or the log's
`index.json`. What follows from it:

- The validation (CDK synth, `npm test`, `check:manifest`,
  `vault:manifest`) refuses a production release 1 entry without it
  (W10-READINESS B12), accepts the member only on production release 1
  and only as 90, and then refuses an `ends_at` on release 1 earlier than 90
  days after release 2's `published_at`. A later date passes.
- Release 1 is never `deprecated`: in the same edit that makes release 2
  `active` (T0), set release 1 `retired` with `ends_at` = release 2's
  `published_at` + 90 days, and sign and publish that manifest. The
  notice job then sends email 1 on its next run and the others at 30, 7
  and 1 days.
- Until then release 1's log page says "End date: Not set (90 days after
  a newer release replaces it)"; every other release says 12 months.
- The 30 days of `schedule-key-deletion` above are another window
  (`retirement_window_days`) and stay 30.

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

### The parent's metrics and their alarms (from staging S11; VAULT-RELEASES §8.7)

From the release that includes vettid-vault f3003ed (staging S11) each
host's parent writes one record a minute to its log
(`/vettid-org/<stage>/vault-host`, stream `<instance id>/vault-parent`,
`"msg":"metrics"`) in CloudWatch's embedded metric format; CloudWatch
takes 13 metrics from it into the namespace `VettID/Vault` with the one
dimension `InstanceId` (9 while no enclave is connected: the four
`Relay…` metrics come from the enclave). Hosts of earlier releases write
none. The record also carries plain fields (`relay_conns`,
`relay_streams`, `relay_waiting`, …) that are searchable in the log but
are not metrics.

**Check after a release from S11 on is deployed** (staging shown; an
instance of the release must be running, a few minutes):

```bash
P="--profile vault-staging"; G=/vettid-org/staging/vault-host
# 1. The record is in the log (the newest one; expect the 13 names, InstanceId and _aws).
aws logs filter-log-events $P --log-group-name $G --filter-pattern '{ $.msg = "metrics" }' \
  --start-time $(( ($(date +%s) - 600) * 1000 )) --query 'events[-1].message' --output text | python3 -m json.tool
# 2. CloudWatch took the metrics from it: 13 names (a new metric can take
#    some minutes to be listed; --recently-active PT3H leaves out old instances).
aws cloudwatch list-metrics $P --namespace VettID/Vault --dimensions Name=InstanceId --recently-active PT3H \
  --query 'Metrics[].MetricName' --output text | tr '\t' '\n' | sort -u
#    Expect: EgressOpenKMS EgressOpenOther EgressOpenPush EgressOpenRelay
#    EgressOpenedKMS EgressOpenedOther EgressOpenedPush EgressOpenedRelay
#    RelayGrowthRefused RelayRequestErrors RelayRequestsInFlight
#    RelayStreamWaitMax UnlockedVaults
# 3. A value, as the alarms read it (the worst instance of the last 15 minutes).
aws cloudwatch get-metric-data $P --start-time $(date -u -d '15 min ago' +%FT%TZ) --end-time $(date -u +%FT%TZ) \
  --metric-data-queries '[{"Id":"q","Expression":"SELECT MAX(UnlockedVaults) FROM SCHEMA(\"VettID/Vault\", InstanceId)","Period":60}]' \
  --query 'MetricDataResults[0].[Timestamps,Values]'
# 4. The alarms: all OK (INSUFFICIENT_DATA only while no S11 host has run).
aws cloudwatch describe-alarms $P --alarm-name-prefix vettid-org-staging-vault- \
  --query 'MetricAlarms[].[AlarmName,StateValue,StateReason]' --output table
```

Console: CloudWatch → Metrics → All metrics → Custom namespaces →
`VettID/Vault` → `InstanceId` (the metrics, per instance); CloudWatch →
Alarms → All alarms, search `vault-`. Production: `--profile vault-prod`,
`/vettid-org/prod/vault-host`, prefix `vettid-org-vault-`.

If step 1 shows records and step 2 lists nothing after 15 minutes,
CloudWatch does not read the record as metrics: look at the log group's
`EMFValidationErrors` and `EMFParsingErrors` (namespace `AWS/Logs`,
dimension `LogGroupName`), and at one raw event: its message must be
the JSON document alone, with nothing before the `{`. The fix would be
in vettid-vault (`parent/metrics.go`, or the agent's configuration in
`deploy/host`), so in the next release; the stack has nothing to
change. If step 1 shows nothing, the parent is not running, is older
than S11 or the agent is not shipping (`…/vault-host-config` stream).

| Alarm (`vettid-org[-staging]-vault-…`) | Fires when | Then |
|---|---|---|
| `unlocked-vaults` | an instance holds more than 400 unlocked vaults for 5 minutes | capacity: about 900 fit (VAULT-RELEASES §8.8); the release's `max_instances`, the scaler's caps |
| `relay-in-flight` | an instance has more than 1,638 relay requests in flight (80 % of 16 connections × 128 streams) for 3 minutes | more than a host's vaults can need (at most 1,024 long-polls): look for vault processes at their limit (`relay_vault_limit` in the record) and at the relay |
| `relay-stream-wait` | a relay request waited more than 1 s for a stream | the record's `relay_conns`, `relay_streams`, `relay_waiting`; the relay's load balancer (rejected connections, 5xx) |
| `relay-growth-refused` | requests waited because a bound forbade another connection | which bound: `relay_refused_max_conns` (16 connections) or `relay_refused_min_streams` (the relay announces fewer than 32 streams: "Relay" below, the stream limit check) |
| `relay-connection-churn` | in an hour more than 64 relay connections were opened, summed over every instance (ordinary: 8 to 16 an hour per host, the load balancer's hourly close) | the relay or its load balancer is closing connections: `aws logs tail` the relay service; `EgressOpenedRelay` against `EgressOpenRelay` per instance in the console. With five or more busy hosts the ordinary close alone passes 64: raise `relayOpenedPerHour` (`lib/stacks/vault-host-stack.ts`) |
| `relay-stream-limit` | twice in 3 minutes a record had requests waiting while `relay_streams` read 0 or 100 | the relay's front end must announce 128, never exactly 100 ("Relay", the stream limit check) |

The first five are Metrics Insights queries over every instance (no
alarm names an instance; one query per alarm, CloudWatch refuses a
second: "Invalid metrics list"); the last reads the log through the metric
filter `RelayStreamLimitSuspect`. To see that an alarm reaches the
admin inbox (it changes nothing but the alarm's state, which the next
evaluation sets back):
`aws cloudwatch set-alarm-state $P --alarm-name vettid-org-staging-vault-relay-stream-wait --state-value ALARM --state-reason test`,
then
`aws cloudwatch describe-alarm-history $P --alarm-name vettid-org-staging-vault-relay-stream-wait --history-item-type Action --max-items 1 --query 'AlarmHistoryItems[].HistorySummary'`:
"Successfully executed action …", not "not authorized to perform:
SNS:Publish" (the topic admitted only the CloudTrail rules until the
host stack that added these alarms was deployed; an alarm that fired
before that deploy did not notify).

### The data bucket's old versions and its size alarm

The data bucket (`vettid-org[-staging]-vault-data-<account>`,
`VettidOrgVaultStack`) is versioned. A vault's state is one object,
`vaults/<vault_id>/state`, rewritten in full at every change (with its
header, `vaults/<vault_id>/header/<pcr0>`), so a busy vault leaves
hundreds of old versions a day and they are nearly all of the bucket's
bytes. Nothing reads an old version: the hosts read and write the current
one only (conditional writes), and an old version is there for an
operator to restore by hand (VAULT-RELEASES §8.2, §11.4).

Two lifecycle rules, over every key (`VAULT_DATA_VERSIONS` in
`lib/stacks/vault-stack.ts`); S3 removes a version as soon as either
allows it:

1. No old version is kept more than **7 days** after it was replaced or
   deleted; a delete marker goes once nothing is left under it;
   unfinished multipart uploads go after a day. This is the rule the
   bucket has had from the start.
2. An old version goes **1 day** after it was replaced, unless it is one
   of the **5 newest** old versions of its object (owner, 2026-10-13).

S3 counts from the moment a version was replaced, rounds up to the next
midnight UTC and removes some time after that, so "1 day" is between 24
and 48 hours, and a little more.

| Object | What is kept beside the current version |
|---|---|
| Of an idle vault (no write for a week) | nothing: its 5 newest old versions went when they reached 7 days |
| Of a vault written 600 times a day | every version of the last 24 to 48 hours (600 to 1,200 of them), and nothing older. The 5 newest are always among those, so the count of 5 changes nothing for such a vault: the 1 day is what bounds it |
| Of a vault written a few times a week | the 5 newest old versions, each for at most 7 days |
| Of a deleted vault | all it wrote in its last 24 to 48 hours, then its 5 newest versions, until 7 days after the deletion; then the delete marker goes too. The same bound as before: rule 1 is what removes them, rule 2 alone would keep those 5 for ever |

What this gives up: an operator could restore any state of the last 7
days and can now restore any state of the last 24 hours, plus the 5
versions before that. For a busy vault those 5 are seconds or minutes of
history, not days. The 24 hours are therefore the time there is to notice
a fault that damages state at every write (a bad release, an operator
error) and still find a good version: a fault noticed on the second day is
too late for a vault that kept writing. State and header are written
together and restored together (the header names the state it belongs
to), so both have the same rule; restoring means editing the bucket
policy first (it denies `vaults/*` to everyone but the host role) and
shows in the app as a rollback (VAULT-RELEASES §13.2).

To see the rules and that they work (read-only; the size is S3's daily
metric, a day or so late, and it counts every version):

```bash
P="--profile vault-staging"; B=vettid-org-staging-vault-data-347272280361
aws s3api get-bucket-lifecycle-configuration $P --bucket $B
aws cloudwatch get-metric-statistics $P --namespace AWS/S3 --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=$B Name=StorageType,Value=StandardStorage \
  --start-time "$(date -u -d '10 days ago' +%FT00:00:00Z)" --end-time "$(date -u +%FT%TZ)" \
  --period 86400 --statistics Maximum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Maximum]' --output table
# NumberOfObjects (StorageType=AllStorageTypes) counts versions and delete markers too.
```

After a deploy that changes the rules, S3 needs up to two days to act on
them; the size then falls over the following days.

**Alarm `vettid-org[-staging]-vault-data-bucket-size`** (host stack, to
the vault alerts topic like the others): the bucket holds more than
10 GiB (`VAULT_DATA_BUCKET_ALARM_BYTES` in
`lib/stacks/vault-host-stack.ts`; staging held about 7.4 GB under the
7-day rule on 2026-10-13). When it fires:

1. Look at the size over the last days (the command above). A step up
   over one or two days is a vault writing more or larger state than
   before; a slow rise is more vaults.
2. Check that both lifecycle rules are there and `Enabled`. A bucket
   whose rules were removed or disabled grows without bound.
3. Find what writes: the parent's metrics and the host log say which
   instance is busy; the storage metric does not say which vault. A
   vault that rewrites its state in a loop is a bug to report in
   vettid-vault, not something to fix in the bucket.
4. If the growth is ordinary (more vaults), raise the threshold. A vault
   costs about its state's size times the writes of one to two days.

Do not delete versions by hand to make room: the bucket policy forbids
it to everyone but the host role, and the 24 hours of versions are the
only way back from a fault that damages state.

**A vault nobody can unlock after a change of PIN, password or phone**
(vault release R; VAULT-MESSAGING 0.33.0 §11.14.2; wording for the
owner's approval). From release R a change of the DEK writes the header,
then the state, then the header again. If the store confirmed the first
header write but did not keep it, and the state write was kept, the
stored header and state no longer belong together and **no phone can
unlock**, and a recovery is answered `stored_mismatch` (the member's
apps see failed unlocks; a transfer's new phone never finishes the
move). The state to restore is **the last version written before the
failed change**: find it by time (just before the member's change) and
check its clear header (`dek_version`, the eight bytes after the
format byte `0x02` and `state_seq`): take the version with the highest
`dek_version` below that of the newest versions (the operator cannot
read the sealed header, and does not need to). Do not simply take "the newest old
version". By rule 2 above it lasts **at least 24 hours** after the
failure, and up to 7 days only while the state object has been written
fewer than 5 times since (rule 1 removes it at 7 days in any case).
Act within 24 hours:

1. Confirm with the member which change failed and when. Afterwards the
   member needs, for a PIN or password change, the phone that made it
   (with the old PIN); for a transfer, the **old** phone (which keeps its
   keys until the new phone has unlocked and the vault's notice reaches
   it, or from day 7 until its vault answers), or, with
   the credential backup on, a recovery after the restore (a new phone,
   the PIN and the password, after the quiet period).
2. Make sure no instance holds the vault unlocked: send the host's
   `lock` for it, and check that the vault row is `locked` with no lease
   (VAULT-MESSAGING §11.5). A running vault would overwrite the restore
   with its next flush.
3. Lift the bucket policy's denial for this one key (as for any restore),
   copy the chosen state version back as the current version (`aws s3api
   copy-object --copy-source "$B/vaults/<vault_id>/state?versionId=<id>"`),
   and put the policy back. Do not touch the header.
4. Reset the vault row's `app_key` to the key the current (old) header
   names, with its `app_key_seq`, and remove `app_key_next`, so that
   the member API accepts the old phone again (it otherwise accepts a
   new key only with a higher `app_key_seq`).
5. The member uses "The move didn't finish" on the old phone (for a
   change of PIN or password: unlocks with the PIN of before the change)
   and repeats the change (for a transfer: approves a new one). The old
   phone never saw the newer state, so its minimums pass and it sees no
   rollback; the new phone is no device of the restored state and is
   refused.

After the earlier state is gone the vault cannot be opened by anyone,
recovery included, whatever its credential backup setting: the member
can only start over. The new phone of a failed transfer gets unreadable
answers after a restore; its app says "This phone is not your vault's
phone any more. Use your old phone, or recover your vault."  Never do this for a vault whose member did not ask:
it undoes the member's change.

### Vault attachment sweep (P15; from the vault's attachments release, "release A")

Photos sent in messages are stored as objects of their own,
`vaults/<vault_id>/att/<att_id>` and `…/<att_id>.t` (thumbnail),
encrypted under keys that only the vault's state holds. A vault that
deletes itself deletes them; a vault erased without its key (for example
an account cancelled while its release cannot start) cannot find them. So
after the parent marks a vault's row `deleted` it deletes every object
under `vaults/<vault_id>/att/` itself, and retries until the prefix is
empty (VAULT-HOST-PROTOCOL §12 P15, 0.1.11):

- The update that marks the row `deleted` also sets
  `att_sweep_pending = true` on it; the parent removes the attribute when
  a listing of the prefix comes back empty.
- A parent's start scans the vaults table for rows with
  `att_sweep_pending` and resumes those sweeps (a restart, a replaced
  instance or another release's host picks them up).
- The `vault-alarms` job keeps the row while the attribute is set (it
  sends the deletion email and removes the pointer row as before), and
  removes it when the parent's removal of the attribute comes through the
  stream (MEMBER-API 2.7.1).
- Permissions (in `VettidOrgVaultStack`): the host role lists the whole
  bucket and deletes under `vaults/*` (both unchanged), may write
  `att_sweep_pending`, and may Scan the vaults table for `vault_id` and
  `att_sweep_pending` only. Hosts of a release before release A neither
  set nor sweep anything.

**Check** (staging shown; production: `--profile vault-prod`, the table
`vettid-org-vaults` and the bucket `vettid-org-vault-data-369484479783`).
A sweep normally ends within seconds of the deletion, so a pending row
older than an hour, or any pending row with no host running, needs a
look.

```bash
P="--profile vault-staging"; T=vettid-org-staging-vaults; B=vettid-org-staging-vault-data-347272280361
G=/vettid-org/staging/vault-host
# 1. Sweeps not finished: rows that still record one (expect none, or only very recent deletions).
aws dynamodb scan $P --table-name $T --filter-expression 'attribute_exists(att_sweep_pending)' \
  --projection-expression 'vault_id, #s, updated_at' --expression-attribute-names '{"#s":"state"}' --output table
# 2. For one of them: what is left under its prefix (listing is allowed to operators;
#    reading the objects is not, by the bucket policy).
V=<vault_id>; aws s3api list-objects-v2 $P --bucket $B --prefix "vaults/$V/att/" --query 'KeyCount'
# 3. What the parents said about it (the last day).
aws logs filter-log-events $P --log-group-name $G --filter-pattern "\"attachment sweep\" \"$V\"" \
  --start-time $(( ($(date +%s) - 86400) * 1000 )) --query 'events[].message' --output text
# 4. A deleted vault's row whose sweep is done but which the job did not remove (expect none):
aws dynamodb scan $P --table-name $T --filter-expression '#s = :d AND attribute_not_exists(att_sweep_pending)' \
  --expression-attribute-names '{"#s":"state"}' --expression-attribute-values '{":d":{"S":"deleted"}}' \
  --projection-expression 'vault_id, updated_at, alarm' --output table
```

Log lines (the parent, stream `<instance id>/vault-parent`):
`attachment sweep` (a pass, with how many it deleted), `attachment sweep
done`, `attachment sweep incomplete` and `attachment sweep: row not read`
or `record not removed` (retried, 5 s doubling to 5 minutes), `attachment
sweep stopped: the vault is no longer deleted` (the vault id was enrolled
again; nothing more to do), `pending attachment sweeps not read` (the
start's scan failed; retried, most likely a permission: check the host
role's `dynamodb:Scan` statement).

**What to do.**

- *Pending, a host running, `incomplete` repeating:* the error in the
  line says why (an S3 `AccessDenied` is the host role's grants or the
  bucket policy; compare with `lib/stacks/vault-stack.ts` and the drift
  check). The parent keeps retrying; once fixed, it finishes by itself.
- *Pending, no host running* (the scaler stopped every group): the sweep
  resumes at the next host's start. Nothing is lost meanwhile: the
  objects are encrypted under keys the deletion destroyed. Starting a
  host of the active release (a start request, "How the scaler works")
  makes it finish sooner.
- *Pending, no objects left (step 2 says 0) and no parent finishing it:*
  remove the record by hand; the job then removes the row:
  `aws dynamodb update-item $P --table-name $T --key '{"vault_id":{"S":"<vault_id>"}}' --update-expression 'REMOVE att_sweep_pending' --condition-expression '#s = :d' --expression-attribute-names '{"#s":"state"}' --expression-attribute-values '{":d":{"S":"deleted"}}'`.
- *Step 4 lists a row:* if its `alarm` has `handled_at`, the stream's
  retries ran out; delete it by hand
  (`aws dynamodb delete-item $P --table-name $T --key '{"vault_id":{"S":"<vault_id>"}}' --condition-expression '#s = :d AND attribute_not_exists(att_sweep_pending)' …`).
  Without `handled_at` the deletion email has not been handled yet
  (`alarm_pending` set) or was never recorded: see "Vault alarms" in
  MEMBER-API and the `vault-alarms` function's log first.
- Never delete objects under another vault's prefix, and never delete a
  row that is not `deleted`.

### Recovery from release R: the counter bucket, the request key and the deploy order

*Vault release R (VAULT-MESSAGING 0.33.0 §11.14; VAULT-HOST-PROTOCOL
0.1.11 §8.1, P16 to P18; MEMBER-API 2.7.0; VAULT-RELEASES 0.1.29 §5.2,
§8.2, §8.4). Built in vettid.org and vettid-vault; **not deployed**. Nothing
here is done before the owner has decided the point below.*

Release R keeps each vault's recovery attempts outside everything the host
stores: as objects in an S3 bucket under **Object Lock in compliance
mode**, which the enclave writes, locks and reads back over its own TLS.
The member API signs every `recovery` and `recovery_cancel` with a KMS key
that the release pins. Three pieces, each in its own stack:

| Piece | Stack and account | Name |
|---|---|---|
| Counter bucket | `VettidOrgVaultStack`, the vault account | `vettid-org-vault-recovery-347272280361` (staging), `vettid-org-vault-recovery-369484479783` (prod) |
| Its host name on the DNS Firewall | `VettidOrgVaultHostStack`, the vault account | `<bucket>.s3.us-east-1.amazonaws.com` |
| Recovery request key | `VettidOrgDataStack`, the member API's account | `alias/vettid-org-staging-recovery-request` (staging, 347272280361), `alias/vettid-org-recovery-request` (prod, 449757308783) |
| Signing, `POST /api/vault/recovery/open`, the new slot members | `VettidOrgMemberApiStack`, the member API's account | |

**Owner's decision before the first deploy: the bucket is irreversible.**
Creating the counter bucket cannot be undone, and this is meant:

- Object Lock is enabled when the bucket is created and can never be
  turned off; versioning can never be suspended.
- The enclave writes every record with a **compliance-mode** lock: tokens,
  success and close records for **100 years** in production and **1 day**
  in staging, wait records until the wait ends, presence records for 96
  hours. The period is part of the measured vault release for each
  channel; nothing the host or an operator sends can change it. AWS documents that no user can
  shorten or remove a compliance lock, **including the account's root
  user**, and that a version under such a lock cannot be deleted.
- So in production, once the first vault of release R has written a
  record, the bucket can never be emptied and therefore **never be
  deleted**, the objects in
  it can never be deleted before their dates, and closing the AWS account
  is the only way to remove them (and it removes every vault with them,
  VAULT-MESSAGING §11.14.4). The name is pinned in the release
  (`recovery_counter`), so it can never be renamed either.
- In staging (owner's decision, 2026-10-16) the records are locked for
  1 day, so once no vault writes any more, every lock ends within a day
  (or at the end of the longest wait, at most 30 days) and the staging
  bucket can then be emptied and deleted. Staging therefore does not test
  the 100-year period itself; everything else is the same.
- Storage costs are tiny (32-byte objects), but they run for as long as the
  account exists.
- Until the first locked write the bucket is still an ordinary, empty
  bucket and **can** be deleted (empty it, then delete it; versioning and
  Object Lock do not prevent deleting an empty bucket). After that first
  record it never can. A bucket created by mistake must therefore be
  removed before release R's hosts run against it.

Production's bucket is needed only for a production release that offers
recovery (`recovery_offered: true`); production release 1 may ship with
recovery refused (VAULT-RELEASES §12). The owner may therefore decide to
create staging's bucket now and production's later; the CDK creates both
whenever `VettidOrgVaultStack` is deployed to each account, so hold the
production vault stack deploy until then.

**The bucket, as built** (`lib/stacks/vault-stack.ts`; tested in
`test/vault-stack.test.ts`): Object Lock enabled at creation, **no default
retention**, versioning, Block Public Access, SSE-S3, bucket-owner
enforced, TLS only (bucket policy), RETAIN. One lifecycle rule: a version
that has been **noncurrent** for 30 days is removed if its lock has
ended (S3 never removes a locked version), plus incomplete multipart
uploads after a day; no rule touches a current version, so a vault's
newest presence record (the marker's current version) is never removed.
The host role `vettid-org-vault-host` may call exactly
`s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObjectVersion` and
`s3:GetObjectRetention` on `<bucket>/*` and `s3:ListBucketVersions` on the
bucket: no delete, bypass-governance, legal-hold or configuration
permission (P18). The S3 gateway endpoint's policy already admits every
bucket of the vault account (`aws:ResourceAccount`). The host role may
also write `app_key_next` on the vaults table and the slot members
`not_before`, `expires`, `earliest`, `retry_at` and `reason`.

**The request key, as built** (`lib/stacks/data-stack.ts`; tested in
`test/account-admin-stacks.test.ts`): ECDSA P-256, `SIGN_VERIFY`, RETAIN.
Its policy lets the account administer it but not sign; allows `kms:Sign`
(ECDSA_SHA_256 over a digest) to the member API's vault function role
`vettid-org[-staging]-member-vault` only, and denies `kms:Sign` to every
other principal; and lets the owner's permission set read the public key
(`kms:GetPublicKey`, `kms:DescribeKey`) to fill in the release's channel
files. The member API reads its ARN and key id from SSM
(`/vettid-org/<stage>/data/recovery-request-key-arn`, `-key-id`) at
deploy time, so **the member API cannot be deployed before the data
stack**.

**Deploy order** (staging first; production only after the owner's
decision above and when a production release with recovery is near):

```bash
aws sso login
# 1. Vault account: the counter bucket (IRREVERSIBLE, see above), the host
#    role's grants, the new attributes. The diff must show exactly: + the
#    bucket, its policy and an SSM ref, ~ HostRoleDefaultPolicy, + output.
npx cdk diff   VettidOrgVaultStack -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgVaultStack -c stage=staging --profile vault-staging
#    The DNS Firewall allowlist gains the bucket's host name (~ DnsAllowList only).
npx cdk diff   VettidOrgVaultHostStack -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgVaultHostStack -c stage=staging --profile vault-staging
# 2. Member API account: the request key (+ key, alias, two SSM refs, output).
npx cdk diff   VettidOrgDataStack -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgDataStack -c stage=staging --profile vault-staging
# 3. The member API (signing, the open route, the slot members): ~ the vault
#    function's policy and environment, ~ every function's code.
npx cdk diff   VettidOrgMemberApiStack -c stage=staging --profile vault-staging
npx cdk deploy VettidOrgMemberApiStack -c stage=staging --profile vault-staging
# 4. Release R's hosts: only after its channel file pins the key (below),
#    as for any release ("Adding a release").
```

In production the vault account is `--profile vault-prod` and the member
API's account the default profile (no `-c stage`).

**Smoke test after step 3** (staging): on a test vault, start a recovery
from the account site (or `POST /api/vault/recovery` with a session) and
cancel it at once. It must answer `202`, not `503 vault_unavailable`
("Recovery requests cannot be signed right now"), and the member API's
log group must show no `recovery request not signed` and no `recovery
cancel not queued`. Before release R's hosts run, the enclave ignores the
signature, so this proves only that KMS signs; with release R it also
proves the pinned key matches (a wrong key makes the enclave answer the
request with random bytes, and the recovery never shows a code).

```bash
aws logs filter-log-events --profile vault-staging \
  --log-group-name /aws/lambda/<the VaultFunction's name> --start-time $(( ($(date +%s) - 900) * 1000 )) \
  --filter-pattern '"recovery request not signed"' --query 'events[].message'   # expect []
```

**The attempt emails.** A counted attempt is mailed when the new phone
polls its open, at a status read, at the next open, or at the latest by
the 5-minute job `VaultAttemptsJob` (role `vettid-org[-staging]-member-vault-attempts`,
which scans the request table). Open slots live as long as their recovery
plus an hour, so none expires unnoticed. A notice that failed (mail,
audit or link) is retried after 5 minutes, and given up after 24 tries
(log line `recovery attempt notice abandoned`; the slot keeps
`attempt_notice_failed`). The job writes `RecoveryAttemptsUnnoticed` and
`RecoveryAttemptNoticeFailures` (namespace `VettID/MemberApi`).

Two consequences, both on the safe side:

- **A mail failure blocks opens.** Every open first notices the
  recovery's earlier counted attempts, and is refused (`503
  attempt_notice_pending`, nothing forwarded) while one of them is not
  recorded as noticed. With SES failing, opens stay refused until the
  notice succeeds or is given up (24 tries, each retried once its claim is
  5 minutes stale: about 2 hours at the job's pace). Fail-safe: no further
  attempt goes out while the member cannot be told of the last one. An SES
  outage shows as `RecoveryAttemptNoticeFailures` and `recovery attempt
  not noticed` lines; a status read still answers.
- **A mail can arrive twice, rarely:** when the send succeeded but the
  record afterwards (`attempt_noticed_at`) failed, the notice is taken up
  again after 5 minutes and mailed again. Its audit entry can likewise be
  written twice.

Check after step 1 (staging shown):

```bash
B=vettid-org-vault-recovery-347272280361; P="--profile vault-staging"
aws s3api get-object-lock-configuration --bucket $B $P   # ObjectLockEnabled: Enabled, and NO "Rule"
aws s3api get-bucket-versioning --bucket $B $P            # Enabled
aws s3api get-public-access-block --bucket $B $P          # all four true
aws s3api get-bucket-lifecycle-configuration --bucket $B $P   # NoncurrentVersionExpiration only
aws iam simulate-principal-policy $P \
  --policy-source-arn arn:aws:iam::347272280361:role/vettid-org-vault-host \
  --action-names s3:DeleteObject s3:DeleteObjectVersion s3:BypassGovernanceRetention \
                 s3:PutObjectLegalHold s3:PutBucketObjectLockConfiguration s3:PutLifecycleConfiguration \
  --resource-arns arn:aws:s3:::$B arn:aws:s3:::$B/x \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text   # every one implicitDeny
```

If `get-object-lock-configuration` ever shows a `Rule` (a default
retention), stop and tell the owner: it would lock objects the enclave did
not mean to lock, and it is not removable from objects already written.

**Filling in vettid-vault's channel files** (after step 2; a pull request
in vettid-vault, as for any release constant; VAULT-RELEASES §5.2):

```bash
A=alias/vettid-org-staging-recovery-request; P="--profile vault-staging"   # prod: alias/vettid-org-recovery-request, default profile
aws kms describe-key   --key-id $A $P --query KeyMetadata.KeyId --output text      # the key_id
aws kms get-public-key --key-id $A $P --query PublicKey --output text              # the spki (base64 DER)
aws kms get-public-key --key-id $A $P --query '[KeySpec,KeyUsage,SigningAlgorithms]'  # ECC_NIST_P256, SIGN_VERIFY, ECDSA_SHA_256
```

- In `enclave/releasecfg/staging.json` (or `prod.json`) replace the
  placeholders of `recovery_request_keys` with `{"key_id": "<KeyId>",
  "spki": "<PublicKey>"}`. The `key_id` is the KMS key id (the UUID), the
  same value the member API sends as `key_id` (its
  `RECOVERY_REQUEST_KEY_ID`); a release refuses a message whose `key_id`
  it does not pin. To replace the key later, pin the new one beside the
  old one in one release first.
- Set `android_min_version_code` to the version code of the first app
  build of release R (the Android app's own release notes give it); the
  enclave refuses an older app at a recovery's register, an enrollment
  and a transfer's `hs.init`.
- Check that `recovery_counter` names this channel's bucket and account
  (the release build refuses another channel's).

**What the member API deploy (step 3) changes for vaults of earlier
releases.** Earlier enclaves ignore the signature members. The recovering
key may no longer unlock or lock (`403`): the recovery of releases before
R (`credential.recover` after an unlock) no longer works through the API,
so an earlier-release vault on staging can only be recovered until this
deploy; staging's earlier vaults are deleted and enrolled again on release
R anyway (VAULT-MESSAGING §11.14.14). `available_at` is now marked
`earliest` until a slot of release R says otherwise. The request email has
the text of release R.

**Watching it work.** `vault.recovery_open` and `vault.recovery_attempt`
in the audit table; the member gets one email per counted attempt. A
recovery request that KMS could not sign answers `503` and writes nothing
(log line `recovery request not signed`); a cancel that could not be
signed is recorded as cancelled at the API but not queued (log line
`recovery cancel not queued`). The bucket's own records: VettID owns the
bucket and can list it (names are opaque per vault), which
VAULT-HOST-PROTOCOL §11.2 discloses.

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
   Every entry, in every channel, has `notes` = its own channel's log
   entry (`https://vettid.org/security/releases/<N>/`, staging
   `https://staging.vettid.org/security/releases/<N>/`) and, before it
   is signed into any manifest (a canary too), its `log` (VAULT-RELEASES
   §7 "Release notes on every channel"): `summary` one line of at most
   160 characters; `changes` 1–20 items of at most 280 characters;
   `security` `none`, `recommended` or `urgent` (the last two with
   `security_text`, at most 1,000 characters, and `affects`). Plain text
   only: no line breaks, `<`, `>`, backticks, `**`, `](` or `://` (the
   app shows it as written). The validation (CDK synth, `npm test`,
   `vault:manifest sign`, `check:manifest`) refuses a non-candidate
   without `log`. Write it in the release PR, where it is reviewed.
3. The release key first (VaultStack, "Creating a release key" above).
4. `npx cdk diff VettidOrgVaultHostStack VettidOrgVaultRelease<N>Stack --profile vault-prod`:
   the host stack only gains N's PCR0 on the smoke key; the release stack
   is new. Deploy both (`npx cdk deploy VettidOrgVaultHostStack VettidOrgVaultRelease<N>Stack --profile vault-prod`).
   The image build takes about 20–40 minutes; a hash or PCR0 mismatch
   fails the build and the deploy (logs: `/aws/imagebuilder/vettid-org-vault-r<N>-<hash>`).
5. Canary: `aws autoscaling set-desired-capacity --auto-scaling-group-name vettid-org-vault-r<N> --desired-capacity 1`,
   then the self-test on that instance through Run Command ("No
   interactive access to hosts" below), per vettid-vault docs/SMOKE.md:
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
   As run for S10 (2026-10-11): the same sequence with the capacity
   run in one go, that is the self-test line with `-capacity 400` and
   the output redirected as in "Capacity measurement" below (SSM
   `executionTimeout` of at least 7200 s); PASS, 58 held, about 907
   projected. Two things about the group's size while doing this: a
   **candidate or canary** group, whose PCR0 has no `vault-releases`
   row yet, is left alone by the scaler and stayed at 1 for the whole
   self-test, so set it back to 0 by hand afterwards; an idle group of
   a **listed** release that is scaled up by hand is returned to its
   minimum by the scaler after its 30 idle minutes (seen on r4), so a
   long run on a listed release needs a vault unlocked on it or a
   fresh scale-up.
   From S11: with the ordinary parent running again, check that its
   metrics arrive ("The parent's metrics and their alarms" above, steps
   1 to 4). The self-test parent writes no metrics.
6. After publication, the always-on minimum moves (O7): set
   `min_instances: 1` on N and `0` on N−1, deploy both release stacks.

### Capacity measurement (W9; VAULT-RELEASES §8.8, O6)

From S3 on, the release image's self-test can measure how many vaults one
host holds (vettid-vault docs/SMOKE.md, "Capacity measurement"). Run it on
a host of the release under test, the same way as the canary self-test,
through Run Command with `executionTimeout` of at least 7200 s:

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
2. `npm run vault:manifest -- sign --channel prod`: refuses a manifest
   in which a `removed` release that can still be rescued is not
   admitted by the newest `active` release's key ("Removing a release
   and rescue" below); refuses while any
   release's `notes` is not its release log entry (`npm run vault:manifest --
   notes --channel <c>` switches them; only staging S1–S9 ever had other
   notes), then serial = max(served,
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
   release log (`website/security/releases/`) and commits those paths
   (staging: `vault/staging/pcr-manifest.json` and
   `sites/staging/security/releases/`). `npm run release-log [-- --channel <c>]`
   regenerates a log by hand; `check:manifest` fails while either
   channel's log is stale.
   Push, merge (CI runs `check:manifest`), `npm run deploy:site`, and run
   the manifest sync (above) so routing follows at once.

If the canary fails, never publish that document: edit the file (N
`removed`, no `host`, no `ends_at`: nobody was on it, so it is not
rescued and no later key admits it), sign the next serial when there is something to
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
   Do it on the phone. Handing the file to the app from the computer
   (`adb shell am start -a android.intent.action.SEND … --grant-read-uri-permission`)
   no longer works: the media provider denies the permission (seen on
   GrapheneOS, 2026-10-11).
   Each installed app keeps its own canary manifest: with the old
   staging app (`com.vettid.app`) and the new one
   (`com.vettid.app.staging`) on one phone, share the file to each app
   that is to use it.
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

**Before a release is removed, and before a new release is published:
a rescue must have a target** (VAULT-RELEASES 0.1.24 §3.5). A rescued
vault can only move into the newest `active` release, and only if that
release's key admits it. Check in `vault/releases/<channel>.json`, as it
will be after the edit: the PCR0 of every `removed` release whose
`ends_at` is less than the deletion window ago (30 days in production,
7 in staging), the release being removed included, is in the
`admitted_pcr0s` of the newest `active` release. `vault:manifest sign`
makes the same check and refuses to sign, and `check:manifest` refuses
the served manifest. If it fails, do not publish: wait until the
window of the release left out is over, or keep the current `active`
release until then. (Staging releases through 11 are not checked: their
keys are older than the rule, "Creating a release key" above.)

One case has no target and no check: a release that is removed while
an older release is the newest `active` one (the enclave refuses a move
to a lower number). Removing such a release ends its vaults; ask the
owner first.

At D (§10.3 step 2): set the entry `removed` and keep its `ends_at`,
the time the release ended, never a later one
(the rescue window counts from it; `check:manifest` refuses a published
release that is `removed` without one, and a `removed` entry whose
`ends_at` is after the manifest's `issued_at`), sign and publish, then
`npx cdk destroy VettidOrgVaultRelease<N>Stack --profile vault-prod`
(instances drain; the `group-name` ref goes, so the next manifest sync sets
`available` false), then remove the entry's `host` in
`vault/releases/<channel>.json` (the entry itself stays while the manifest
lists the release), and schedule the key's deletion ("Retirement" above).

Rescue (step 3), within the window. Nothing is signed or published: the
entry stays `removed` and the manifest does not change.

1. The target: the newest `active` release admits N (the check above).
   Without it, stop: the vault cannot move. (The enclave accepts any
   `active` release above N whose key admits it; the list and the app
   choose the newest.)
2. The key, as the retirement role:
   `aws kms cancel-key-deletion --key-id <arn>`, then
   `aws kms enable-key --key-id <arn>` (cancelling leaves it `Disabled`);
   `aws kms describe-key --key-id <arn> --query KeyMetadata.KeyState`
   must answer `Enabled`.
3. The release stack: in `vault/releases/<channel>.json` give N's entry
   its `host` again (as it was before the removal: `git log -p` on the
   file) **together with `"rescue": true`**, `min_instances: 0`. The
   validation allows `host` on a `removed` entry only with that marker,
   and the marker only while the newest `active` release admits N; the
   marker is never in the manifest. In production the edit is a PR
   merged to master before the deploy, like any release list change:
   the daily drift check ("Production drift") compares master with
   what is deployed, so it stays clean during the rescue; with an
   unmerged edit it would report the host stack as changed and the
   release stack as deployed but not in master. `npm run check:manifest`, then
   `npx cdk diff VettidOrgVaultStack VettidOrgVaultHostStack VettidOrgVaultRelease<N>Stack --profile vault-prod`
   (the host stack only gains N's PCR0 on the smoke key; the release
   stack is new; **`VettidOrgVaultStack` must show no change**: `cdk
   deploy` of the other two deploys it too, as their dependency, and
   it holds the release keys) and deploy the host and release stacks.
   The image is built again from the release's assets and its pinned
   base AMI; if that AMI is gone, set the current one ("Adding a
   release" step 1). Run the manifest sync so that `available` is true.
4. Routing:

   ```bash
   aws dynamodb update-item --profile vault-prod --table-name vettid-org-vault-releases \
     --key '{"release":{"S":"<pcr0>"}}' --update-expression 'SET rescue = :t' --expression-attribute-values '{":t":{"BOOL":true}}'
   ```

   The member API routes the vaults of that release again and the scaler
   starts it on demand. `rescue` is release-wide (every vault sealed to
   it is routed while it is set).
5. The member unlocks and approves the move into the newest `active`
   release (the app offers only the move), then unlocks again there.
   **The move is confirmed when an unlock in the target release has
   succeeded** (the member sees the vault open, and the app shows the
   target release). The vault row's `sealed_release` is not
   the sign: it names the target as soon as N has sealed the header,
   before the target has opened the vault. Until the confirmation N
   must stay routed, because going back (an abandon) is served by N.
6. The way back, only after that confirmation: `REMOVE rescue` on the
   row (the scaler then stops the group at once); `npx cdk destroy
   VettidOrgVaultRelease<N>Stack`; remove `host` and `rescue` from the
   entry (in production: a second PR, merged before the deploy, after
   which the drift check is clean again) and deploy the host stack;
   schedule the key's deletion again ("Retirement" above). KMS takes
   the full window again, so the key's deletion date is no longer
   `ends_at` plus the window.

`check:manifest` fails while an entry carries `rescue: true` past its
window (`ends_at` plus the window): end the rescue. CDK synth does not
fail for that, so the stack can still be destroyed.

### Network and egress

Hosts: public subnets in two AZs of the host VPC, no NAT, no inbound,
outbound TCP 443 only, no SSH key and no interactive access: commands
through Systems Manager Run Command only (next section). Route 53 Resolver DNS
Firewall answers only the names in `lib/vault/egress.ts` (NXDOMAIN for the
rest; query logs in `/vettid-org/<stage>/vault-dns`, metric
`DnsQueriesBlocked`); S3 and DynamoDB gateway endpoints admit only this
account's resources. AMIs are built in a separate build VPC without the
firewall (the builder needs GitHub and the package repositories).

### No interactive access to hosts

Nobody gets a shell on an instance in a vault account (the owner's
decision of 2026-10-13), in staging or production. What makes it so:

- The Vault OU policy (`lib/org/scp-vault.json`, statement
  `NoInteractiveSessions`) denies, to every principal in both accounts
  with no exception: `ssm:StartSession` and `ssm:ResumeSession` (one call
  starts every kind of session: the shell, an interactive command, port
  forwarding, SSH over Session Manager, whatever the session document),
  every EC2 Instance Connect call (a temporary SSH key, the serial
  console's key, an Instance Connect tunnel), creating an Instance
  Connect endpoint, and turning on the serial console (it is off in both
  accounts).
- The hosts themselves: the security group has no inbound rule, the
  launch template has no key pair, and neither account has one.

What an operator does instead: **Run Command**, one command at a time.
It runs as root, through the SSM agent, without a terminal:

```bash
P="--profile vault-staging"; I=<instance id>
C=$(aws ssm send-command $P --instance-ids $I --document-name AWS-RunShellScript \
  --comment "S12 self-test" --parameters 'commands=["systemctl is-active vault-parent"]' \
  --query Command.CommandId --output text)
aws ssm get-command-invocation $P --command-id $C --instance-id $I \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
```

Give every command a `--comment` (it is in CloudTrail; the commands
themselves are not). The output comes back up to 24,000 characters:
for more, write to a file on the host and `grep` or `tail` it with a
second command, as "Capacity measurement" does. A long command takes
`executionTimeout` in `--parameters`. Each `send-command` by a person
sends a `VaultHostAccess` email ("Security alerts"); that is intended.
So does every other way to have the agent run a document (a State
Manager association, an automation, a maintenance-window task); none is
used here, so use none.
Image Builder's own commands on its build instances and a patch
baseline, should one ever be wanted, are Run Command too and are not
affected (the hosts are replaced by a new release's image, not patched
in place).

Run Command is still any command as root. What the policy removes is
the terminal: unattributed keystrokes with nothing recorded. It does
not stop an administrator from running a script.

**Break-glass.** A shell on a host takes a change of the organization
policy, which only an administrator of the management account can make
(nothing inside a vault account can): remove the two `ssm:` actions
from the statement, `scripts/vault/apply-scp.sh --apply`, open the
session, put the file back and apply again. Each apply emails
`OrgOrSsoChanges`, and the session emails `VaultHostAccess`. Say in
the release or incident notes why it was needed.

The exit node in the management account ("Admin access") is not a
vault host and is not under this policy: its Session Manager access is
unchanged.

### The Android app link (account site)

The account site's Vault tab links to the Android app from
`/config.json`, which the account site stack writes at deploy from CDK
context: `androidAppUrl` (production, the Google Play listing) and
`stagingAndroidAppUrl` (staging, the test build's page). Both are unset
until the link exists, and the page then says the app is not available
yet. To set one, add it to cdk.json `"context"` (https only; the synth
fails otherwise), commit it (PR) and deploy `VettidOrgAccountSiteStack`
for that stage.

### App Links: `assetlinks.json` per stage (account site)

Each stage's account site serves `/.well-known/assetlinks.json`, written
at deploy from `ANDROID_APP_LINKS` in `lib/config.ts`, so that the
same-device setup link `https://account.<zone>/vault/enroll/#s=…` opens
in that stage's app as a verified App Link (VAULT-MESSAGING §11.12.1;
0.26.0 §11.10.8 "Android package", STAGING-DEVELOPMENT-PLAN D5):

| Stage | Host | Package | Certificate digests |
|---|---|---|---|
| prod | account.vettid.org | `com.vettid.app` | the production upload key; the Play app-signing key when it exists (O8) |
| staging | account.staging.vettid.org | `com.vettid.app.staging` | the two staging signers (the owner's staging key and the automation key) |

One statement per stage, never both. The package and the digests are the
channel's `android_package` and `android_signers` in vettid-vault
`enclave/releasecfg/<channel>.json` (there lowercase hex, here uppercase
with colons): a signer added or removed there is a PR here and a deploy
of that stage's `VettidOrgAccountSiteStack`. The relay's own
`assetlinks.json` (relay.vettid.org, invitation links) is the relay's
and is not changed from here.

Staging's statement goes live with staging release S10 and the first
Android build whose application id is `com.vettid.app.staging`:

```bash
npx cdk diff   VettidOrgAccountSiteStack -c stage=staging --profile vault-staging    # the site deployment's assets only
npx cdk deploy VettidOrgAccountSiteStack -c stage=staging --profile vault-staging
curl -s https://account.staging.vettid.org/.well-known/assetlinks.json               # com.vettid.app.staging, two digests
# On a phone with the new build (Android verifies at install; re-verify after the deploy):
adb -s <serial> shell pm verify-app-links --re-verify com.vettid.app.staging
adb -s <serial> shell pm get-app-links com.vettid.app.staging                        # account.staging.vettid.org: verified
```

Deploying before S10 breaks nothing that works today: until now staging
served production's package with production's digest only, so no staging
build's setup link was ever a verified App Link. An old staging build
(`com.vettid.app`, staging-signed) is unverified before and after.
Production's document is unchanged; a production deploy of the account
site shows no difference from this.

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
no snapshot in an unlock; fix the member row. Since MEMBER-API 2.3.0 the
snapshot carries the member's full verified `email` instead of
`email_hint` (the redeem and recovery-claim answers keep the masked
hint); a member row whose `email` a vault would refuse (under 3 or over
1,016 bytes, no `@`, control characters) is treated the same way: no
enroll, no snapshot in an unlock or a push. The snapshot is never logged
(it carries the address); the push and enqueue failures log only ids and
the error name.

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

### The vault row's app key: parent log lines (VAULT-HOST-PROTOCOL 0.1.15)

The parent writes the vault row's `app_key` and `app_key_next` durably
(VAULT-MESSAGING 0.58.0 §11.5). **The parent and the
enclave of a release go out together, from the same tag; neither mixed
pairing is supported** (VAULT-HOST-PROTOCOL §10, "Deployment order"). Do
not upgrade the parent in place under an older enclave: the `app_key_next`
report is then not written and the step-1 admission is lost. A parent
before 0.1.15 under a new enclave answers `AppKeyNext` `invalid`, and every
enrollment, transfer and recovery fails closed.

| Log line | Level | Meaning |
|---|---|---|
| `app key confirmed` (`vault_id`, `mode`) | info | An `AppKeyNext` was written (or the row already named the key) and answered `ok` |
| `app key refused` | warn | Answered `conflict`: the row names another key at that `seq` or higher, a newer replacement's key is there, or the row is gone. The transfer or recovery fails with `retry` |
| `app key not confirmed` (`error`) | warn | Answered `error`: the table failed, the vault's confirmation lock or earlier writes did not clear in 8 s. The enclave retries for 10 s |
| `app key write failed; trying again` | warn | An `app_key` write or a clear failed and is queued; it is retried from 1 s up to 30 s, per vault |
| `app key written after a retry` | info | The queued write succeeded |
| `app key write refused; not tried again` | error | The service refused the write as malformed or not allowed; it is given up (check the host role's grant on the vault table) |
| `lifecycle` with `event=app_key_assert` | debug only | The enclave's assertion after a hello; not logged at info |
| `lifecycle` with `event=app_key_next_clear` | info | The enclave clears the next key a failed step 1 left on the row. The clear is made only by the parent that holds the vault's lease and made that key's confirmation (0.1.16) |
| `orphan clear skipped; stamp unknown` (`vault_id`, `header_seq`) | debug | The parent has no stamp for that clear (it restarted, or never confirmed that key) and wrote nothing; the orphan stays until a later `next_cleared` or an unlock with `next: false` |

`app key refused` is also logged when a parent that does not hold the vault's unexpired lease is asked to confirm a key (0.1.16); expect it at a move, at a late lease renewal, and in a split brain.

A burst of `app key write failed; trying again` for one vault that ends
with `app key written after a retry` is a table outage that healed.
Repeated `app key refused` for one vault after a prior transfer or
recovery is residual 3 of VAULT-HOST-PROTOCOL §5.7 (a stale
`app_key_next`); it clears only when an unlock of the vault reports `next: false` with
an `app_key_seq` or `header_seq` that reaches the stale key's, or when
`app_key` reaches its `seq` (not at any unlock).

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
  versions stay at most 7 days, sealed, and are not restorable by support;
  "The data bucket's old versions and its size alarm").
- *The account looks taken over* (the member did not ask for the
  deletion, or for a recovery, and someone else may hold their mailbox
  or session). In this order, on the admin site's **Members** page:
  1. **Suspend** the account (with the reason). Suspend writes the
     status first, then disables sign-in, then ends the sessions, and
     writes the `member.suspend` event last. From the status write on,
     a pending deletion is **not carried out**: the cleanup job's
     5-minute run reads the member's row before each deletion and
     leaves it `pending` for an account that is not active, for as
     long as it stays that way (metric `StartOverHeldNotActive`; no
     alarm, see below). The one case suspending cannot catch is a run
     of the job that read the row as active just before the status was
     written. Suspending cancels nothing by itself.
     **A suspension can be half done.** If Suspend answers an error
     after the status was written, the row says `suspended` but
     sign-in may not be disabled and the sessions may not be ended.
     The sign of it is a suspended account with **no `member.suspend`
     event** for this suspension in the audit log (by `subject`, the
     member's id). Until it is finished, a session from before the
     suspension keeps renewing itself; it reaches only lock and the
     two cancels, because every other account and vault route reads
     the row. Finish it with **Suspend again** on the suspended row
     (it disables sign-in and ends the sessions again and writes
     `member.suspend` with `repeat: true`; the stored reason stays the
     first one). It is safe to press on any suspended account.
     Reinstate also ends the sessions before it enables sign-in, so a
     half-done suspension cannot hand an old session back.
  2. **Cancel vault deletion** on the member's row
     (`POST /admin/members/{user_guid}/vault/deletion/cancel`). It
     answers "cancelled" (audit `member.vault_deletion_cancel`, the
     member is emailed "VettID vault deletion cancelled … by VettID
     support"), "no pending vault deletion" (nothing to do; repeating
     it is harmless), or an error that it is already being carried out
     (`409`, state `executing`: see the next entry). It works whatever
     the account status, so it is also the way to cancel for a member
     who cannot reach the link, the account page or the app. If it
     answers an internal error, press it again: when the second answer
     is "no pending vault deletion", the first one did cancel (its
     audit event or email failed); the cancel function's log has
     `{"startOverCancel":{"user_guid","vault_id","deletion_id"}}` for
     every record it removed.
  3. *A recovery the member did not ask for* has no admin cancel. While
     the account is suspended it is **blocked, not stopped**: the code
     is not released (`GET /api/vault/recovery` answers 403) and a new
     app can neither claim it nor register, but its clock runs on
     (code after 24 hours, usable for 24 more), and it works again the
     moment the account is active. The member can cancel it with the
     link in the "recovery requested" email at any time, suspended or
     not.
  4. **Reinstate** when the member has their mailbox back. Reinstating
     first cancels a vault deletion that is still pending (step 2 not
     done, or a deletion nobody noticed), with the same email and
     audit event (`on: reinstate`), so that a deletion which waited
     through a suspension is not carried out afterwards. Then, if a
     recovery is still active, it stops and shows a warning with the
     recovery's state and the time it stays usable until (`409
     recovery_active`; the pending deletion has been cancelled by
     then, the account is still suspended). Unless the member says the
     recovery is theirs: have them cancel it with the email link, or
     wait until that time has passed, and press Reinstate again.
     When it goes on, it ends the member's sessions before it enables
     sign-in (a half-done suspension cannot hand an old session back).
     **Reinstate anyway** reinstates with the recovery alive (audit
     `member.reinstate_with_active_recovery`, written before sign-in
     is enabled, then `member.reinstate`). The warning can be wrong in
     one case: a recovery that the member's new app has just completed
     is shown as `registered` until the API has recorded it.
     If the cancel of the deletion cannot be made (the cancel function
     or the vault tables are unreachable), or a step before the status
     write fails, Reinstate answers an error and the account stays
     suspended; try again. If it answers an error and the row then
     says `active`, the reinstatement was made and only its event or
     the vault's snapshot failed; pressing it again answers "already
     active". A member who does
     want to start over asks again and gets a new 24 hours.

  What the member sees while suspended: sign-in is refused; the app
  and the account page answer "This account is not active" for
  everything except lock and the two cancels (deletion, recovery),
  which keep working with the vault's app key, the email link, or a
  session from before the suspension (it ends within the hour once
  the suspension's sign-out was made; see "half done" above). The deletion's email link stops
  working at the original `deletes_at`, held or not; after that the
  cancel is support's (step 2) or the reinstatement's. The app reads
  the pending deletion from its status, which a suspended account
  cannot fetch, so in practice a suspended member cancels with the
  link or asks support.
- *"Already being carried out" (`executing`)*: the 24 hours passed
  with the account active and the job took the deletion. Nothing
  cancels it: not the member, not **Cancel vault deletion** (`409`),
  not a suspension, also when the host's `delete` has not been sent
  yet (`deletion.queued_at` absent: the vault service is paused or no
  instance was running; the job tries again at every run and does not
  ask about the account for these). Stopping such a deletion while it
  is still unqueued is the owner's decision and a change by hand, and
  it is **not safe without stopping the job first**: the job sends the
  queue message and only then writes `queued_at`, and it acts on the
  row as its scan read it, so a run in progress, the next 5-minute
  run or the daily retry can queue the `delete` after a by-hand update
  has succeeded. In this order:
  1. **Pause the vault service** (admin site, **Vault service**, with
     the reason; "Pausing the vault service"). While it is paused the
     job queues no `delete` and requests no start. It takes effect in
     the job within about 30 seconds (its cache). If the service
     cannot be paused, disable both schedules of the cleanup function
     instead (the rules `StartOverSchedule` and `CleanupSchedule` of
     `VettidOrgMemberApiStack`, `aws events disable-rule`), and enable
     them again in step 5.
  2. **Wait 6 minutes**: longer than the function's timeout (5
     minutes) plus the cache, so that a run that started before the
     pause has ended.
  3. **Check that nothing was queued.** Read the vault row
     consistently
     (`aws dynamodb get-item --consistent-read --table-name vettid-org-vaults --key '{"vault_id":{"S":"<vault_id>"}}'`):
     `deletion.state` is `executing`, `deletion.queued_at` is absent
     and `state` is not `deleted`. `queued_at` absent is not quite
     proof: the job sends first and writes `queued_at` after, so a
     send whose write then failed leaves no mark on the row. That
     write failing ends the run with an error, so also check that no
     invocation of the cleanup function failed since the deletion
     became `executing` (audit `vault.deletion_executed` has the time
     and `queued: false`; the function's `Errors` metric, or its log).
     If the row or the log says it may have been queued, stop here:
     the vault is being deleted and nothing takes the message back.
  4. **Remove both marks in one update**, conditional on what step 3
     saw:
     `aws dynamodb update-item --table-name vettid-org-vaults --key '{"vault_id":{"S":"<vault_id>"}}' --update-expression "REMOVE deletion, deletion_requested_at" --condition-expression "deletion.deletion_id = :id AND deletion.#s = :ex AND attribute_not_exists(deletion.queued_at)" --expression-attribute-names '{"#s":"state"}' --expression-attribute-values '{":id":{"S":"<deletion_id>"},":ex":{"S":"executing"}}'`.
     Both must go: with `deletion_requested_at` left, the daily retry
     deletes the vault. Read the row again and see neither.
  5. **Resume the vault service** (or enable the two rules), and tell
     the member; no email is sent for a change by hand.
- *A canceled account* (the member cancelled the account during the 24
  hours): the deletion is held in the same way, and the vault goes
  with the account after its 7 days (the daily run, as for every
  canceled account; from then on the row has `deletion_requested_at`
  and the 5-minute run leaves it to the daily retry). An admin's
  reinstate inside the 7 days cancels the pending deletion as above.
- *A held deletion without a member* (alarm
  `vettid-org-start-over-held-no-member`, metric
  `StartOverHeldNoMember`; three 5-minute runs in a row): a vault has
  a pending deletion past its time and no member row. The 5-minute run
  holds it and never carries a start-over out because a row is
  missing. It happens when an account's own deletion removed the row
  and then failed before it reached the vault (or, before admin
  **Delete** refused while a vault exists, when an admin deleted a
  member who had one). The daily run (07:00 UTC) marks such a vault
  (`orphan_seen_at`, alarm `vettid-org-orphan-vaults-seen`) and, if
  the member row is still missing 7 days after the mark and no
  operator holds it, asks it to delete itself as for a canceled
  account; from then on the row has `deletion_requested_at`, the
  5-minute run stops counting it, and this alarm returns to OK. Until
  then it stays in ALARM. See *Vaults without a member* below for
  finding out why, and for keeping the vault.
- *Vaults without a member* (MEMBER-API 2.6.5; metrics from the daily
  run, namespace `VettID/MemberApi`). The daily run scans the vaults
  table for rows with a `user_guid`, not `deleted` and without
  `deletion_requested_at`, and reads each owner's member row
  consistently. Log line
  `{"vaultOrphans":{marked, waiting, cleared, requested, operator_held, held, read_errors, failures}}`.
  - **First sight** (alarm `vettid-org-orphan-vaults-seen`, metric
    `OrphanVaultsSeen`; log `orphaned vaults: a vault without a member
    row, marked` with `vault_id` and `user_guid`): the row gets
    `orphan_seen_at` (epoch seconds; never moved by a later run). This
    is the warning: nothing is deleted yet. Find out why the member is
    gone: the audit log by `subject` = the `user_guid`
    (`member.delete` by an admin, `member.delete_after_cancel` by the
    job). The first run after 2.6.5 was deployed marks every vault
    already without a member, including those held under
    `StartOverHeldNoMember` from earlier admin Deletes, and deletes
    nothing for 7 days.
  - **Waiting** (metric `OrphanVaultsWaiting`, no alarm): marked, the
    7 days not over.
  - **The member row is back** (restored): the next run removes
    `orphan_seen_at` (`cleared`); nothing else. Only a run that sees
    the row clears the mark: a member row restored and lost again
    between two 07:00 runs keeps its first mark, and its 7 days are not
    restarted.
  - **Deleted** (alarm `vettid-org-orphan-vault-deletions`, metric
    `OrphanVaultDeletions`): 7 days or more after the mark of every
    one of that member's vaults, the member row still missing and no
    hold, the run does what the account deletion does for a canceled
    account: the host's `delete` to each vault not yet deleted, a
    never-sealed row and the pointer row deleted; audit
    `vault.orphan_deletion_requested` (subject: the `user_guid`,
    detail: `vault_ids`, `orphan_seen_at`). This cannot be undone.
  - **To keep a vault without a member** (the row was removed by
    mistake, or the vault is wanted for an investigation): put it on
    hold before the 7 days are over. In the vault account:
    `aws dynamodb update-item --table-name vettid-org-vaults --key '{"vault_id":{"S":"<vault_id>"}}' --update-expression "SET orphan_hold = :t" --condition-expression "attribute_exists(vault_id) AND attribute_not_exists(deletion_requested_at)" --expression-attribute-values '{":t":{"BOOL":true}}'`.
    Any `orphan_hold` attribute counts as a hold, whatever its type or
    value (a value other than the boolean true is logged as a warning);
    to end it, remove the attribute.
    A hold on any one of a member's vaults keeps all of that member's
    vaults out of the scan: none is marked or deleted (metric
    `OrphanVaultsOperatorHeld`, no alarm). If the vault also has a
    pending start-over, remove that record too, or
    `StartOverHeldNoMember` stays in ALARM
    (`--update-expression "REMOVE deletion" --condition-expression "deletion.#s = :p"`
    with `#s` = `state`, `:p` = `pending`). To end the hold:
    `--update-expression "REMOVE orphan_hold" --condition-expression "attribute_exists(orphan_hold)"`;
    a mark older than 7 days then leads to the deletion at the next
    run, so restore the member row first if the vault is to stay.
    Better still, restore the member row: the mark is then cleared.
    The job never writes `orphan_hold`; the vault account's table
    policy does not even let it.
  - **Held** (alarm `vettid-org-orphan-vaults-held`, metric
    `OrphanVaultsHeld`):
    - `orphaned vaults: held, more members without a row than one run
      accepts`: more than 5 members without a row, or more than 15 %
      of the owners the run read (one is always allowed). The run
      then marks and asks none of them, and does so at every daily
      run for as long as that is the case. That many at once is more
      likely a wrong or damaged members table (above all one restored
      from an older backup, which lacks every member who joined since)
      than stopped deletions. Check the members table (point-in-time
      recovery, the stack's `TABLE_MEMBERS`) first. When the members
      are really gone, the vaults can be asked one at a time by hand
      (below), or `ORPHAN_LIMIT` / `ORPHAN_SHARE` in
      `lambda/jobs/cleanup.ts` raised for one deploy; the 7 days from
      each mark still apply.
    - `orphaned vaults: a member row could not be read` (with the
      error name): as for `StartOverHeldReadError` above; tried again
      the next day.
    - `orphaned vaults: not all marked or asked to delete themselves`
      or `a mark could not be cleared`: a failed table or queue call;
      tried again the next day.
  - To ask one vault by hand (instead of waiting), set
    `deletion_requested_at` on its row to a time more than an hour ago
    (`aws dynamodb update-item --table-name vettid-org-vaults --key '{"vault_id":{"S":"<vault_id>"}}' --update-expression "SET deletion_requested_at = :t" --condition-expression "attribute_exists(vault_id) AND attribute_not_exists(deletion_requested_at)" --expression-attribute-values '{":t":{"N":"<epoch seconds, an hour or more ago>"}}'`);
    the daily retry then asks it as for a canceled account.
  - Deploying: see **Deploy order for 2.6.5** below.
- *Held because the member row cannot be read* (alarm
  `vettid-org-start-over-held-read-error`, metric
  `StartOverHeldReadError`; three runs in a row): no due deletion is
  carried out while this lasts, and none is lost: each is tried again
  every 5 minutes. The cleanup function's log has
  `start-over held: the member row could not be read` with the error
  name. `AccessDeniedException`: the function's role lost
  `dynamodb:GetItem` on the members table (`VettidOrgMemberApiStack`
  not deployed, or deployed without it). Anything else is the table.
- *Held for a suspended or canceled account* is not alarmed: it is
  what a suspension is for, and a reinstatement ends it by cancelling
  the deletion. `StartOverHeldNotActive` (namespace `VettID/MemberApi`)
  shows how many are held at each run.
- *Stuck in `executing`*: as for an account deletion: look at
  `deletion_requested_at`, the release's routability and the host logs;
  the daily retry keeps trying and logs `vault deletion pending` after 30
  days.

**Deploy order for the hold and the admin cancel.**
`VettidOrgMemberApiStack` first: the cleanup job's read of the members
table, the two alarms, and a second function, `StartOverCancel`, which
runs only the cancel of a member's pending deletion under the cleanup
job's role; its ARN is published as SSM
`/vettid-org/<stage>/member-api/start-over-cancel-fn-arn`. Then
`VettidOrgAdminApiStack` (it reads that parameter, so its deploy fails
until the first one is done; the people function may invoke that
function, not the cleanup job), then the admin site. Nothing changes
in the vault account, and no existing function, log group or table is
replaced. Between the two deploys the admin API is the old one and
behaves as before.

**Deploy order for 2.6.5 (vaults without a member, admin Delete
refused while a vault exists).** `VettidOrgVaultStack` first (vault
account: the vaults table's resource policy gains the cleanup job's
`orphan_seen_at` attribute and the new role
`vettid-org-member-member-vaults`, Query on the table and its
`user-index` only). Then `VettidOrgMemberApiStack`: the orphan step
and its three alarms, and a third function, `MemberVaults`, under that
role of its own; its ARN is published as SSM
`/vettid-org/<stage>/member-api/member-vaults-fn-arn`. Then
`VettidOrgAdminApiStack` (it reads that parameter, so its deploy fails
until the member API's is done; the people function may invoke that
function), then the admin site. In the other order the job's first
mark is refused by the vault account (logged, `OrphanVaultsHeld`) and
nothing is deleted. Between the member API's and the admin API's
deploys, Delete behaves as before. The first daily run after the
member API's deploy only marks; nothing is deleted for 7 days.

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

`-c stage=staging --profile vault-staging` builds the staging channel,
entirely in vettid-vault-staging
(347272280361), under its own zone **staging.vettid.org**. It began as
a copy of what the vault's end-to-end tests need; since 2026-10-11 it
is the development channel, where every change runs first
(docs/STAGING-DEVELOPMENT-PLAN.md §2: at most three live releases, at
most two new ones a week, cleanup with every release):

| Stack | What |
|---|---|
| `VettidOrgStageDnsStack` | zone staging.vettid.org (delegated from vettid.org), CAA, SES domain identity (DKIM) for `no-reply@staging.vettid.org` |
| `VettidOrgAuthStack`, `VettidOrgDataStack` | the member pool (and an unused admin pool), PIN pepper, the `vettid-org-staging-*` tables (plus an empty `mailing-list` table that the cleanup job reads), terms bucket |
| `VettidOrgVaultStack`, `VettidOrgVaultHostStack` | as in "Vault" (deployed since W5/W6) |
| `VettidOrgMemberApiStack` | member API with the vault routes, notice job, alarm mailer (stream: context `stagingVaultsStreamArn` in cdk.json), cleanup |
| `VettidOrgAccountSiteStack` | https://account.staging.vettid.org (same site, WAF and API path as prod) |
| `VettidOrgStageSiteStack` | https://staging.vettid.org: a notice page, the staging manifest at `/.well-known/vettid/pcr-manifest.json` and the staging release log at `/security/releases/` |
| `VettidOrgStageTestMailStack` | test infrastructure: a mailbox for automated tests at `*@test.staging.vettid.org` ("Test mail" below) |

Not in staging, on purpose: the public site, signup, playbooks and the
vettid.dev redirect (prod content); the admin exit node, admin API and
admin site (test data comes from `npm run staging:seed`, the canary flag
from the CLI fallback in "Canary routing" with `--profile vault-staging`
and table `vettid-org-staging-members`); the relay (staging images pin
relay.vettid.org; a staging relay is deployed only when relay changes need
testing); the push gateway (the staging gateway runs in the management
account next to production's, "Push gateway"; here only the delegation of
its name, `VettidOrgStagePushDelegationStack`); the audit stack (the organization trail and GuardDuty,
administered from the management account, already cover the account;
`VettidOrgVaultAlertForwardStack` sends the account's events to the
management account's alert rules — "Security alerts").
Staging has its own release log (W11; VAULT-RELEASES §7 "Release notes
on every channel"): https://staging.vettid.org/security/releases/,
generated into `sites/staging/security/releases/` (pages "Staging (test
builds)", `log.css`, `index.json` for the staging app's What's new) by
the same code as production's and served by `VettidOrgStageSiteStack`.
The staging notice emails and the staging account site link it.

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
`vault/staging/pcr-manifest.json`, the log `sites/staging/security/releases/`
(both written and committed by `publish`). After the merge:
`npx cdk deploy VettidOrgStageSiteStack -c stage=staging --profile vault-staging`
(the manifest byte for byte at https://staging.vettid.org/.well-known/vettid/pcr-manifest.json,
and the release log), then run `vettid-org-staging-vault-manifest-sync`
with `--profile vault-staging`.

**The one-time notes switch (W11 backfill).** S1–S8 were signed with
their GitHub release URLs as `notes` (S9 too, if it was published before
W11 merged). The validation accepts that URL for staging releases 1–9
only, so the manifests already signed stay renders of the file, but
`sign` refuses it. The first staging signing after W11 therefore starts
with `npm run vault:manifest -- notes --channel staging`, which sets
every entry's `notes` to `https://staging.vettid.org/security/releases/<N>/`
(review the diff); then edit statuses as usual and `sign`. One
publication switches them all; the earlier serials keep their GitHub
URLs in git history. From then on a release's log URL never changes
(`check:manifest` successor rule).

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
  npm run -s staging:mail -- link --to ADDRESS [--match REGEX] [--since ISO] [--timeout 120] [--subject REGEX]
  #   the first matching link of the newest matching message, e.g.
  #   --match '/auth/#t='                     (account site sign-in link)
  #   --match 'email-verification\.'          (SES verification link)
  #   --match '/request/withdraw/#w=' --subject '^We have your request'
  #                                           (a request's withdrawal link)
  ```

  **Always pass `--match` (and `--subject` when you want one mail in
  particular) to `link`.** Without them it prints the first link of
  the newest message, and one address now gets several mails in a
  row: since MEMBER-API 2.6.0 a request made without a registration
  code is answered, once verified, by "We have your request for early
  access to VettID" (the withdrawal link), which arrives after
  Amazon's verification mail and before any "Your VettID account is
  ready" or sign-in link. A flow that took "the newest link" would
  open the withdrawal page.

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

Staging is no longer parked between releases (2026-10-11,
docs/STAGING-DEVELOPMENT-PLAN.md §2.1, §2.5): it is in use, and what
keeps its cost down is removing old releases and locking test vaults,
since an unlocked vault keeps its release's host running. What remains
true: a release group with no leased vault scales to zero (scaler), and
at idle the main stacks cost about $10/month (account
site WAF ~$8, zone $0.50, two secrets ~$0.80, pennies of Lambda,
DynamoDB, CloudFront). Everything stateful is retained and
deletion-protected as in prod; tearing staging down means turning
termination protection off in code first, and the zone (RETAIN) keeps its
name servers unless it is deleted by hand, after which
`stagingZoneNs` and the delegation must be updated.

### Staging time scale (MEMBER-API 2.8.0, STAGING-TIME-SCALE)

On staging, 1 day = 1 hour: the member API divides the start-over
deletion's 24 h, the account site PIN's 24 h lock and the recovery
estimates by `stagingTimeScale` (cdk.json; 1 or 24, staging only;
production is 1 in code). It ships at 1. The switch to 24 is a cdk.json
change that goes with publishing the first vault release that carries
`time_scale`: `"stagingTimeScale": 24` and `"stagingTimeScaleFromRelease":
<that release's number>` (the synth refuses 24 without it), then a staging
deploy. Recovery times are scaled only for vaults on that release or later.

- If a staging release from `stagingTimeScaleFromRelease` on is ever
  published with `time_scale` 1, set `"stagingTimeScale": 1` for it and
  deploy staging; otherwise the emails and pages say 1 h / 3 h while the
  enclave enforces 24 h / 72 h.

## Cost alerts

All to `vettid-org-security-alerts` → admin@vettid.org. The three budgets
also email al@vettid.org directly (`COST_ALERTS.budgetEmail`), as the
console-made budget they replaced did. The anomaly subscription stays on
the topic only: Cost Anomaly Detection sends to an SNS topic only as
found (`IMMEDIATE`), and to email only daily or weekly.

- **Daily budget for the management account** (`vettid-org-main-account-daily-15`,
  VettidOrgAuditStack): $15 of this account's own costs in a day (about
  five times normal), alert when the actual cost passes it. Budgets data
  is updated a few times a day, so the alert comes up to a day late: it
  is a backstop behind the CloudWatch alarms.
- **Cost anomalies** (`vettid-org-cost-anomalies`, VettidOrgAuditStack):
  an anomaly with an impact of $40 or more on the account's services
  monitor (`Default-Services-Monitor`, made by AWS), sent as found. The
  console's `Default-Services-Subscription` ($100 and 40 %, daily email)
  still exists alongside.
- **The organization's monthly budget** (every account, through
  consolidated billing; VettidOrgAuditStack): $500 a month, with alerts
  as actual spend passes $200, $250, $300, $350, $400, $450 and $500, and
  when the month is forecast past $500. A budget holds at most five
  notifications, so it is two budgets with the same $500 limit:
  `vettid-org-monthly-500 alerts 200-400` and `vettid-org-monthly-500 alerts 450-500`
  (the second carries the forecast). Amounts in `COST_ALERTS`
  (`lib/stacks/audit-stack.ts`). Changing a budget's notifications or
  subscribers replaces it, so its name must change in the same commit
  (AWS refuses a second budget of the same name). They replaced the console-made "My
  Monthly Cost Budget" ($200), deleted after they were deployed.

What to do: Cost Explorer (management account), by service and by
linked account for the day; for the relay, its alarms above.

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
  console sign-in to the management account's default bus. Data events
  (the object writes on the vault data bucket, "Vault data events" below)
  are not forwarded: they are kept in the trail, and the host makes them
  all day. The pattern also names Session Manager's `StartSession` and
  `ResumeSession`, as a precaution that by itself changes nothing:
  EventBridge gives read-only management calls only to a rule in state
  `ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS`, and the rule is in
  the ordinary `ENABLED` state ("Testing an alert" says when that would
  have to change). Stacks:
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
  S3 protection (GuardDuty's own reading of object calls, for findings
  such as unusual downloads or deletions) is a per-feature organization
  setting, not in any stack: "Vault data events" below has the one-time
  command.
- us-east-1 only: global events (IAM, STS, sign-in, Organizations,
  Identity Center) land there, and the Workloads SCP denies every other
  region in the member accounts. (Calls attempted in other regions are
  still in the organization trail, just not alerted.)

A rule's event pattern may be at most 2,048 characters as compact JSON
(EventBridge refuses a longer one and the stack rolls back, as the first
deploy of the vault account rules did). `test/event-pattern-size.test.ts`
holds every rule to 1,800. A pattern that needs two "or" lists at once
grows as their product when written as one list: put them at different
levels of the pattern, as `VaultHostProfileLaunch` does (the profile's
place under `detail`, the caller under `userIdentity`).

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
| `TrailBucketConfig` | the audit trail bucket (`vettid-org-cloudtrail-449757308783`): its Object Lock default, lifecycle rule, versioning or bucket policy changed, or the bucket deleted — always, deploys and refused attempts included ("The audit trail is write-once") |
| `OrgOrSsoChanges` | Organizations (leave, remove/move/create account, SCP create/update/delete/attach/detach, service access, delegated admins) and Identity Center (permission sets, account assignments, users, group memberships) |
| `CentralRootSession` | `sts:AssumeRoot` (a root session into a member account) |
| `KmsKeyDeletion` | `ScheduleKeyDeletion`, `CancelKeyDeletion`, `DisableKey`, `DeleteImportedKeyMaterial` — always, deploys included (management and proteus) |
| `KmsKeyPolicy` | `PutKeyPolicy` outside a deploy (management and proteus) |
| `S3PublicAccess` | bucket policy, ACL, ownership controls, bucket- or account-level public access block (outside a deploy) |
| `VaultDataBucketConfig` | a vault data bucket's lifecycle rule, versioning or bucket policy changed, or the bucket deleted — always, deploys and refused attempts included (vault accounts) |
| `VaultHostAccess` | in a vault account, except by Image Builder itself (its service principal and its service-linked role) on its build instances: a Run Command (`SendCommand`) and the other ways to have the SSM agent run a document, deploys included (`CreateAssociation`, `CreateAssociationBatch`, `UpdateAssociation`, `StartAssociationsOnce`; `StartAutomationExecution`, `StartChangeRequestExecution`; `RegisterTaskWithMaintenanceWindow`, `UpdateMaintenanceWindowTask`); and every interactive way in, which the Vault OU policy denies, so normally as a refused attempt: a Session Manager session (`StartSession`, `ResumeSession`), EC2 Instance Connect (`SendSSHPublicKey`, `SendSerialConsoleSSHPublicKey`, `OpenTunnel`, `CreateInstanceConnectEndpoint`), the serial console switch (`EnableSerialConsoleAccess`) |
| `VaultHostProfileLaunch` | `RunInstances` with the instance profile `vettid-org-vault-host` by anything but Auto Scaling through its service-linked role (vault accounts; refused attempts included) |
| `VaultHostLaunchPath` | `CreateLaunchTemplate`, `CreateLaunchTemplateVersion`, `ModifyLaunchTemplate`; `CreateAutoScalingGroup`, `UpdateAutoScalingGroup`, `CreateLaunchConfiguration`, `StartInstanceRefresh`; `AssociateIamInstanceProfile`, `ReplaceIamInstanceProfileAssociation`; `AddRoleToInstanceProfile` — always, **deploys included** (vault accounts): a release deploy sends three, a release's removal one |
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

### The vault account alerts: what they mean, what to do

All four concern the sealed vault objects in the data bucket. The host
role `vettid-org-vault-host` is the only principal the bucket policy
admits to them, and its credentials do not open them: a release key
decrypts only for an attested enclave. So the worst case behind these
alerts is objects copied or destroyed, not read.

- **`VaultDataBucketConfig`.** Expected only while a deploy of
  `VettidOrgVaultStack` that changes the bucket's definition runs (`who`
  is then `…/cdk-hnb659fds-cfn-exec-role-…/AWSCloudFormation`, and the
  change is in the merged diff). Anything else, at once: read the
  bucket's state with that account's profile
  (`aws s3api get-bucket-lifecycle-configuration`, `get-bucket-versioning`,
  `get-bucket-policy`, each with `--bucket <name>`) and compare with
  `lib/stacks/vault-stack.ts`: versioning `Enabled`; the lifecycle
  rules exactly as the stack's `lifecycleRules` has them (noncurrent
  versions kept for the days written there, expired delete markers
  removed, incomplete uploads aborted), and **no** rule that expires
  current objects; the two deny statements. If it differs, deploy
  `VettidOrgVaultStack` to put it back **the same day**: an expiry rule
  takes effect at the next midnight UTC and noncurrent versions go only
  after their days, so an early repair loses nothing (objects that already have a
  delete marker come back by deleting the marker). An `error:
  AccessDenied` means the SCP refused the call and nothing changed; find
  out who tried. A bucket policy change outside a deploy also arrives as
  `S3PublicAccess`.
- **`VaultHostAccess`.** Look at `event` and `error` first.
  `SendCommand`: someone ran a command on an instance in a vault
  account. CloudTrail keeps who, when, from where, on which instance
  (`requestParameters.instanceIds`), the document and the comment, not
  the command: its parameters are recorded as hidden. Expected when the
  owner runs a release's self-test or capacity measurement ("Adding a
  release", "Capacity measurement"); one email per command, typically
  three to ten on a release day. An association, an automation or a
  maintenance-window task (`CreateAssociation`,
  `StartAutomationExecution`, `RegisterTaskWithMaintenanceWindow` and
  their variants) makes the agent run a document without a visible
  `SendCommand`; no procedure and no stack uses one in a vault account,
  so treat it as a command that was not you, and delete the association
  or task. Any other event is an interactive way in ("No interactive access to hosts"):
  with `error: AccessDenied` the policy refused it and nothing happened,
  but someone tried; **without an error the policy is not in force**
  (detached, edited, or the account moved out of the Vault OU): check
  `OrgOrSsoChanges` emails and re-apply it. For a command or a session
  that was not you: treat the host role's credentials on that instance
  as taken. Terminate the instance (its group starts a new one; the
  credentials die with it within hours), end the Identity Center
  session that made the call, and read the data events of the bucket
  from that time on ("Vault data events": they show what was written or
  deleted, not what was read).
- **`VaultHostProfileLaunch`.** An instance was started with the host
  role outside the release groups, so something other than a released
  image holds the credentials that read and delete sealed objects. No
  procedure does this (image builds and rebuilds use
  `vettid-org[-staging]-vault-image-builder`). Find the instance
  (`responseElements.instancesSet.items[].instanceId` in the event),
  terminate it, and read the data events of the bucket for writes and
  deletions from it: its session name in `userIdentity.arn` is its
  instance id. What it read is not recorded.
- **`VaultHostLaunchPath`.** The indirect ways to the same thing: a
  launch template or group that Auto Scaling would launch from (those
  launches are not reported, as release groups launch hosts all day), a
  refresh of a group's instances, a profile attached to a running
  instance, a role put into another profile. Reported whoever does it,
  a deploy too: a stack is how hosts come to exist, so a stack nobody
  reviewed must not be quiet. **Expected, with `who` ending in
  `…cfn-exec-role-…/AWSCloudFormation`, while you deploy:** three emails
  for a new `VettidOrgVaultRelease<N>Stack` (`CreateLaunchTemplate`,
  `CreateAutoScalingGroup`, `UpdateAutoScalingGroup`, within a minute),
  one `UpdateAutoScalingGroup` for a release stack that is destroyed or
  whose `min_instances` or `max_instances` changed, one
  `AddRoleToInstanceProfile` for a first deploy of the vault or host
  stack. Check the group or template name against the release you are
  deploying (`vettid-org[-staging]-vault-r<N>`). Also expected: one
  `AddRoleToInstanceProfile` when a temporary profile is made by hand
  for an independent rebuild. Anything else, or any of these when
  nobody is deploying: look at the event's `requestParameters` for the
  instance profile, the user data and the role. If it names
  `vettid-org-vault-host`, delete what was created (the stack, the
  template, the group) and proceed as for `VaultHostProfileLaunch`.

### Vault data events

The organization trail records every **write** on
`vettid-org-vault-data-369484479783` and
`vettid-org-staging-vault-data-347272280361`: `PutObject`,
`DeleteObject` and `DeleteObjects`, `CopyObject`, the multipart calls
(`CreateMultipartUpload`, `UploadPart`, `UploadPartCopy`,
`CompleteMultipartUpload`, `AbortMultipartUpload`) and the calls that
change an object's tags, ACL or restore state. For each: who (the role
and, for a host, the instance id as session name), when, from where
(`sourceIPAddress`, `vpcEndpointId`), which key, and the error if it was
refused.

**Reads are not recorded** (`GetObject`, `HeadObject`, the list calls),
by the owner's decision: the trail is not to be a record
of every time a member's vault is opened. The accepted cost: after an
incident the trail shows what was changed or destroyed and by whom, and
**cannot show whether anything was taken**. The objects are sealed to
release keys, so a copy is not readable; and GuardDuty's S3 protection
(below) reads object calls on its own, reads included, whatever the
trail records, and reports unusual access as findings. It keeps no
record that can be searched afterwards.

The records are in the trail bucket with the account's management
events, same files and format, kept 400 days; they are **not** in
CloudTrail's Event history (management events only) and not on the alert
bus. To read a day:

```bash
A=347272280361; D=2026/10/14      # account, UTC day
aws s3 sync "s3://vettid-org-cloudtrail-449757308783/AWSLogs/o-kualrldevn/$A/CloudTrail/us-east-1/$D/" /tmp/trail/
zcat /tmp/trail/*.json.gz | jq -c '.Records[] | select(.eventCategory == "Data")
  | [.eventTime, .eventName, .userIdentity.arn, .sourceIPAddress, .vpcEndpointId, .requestParameters.key, .errorCode]'
```

Normal: every write under `vaults/`, `users/` and `smoke/` is by
`assumed-role/vettid-org-vault-host/i-…` of a running release host,
through the host VPC's S3 endpoint; `manifests/` is written by the
manifest signer role. Worth a look: the host role from an instance id
that is not a release host or without the endpoint, any other principal
(the bucket policy refuses it, so with an error), or deletions or
overwrites of many vaults by one instance in a short time.

Cost: CloudTrail charges $0.10 per 100,000 data events ($1 per million),
so it follows vault activity. Staging wrote about 2,200 object versions
a day in October 2026 (a handful of test vaults): about 66,000 writes a
month, under $0.10. A thousand vaults at that per-vault rate would be
about 16.5 million events and $16.50 a month, plus well under $1 of
storage (a record is about 0.15 KB compressed).

GuardDuty S3 protection for the member accounts is set once, from the
management account (it is an organization setting of the GuardDuty
administrator; $0.80 per million object calls it reads, reads and
writes alike and independent of the trail's selector, so up to a few
times the data events' cost). `ALL` for the members is what the
organization already has; the feature is the change. The first command
sends an `AuditTampering` email:

```bash
D=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)
aws guardduty update-organization-configuration --detector-id "$D" \
  --auto-enable-organization-members ALL --features '[{"Name":"S3_DATA_EVENTS","AutoEnable":"ALL"}]'
# Members follow within a day; to see, and to do it at once if needed:
aws guardduty get-member-detectors --detector-id "$D" --account-ids 369484479783 347272280361 605628228301 \
  --query 'MemberDataSourceConfigurations[].[AccountId,Features[?Name==`S3_DATA_EVENTS`]|[0].Status]' --output text
aws guardduty update-member-detectors --detector-id "$D" --account-ids 369484479783 347272280361 605628228301 \
  --features '[{"Name":"S3_DATA_EVENTS","Status":"ENABLED"}]'
```

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

A change that makes the trail record more data events (as the vault data
buckets' did) deploys the other way round, so that the new events are
never forwarded: the staging forwarder, the production forwarder, the
proteus forwarder, **then** VettidOrgAuditStack (`--exclusively` each,
as above; a forwarder stack depends on the audit stack only for the
first deployment's order). The rules for the vault accounts exist only
once the audit stack is deployed: nothing emails `VaultDataBucketConfig`,
`VaultHostAccess` or the launch rules before that. The vault data
bucket's protection and the ban on interactive sessions are part of the
Vault OU policy: `scripts/vault/apply-scp.sh` (dry run), then `--apply`
("Vault", first deployment, step 6).

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

The vault account rules, in staging, **after VettidOrgAuditStack is
deployed** (before that nothing matches and no email comes). A command on a running host
(it runs; expect a `VaultHostAccess` email), a session (once the SCP is
applied it must be refused with `AccessDeniedException` and still send
a `VaultHostAccess` email, with `event: StartSession` and `error:
AccessDenied`), and the bucket's versioning set to what it already is
(before the SCP is applied: a `VaultDataBucketConfig` email and no
change; after: the same email with `error: AccessDenied`):

```bash
aws ssm send-command --profile vault-staging --instance-ids <instance id> \
  --document-name AWS-RunShellScript --parameters 'commands=["true"]' --comment "alert test"
aws ssm start-session --profile vault-staging --target <instance id>
aws s3api put-bucket-versioning --profile vault-staging \
  --bucket vettid-org-staging-vault-data-347272280361 --versioning-configuration Status=Enabled
```

If the refused session sends no email while the command does:
CloudTrail classes `StartSession` as read-only, and EventBridge gives
read-only management calls only to rules in state
`ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS`. Look the event up
(Event history, `StartSession`, field `readOnly`). The remedy is that
state on two rules: each vault account's forwarding rule (its pattern
already names the session calls and lets no other read-only call
through, so nothing else is forwarded) and `VaultHostAccess`. It is a
code change with its own review, not something to set by hand: the
forwarding rule is under the forwarder SCP.

Heartbeats: `aws cloudwatch describe-alarms --alarm-name-prefix
vettid-org-security-alert-heartbeat --query
'MetricAlarms[].[AlarmName,StateValue]' --output text` shows `OK` for
each member once its forwarder is deployed.

### The audit trail is write-once

The organization trail `vettid-org-trail` delivers into
`vettid-org-cloudtrail-449757308783` (management account). Since the
deploy of this change the bucket has **S3 Object Lock in compliance mode
with a default retention of 400 days** (owner decision, 2026-10-13):
every log and digest file delivered from then on is locked for 400 days
from its delivery. During that time nobody can delete that file version,
change it or shorten its lock: no administrator, not the root user, not
AWS support. The bucket policy also admits the CloudTrail service for
this one trail only (`aws:SourceArn` on all three of its statements).

**What can no longer be done, by anyone:**

- Remove or change a delivered record before its 400 days are over. That
  includes a record that should not be there: a secret someone put into
  a request parameter, or personal data. The trail does hold personal
  data: for example the email address in every SES identity call of the
  mailing list and of early-access requests (the privacy notice says so,
  and says 400 days). A leaked secret is dealt with by rotating it,
  never by editing the trail. A demand to erase a person's data, from
  that person or from an authority, cannot be met for trail records
  before they expire.
- Empty or delete the bucket until 400 days after the last delivery, or
  give its name to another bucket. Closing the AWS account is the only
  way to end the storage earlier, and this is the organization's
  management account. This also holds after a later move of the trail to
  a log-archive account: once the trail points elsewhere, this bucket
  stays, under this name, until about 403 days after its last delivery;
  its contents can be copied to the new place, not moved.
- Suspend the bucket's versioning, or turn Object Lock off again.
- Shorten the lock of objects already delivered. Lowering the default
  (in `lib/stacks/audit-stack.ts`, or with
  `put-object-lock-configuration`) changes it for new objects only; so a
  default that is lowered or removed by someone else is a way to make
  *future* records deletable. Every change of it is emailed
  (`TrailBucketConfig`).

**A new risk that comes with the lock: retention can be extended, and
that cannot be undone either.** Anyone in the account who may call
`s3:PutObjectRetention` can set a later date on a file (up to 100 years),
and anyone who may change the bucket's Object Lock configuration can
raise the default for new files. In compliance mode a later date is as
final as the first one: logs, and the personal data in them, would be
kept far past the published 400 days with no way back. A raised default
is emailed (`TrailBucketConfig`); a later date on a single file is not
(it is an object call, which the trail does not record for this bucket).
Follow-up, not part of this change because it edits the delivery
bucket's policy before delivery under the lock has been seen to work: a
bucket policy statement that denies `s3:PutObjectRetention` when
`s3:object-lock-remaining-retention-days` is greater than 400 (S3 user
guide, "Object Lock considerations": "You can set minimum and maximum
allowable retention periods for a bucket by using a bucket policy").
CloudTrail's deliveries take the bucket default and do not use that
action, so the statement would not touch them.

**What still works.** Reading, as before. The lifecycle rule: 400 days
after delivery, at the next midnight UTC (so never before the lock
ends), it puts a delete marker on a file, which the lock does not
refuse; one day after that, again at the next midnight, the file itself
is removed (1 day since this change, 30 before: owner decision,
2026-10-13). So a record is gone for good 402 to 403 days after its
delivery, a day or two more if S3's lifecycle run is late, and storage
stops growing after that. "400 days" in the privacy notice means this.
Files smaller than 128 KB (nearly all of them) stay in the standard
storage class; the rule's move to Glacier Instant Retrieval at 90 days
applies to the larger ones. Volume in October 2026: about 4,700 files
and 12 to 16 MB a day for the whole organization, so about 6 GB held at
any time, under $0.20 a month; Object Lock itself costs nothing. The
vault data events ("Vault data events": writes and deletes on the two
vault data buckets) are delivered here as well and are locked like the
rest; their object keys carry vault and member identifiers. At a
thousand vaults, by that section's estimate of 16.5 million events a
month, they would add about 2.5 GB a month, some 33 GB held at any time,
under $1 a month of storage.

**What it does not cover.**

- **Files delivered before the deploy** (from 2026-10-01; 44,428
  versions and 147 MB on 2026-10-13) carry no lock, and the 1-day rule
  above makes them easier to lose than before. Nothing records or
  reports object calls on this bucket, so a single recursive delete
  (`aws s3 rm --recursive`, which adds a delete marker to every file)
  would go unnoticed, and the lifecycle rule would then remove every
  unlocked file for good within two days, where it used to take thirty.
  Locked files in the same situation are not removed until their lock
  ends. "Locking the files from before the deploy" below ends that
  difference; until it has run, the old files have this weakness.
- **A file can be hidden, and a forged one put in its place.**
  `delete-object` without a version id adds a delete marker, and the
  file then looks deleted in a plain listing. An administrator can also
  put a new version over an existing key, or add files that CloudTrail
  never wrote (the bucket policy's source condition binds the CloudTrail
  service, not the account's own administrators). In each case the
  delivered version is still there underneath until its lock ends
  (`list-object-versions`), but a plain download returns the newest
  version. `aws cloudtrail validate-logs` is what tells a delivered file
  from a forged or missing one: the digests are signed by CloudTrail.
- **Stopping the record at its source.** The trail lives in the
  management account, which no service control policy can bind (the
  `ProtectAuditTrail` statement of `vettid-workloads-baseline` covers
  the member accounts only). An administrator there can stop the trail,
  delete it, point it elsewhere or change its event selectors. Each of
  these is emailed (`AuditTampering`: `StopLogging`, `DeleteTrail`,
  `UpdateTrail`, `PutEventSelectors`), except when CloudFormation's CDK
  execution role makes the call.
- **Silencing the alerts.** Not reported today, each a follow-up:
  `events:PutRule` and `events:PutTargets` (an alert rule's pattern or
  target can be rewritten without an email; `AuditTampering` has only
  the delete, disable and remove-targets calls); any change to the alert
  topic itself (`sns:Unsubscribe`, `DeleteTopic`, `SetTopicAttributes`);
  and a trail that fails to deliver (no alarm; check 2 below is by
  hand).
- The log-file validation digests are locked like the logs, so a gap in
  the record stays provable; what happened in the gap is not recorded
  anywhere.

**Deploying a change to this bucket.** Look at the change set before it
runs: the bucket must be modified, never replaced.

```bash
npx cdk diff VettidOrgAuditStack --exclusively
npx cdk deploy VettidOrgAuditStack --exclusively --no-execute      # creates the change set, changes nothing
aws cloudformation describe-change-set --stack-name VettidOrgAuditStack --change-set-name cdk-deploy-change-set \
  --query 'Changes[].ResourceChange.[LogicalResourceId,ResourceType,Action,Replacement]' --output table
# TrailBucketA831CE63 and TrailBucketPolicyFEBC3C5C: Modify, Replacement False. The trail: absent, or Modify / False.
date -u +%Y-%m-%dT%H:%M:%S+00:00                                   # note it: the deploy time, used in the checks
npx cdk deploy VettidOrgAuditStack --exclusively
```

The deploy that turned the lock on did not change the trail resource, so
CloudTrail did not re-check the bucket policy then (it does that when a
trail is created or updated). The first later deploy that changes the
trail (new event selectors, for example) does; if CloudTrail objected,
that deploy would fail and roll back, and deliveries, which go by the
bucket policy alone, would not be affected.

**Checks** (after the deploy, and whenever in doubt). None of them
deletes or changes a delivered log file; never test the lock on one.

```bash
B=vettid-org-cloudtrail-449757308783
DEPLOY=<the time noted before the deploy, e.g. 2026-10-14T15:00:00+00:00>
# 1. The lock: Enabled, COMPLIANCE, 400 days; versioning Enabled; NoncurrentDays 1.
aws s3api get-object-lock-configuration --bucket $B
aws s3api get-bucket-versioning --bucket $B
aws s3api get-bucket-lifecycle-configuration --bucket $B --query 'Rules[].[Expiration.Days,NoncurrentVersionExpiration.NoncurrentDays]'
# 2. Deliveries go on (wait 15 minutes): times later than the deploy, no error.
aws cloudtrail get-trail-status --name vettid-org-trail \
  --query '[IsLogging,LatestDeliveryTime,LatestDeliveryError,LatestDigestDeliveryTime,LatestDigestDeliveryError]'
# 3. A file delivered AFTER the deploy carries the lock. (JSON output: the CLI
#    joins all pages before jq sees them. Prints nothing until such a file exists.)
P=AWSLogs/o-kualrldevn/449757308783/CloudTrail/us-east-1/$(date -u +%Y/%m/%d)/
aws s3api list-object-versions --bucket $B --prefix $P --output json \
  | jq -r --arg d "$DEPLOY" '[.Versions[]? | select(.LastModified > $d)] | sort_by(.LastModified) | last // empty | [.Key, .VersionId] | @tsv' \
  | while IFS=$'\t' read -r K V; do
      aws s3api head-object --bucket $B --key "$K" --version-id "$V" \
        --query '[LastModified,ObjectLockMode,ObjectLockRetainUntilDate]'    # COMPLIANCE, delivery + 400 days
    done
# 4. One hour after the deploy: every account and every region has a digest
#    newer than the deploy (get-trail-status is one answer for all of them).
for A in $(aws s3api list-objects-v2 --bucket $B --prefix AWSLogs/o-kualrldevn/ --delimiter / --output json | jq -r '.CommonPrefixes[].Prefix'); do
  for R in $(aws s3api list-objects-v2 --bucket $B --prefix "${A}CloudTrail-Digest/" --delimiter / --output json | jq -r '.CommonPrefixes[]?.Prefix'); do
    aws s3api list-objects-v2 --bucket $B --prefix "$R$(date -u +%Y/%m/%d)/" --output json \
      | jq -r --arg r "$R" --arg d "$DEPLOY" '([.Contents[]?.LastModified] | max) as $m | (if $m != null and $m > $d then "ok     " else "MISSING" end) + " \($m)  \($r)"'
  done
done      # one line per account and region (85 in October 2026), all "ok"; shortly after midnight UTC run it again later
```

To see a deletion refused, use a file of our own, never a log. The
prefix `lock-check/` is one CloudTrail does not write to; the file stays
for its 400 days (a few bytes) and then expires like the rest:

```bash
K=lock-check/$(date -u +%Y-%m-%dT%H%MZ).txt; echo "object lock check" > /tmp/lock-check.txt
V=$(aws s3api put-object --bucket $B --key $K --body /tmp/lock-check.txt --query VersionId --output text)
M=$(aws s3api head-object --bucket $B --key $K --version-id "$V" --query ObjectLockMode --output text); echo "$M"   # COMPLIANCE
[ "$M" = COMPLIANCE ] && aws s3api delete-object --bucket $B --key $K --version-id "$V"    # must fail: AccessDenied
```

If `$M` is not `COMPLIANCE` the lock is not in effect: stop and find out
why; the last line then does nothing.

**If something goes wrong.** What can be taken back, and what cannot:

- *Cannot:* Object Lock being enabled on the bucket, its versioning, and
  the lock on every file delivered in the meantime. Do **not** deploy an
  earlier commit to "undo" the change: its template has no Object Lock
  properties, S3 cannot turn Object Lock off, and what CloudFormation
  does when asked to is not documented.
- *Deliveries stopped* (check 2 shows an error). CloudTrail keeps
  trying: "If you misconfigure your trail (for example, the S3 bucket is
  unreachable), CloudTrail will attempt to redeliver the log files to
  your S3 bucket for 30 days" (CloudTrail user guide, "Amazon S3 bucket
  policy for CloudTrail"). So a break that is repaired within days loses
  nothing. If the error points at the bucket policy: remove only the
  block that adds `aws:SourceArn` (the `addOverride` loop after the
  `Trail` in `lib/stacks/audit-stack.ts`), keep the Object Lock
  properties, and deploy. If it points at the lock: take the default
  retention off while the cause is found, which affects new files only
  (and sends a `TrailBucketConfig` email):
  `aws s3api put-object-lock-configuration --bucket $B --object-lock-configuration '{"ObjectLockEnabled":"Enabled"}'`.
- *The lifecycle number* (1 day) is an ordinary property: change it in
  code and deploy.
- *The deploy itself failed half-way.* CloudFormation updates the bucket
  before its policy. If a later step failed, the automatic rollback
  would try to take the lock off the bucket again, which S3 refuses, and
  the stack could end in `UPDATE_ROLLBACK_FAILED`. Recovery: skip the
  bucket and let the rest roll back, then fix the cause and deploy again
  (the bucket keeps the lock, which is what the code says):
  `aws cloudformation continue-update-rollback --stack-name VettidOrgAuditStack --resources-to-skip TrailBucketA831CE63`.

**Locking the files from before the deploy.** One pass that gives every
version delivered before the deploy the same retain-until date:
**`2027-11-05T00:00:00Z`**. That is the oldest delivery in the bucket
(2026-10-01T20:46:01Z) plus 400 days, taken back to midnight UTC, so no
file is held past its own 400 days. The newest of the old files are
therefore without a lock for their last days (a file delivered on
2026-10-14 from 2027-11-05 until it expires around 2027-11-19). Read
this before running it: **a date that is too late cannot be shortened**,
by anyone, and would keep records beyond the published 400 days; check
the oldest delivery again (first command) and do not change the date to
anything later than it gives.

```bash
B=vettid-org-cloudtrail-449757308783
DEPLOY=<the deploy time, e.g. 2026-10-14T15:00:00+00:00>
UNTIL=2027-11-05T00:00:00Z
aws s3api list-object-versions --bucket $B --output json > /tmp/trail-versions.json     # every page, one document
jq -r '[.Versions[].LastModified] | min' /tmp/trail-versions.json     # the oldest delivery: + 400 days must not be before $UNTIL
jq -r --arg d "$DEPLOY" '.Versions[] | select(.LastModified < $d) | [.Key, .VersionId] | @tsv' /tmp/trail-versions.json > /tmp/trail-prelock.tsv
wc -l /tmp/trail-prelock.tsv; head -3 /tmp/trail-prelock.tsv; tail -3 /tmp/trail-prelock.tsv
# Without APPLY=1 this only prints what it would do.
while IFS=$'\t' read -r K V; do
  if [ "${APPLY:-}" = 1 ]; then
    aws s3api put-object-retention --bucket $B --key "$K" --version-id "$V" \
      --retention "{\"Mode\":\"COMPLIANCE\",\"RetainUntilDate\":\"$UNTIL\"}" || echo "FAILED $K $V"
  else
    echo "would lock until $UNTIL: $K"
  fi
done < /tmp/trail-prelock.tsv
```

About 50,000 calls, several hours; it can be stopped and run again
(setting the same date twice is allowed). A file that already has a
later date, because it was delivered after the deploy and `DEPLOY` was
given too late, is refused and reported as `FAILED`: harmless. For a
faster run the same list is the manifest of one S3 Batch Operations job
("Object Lock retention", compliance, the same date). Afterwards
`head-object` on a few of the listed versions shows the date.

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

## Membership requests

MEMBER-API 2.6.0 ("Request states", "Withdrawing a request",
"Retention", "Request emails") is the specification; this is what the
operator does, and does not have to do.

- **Automatic now, nothing by hand:**
  - *Unverified request*: deleted after 14 days (daily cleanup job,
    07:00 UTC), with its SES identity if the request created it
    (`owns_identity`; a row from before 2.6.0 keeps the old rule:
    unless the mailing list uses the address).
  - *Withdrawal*: the person uses the link in "We have your request
    for early access to VettID" (sent once, when the address is
    verified).
    The page is `https://account.vettid.org/request/withdraw/`; the
    button marks the row `withdrawn` and erases the names at once; the
    cleanup job's 15-minute run (`{"task":"requests"}`) removes the
    row, its `email:<addr>` marker, a Cognito user left by a failed
    code registration, and the SES identity if the request created it
    and the mailing list does not use it.
  - *Declined request*: removed the same way 30 days after the decline
    (daily run). At the first daily run after 2.6.0 is deployed, every
    request declined more than 30 days earlier goes (its `updated_at`
    is its decline time).
  - *Audit log*: a person's address is kept 90 days in a record beside
    the event (`addr#<month>` partition, TTL `expires_at`); events stay.
- **The admin notices** ("a request for early access arrived", "…was
  verified", "someone registered with a registration code") carry no
  name, address or code: read the request on the admin site.
  **One-time clean-up of the admin mailbox (owner):** notices sent
  before 2.6.0 carry the requester's name and address. Search
  admin@vettid.org for subjects starting `VettID: membership request
  from` and `VettID:` … `registered with a registration code` from
  `no-reply@vettid.org`, delete those dated before the deploy, and
  empty the trash (and any archive, forward or local copy). The
  requests themselves are on the admin site, so nothing is lost.
- **Alarms** (production: to `vettid-org-security-alerts`):
  - `vettid-org-request-removal-failing`: the cleanup job could not
    finish removing a withdrawn or expired request in the last hour.
    The row (with the address, without the names) is still in the
    table and is retried at every run for 7 days. Read the cleanup
    function's log group for `request removal failed` and its error
    name (no address is logged). Waiting rows:
    `aws dynamodb query --table-name vettid-org-members --index-name state-index --key-condition-expression '#s = :w' --expression-attribute-names '{"#s":"state"}' --expression-attribute-values '{":w":{"S":"withdrawn"}}' --select COUNT`
    (and `rejected` for declined ones). Typical causes: SES throttling
    (clears by itself), a changed IAM policy, the mailing-list table
    unreadable.
  - `vettid-org-request-removal-abandoned`: after 7 days of failures
    the job deleted the row and the marker without finishing the rest
    (audit `request.removal_incomplete`, subject the request's id).
    The address is no longer in the members table; an SES identity (or
    a Cognito user) may be left. Reconcile as for the mailing list
    ("Unsubscribe" → Alarms): compare `aws sesv2 list-email-identities`
    with the members table and the list, and delete an address
    identity that neither has, if a request created it (CloudTrail: a
    `CreateEmailIdentity` by the member API's public function role
    that succeeded).
- **Backfills (operator, once per stage after the 2.6.0 deploy; both
  are dry runs unless told otherwise and print counts only, never an
  address):**
  1. *The audit log's old events* still hold addresses inside them
     (`detail.email`; a member's address as `actor`). The Lambdas may
     only append to the audit table, so this needs an operator session:
     `npx ts-node --transpile-only --prefer-ts-exts scripts/ops/audit-address-backfill.ts [--stage staging]`
     shows what it would change, per action; add `--apply` to do it.
     Events younger than 90 days keep their address in a 90-day record;
     older ones lose it. Safe to repeat. Every `--apply` run appends one
     audit event, `admin.audit_address_backfill` (actor: your session's
     caller ARN; subject: the audit table; detail: the stage, the counts
     and `completed`, which is `false` if the run stopped on an error),
     so the admin site's audit view shows that old events were changed,
     by whom and how many. Look at any "UNCLASSIFIED" line
     before applying (an address as actor of an action the script does
     not know: it leaves those alone). Until this has run, "addresses
     in the audit log are gone after 90 days" is true only of events
     written since the deploy.
  2. *Requests verified before 2.6.0* have no withdrawal link and got
     no email. They are **not** mailed automatically.
     `npx ts-node --transpile-only --prefer-ts-exts scripts/ops/request-mail-backfill.ts [--stage staging]`
     counts them; `--send` emails each of them "We have your request
     for early access to VettID" with their link (`--send --guid <user_guid>`:
     one of them only). **That emails real people: the owner decides,
     per run.** Without it, such a request is still removed when an
     admin declines it (gone 30 days later), and "Removal by hand"
     below covers a person who asks. The same command also finds a
     request whose email failed to send.
- **"… is left" in the logs** (cleanup function, admin people
  function; level warn, with a `user_guid`, never an address):
  `the email marker belongs to another request and is left` and
  `the sign-in user under … address carries another id and is left`.
  A deletion found that the marker or the Cognito user under the
  address belongs to a newer request or account for the same address
  (MEMBER-API "Retention"), did not touch it, and deleted the rest.
  The deletion's audit event says the same in its detail
  (`sign_in_user: "left"`, `email_marker: "left"`).
  Nothing to do for the marker. For a sign-in user, check that a
  member row with that user's `custom:user_guid` exists
  (`aws cognito-idp admin-get-user --user-pool-id <member pool> --username a@example.com`,
  then `aws dynamodb get-item --table-name vettid-org-members --key '{"user_guid":{"S":"<that id>"}}'`):
  if none does, it is a leftover (an abandoned removal above) and
  `aws cognito-idp admin-delete-user` removes it; an approval for the
  address is refused until then.
  An admin's Delete that answers "No such member" for a row that was
  on the page a moment ago: the cleanup job (or another admin) removed
  the row first. This Delete did not delete it and wrote no
  `member.delete` event; the page still shows the row until it is
  reloaded. By then it had already removed the member's own Cognito
  user and subscription row if they were still there, and it removes
  an email marker that still names the row. It does not finish the
  rest of what the other deletion does (vaults, the SES identity):
  that is the other deletion's, and its own audit event says if any
  of it was not removed (`incomplete`, below).
- **The daily run's other two removals** (a canceled account past its
  date; an unverified request after 14 days) delete the row first,
  with its marker, and the rest after (MEMBER-API "Retention", "The
  daily sweeps"). They use the two alarms below:
  - `request-removal-failing` also means: the row of one of these
    could not be deleted (log: `canceled account: not removed` /
    `unverified request: not removed`, with the id and the error
    name). Nothing was touched; the next daily run tries again.
  - `request-removal-abandoned` also means: the row and marker are
    gone, and something of the member's own outside the row is not
    (log: `… removed, but not all of it`, with the id, `not_removed`
    and the error name; the audit event `member.delete_after_cancel`
    or `request.reclaim_unverified` for that id lists it in
    `incomplete`). It is not retried. By hand, for the id in the
    event: `subscription`: delete the row with that `user_guid` from
    the subscriptions table; `vaults`: query the vaults table's
    `user-index` for the id; rows with `deletion_requested_at` are
    retried by the job itself, the others are the operator's (section
    "Vault"; and delete the pointer row `user#<id>`); `sign_in_user`:
    the user is disabled since the cancellation and carries that id,
    `aws cognito-idp list-users --user-pool-id <member pool> --query "Users[?Attributes[?Name=='custom:user_guid' && Value=='<id>']].Username"`,
    then `admin-delete-user` (until then an approval for that address
    is refused); `ses_identity`: reconcile as for an abandonment below.
- **Removal by hand** remains for four things only:
  1. *A request verified before 2.6.0 whose owner asks by email*
     (no link, if the backfill email was not sent): send that one
     person their link,
     `… scripts/ops/request-mail-backfill.ts --send --guid <user_guid>`
     (the id under the name on the admin site's requests page), and
     they withdraw it themselves; or decline it on the admin site (it
     is deleted in 30 days). The SES identity of such a row is left:
     see 3.
  2. *An account* (an approved request): the member cancels it in the
     account site, or an admin deletes it. Not the withdrawal link.
  3. *The SES identity of an address whose row had no `owns_identity`*
     (every row from before 2.6.0) or that an admin deleted with
     Delete: the automatic removal leaves it (never on doubt).
     `aws sesv2 delete-email-identity --email-identity a@example.com`
     once you have checked that neither a member row
     (`aws dynamodb query --table-name vettid-org-members --index-name email-index --key-condition-expression 'email = :e' --expression-attribute-values '{":e":{"S":"a@example.com"}}' --select COUNT`)
     nor the mailing list
     (`aws dynamodb get-item --table-name vettid-org-mailing-list --key '{"email":{"S":"a@example.com"}}'`)
     uses it.
  4. *Approve answers "a sign-in user from an earlier request or
     account already exists for this address"* (`409`; the People
     function's log has `approve refused` with the request's id): the
     member pool holds a user under that address with another
     `custom:user_guid`, left by a removal that was given up on
     (`request-removal-abandoned` above) or by a half-deleted account.
     Check that the only member row for the address is the request
     being approved (the `email-index` query in 3: count 1, and its
     `user_guid` is the request's), look at the stale user
     (`aws cognito-idp admin-get-user --user-pool-id <member pool> --username a@example.com`:
     its `custom:user_guid` names no row), delete it
     (`aws cognito-idp admin-delete-user --user-pool-id <member pool> --username a@example.com`),
     then approve again on the admin site.
  What remains after any removal, and for how long: the tables'
  backups (35 days), the audit log's address records (90 days from
  each event), the CloudTrail record of the SES calls (400 days).
- **Logs of the member and admin APIs** (not changed by 2.6.0): every
  function's own log group (errors, job counts; no addresses by
  design) is kept **30 days** (`ApiFunction`'s default,
  `lib/constructs/api-function.ts`): the 13 functions of
  `VettidOrgMemberApiStack` (Public, Auth, Account, Vault, LinkMailer,
  VaultAccountPush, VerificationsJob, CleanupJob, MembersStreamMailer,
  VaultAlarmMailer, VaultNamesJob, VaultNoticeJob, VaultServiceWatch)
  and the 5 of `VettidOrgAdminApiStack` (People, Content, System,
  VaultCanary, VaultService). The member API's access log
  (`/vettid-org/<stage>/member-api/access`: time, path, status), the
  account and admin sites' CloudFront logs and their WAF logs are kept
  **90 days**.
- **A window that remains** (rare): a mailing-list sign-up for the
  same address in the instant between the job's check of the list and
  its `DeleteEmailIdentity` loses the identity its verification mail
  was sent for; that sign-up then expires unverified after 3 days and
  the person signs up again.
- **Staging**: the same flow with `--stage staging` / `--profile
  vault-staging` and the `vettid-org-staging-*` tables. Test
  addresses at `test.staging.vettid.org` are the project's own: their
  SES identities are never deleted by a removal (and IAM would refuse
  it), so a withdrawn test request leaves its identity, as before.

## Mailing list

- Flow: `POST /api/subscribe` → SES `CreateEmailIdentity` (SES's verification
  email IS the double opt-in) → pending row in `vettid-org-mailing-list` →
  15-min sweep confirms verified addresses and sends each a short welcome
  mail (their first mail from us, carrying their unsubscribe link).
- Addresses SES has **already** verified (e.g. VettID members) get no SES mail,
  so the API sends its own "Confirm your VettID updates subscription" email
  with a single-use link (`GET /api/subscribe/confirm?t=…`, 48 h; only the
  token's SHA-256 is stored). Rows wait as `status = pending_link` (never
  `pending`, which the sweep would auto-confirm); the link 302s to
  `https://vettid.org/?subscribed=1` (`=0` if stale). Both kinds of mail share
  the 200/hour global send cap.
- The API only serves requests carrying CloudFront's `X-Origin-Verify` secret
  (`vettid-org-signup/origin-verify`); `POST /api/subscribe` takes only
  `application/json` (415 otherwise). Rotating the secret: update it, then redeploy VettidOrgStack
  (the Lambda re-reads it within 5 minutes).
- The sweep reclaims (deletes) SES identities of rows that expired unverified,
  but only an identity the list itself created (`ownsIdentity` on the row,
  see "Unsubscribe"), and not if the address belongs to a row in
  `vettid-org-members` (a pending member may be mid-verification). It can never delete the `vettid.org` domain
  identity (explicit IAM deny).
- Every confirmation emails **admin@vettid.org** from `no-reply@vettid.org`
  (SES domain identity, DKIM in the zone). That sender is fixed in
  `VettidOrgSignupStack`, which is part of the production app only: a
  stage has no mailing list. The notice says that somebody
  confirmed, how and when; it does **not** carry the address (that mailbox is
  at another provider, outside the list's storage and its deletion). To see
  who is on the list, export it (below).
- **One-time clean-up of the admin mailbox (owner).** Until this change every
  notice carried the subscriber's address. Those copies are still in the
  admin@vettid.org mailbox and can only be removed there: search it for the
  subject `New mailing list subscriber` from `no-reply@vettid.org`, delete
  every result dated before the deploy of this change, and empty the trash
  (and any archive, forward or local mail-client copy). The addresses
  themselves are still in the table, so nothing is lost.
- Export subscribers (the table also holds `#…` counter/link rows and
  unconfirmed rows, so filter):
  `aws dynamodb scan --table-name vettid-org-mailing-list --filter-expression '#s = :c' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":c":{"S":"confirmed"}}' --output json`
- The table has deletion protection on (and RETAIN); turn it off in code first
  if it ever really has to go.
- **SES is in sandbox**: fine for the opt-in flow (verified recipients only by
  design), but bulk sending to the list requires production access — request it
  in the SES console before the first newsletter.

### Unsubscribe

- **The token.** Every subscriber row has `unsubToken`: 32 random bytes
  (base64url), created with the row, found through the sparse, keys-only
  index `unsub-index`. It names the row without carrying or accepting an
  address, works for as long as the row exists (also before confirmation),
  and is dead once used, because unsubscribing deletes the row; signing up
  again makes a new row with a new token. There is no server secret.
- **The link in the mail body** is `https://vettid.org/unsubscribe/#u=<token>`.
  The token is in the URL fragment, which browsers do not send: it reaches no
  log. The page (`website/unsubscribe/`, `website/js/unsubscribe.js`) shows
  one button; opening it changes nothing. The button posts the token in a
  form body to `POST /api/subscribe/unsubscribe`, which answers 303 to
  `/unsubscribe/done/` ("You have been removed from the VettID mailing
  list.").
- **The headers** (RFC 8058): `List-Unsubscribe:
  <https://vettid.org/api/subscribe/unsubscribe?u=<token>>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. A mail provider's
  one-click POST to that URL removes the row and gets 200 with the same
  sentence as text. Here the token is in the query string, so it is in the
  CloudFront and WAF logs for their 90 days, and it stays valid until it is
  used (a GET logs it without using it); all it can do is remove that one
  address. A **GET** of that URL never unsubscribes (scanners and link
  previewers fetch links): it redirects to the page above, which takes the
  token out of the address bar and the browser history once it has read it.
- **The answers are the same** for a valid, a used, an unknown and a
  malformed token, so the route cannot be used to find out whether an address
  or a token is on the list. Only a failure on our side answers differently
  (503, "nothing was changed"). Nothing is cached (`no-store`, and `/api/*`
  has caching disabled). Neither Lambda logs an address or a token.
- **What is deleted, and when.**
  - At once: the subscriber's row (address, times, status, token) and, for an
    unconfirmed row, its confirm-link pointer. The address is off the list
    from that moment.
  - **Only an SES identity the list created is ever deleted.** A row carries
    `ownsIdentity = true` only when the sign-up's own `CreateEmailIdentity`
    call succeeded. An identity that was already there (a member's, one the
    operator verified, anyone's: the sign-up form accepts any address, and
    the confirmation mail it sends carries a working unsubscribe link) is
    never touched, whatever happens to the row. A row without the flag
    leaves no marker when it is removed. Rows from before this change have
    no flag and are treated as not the list's. For the one subscriber
    confirmed before this change that is also the truth: CloudTrail shows the
    sign-up's `CreateEmailIdentity` for it answered `AlreadyExistsException`
    (2026-08-14), so the identity was not the list's.
  - Within 15 minutes, normally, for a row with the flag: the address's SES
    identity. The API leaves a marker row (`#release#…`, `status = release`,
    holding the address, so until the sweep the address is still in the
    table) and the sweep deletes the identity, then the marker. The sweep
    keeps the identity, and only deletes the marker, when the address belongs
    to a member (the member table's `email:<addr>` marker row, read strongly
    consistent, or the email index), when the address is back on the list
    (that row then takes the flag over), or when it is one of ours
    (`@vettid.org`).
  - If the member lookup or SES fails, the marker stays and every sweep tries
    again (`releaseRetry` in the sweep's log line), for 7 days. Then the
    sweep gives up on it (`releaseAbandoned`): the address is taken off the
    marker, the marker leaves the queue and expires after 90 days as a bare
    count, and the SES identity is **not** deleted (never on doubt). Markers
    are worked newest first and page by page, and independently of the
    pending rows, so a failing one holds up nothing else.
  - **Alarms** (to `vettid-org-security-alerts`):
    `vettid-org-mailing-list-release-retry` (retries in four sweeps in a row:
    an address has been waiting an hour),
    `vettid-org-mailing-list-release-abandoned` (the sweep gave up on one),
    `vettid-org-mailing-list-sweep-errors` (the sweep failed four times in a
    row). What to do: read the sweep's log group for `release_failed` /
    `member_lookup_failed` and their error names; waiting markers are
    `aws dynamodb query --table-name vettid-org-mailing-list --index-name status-index --key-condition-expression '#s = :r' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":r":{"S":"release"}}'`
    (each `target` is an address to finish by hand: steps 2 and 3 of
    "Removal by hand", then delete the marker row). After an abandonment the
    address is no longer in the table: compare
    `aws sesv2 list-email-identities` with the list (export above) and the
    members table, and delete an address identity that neither has, if the
    list created it (CloudTrail: a `CreateEmailIdentity` by the sign-up
    function's role that succeeded).
  - Within 35 days: the table's point-in-time-recovery backups.
  - **Not** deleted by unsubscribing: the organization CloudTrail (audit
    stack, 400 days) records every SES `CreateEmailIdentity`,
    `GetEmailIdentity` (the sweep asks once per pending row every 15
    minutes) and `DeleteEmailIdentity` call with the address as a request
    parameter; and
    whatever is in the admin mailbox from before the notice lost the address
    (clean-up above).
- **Subscribers from before this change** have no token until one is made
  for them. Run once after the deploy, and again right before any mailing
  (safe to repeat; a token is never replaced):
  `node scripts/list/unsubscribe-links.mjs` (prints counts only).
- **Any future mailing** must be list mail as the Lambdas send it: build each
  message with `listMessage({ to, subject, text, token })` from
  `lambda/signup/list-mail.mjs` (it appends the link and sets both headers),
  with the row's `unsubToken` (`ensureUnsubscribeToken()` returns it and
  creates it if missing). For a tool that cannot import that module,
  `node scripts/list/unsubscribe-links.mjs --links` prints, per confirmed
  subscriber, the address, the body link and the one-click URL (tab
  separated; they are addresses and tokens: to a terminal or a pipe, never a
  log or a file that is kept). The headers have to be covered by the DKIM
  signature for providers to honour them; check one delivered message before
  the first real mailing.
- **Limits on the unsubscribe POST.** After a mailing, providers send their
  one-click POSTs from a few addresses in a burst, and a 429 there is a
  person who believes they left and did not. So `POST
  /api/subscribe/unsubscribe` is outside the site's general rate rules (300
  and 20 per 5 minutes per IP, 600 and 50 per JA4) and has its own: WAF
  `rate-limit-unsubscribe`, 2,000 per 5 minutes per IP, and an API throttle
  of 50 per second (burst 100) instead of the stage's 5. A request with a
  wrong token costs one index query. Before a mailing to more than a few
  thousand people, look at these two numbers again
  (`lib/stacks/web-stack.ts`, `UNSUBSCRIBE_THROTTLE` in
  `lib/stacks/signup-stack.ts`). The GET and the pages stay under the
  general rules.
- **Mails the list sends today**, all with the link and headers: the
  confirmation link (to an address SES had already verified) and the welcome
  mail the sweep sends when an SES verification is accepted. Amazon's own
  verification email cannot carry our link; the welcome mail is why those
  subscribers have one.
- **Removal by hand** (a request by email; the address is `a@example.com`):
  1. The row: `aws dynamodb delete-item --table-name vettid-org-mailing-list --key '{"email":{"S":"a@example.com"}}' --return-values ALL_OLD`
     (lower-case the address; the output shows what was there. If it shows a
     `tokenHash`, also delete the key `#confirm#<tokenHash>`.)
  2. The SES identity, unless a member uses the address:
     `aws dynamodb query --table-name vettid-org-members --index-name email-index --key-condition-expression 'email = :e' --expression-attribute-values '{":e":{"S":"a@example.com"}}' --select COUNT`
     and, if the count is 0,
     `aws sesv2 delete-email-identity --email-identity a@example.com`.
     Delete it only if the list created it: the row you deleted in step 1
     had `ownsIdentity` true. If it had not, leave the identity.
  3. The admin mailbox: delete any `New mailing list subscriber` notice that
     names the address (only notices from before this change do), and the
     request email itself once it is answered, unless it has to be kept as a
     record of what was asked.
  4. What remains, and for how long: the table's backups (35 days), the
     CloudTrail record of the SES calls (400 days), and request logs, which
     hold no address.
- **A window that remains** (rare; recovery by hand): a member who registers
  with an address in the instant between the sweep's member check and its
  `DeleteEmailIdentity` loses the SES identity their verification mail was
  sent for. The check reads the member table's marker row strongly
  consistent, so the window is the milliseconds between two calls, not the
  index's second. If it happens the member's link fails: use the admin
  site's "resend verification" for that person, which creates the identity
  again.

## Logging & analysis

- **One retention period for the public website's logs: 90 days** (the
  owner's decision of 2026-10-12). It is one constant,
  `WEBSITE_LOG_RETENTION_DAYS` in `lib/constructs/website-logs.ts`, used by
  every store the site and its sign-up path write to:
  the CloudFront access logs (`vettid-org-access-logs`), the WAF log group
  (`aws-waf-logs-vettid-org`), the Athena results bucket
  (`vettid.org-athena-results`), and the two sign-up Lambdas' log groups
  (VettidOrgSignupStack). To change it: change the number, deploy
  `VettidOrgSignupStack` and `VettidOrgStack`, and change the number on the
  privacy page. CloudWatch accepts only certain values (30, 60, 90, 120, …);
  synth fails on any other. A shorter period also deletes what is already
  older than it (S3 within a day or two, CloudWatch within about three); a
  longer one keeps what exists for longer. The sign-up HTTP API writes no
  access log. The account and admin sites, the member API and the relay have
  their own settings (below and in their stacks) and are not touched by this
  constant.
- CloudFront v2 JSON logs → `s3://vettid-org-access-logs/AWSLogs/<acct>/CloudFront/cloudfront-v2/…`
  → Athena table `vettid_logs.cloudfront_logs_v2`
  (partition projection; pass `distributionid` as injected partition). This is
  the site's only access log.
- The legacy TSV log (`vettid.org-logs`, table `vettid_logs.cloudfront_logs`)
  is **off** and its table is gone: it wrote the same requests a second time.
  The bucket still exists and empties itself under its 30-day rule. Once it
  is empty (30 days after the deploy that turned the log off:
  `aws s3 ls s3://vettid.org-logs --recursive --summarize | tail -2`), the
  bucket and its `LogsBucket` resource and output can be removed in a later
  change.
- WAF telemetry (JA3/JA4 fingerprints, ordered headers, cookie/auth redacted) →
  CloudWatch group `aws-waf-logs-vettid-org`. Join to CloudFront logs
  on request ID.
- Not visitor logs, and not on the website's period: the log group of the
  CDK site-deployment helper (`/aws/lambda/VettidOrgStack-CustomCDKBucketDeployment…`:
  file names of each site deploy), and the organization CloudTrail (audit
  stack, 400 days), which records the SES identity calls the mailing list
  makes, with the address (see "Unsubscribe").
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

Vault data events (organization trail) and GuardDuty S3 protection: under
$0.50/month today; $1 per million object writes on the vault data
buckets (trail) plus $0.80 per million object calls, reads included
(GuardDuty) ("Vault data events").

Relay (when deployed), at idle: ~$55/month — ALB ~$16, two 0.25 vCPU tasks
~$15, four public IPv4 addresses ~$15, Valkey Serverless minimum ~$6, logs
and DynamoDB a few dollars. It grows with use at roughly $9 per million
messages plus ~$0.003 per always-on long-poll collector per month (DynamoDB
on-demand), with idle collectors mostly served from Valkey (empty hints);
see the relay PRs for the 1k/10k/100k estimates.

Push gateway (when deployed): about $25/month per channel — two 0.25 vCPU
tasks ~$15, their two public IPv4 addresses ~$7, three secrets ~$1, six
alarms and four filter metrics ~$2 — plus, once, the key ($1) and the
staging zone ($0.50). The load balancer is the relay's.

Vault host stack, per vault account, with every group parked: about
$6–8/month (scaler and sync custom metrics ~$4, ~10 alarms ~$1–2, smoke
key $1, DNS Firewall, query and flow logs, Lambda within the free tier).
Each running m7g.large host adds ~$60 plus ~$5 for its public IPv4 and
disk; an AMI build costs a few cents of builder time; each release's AMI
snapshot is well under $1/month.
