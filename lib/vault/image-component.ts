import { createHash } from 'node:crypto';
import { VaultReleaseSpec } from './releases';

/** Where the release assets and host files come from (VAULT-RELEASES §5, §8.3). */
export const VAULT_REPO = 'vettid/vettid-vault';

/**
 * The EC2 Image Builder build component for one release's AMI
 * (VAULT-RELEASES §8.3). It runs on the builder instance, in the host
 * stack's build VPC, and fails the image (and so the release stack's
 * deploy) on any mismatch:
 *
 *  1. the pinned nitro-cli package and the CloudWatch agent;
 *  2. the GitHub release's `measurements.json`, checked against the pinned
 *     SHA-256; its channel, release, commit and PCR0 must be the pinned ones;
 *  3. `vault-enclave.eif` and `vault-parent-arm64`, checked against the
 *     hashes in that measurements file; `nitro-cli describe-eif` must report
 *     the pinned PCR0;
 *  4. the release commit's `deploy/host/SHA256SUMS` (pinned SHA-256), then
 *     every file it lists, `sha256sum -c`, then its `install.sh` (units,
 *     allocator 1 vCPU / 5 GiB, boot and lifecycle scripts; C4: each release
 *     runs its own tag's parent and units).
 *
 * The AMI is not measured: the hash checks here guard availability and the
 * operator's intent; members rely on the PCR0 in the signed manifest.
 */
export function renderBuildComponent(spec: VaultReleaseSpec): string {
  const script = [
    'set -euo pipefail',
    `REPO='${VAULT_REPO}'`,
    `TAG='${spec.tag}'`,
    `RELEASE='${spec.release}'`,
    `CHANNEL='${spec.channel}'`,
    `COMMIT='${spec.sourceCommit}'`,
    `PCR0='${spec.pcr0}'`,
    `MEASUREMENTS_SHA256='${spec.measurementsSha256}'`,
    `HOST_SUMS_SHA256='${spec.hostFilesSha256}'`,
    `NITRO_CLI='${spec.nitroCliVersion}'`,
    'W="$(mktemp -d)"',
    'trap \'rm -rf "$W"\' EXIT',
    'dl() { curl -fsSL --proto "=https" --tlsv1.2 --retry 5 --retry-delay 3 --max-filesize 1073741824 -o "$2" "$1"; }',
    'sha() { sha256sum "$1" | cut -d" " -f1; }',
    'die() { echo "FAIL: $*" >&2; exit 1; }',
    '',
    '# 1. packages (pinned nitro-cli)',
    'dnf install -y -q "aws-nitro-enclaves-cli-${NITRO_CLI}" amazon-cloudwatch-agent',
    'rpm -q --qf "%{VERSION}\\n" aws-nitro-enclaves-cli | grep -qx "${NITRO_CLI}" || die "nitro-cli is not ${NITRO_CLI}"',
    '',
    '# 2. measurements.json, pinned by hash',
    'ASSETS="https://github.com/${REPO}/releases/download/${TAG}"',
    'dl "${ASSETS}/measurements.json" "$W/measurements.json"',
    '[ "$(sha "$W/measurements.json")" = "$MEASUREMENTS_SHA256" ] || die "measurements.json hash"',
    'python3 - "$W/measurements.json" "$CHANNEL" "$RELEASE" "$COMMIT" "$PCR0" > "$W/hashes" <<\'PY\'',
    'import json, sys',
    'm = json.load(open(sys.argv[1]))',
    'want = {"channel": sys.argv[2], "release": int(sys.argv[3]), "source_commit": sys.argv[4], "pcr0": sys.argv[5]}',
    'for k, v in want.items():',
    '    if m.get(k) != v:',
    '        sys.exit("measurements.json: %s is %r, pinned %r" % (k, m.get(k), v))',
    'print(m["eif_sha256"], m["parent_sha256"])',
    'PY',
    'read -r EIF_SHA PARENT_SHA < "$W/hashes"',
    '',
    '# 3. EIF and parent, by the hashes in measurements.json; PCR0 from the EIF itself',
    'dl "${ASSETS}/vault-enclave.eif" "$W/vault-enclave.eif"',
    '[ "$(sha "$W/vault-enclave.eif")" = "$EIF_SHA" ] || die "EIF hash"',
    'dl "${ASSETS}/vault-parent-arm64" "$W/vault-parent"',
    '[ "$(sha "$W/vault-parent")" = "$PARENT_SHA" ] || die "parent hash"',
    'nitro-cli describe-eif --eif-path "$W/vault-enclave.eif" > "$W/eif.json"',
    'python3 -c \'import json,sys; m=json.load(open(sys.argv[1]))["Measurements"]; sys.exit(0 if m["PCR0"].lower()==sys.argv[2] else "describe-eif PCR0 " + m["PCR0"])\' "$W/eif.json" "$PCR0"',
    'install -D -m 0644 "$W/vault-enclave.eif" /opt/vettid/vault-enclave.eif',
    'install -D -m 0755 "$W/vault-parent" /opt/vettid/bin/vault-parent',
    '',
    '# 4. host files at the release commit, pinned by SHA256SUMS',
    'RAW="https://raw.githubusercontent.com/${REPO}/${COMMIT}/deploy/host"',
    'mkdir -p "$W/host"',
    'dl "${RAW}/SHA256SUMS" "$W/host/SHA256SUMS"',
    '[ "$(sha "$W/host/SHA256SUMS")" = "$HOST_SUMS_SHA256" ] || die "deploy/host/SHA256SUMS hash"',
    'while read -r _ f; do',
    '  [[ "$f" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "host file name $f"',
    '  dl "${RAW}/${f}" "$W/host/${f}"',
    'done < "$W/host/SHA256SUMS"',
    '(cd "$W/host" && sha256sum --quiet --strict -c SHA256SUMS) || die "host file hashes"',
    '(cd "$W/host" && bash install.sh)',
    '',
    'printf \'{"release":%s,"channel":"%s","tag":"%s","source_commit":"%s","pcr0":"%s"}\\n\' "$RELEASE" "$CHANNEL" "$TAG" "$COMMIT" "$PCR0" > /opt/vettid/release.json',
    'dnf clean all -q',
    'echo "PASS vault release ${RELEASE} (${CHANNEL}) installed"',
  ].join('\n');
  // Image Builder component document (schemaVersion 1.0).
  const indented = script
    .split('\n')
    .map((l) => (l ? `              ${l}` : ''))
    .join('\n');
  return [
    `name: vettid-vault-release-${spec.channel}-${spec.release}`,
    `description: VettID vault ${spec.channel} release ${spec.release} host (EIF, parent, units), verified`,
    'schemaVersion: 1.0',
    'phases:',
    '  - name: build',
    '    steps:',
    '      - name: InstallRelease',
    '        action: ExecuteBash',
    '        timeoutSeconds: 1800',
    '        inputs:',
    '          commands:',
    '            - |',
    indented,
    '',
  ].join('\n');
}

/** A short content hash: Image Builder names and versions are immutable, so new content gets a new name. */
export function contentHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 10);
}
