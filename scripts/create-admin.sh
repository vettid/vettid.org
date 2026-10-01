#!/usr/bin/env bash
# Create a VettID admin in the admin Cognito pool.
#
#   scripts/create-admin.sh someone@example.org
#
# SES is in the sandbox (by decision), so Cognito can only email the
# temporary password to a verified address. First run sends the SES
# verification email and stops; run again once the recipient has clicked it.
# Cognito then emails the temporary password; on first sign-in (from the
# admin tailnet) the admin sets a password and enrolls TOTP.
set -euo pipefail

EMAIL="${1:?usage: $0 <email>}"
STAGE="${STAGE:-prod}"
REGION="us-east-1"

POOL_ID=$(aws ssm get-parameter --region "$REGION" --name "/vettid-org/$STAGE/auth/admin-pool-id" --query Parameter.Value --output text)

STATUS=$(aws sesv2 get-email-identity --region "$REGION" --email-identity "$EMAIL" \
  --query VerifiedForSendingStatus --output text 2>/dev/null || echo missing)
if [ "$STATUS" = "missing" ]; then
  aws sesv2 create-email-identity --region "$REGION" --email-identity "$EMAIL" >/dev/null
  echo "Sent SES verification to $EMAIL. Ask them to click it, then re-run this script."
  exit 0
elif [ "$STATUS" != "True" ]; then
  echo "$EMAIL has not completed SES verification yet. Re-run once they click the link."
  exit 1
fi

aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL >/dev/null
aws cognito-idp admin-add-user-to-group --region "$REGION" --user-pool-id "$POOL_ID" \
  --username "$EMAIL" --group-name admin

echo "Created admin $EMAIL; Cognito has emailed a temporary password (valid 3 days)."
echo "They also need a Headscale node on the tailnet to reach admin."
