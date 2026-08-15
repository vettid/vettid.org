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
  (props flow left to right in `bin/vettid.org.ts`).

## Stacks

| Stack | Owns |
|---|---|
| `VettidOrgDnsStack` | Route53 zone for vettid.org + ProtonMail mail records |
| `VettidOrgStack` | Site bucket, CloudFront, cert, WAF telemetry, all logging |
| `VettidOrgSignupStack` | Mailing list: DynamoDB, Lambdas, HTTP API, SES domain identity |
| `VettidDevRedirectStack` | The entire vettid.dev footprint: blanket 301 → vettid.org. Permanent. |

## DNS

- Route53 is authoritative for **vettid.org** and **vettid.dev**; the registrar
  (Hover) only points nameservers.
- ProtonMail records (MX/SPF/DKIM/DMARC) live in the DnsStack — change mail
  config in code, not the console.
- ACM certs auto-validate through the zones; renewals are hands-off.

## Mailing list

- Flow: `POST /api/subscribe` → SES `CreateEmailIdentity` (SES's verification
  email IS the double opt-in) → pending row in `vettid-org-mailing-list` →
  15-min sweep confirms verified addresses. Already-verified addresses confirm
  instantly.
- Every confirmation emails **admin@vettid.org** from `no-reply@vettid.org`
  (SES domain identity, DKIM in the zone).
- Export subscribers:
  `aws dynamodb scan --table-name vettid-org-mailing-list --output json`
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
