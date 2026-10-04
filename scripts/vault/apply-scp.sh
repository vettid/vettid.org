#!/usr/bin/env bash
# Create or update the Vault OU service control policy (lib/org/scp-vault.json)
# and attach it to the Workloads/Vault OU (docs/AWS-ACCOUNTS.md §2,
# docs/VAULT-RELEASES.md §6.3). Run from the MANAGEMENT account (SCPs are
# managed there and cannot restrict it).
#
#   scripts/vault/apply-scp.sh            # dry run: shows what it would do
#   scripts/vault/apply-scp.sh --apply    # creates/updates and attaches
#
# Env: AWS_PROFILE (management account; default profile), VAULT_OU (default
# the Vault OU). Deploy VettidOrgVaultStack in both vault accounts FIRST: the
# SCP only allows the lockout bypass to the release-key creator role, which
# that stack creates.
#
# Break-glass (e.g. a role named in key policies must really change): detach
# or edit the policy from the management account; nothing inside a vault
# account can.
set -euo pipefail

NAME="vettid-vault-key-protection"
DESC="Vault OU: protect the roles named in release key policies; lockout bypass only by the release-key creator"
VAULT_OU="${VAULT_OU:-ou-kuf0-plfg393o}"
FILE="$(cd "$(dirname "$0")/../.." && pwd)/lib/org/scp-vault.json"
APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

# Validate and minify (SCPs are limited to 5,120 characters).
CONTENT=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' "$FILE")
echo "policy: $NAME (${#CONTENT} characters), target: $VAULT_OU"
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

ATTACHED=$(aws organizations list-policies-for-target --target-id "$VAULT_OU" --filter SERVICE_CONTROL_POLICY \
  --query "Policies[?Name=='$NAME'].Id | [0]" --output text)
if [ "$ATTACHED" = "None" ] || [ -z "$ATTACHED" ]; then
  run aws organizations attach-policy --policy-id "$ID" --target-id "$VAULT_OU"
else
  echo "already attached to $VAULT_OU"
fi
$APPLY || echo "dry run only; re-run with --apply"
