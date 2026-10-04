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

## Stacks

Stateful stacks (Dns, Signup, Playbooks, Auth, Data, AdminAccess, RelayData) have
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
| `VettidOrgDataStack` | Account/admin DynamoDB tables (`vettid-org-*`), the vault alternate-channel tables (`vettid-org-vault*`, docs/MEMBER-API.md "Vault") + terms PDF bucket. Stateful. |
| `VettidOrgAdminAccessStack` | Admin tailnet exit node (EC2 + EIP) and the CloudFront WAF allowlist keyed to its IP (admin site). |
| `VettidOrgAdminApiStack` | Admin REST API at admin-api.vettid.org (docs/ADMIN-API.md): exit-node-IP resource policy + Cognito authorizer, 3 route-group Lambdas. |
| `VettidOrgAdminSiteStack` | Admin SPA at admin.vettid.org (`sites/admin`), behind the exit-node web ACL. |
| `VettidOrgRelayDataStack` | Relay state: DynamoDB table `vettid-org-relay` and the blob bucket `vettid-org-relay-blobs-<account>` (published via SSM `relay/*`). Stateful. |
| `VettidOrgRelayStack` | relay.vettid.org: VPC (no NAT; S3 + DynamoDB gateway endpoints), ElastiCache Serverless Valkey (IAM auth, TLS), ECS Fargate service (2–8 tasks, rolling deploys), ALB with PQ TLS. Logs to `/vettid-org/<stage>/relay-service`. Only deployed when `relayImage` is set. |

## CDK conventions (new stacks)

Applies to everything added from the account/admin work onward
(docs/ACCOUNT-ADMIN-PLAN.md §3); the stacks above are grandfathered and keep
their construct IDs.

- **App wiring** lives in `lib/app.ts` (`bin/` only calls `buildApp`).
  Config — stage, domain, region, sender/admin email — comes from
  `lib/config.ts`; `-c stage=<name>` exists for a future staging account and
  defaults to `prod`. Physical names come from `resourceName()`
  (`vettid-org-<thing>`); hosts from `hostName()`.
- **Stateful vs stateless.** Pools and tables go in stateful stacks
  (Auth, Data) with `RemovalPolicy.RETAIN`; APIs and sites go in stateless
  stacks that deploy freely.
- **No CloudFormation exports between them.** Producers call `publishRef()`,
  consumers `readRef()` (`lib/constructs/ssm-refs.ts`, params under
  `/vettid-org/<stage>/…`). Deploy the producer first.
- **Lambdas** are defined only through `ApiFunction` (Node 24, ARM64, esbuild,
  1-month log group) and served through `HttpRouteGroup`: one function per
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

## Vault (from V5; placeholder)

Nothing runs yet. When VAULT-PLAN V5 lands, this section covers: publishing
a release (reproducible build, PCRs, manifest signing, the release's
immutable KMS key), scaling the enclave host ASG from 0 and on-demand starts
of older releases, instance and lease health, incident classes and first
responses, capacity per host, and the disaster-recovery objectives listed in
VAULT-PLAN V5 (VAULT-RELEASES), and retirement after notice: at a
release's end date it is `removed`, its stack deleted and its key
scheduled for deletion **as the retirement role, with exactly the pinned
window** (30 days in production; any other window is refused by the key
policy), with a rescue (cancel, enable, restart, move) on request within
that window (VAULT-RELEASES §3.5, §10.3). Release keys can never be
disabled or have their policy changed; the host and retirement roles named
in their policies must never be deleted (VAULT-RELEASES §6.3).

## DNS

- Route53 is authoritative for **vettid.org** and **vettid.dev**; the registrar
  (Hover) only points nameservers.
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
