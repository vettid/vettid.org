#!/usr/bin/env bash
# Create or update the alert-forwarder service control policy
# (lib/org/scp-alert-forwarder.json) and attach it to the Workloads OU, which
# holds every member account (its Vault and Proteus OUs inherit it). It
# protects each member account's security-alert forwarder
# (VettidOrgAlertForwardStack: the forward and heartbeat rules and the
# forwarder role) from everyone but CloudFormation's CDK execution role
# (RUNBOOK "Security alerts"). Run from the MANAGEMENT account (SCPs are
# managed there and cannot restrict it). Same pattern as
# scripts/vault/apply-scp.sh.
#
#   scripts/org/apply-alert-forwarder-scp.sh            # dry run
#   scripts/org/apply-alert-forwarder-scp.sh --apply    # creates/updates and attaches
#
# Env: AWS_PROFILE (management account; default profile), WORKLOADS_OU
# (default the Workloads OU). Deploy the forwarder stacks FIRST (a change to
# them after this is applied still works: deploys run as the CDK execution
# role, which the policy exempts).
#
# Break-glass: detach or edit the policy from the management account.
set -euo pipefail

NAME="vettid-alert-forwarder-protection"
DESC="Workloads OU: only the CDK execution role may change the security-alert forwarder rules and role"
TARGET="${WORKLOADS_OU:-ou-kuf0-q8c9trwg}"
FILE="$(cd "$(dirname "$0")/../.." && pwd)/lib/org/scp-alert-forwarder.json"
APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

# Validate and minify (SCPs are limited to 5,120 characters).
CONTENT=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' "$FILE")
echo "policy: $NAME (${#CONTENT} characters), target: $TARGET"
[ "${#CONTENT}" -le 5120 ] || { echo "policy too large" >&2; exit 1; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
MGMT=$(aws organizations describe-organization --query Organization.MasterAccountId --output text)
[ "$ACCOUNT" = "$MGMT" ] || { echo "run this with the management account's profile (got $ACCOUNT)" >&2; exit 1; }

ID=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY \
  --query "Policies[?Name=='$NAME'].Id | [0]" --output text)

run() {
  if $APPLY; then "$@"; else printf 'would run:'; printf ' %q' "$@"; printf '\n'; fi
}

if [ "$ID" = "None" ] || [ -z "$ID" ]; then
  if $APPLY; then
    ID=$(aws organizations create-policy --type SERVICE_CONTROL_POLICY --name "$NAME" \
      --description "$DESC" --content "$CONTENT" --query Policy.PolicySummary.Id --output text)
    echo "created $ID"
  else
    echo "would create policy $NAME"
    ID="<new policy id>"
  fi
else
  run aws organizations update-policy --policy-id "$ID" --content "$CONTENT" --description "$DESC" --query Policy.PolicySummary.Id --output text
fi

ATTACHED=$(aws organizations list-policies-for-target --target-id "$TARGET" --filter SERVICE_CONTROL_POLICY \
  --query "Policies[].Name" --output text)
if printf '%s\n' $ATTACHED | grep -qx "$NAME"; then
  echo "already attached to $TARGET"
else
  # At most 5 SCPs per target (FullAWSAccess counts).
  COUNT=$(printf '%s\n' $ATTACHED | grep -c . || true)
  [ "$COUNT" -lt 5 ] || { echo "$TARGET already has $COUNT SCPs (limit 5)" >&2; exit 1; }
  run aws organizations attach-policy --policy-id "$ID" --target-id "$TARGET"
fi
$APPLY || echo "dry run only; re-run with --apply"
