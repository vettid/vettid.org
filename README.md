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

Plain static HTML/CSS/JS in `website/` — no build step. Pages: `/` (landing with mailing-list signup), `/security`, `/donate`, `/open-source`, plus `/404.html`. App routes return when the production backend migrates from vettid.dev.

Design system: "Night Watch" — ground `#0b0b12`, indigo bands `#212062`, surfaces `#14142a`/`#1b1b3a`/`#2e2d88`, daylight band `#f4f4f6`, gold `#ffc125` (scarce by policy). Tokens in `website/assets/site.css`. Fonts: Plus Jakarta Sans + Inter + IBM Plex Mono, self-hosted.

## Stacks

```
bin/vettid.org.ts             — app entry, wires all stacks (all us-east-1)
lib/stacks/dns-stack.ts       — VettidOrgDnsStack: Route53 zone + ProtonMail records
lib/stacks/web-stack.ts       — VettidOrgStack: site bucket, CloudFront, cert, WAF, logging
lib/stacks/signup-stack.ts    — VettidOrgSignupStack: mailing list (DynamoDB + Lambda + HTTP API)
lambda/signup/                — subscribe + verification-sweep handlers (Node 20, no build step)
```

Deploy order (cross-stack props flow left to right):

```bash
npx cdk deploy VettidOrgDnsStack VettidOrgSignupStack VettidOrgStack
```

Conventions for future components (account site, admin site, vault services):
one stack per component in `lib/stacks/`; stateful resources (tables, data
buckets, user pools) separated from stateless wiring; cross-stack values as
explicit props from `bin/vettid.org.ts`, never ad-hoc CFN exports; new
subdomains and certs come from the Route53 zone.

The mailing list uses SES identity verification as the double opt-in:
POST /api/subscribe calls CreateEmailIdentity, SES sends its verification
email, and a 15-minute sweep promotes verified addresses to `confirmed` in
the `vettid-org-mailing-list` table. Works entirely inside the SES sandbox.

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
