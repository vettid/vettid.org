# VettID.org Logs Analysis Guide

Traffic telemetry for vettid.org lives in **two streams**, by design:

| Stream | Where | What it uniquely has |
|---|---|---|
| CloudFront standard access logs (v2, JSON Lines) | S3 `vettid-org-access-logs`, queryable via Athena (`vettid_logs.cloudfront_logs_v2`) | Full request/response detail: URI, status, bytes, timing, edge result types |
| WAF telemetry | CloudWatch Logs group **`aws-waf-logs-vettid-org`** | **JA3/JA4 TLS fingerprints**, request header **names in received order**, WAF rule outcomes |

The split exists because CloudFront's standard logs cannot carry TLS
fingerprints — no such fields exist in the v2 field set, and forwarding the
`CloudFront-Viewer-JA3/JA4-Fingerprint` headers via an origin-request policy
only sends them to the S3 origin, which logs nothing. On CloudFront, **WAF
logging is the only mechanism that lands JA3/JA4 in a log record**. The WAF
web ACL (`vettid-org-telemetry`) is default-allow with no blocking rules; it
exists to produce this telemetry.

The two streams join on the CloudFront request ID:
**WAF `httpRequest.requestId` = access log `x_edge_request_id`.**

Privacy rules (logging spec §5, non-negotiable): `Cookie` and `Authorization`
values are redacted in WAF records and excluded from access logs. Email
addresses are never logged anywhere.

---

## Stream 1: TLS fingerprints (WAF telemetry)

Each record in `aws-waf-logs-vettid-org` is JSON with top-level
`ja3Fingerprint` and `ja4Fingerprint` fields. Live sample (2026-08-16):

```json
{
  "timestamp": 1786...,
  "action": "ALLOW",
  "ja3Fingerprint": "68b3ecfaf0034bb9fcbecd518b5ab8d4",
  "ja4Fingerprint": "t13d201100_2b729b4bf6f3_36bf25f296df",
  "httpRequest": {
    "clientIp": "…",
    "country": "PL",
    "uri": "/",
    "requestId": "pVksGE8oR2rb3WkaJraPySIqym8pK-…==",
    "headers": [ { "name": "Host", "value": "vettid.org" } ]
  }
}
```

(That sample is a real bot: TLS 1.3 client sending only a `Host` header —
exactly the kind of client these fields characterize.)

Field conventions:

- **JA4 preferred, JA3 also captured** (spec §2). Both are emitted per
  request by AWS; the format is AWS-controlled.
- **Absence handling:** AWS may emit an empty string or omit the field when
  no fingerprint is available. Normalize at query time — treat empty and
  missing as the same "not captured" state (e.g. `nullif(ja3Fingerprint,'')`
  in SQL after export, or `isPresent(ja4Fingerprint)` filters in Insights).
- **`httpRequest.headers`** preserves the received header order — project
  names only for `header_names_ordered`; values for `Cookie`/`Authorization`
  are `REDACTED` at capture.
- **`client_hints_present`** is derivable: any `sec-ch-ua*` name in the
  headers array.
- **HTTP/2 fingerprints (`h2_fingerprint`) are not capturable on CloudFront**
  — no header, log field, or WAF record exposes one. Per spec §6, this field
  is documented as explicitly absent on this CDN rather than emitted empty.

### Querying with CloudWatch Logs Insights

Console → CloudWatch → Logs Insights → log group `aws-waf-logs-vettid-org`.

Top fingerprints over the window:

```
stats count(*) as requests by ja4Fingerprint
| sort requests desc
| limit 25
```

One fingerprint wearing many User-Agents (impersonation tell):

```
filter ispresent(ja4Fingerprint)
| parse @message /"name":"[Uu]ser-[Aa]gent","value":"(?<ua>[^"]*)"/
| stats count_distinct(ua) as identities, count(*) as requests by ja4Fingerprint
| sort identities desc
| limit 25
```

All activity for one fingerprint (with join keys for Athena):

```
filter ja4Fingerprint = "t13d201100_2b729b4bf6f3_36bf25f296df"
| fields @timestamp, httpRequest.clientIp, httpRequest.country, httpRequest.uri, httpRequest.requestId
| sort @timestamp desc
```

Client-hints presence rate (rough Chrome-family vs other/tooling split):

```
stats count(*) as requests,
      sum(strcontains(@message, "sec-ch-ua")) as with_client_hints
```

### Joining to the access logs

Take `httpRequest.requestId` values from an Insights result and filter the
Athena table on them:

```sql
SELECT date, time, c_ip, cs_uri_stem, sc_status, cs_user_agent
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND x_edge_request_id IN ('pVksGE8oR2rb3WkaJraPySIqym8pK-…==', '…')
ORDER BY date DESC, time DESC;
```

If regular fingerprint-enriched SQL becomes routine, the clean upgrade is
pointing the WAF logging destination at S3/Firehose and adding a Glue table,
making the join a plain Athena `JOIN` — a stack change, not an analysis one.

---

## Stream 2: Access logs (Athena)

1. AWS Console → **Amazon Athena**
2. Workgroup **vettid-logs-workgroup**
3. Database **vettid_logs**, table **cloudfront_logs_v2**

Two table rules that will bite you if skipped:

- **Every query must pin the distribution**: `WHERE distributionid = 'E17RU9Q7P4C2QY'`.
  The table uses injected partition projection, and Athena rejects any query
  without a static equality condition on `distributionid`.
- The legacy `cloudfront_logs` table is the old v1 (TSV) format with the old
  column names — historical data only, aging out under the 30-day retention.
  New analysis targets `cloudfront_logs_v2`.

### Fields

All columns are strings — `CAST` before doing math. The main ones:

- `date`, `time`, `timestamp_ms` — request time (UTC)
- `c_ip`, `c_port`, `c_country`, `asn` — client network identity
- `cs_method`, `cs_uri_stem`, `cs_uri_query`, `cs_protocol_version` — request
- `x_host_header` — requested domain (vettid.org / www.vettid.org)
- `sc_status`, `sc_bytes`, `sc_content_type` — response
- `cs_user_agent`, `cs_referer` — client-claimed identity
- `x_edge_location`, `x_edge_result_type`, `x_edge_detailed_result_type` — CDN handling (cache hits, errors, function 403s)
- `x_edge_request_id` — **join key to WAF telemetry**
- `ssl_protocol`, `ssl_cipher`, `time_taken`, `time_to_first_byte`
- Partitions: `distributionid`, `log_hour` (`yyyy/MM/dd/HH`)

There is deliberately no `cs_cookie` column (spec §5).

### Example queries

Recent requests (last 24h):

```sql
SELECT date, time, c_ip, cs_method, cs_uri_stem, sc_status, cs_user_agent
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '1' day, '%Y-%m-%d')
ORDER BY date DESC, time DESC
LIMIT 100;
```

Unique visitors (7 days):

```sql
SELECT COUNT(DISTINCT c_ip) AS unique_visitors
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '7' day, '%Y-%m-%d');
```

Top client IPs:

```sql
SELECT c_ip,
       COUNT(*) AS request_count,
       SUM(CAST(sc_bytes AS bigint)) AS total_bytes
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '7' day, '%Y-%m-%d')
GROUP BY c_ip
ORDER BY request_count DESC
LIMIT 10;
```

Requests by country:

```sql
SELECT c_country, COUNT(*) AS requests
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '7' day, '%Y-%m-%d')
GROUP BY c_country
ORDER BY requests DESC;
```

Most requested pages (HTML only):

```sql
SELECT cs_uri_stem,
       COUNT(*) AS views,
       COUNT(DISTINCT c_ip) AS unique_visitors
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '30' day, '%Y-%m-%d')
  AND sc_status = '200'
  AND cs_uri_stem NOT LIKE '%.css'
  AND cs_uri_stem NOT LIKE '%.js'
  AND cs_uri_stem NOT LIKE '%.png'
  AND cs_uri_stem NOT LIKE '%.woff2'
GROUP BY cs_uri_stem
ORDER BY views DESC
LIMIT 20;
```

Traffic and bandwidth by day:

```sql
SELECT date,
       COUNT(*) AS total_requests,
       COUNT(DISTINCT c_ip) AS unique_visitors,
       ROUND(SUM(CAST(sc_bytes AS bigint)) / 1024.0 / 1024.0, 2) AS bandwidth_mb
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '30' day, '%Y-%m-%d')
GROUP BY date
ORDER BY date DESC;
```

Status code distribution:

```sql
SELECT sc_status,
       COUNT(*) AS count,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '7' day, '%Y-%m-%d')
GROUP BY sc_status
ORDER BY count DESC;
```

Errors, including edge-function 403s (hostile-path probes):

```sql
SELECT date, time, c_ip, cs_uri_stem, sc_status, x_edge_detailed_result_type, cs_referer
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '7' day, '%Y-%m-%d')
  AND CAST(sc_status AS integer) >= 400
ORDER BY date DESC, time DESC
LIMIT 100;
```

External referrers:

```sql
SELECT cs_referer, COUNT(*) AS visits
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND date >= date_format(current_date - interval '30' day, '%Y-%m-%d')
  AND cs_referer != '-'
  AND cs_referer NOT LIKE '%vettid.org%'
GROUP BY cs_referer
ORDER BY visits DESC
LIMIT 20;
```

One IP's activity:

```sql
SELECT date, time, cs_uri_stem, sc_status, cs_user_agent, x_edge_request_id
FROM vettid_logs.cloudfront_logs_v2
WHERE distributionid = 'E17RU9Q7P4C2QY'
  AND c_ip = '203.0.113.7'  -- replace
ORDER BY date DESC, time DESC
LIMIT 100;
```

### Athena tips

1. **Always filter on `date`** (or the `log_hour` partition for tighter
   scans: `log_hour >= date_format(now() - interval '1' day, '%Y/%m/%d/%H')`)
   — Athena bills by data scanned.
2. Results land in the Athena results bucket and expire after 30 days.
3. CLI automation:
   ```bash
   aws athena start-query-execution \
     --query-string "SELECT * FROM vettid_logs.cloudfront_logs_v2 WHERE distributionid = 'E17RU9Q7P4C2QY' LIMIT 10" \
     --work-group vettid-logs-workgroup \
     --region us-east-1
   ```

## Delivery delays and retention

- Access logs typically arrive within minutes; up to an hour is normal.
- WAF telemetry arrives in near-real-time.
- Both streams are retained **30 days**, then deleted automatically
  (retention is set in the CDK stack if it ever needs changing).

## Privacy considerations

The logs contain visitor IP addresses and TLS fingerprints. Cookie and
Authorization values are redacted at capture; email addresses are never
logged. Keep it that way: any new field must pass the logging spec §5 rules
before it's added, and access to the logs bucket / log group stays
restricted to the AWS account's operators.
