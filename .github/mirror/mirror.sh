#!/usr/bin/env bash
# Copy each pinned image in IMAGES_FILE to $MIRROR/<name>, byte for byte
# (skopeo copy --all --preserve-digests: the index and every platform's
# manifest keep their digests), and verify that the mirror serves exactly
# the pinned digest. An image already in the mirror at its digest is only
# verified, so a weekly run costs a few manifest requests upstream.
#
#   MIRROR=ghcr.io/vettid/mirror .github/mirror/mirror.sh .github/mirror/images.txt
#
# Needs skopeo, logged in to the mirror registry with push rights.
set -euo pipefail

file="${1:?usage: mirror.sh IMAGES_FILE}"
mirror="${MIRROR:-ghcr.io/vettid/mirror}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

# The SHA-256 of the manifest a reference serves, or "-" if it serves none.
served() {
  local raw
  if raw="$(skopeo inspect --raw --retry-times 3 "docker://$1" 2>/dev/null)"; then
    printf '%s' "$raw" | sha256sum | cut -d' ' -f1
  else
    echo -
  fi
}

bad=0
{
  echo "### CI image mirror ($mirror)"
  echo
  echo "| upstream | mirror | result |"
  echo "|---|---|---|"
} >>"$summary"

while read -r ref alts; do
  case "$ref" in ''|'#'*) continue ;; esac
  if [[ ! "$ref" =~ ^([a-z0-9.-]+/[a-z0-9._/-]+):([A-Za-z0-9._-]+)@sha256:([0-9a-f]{64})$ ]]; then
    echo "::error::not REGISTRY/REPOSITORY:TAG@sha256:DIGEST: $ref"
    bad=1
    continue
  fi
  repo="${BASH_REMATCH[1]}" tag="${BASH_REMATCH[2]}" hex="${BASH_REMATCH[3]}"
  digest="sha256:$hex"
  dst="$mirror/${repo##*/}"
  result=""

  if [ "$(served "$dst@$digest")" = "$hex" ]; then
    result="already mirrored"
  else
    for src in "$repo" $alts; do
      echo "copy $src@$digest -> $dst:$tag-${hex:0:12}"
      if skopeo copy --all --preserve-digests --retry-times 3 \
          "docker://$src@$digest" "docker://$dst:$tag-${hex:0:12}"; then
        result="copied from $src"
        break
      fi
      echo "::warning::copy from $src failed"
    done
  fi

  # The mirror must serve the pinned digest, by digest and by its tag.
  if [ "$(served "$dst@$digest")" != "$hex" ] || [ "$(served "$dst:$tag-${hex:0:12}")" != "$hex" ]; then
    echo "::error::$dst does not serve $digest"
    result="**FAILED** (${result:-not copied})"
    bad=1
  fi

  # Auditors rebuild from the upstream reference: say if it stopped
  # serving the digest (not fatal; the mirror still has it).
  if [ "$(served "$repo@$digest")" != "$hex" ]; then
    echo "::warning::$repo no longer serves $digest (or refused the request)"
    result="$result; upstream did not answer with this digest"
  fi

  echo "$ref: $result"
  echo "| \`$ref\` | \`$dst@$digest\` | $result |" >>"$summary"
done <"$file"

exit "$bad"
