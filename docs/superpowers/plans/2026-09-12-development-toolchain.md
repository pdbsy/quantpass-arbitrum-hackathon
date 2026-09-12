# Development toolchain alignment implementation plan

> Execution: Macbeth executes this plan inline under the user's current request. No delegation; Darwin remains inactive. The executing-plans and test-driven-development workflows apply. The supplied document's historical UNASSIGNED status does not override the present assignment. ENV-06 remains outside scope.

**Goal:** Synchronize the supplied specification and implement ENV-01–05 as a reviewable GitHub PR, with exact toolchain qualification, offline admission checks, native CI and honest evidence.

**Architecture:** `.node-version` and `packageManager` hold the only Node/npm pins. A standard-library environment inspector consumes a closed policy and existing supply-chain policy, records bounded sanitized observations and fails closed. A fixed CI wrapper checks before/after the existing full engineering gate; existing C/R/S management evidence remains unchanged in semantics.

**Stack:** Node standard library, npm lockfile v3, current TypeScript/ESLint/Prettier, existing YAML supply validator and GitHub-hosted runners.

## Invariants

- Repository pdbsy/quantpass-arbitrum-hackathon, base master 5f223039b84f941d8f5c34d245f87c85c676b02a; branch macbeth/env-01-toolchain.
- Original supplied spec SHA256 fcb90e69b558dc40a788e251052dbae870c4e80f158e6ba90124a4fdeb65457e; preserve its historical statements and add an implementation-status note.
- Node candidate 24.21.0; npm separately qualifies an exact version. No framework/direct dependency upgrades, secrets, network RPC, deployment, risk waiver, force push or settings change.
- Keep verify and verify-windows; introduce verify-macos and verify-macos-intel with read-only contents. Linux dependency audit remains separate and mandatory in workflow.
- Environment exit codes: 0 required checks pass, 1 deterministic failure, 2 missing prerequisite; dirty developer tree never eligible for evidence.
- No host installation, shell/profile/global config modification or repository migration. Prepare concrete remaining decisions after code and CI evidence exist; do not infer new merge authority from the prior completed round.

## Tasks

### ENV-01 — sources, scope and qualification
- [x] Read supplied specification; verify clean target/current remote and host capabilities.
- [x] Recheck official Node release/security sources, npm release sources and native runner labels.
- [x] Verify Node archive checksum and npm package integrity in isolated qualification storage; record runtime/advisory impact and historical baseline disposition.
- [x] Synchronize original document, current assignment/status addendum, README and AGENTS entry without claiming completed native-machine setup.

### ENV-02/03 — exact inputs and offline inspector
Files: `.node-version`, `package.json`, `package-lock.json`, `.npmrc`, `.editorconfig`, `planning/development-environment.json`, `tools/check-environment.mjs`, `tools/environment/{policy,observe,report}.mjs`, `test/environment.test.mjs`.
Interfaces: `inspectEnvironment({root,mode,environment}) -> report`; `validateObservation(policy,inputs,observation,mode) -> report`; `writeEnvironmentReport(root,report)` writes only `.checks/environment/report.json`; `validateEnvironmentReport(report)` rejects incomplete/stale/wrong-bound observations.
- [x] Write failing behavioral tests for exact versions/root metadata, registry/TLS overrides, native architecture, dirty/hidden Git state, missing history/refs, detached PR identity, sanitized results and report freshness.
- [x] Implement bounded data reads and shell-free fixed command probes. Preserve Git event separation and absence of automatic downloads/fetch/fixes. Never print raw command errors or environment values.
- [x] Implement fixed-path explicit atomic report writing with canonical parent/file checks and bounded output; test normal round-trip and rejection of unsafe paths.
- [x] Pin Node/npm, synchronize root lock engines and SPDX through generator, preserve direct dependency graph and supply policy.

### ENV-04 — verification and CI
Files: `tools/verify-ci.mjs`, `.github/workflows/ci.yml`, `tools/check-supply-chain.mjs`, test helpers and focused CI/supply tests.
Interfaces: fixed `env:check`, `env:check:ci`, `verify:ci`; npm executed through the selected Node and resolved npm CLI, shell=false on every OS.
- [x] Write failing tests that ensure check failures/dirty output propagate and that new CI jobs retain minimal permissions.
- [x] Add four explicit jobs on ubuntu-24.04/windows-2025/macos-15/macos-15-intel; no matrix renaming, cache disabled initially to avoid unqualified cross-toolchain reuse.
- [x] Each job installs exact npm in the hosted ephemeral toolchain, runs pre-install doctor, npm ci --ignore-scripts, verify:ci; Linux independently audits dependencies. Publish bounded sanitized environment results in the job log/summary.
- [x] Align temporary Git repositories with repository attributes and isolated identity/hooks/signing settings; test whitespace/Unicode and Windows line-ending behavior.

### ENV-05 — publication and review
Files: development spec status addendum, qualification/security report, management task/worker/queue records, manifest and generated Dashboard pair.
- [ ] Run meaningful local focused tests, clean dependency installation and full engineering gates with qualified runtime; retain blocked host-fnm status separately.
- [ ] Commit clean source C, run actual management checks, commit manifest-only R, generate and commit snapshot-only S; validate exact final source.
- [ ] Publish ordinary source branch and PR; inspect all native check runs and repair failures with fresh C/R/S evidence.
- [ ] Technically self-review full immutable diff and exact CI evidence; report remaining host setup, required-status configuration and merge/user-review authorization with concrete PR and settings diff. No automatic protected merge/settings mutation.

## Coverage check

Sections 1–9 map to scope, pins, policy, Git/input and host observations; 10–12 map to inspector/report/wrapper/native CI; 13–14 preserve local/mock and inactive future profiles; 15–17 map to identity-bound report and negative tests; 18–20 map to status/assignment/evidence and official citations. Repository implementation does not claim machine setup, independent governance or future chain profiles complete.

Implementation names: `evaluate`, `inspectEnvironment`, `validateReport`, `writeReport`; native-package metadata is checked alongside runtime architecture. Full pre-freeze engineering execution reached the expected dirty-management-evidence rejection after all preceding checks passed. Frozen-source collection and native CI remain pending.

User steering: Apple Silicon Mac and Windows only for development. Remove Intel macOS job/profile/admission; retain Linux CI/audit. Earlier four-platform plan entries are historical and superseded by this scope. Windows Git null-device compatibility remains required.
