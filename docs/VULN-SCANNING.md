# Vulnerability scanning

What looks for known vulnerabilities in VettID's dependencies, where, and
what happens on a finding. The owner approved this setup on 2026-11-20.

## Layers

1. **Dependabot alerts** are on in every vettid repository (enabled
   2026-11-20). They cover every manifest GitHub can read (Go modules, npm,
   Cargo, Gradle, Swift, pip). Alerts only: Dependabot opens no update PRs.
2. **Per-repository CI scanners** run on pull requests, on pushes to the main
   branch, and weekly. They are stricter than the alerts because they check
   reachability (govulncheck) and fail the build.
3. **Toolchain pins.** Go toolchains are pinned in `go.mod`, in CI and in the
   image builds, so a fixed Go release needs a PR in each repository (see
   GO-2026-6859, 2026-11-20).

## Scanners by repository

| Repository | Scanner | Blocks on |
|---|---|---|
| vettid-vault, vettid-relay, vettid-push, vettid-calls, vettid-agent | `govulncheck` (pinned) | a vulnerability the code reaches |
| service-vault, member-service, votes | `govulncheck` + `npm audit` | reached (Go); high or critical (npm) |
| vettid-android | `osv-scanner` over the Gradle lockfiles | a finding in a release runtime dependency |
| vettid-ios | `osv-scanner` over `Package.resolved`, plus `govulncheck` for its Go code | a finding in a dependency that ships |
| vettid-desktop | `cargo audit` + `npm audit` | a vulnerability advisory (Rust); high or critical (npm) |
| vettid.org | `npm audit` (`.github/workflows/npm-audit.yml`) | high or critical |
| vettid-playbooks, vettid-healthcare-demo, LEASH, zero-knowledge-trust | Dependabot alerts only | — |

Rows other than vettid.org are filed as Ground Control cards (#15094 to
#15098) and land as each repository's PR merges.

## Rules

- **Block only on what matters.** A reached Go vulnerability, or a high or
  critical advisory in what ships, fails the build. Everything else is
  listed in the job output, so it stays visible without blocking unrelated
  work.
- **npm: audit what ships, not just `dependencies`.** Bundled code (Lambda
  functions built with esbuild, web front ends) usually takes its packages
  from `devDependencies`, so `--omit=dev` can skip exactly the shipped code.
  In vettid.org the whole tree is audited.
- **Weekly runs open one issue per repository and scanner** and update it,
  rather than opening a new issue each week. A clean run closes it.
- **A finding is fixed in its own PR,** never folded into the PR that adds or
  changes a scanner. A fix that changes the vault's enclave image changes its
  measurement and rides the next vault release. Deploys and releases stay the
  owner's go.
- **Who acts:** the agent that owns the repository on Ground Control picks
  up the issue and posts it in that repository's topic. The lead decides the
  urgency, or asks the owner when a release or a deploy is needed.

## Known, accepted findings

- **vettid.org, `minimatch` (GHSA-g3hv-75wg-m249, moderate)** through
  `aws-cdk-lib`. A ReDoS in glob patterns, which `aws-cdk-lib` uses at
  synth and deploy time on our own patterns. It never takes outside input
  and doesn't ship in a Lambda. Fixed when `aws-cdk-lib` moves to a
  `minimatch` ≥ 11.0.1.
- **vettid.org, `glob` (GHSA-3g3m-2fjr-6pw4, moderate)** through jest's
  coverage tooling. Test-only; it never ships.
