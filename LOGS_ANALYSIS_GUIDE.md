# VettID.org Access Logs Analysis Guide

This guide shows you how to query CloudFront access logs using Amazon Athena to analyze visitor traffic, IP addresses, and user behavior.

## Overview

Your CloudFront access logs are automatically collected and stored in the S3 logs bucket. Amazon Athena allows you to query these logs using standard SQL without needing to set up any infrastructure.

## Accessing Athena

1. Sign in to the AWS Console
2. Navigate to **Amazon Athena**
3. Select the **vettid-logs-workgroup** from the workgroup dropdown
4. The database **vettid_logs** and table **cloudfront_logs** are already configured

## Common Log Fields

- `date` - The date of the request
- `time` - The time of the request
- `request_ip` - The IP address of the client making the request
- `method` - HTTP method (GET, POST, etc.)
- `uri` - The requested URI path
- `status` - HTTP status code (200, 404, etc.)
- `bytes` - Number of bytes served
- `user_agent` - Browser/client information
- `referrer` - The referring URL
- `location` - CloudFront edge location that served the request
- `host_header` - The domain name (vettid.org or www.vettid.org)

## Example Queries

### 1. View Recent Requests (Last 24 Hours)

```sql
SELECT date, time, request_ip, method, uri, status, user_agent
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '1' day
ORDER BY date DESC, time DESC
LIMIT 100;
```

### 2. Count Unique Visitors by IP Address

```sql
SELECT COUNT(DISTINCT request_ip) as unique_visitors
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day;
```

### 3. Top 10 Visitor IP Addresses

```sql
SELECT request_ip,
       COUNT(*) as request_count,
       SUM(bytes) as total_bytes
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
GROUP BY request_ip
ORDER BY request_count DESC
LIMIT 10;
```

### 4. Requests by Country/Location

```sql
SELECT location,
       COUNT(*) as requests
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
GROUP BY location
ORDER BY requests DESC;
```

### 5. Most Requested Pages

```sql
SELECT uri,
       COUNT(*) as views,
       COUNT(DISTINCT request_ip) as unique_visitors
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
  AND status = 200
  AND uri NOT LIKE '%.css'
  AND uri NOT LIKE '%.js'
  AND uri NOT LIKE '%.png'
  AND uri NOT LIKE '%.jpg'
GROUP BY uri
ORDER BY views DESC
LIMIT 20;
```

### 6. Traffic by Date

```sql
SELECT date,
       COUNT(*) as total_requests,
       COUNT(DISTINCT request_ip) as unique_visitors,
       ROUND(SUM(bytes) / 1024.0 / 1024.0, 2) as bandwidth_mb
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
GROUP BY date
ORDER BY date DESC;
```

### 7. Traffic by Hour of Day

```sql
SELECT SUBSTRING(time, 1, 2) as hour,
       COUNT(*) as requests
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
GROUP BY SUBSTRING(time, 1, 2)
ORDER BY hour;
```

### 8. HTTP Status Code Distribution

```sql
SELECT status,
       COUNT(*) as count,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) as percentage
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
GROUP BY status
ORDER BY count DESC;
```

### 9. Top Referrers

```sql
SELECT referrer,
       COUNT(*) as visits
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
  AND referrer != '-'
  AND referrer NOT LIKE '%vettid.org%'
GROUP BY referrer
ORDER BY visits DESC
LIMIT 20;
```

### 10. Browser/User Agent Analysis

```sql
SELECT
  CASE
    WHEN user_agent LIKE '%Chrome%' THEN 'Chrome'
    WHEN user_agent LIKE '%Firefox%' THEN 'Firefox'
    WHEN user_agent LIKE '%Safari%' AND user_agent NOT LIKE '%Chrome%' THEN 'Safari'
    WHEN user_agent LIKE '%Edge%' THEN 'Edge'
    WHEN user_agent LIKE '%bot%' OR user_agent LIKE '%Bot%' THEN 'Bot'
    ELSE 'Other'
  END as browser,
  COUNT(*) as requests
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
GROUP BY
  CASE
    WHEN user_agent LIKE '%Chrome%' THEN 'Chrome'
    WHEN user_agent LIKE '%Firefox%' THEN 'Firefox'
    WHEN user_agent LIKE '%Safari%' AND user_agent NOT LIKE '%Chrome%' THEN 'Safari'
    WHEN user_agent LIKE '%Edge%' THEN 'Edge'
    WHEN user_agent LIKE '%bot%' OR user_agent LIKE '%Bot%' THEN 'Bot'
    ELSE 'Other'
  END
ORDER BY requests DESC;
```

### 11. Specific IP Address Activity

```sql
SELECT date, time, uri, status, user_agent
FROM vettid_logs.cloudfront_logs
WHERE request_ip = '123.456.789.012'  -- Replace with actual IP
ORDER BY date DESC, time DESC
LIMIT 100;
```

### 12. Errors and Failed Requests

```sql
SELECT date, time, request_ip, uri, status, referrer
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
  AND status >= 400
ORDER BY date DESC, time DESC
LIMIT 100;
```

### 13. Bandwidth Usage by Day

```sql
SELECT date,
       ROUND(SUM(bytes) / 1024.0 / 1024.0 / 1024.0, 2) as bandwidth_gb
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
GROUP BY date
ORDER BY date DESC;
```

### 14. Peak Traffic Times

```sql
SELECT date,
       SUBSTRING(time, 1, 2) as hour,
       COUNT(*) as requests
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '7' day
GROUP BY date, SUBSTRING(time, 1, 2)
ORDER BY requests DESC
LIMIT 20;
```

### 15. Mobile vs Desktop Traffic

```sql
SELECT
  CASE
    WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%Android%' OR user_agent LIKE '%iPhone%' THEN 'Mobile'
    WHEN user_agent LIKE '%Tablet%' OR user_agent LIKE '%iPad%' THEN 'Tablet'
    ELSE 'Desktop'
  END as device_type,
  COUNT(*) as requests,
  COUNT(DISTINCT request_ip) as unique_visitors
FROM vettid_logs.cloudfront_logs
WHERE date >= current_date - interval '30' day
GROUP BY
  CASE
    WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%Android%' OR user_agent LIKE '%iPhone%' THEN 'Mobile'
    WHEN user_agent LIKE '%Tablet%' OR user_agent LIKE '%iPad%' THEN 'Tablet'
    ELSE 'Desktop'
  END
ORDER BY requests DESC;
```

## Tips for Using Athena

1. **Date Filtering**: Always include date filters in your WHERE clause to limit the amount of data scanned and reduce costs

2. **Saving Queries**: You can save frequently used queries in Athena for easy reuse

3. **Query Results**: Query results are automatically saved to the Athena results bucket and expire after 30 days

4. **Costs**: Athena charges based on the amount of data scanned. Using date partitions and limiting columns helps reduce costs

5. **Automation**: You can use the AWS CLI or SDK to run queries programmatically:
   ```bash
   aws athena start-query-execution \
     --query-string "SELECT * FROM vettid_logs.cloudfront_logs LIMIT 10" \
     --work-group vettid-logs-workgroup \
     --region us-east-1
   ```

## Understanding CloudFront Log Delays

CloudFront logs are typically delivered within 15-60 minutes of the request, but can sometimes take up to 24 hours. If you don't see recent logs, this is normal behavior.

## Log Retention

Logs are automatically managed with the following lifecycle:
- **0-30 days**: Standard storage (frequent access)
- **30-90 days**: Infrequent Access storage (lower cost)
- **90-365 days**: Glacier storage (archive)
- **After 365 days**: Automatically deleted

You can modify these settings in the CDK stack if needed.

## Privacy Considerations

The logs contain visitor IP addresses. Ensure you comply with applicable privacy laws and regulations (GDPR, CCPA, etc.) when collecting and analyzing this data. Consider:

1. Documenting IP collection in your privacy policy
2. Providing a way for users to request their data be deleted
3. Anonymizing IP addresses if detailed tracking isn't necessary
4. Implementing appropriate access controls to the logs bucket

## Additional Resources

- [CloudFront Access Log Format](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html)
- [Amazon Athena Documentation](https://docs.aws.amazon.com/athena/)
- [Athena SQL Reference](https://docs.aws.amazon.com/athena/latest/ug/ddl-sql-reference.html)
