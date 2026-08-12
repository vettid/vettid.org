# vettid.org

AWS CDK infrastructure and static content for [vettid.org](https://vettid.org).

## Architecture

- **S3** (`vettid.org-website`): private origin bucket, versioned, deployed from `website/` by `BucketDeployment`
- **CloudFront**: serves `vettid.org` (301s `www.` to apex), HTTPS-only, PriceClass 100
  - Viewer-request function: clean-URL rewrite (`/security` → `/security/index.html`), sensitive-path blocking, www→apex redirect
  - Response headers: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy
  - Custom 404 page (`/404.html`) for missing paths
- **ACM**: certificate for `vettid.org` + `www.vettid.org` (DNS-validated, us-east-1)
- **WAF** (`vettid-org-telemetry`): default-allow WebACL used purely for telemetry — its logs carry JA3/JA4 TLS fingerprints and ordered request headers (cookie/authorization redacted) to CloudWatch log group `aws-waf-logs-vettid-org`
- **Access logs** (per `~/VettID/vettid-org-logging-spec.md`):
  - Standard logging v2: JSON Lines to `vettid-org-access-logs` (90-day retention), queryable via Athena table `vettid_logs.cloudfront_logs_v2` (partition projection; pass `distributionid` as an injected partition)
  - Legacy TSV logs to `vettid.org-logs` (30-day retention), queryable via `vettid_logs.cloudfront_logs`; cookies excluded
- **Athena**: workgroup `vettid-logs-workgroup`, results to `vettid.org-athena-results`

## Website

Plain static HTML/CSS/JS in `website/` — no build step. Live pages: `/` (landing), `/security`, `/donate`. All app routes (`/signin`, `/account`, `/register`, `/votes`, `/pcr`, `/help`, `/leash`, `/auth`, `/signout`, `/enroll`) are "coming soon" placeholders until the production backend migrates from vettid.dev.

Design tokens: ground `#1f1e5c`, surface `#28276f`, brand `#2e2d88`, ink `#16153f`, border `#403e9c`, gold `#ffc125`. Fonts: Plus Jakarta Sans (headings) + Inter (body), self-hosted.

## Commands

```bash
npm run build    # compile TypeScript
npm test         # CDK assertion tests
npx cdk diff     # preview changes against deployed stack
npx cdk deploy   # deploy (publishes straight to production)
```

Local preview: `python3 -m http.server 8080` from `website/`.

## Log analysis

See `LOGS_ANALYSIS_GUIDE.md` for Athena queries against the legacy table. The v2 JSON table (`cloudfront_logs_v2`) requires injected-partition queries, e.g.:

```sql
SELECT * FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'EXXXXXXXXXXXXX'
  AND log_hour >= '2026/08/12/00'
LIMIT 100;
```
