import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * How long the public website (vettid.org) keeps its logs: ONE period for
 * every log store the site and its sign-up path write to (the owner's
 * decision of 2026-10-12: one period, 90 days).
 *
 *   - CloudFront access logs (S3 `vettid-org-access-logs`)
 *   - WAF logs (CloudWatch `aws-waf-logs-vettid-org`)
 *   - Athena query results over those logs (S3 `<domain>-athena-results`)
 *   - the sign-up Lambdas' log groups (VettidOrgSignupStack)
 *
 * To change the period, change this number and deploy VettidOrgStack and
 * VettidOrgSignupStack; the privacy page states the same number. CloudWatch
 * only accepts certain values (1, 3, 5, 7, 14, 30, 60, 90, 120, ...):
 * websiteLogGroupRetention() refuses any other at synth time. On S3 a
 * lifecycle rule goes by each object's age, so a shorter period also deletes
 * what is already older than it (within a day or two of the deploy).
 *
 * The account and admin sites, the member API and the relay have their own
 * settings and do not use this.
 */
export const WEBSITE_LOG_RETENTION_DAYS = 90;

/** The period as a CloudWatch Logs retention setting. */
export function websiteLogGroupRetention(days: number = WEBSITE_LOG_RETENTION_DAYS): logs.RetentionDays {
  if (!Object.values(logs.RetentionDays).includes(days) || days === logs.RetentionDays.INFINITE) {
    throw new Error(`WEBSITE_LOG_RETENTION_DAYS = ${days} is not a retention CloudWatch Logs accepts`);
  }
  return days as logs.RetentionDays;
}
