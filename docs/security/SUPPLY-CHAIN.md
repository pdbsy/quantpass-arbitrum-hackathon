# Supply-chain controls

Status: **in progress — external governance gate blocked**

The offline source of truth is [`planning/supply-chain-policy.json`](../../planning/supply-chain-policy.json). `npm run supply:check` verifies the npm lock, licenses, registry origins, SHA-512 integrity, Action pins, CODEOWNERS, Dependabot coverage and the committed SPDX 2.3 SBOM.

## Enforced in this repository

- npm runtime and development dependencies use exact root versions and lockfile v3.
- Every resolved package comes from `https://registry.npmjs.org`, has canonical SHA-512 integrity and uses a reviewed license identifier.
- Every `uses:` reference in every workflow is a full 40-character commit SHA from an approved GitHub-owned Action namespace.
- `pull_request_target` is rejected because this repository does not need privileged execution of untrusted pull-request content.
- GitHub Actions has read-only default workflow permission; individual CodeQL upload permission is scoped to its analysis job.
- Dependabot covers npm and GitHub Actions weekly. Pull requests run dependency review and reject High/Critical advisories or licenses outside the reviewed allowlist.
- CodeQL analyzes JavaScript and TypeScript on `master`, pull requests and a weekly schedule.
- The committed SPDX document is generated deterministically from `package-lock.json` and fails CI when stale.
- GitHub repository settings allow only GitHub-owned Actions and require full commit SHA pins. Secret scanning with push protection, dependency alerts, Dependabot security updates and private vulnerability reporting are enabled.
- The active `master-protection` ruleset (ID `22507334`) has no bypass actor, requires pull requests, strict `verify`/CodeQL/dependency-review checks, linear history and resolved conversations, and blocks deletion and force pushes. Because `pdbsy` is currently the only collaborator, the approval count remains zero and CODEOWNER approval is not presented as independent review.

The captured API readback is [`github-security-settings.json`](github-security-settings.json). It is dated evidence, not a live monitor; acceptance requires a fresh readback and tamper test.

## Security diff checkpoint

The immutable range `d5de8c064069cf675c2bddf8f626b7add15aa8a0..940c11341d34ba1055ac75dde11ea1ce10889f09` completed a Codex Security diff scan. No reportable vulnerability survived validation and attack-path analysis because the current workflows are least-privileged and a lower-privileged actor cannot activate a workflow or policy change on protected `master`.

The scan still reproduced workflow parser, permission-policy and governance-evidence weaknesses that should be hardened before requesting merge. The durable checkpoint, scope, limitations and next actions are recorded in [`SUPPLY-DIFF-SCAN-2026-09-08.md`](SUPPLY-DIFF-SCAN-2026-09-08.md). This does not change `SUPPLY-001` or `GOV-001` from their current incomplete/blocked states.

## External trust boundary still required

The current repository belongs to the personal account `pdbsy`. Repository-level status checks can require a job name and its GitHub App source, but a coordinated hostile commit could still replace the workflow and validator while preserving that name. Therefore the active ruleset plus the in-repository CI job is defense in depth, not proof of governance immutability.

`GOV-001` may resume only after one of these controls is independently verified:

1. Transfer the project to an organization that can enforce a ruleset workflow stored in a separately protected repository.
2. Require a status check emitted by a dedicated GitHub App whose verifier, credentials and deployment are administered outside this repository.

The rule must target `master`, require pull requests, reject force pushes and deletions, prevent administrator bypass, bind the expected check to its trusted source, and retain readback evidence of the active rule and a failing tamper test. GitHub documents [organization ruleset workflows](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging) and [source-bound required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging).

## Response targets

| Severity | Triage target | Merge/release policy |
| --- | ---: | --- |
| Critical | 1 day | Freeze affected changes and releases immediately |
| High | 3 days | Block merge until fixed or independently accepted |
| Moderate | 14 days | Track with owner and deadline |
| Low | 30 days | Batch with routine maintenance |

Package licenses currently allowed: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, BlueOak-1.0.0 and MPL-2.0. This is an engineering compatibility gate, not legal advice and not a license grant for QuantPass itself.
