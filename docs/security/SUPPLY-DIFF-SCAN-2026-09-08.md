# SUPPLY-001 security diff checkpoint

Status: **completed with partial independent-review coverage**

This checkpoint records a historical security review of an earlier supply-chain implementation revision. Its immutable target predates the current `master` and does not cover PR #7 or the current base. It is evidence of work performed, not an approval to accept `SUPPLY-001`, release, deploy contracts, or enable Robinhood Chain Testnet writes.

## Immutable target

- Scan ID: `6bbe3d03-6eae-419b-9314-d0351c4eff60`
- Base: `d5de8c064069cf675c2bddf8f626b7add15aa8a0`
- Head: `940c11341d34ba1055ac75dde11ea1ce10889f09`
- Snapshot digest: `codex-security-snapshot/v1:sha256:e5c446d0de02ff63a82b10480968ece5b1c2c8f2f03c5a321d1da391d61830dd`
- Reviewed changed artifacts: 19
- Compact changed-source inventory: 4/4 closed
- Reportable findings after validation and attack-path analysis: 0

## Verified state

- The checked-in workflows use approved Actions pinned to full commit SHAs.
- CI and dependency review use read-only repository contents permission. CodeQL grants `security-events: write` only to its analysis job.
- Checkout credentials are not persisted and no checked-in workflow uses `pull_request_target`.
- The npm lock, canonical registry origin, SHA-512 integrity and reviewed license allowlist are checked offline.
- The committed SPDX 2.3 SBOM is generated deterministically and compared byte-for-byte.
- `SUPPLY-001` remains `in_progress`, `GOV-001` remains `blocked`, and both Testnet write planes remain disabled.
- `docs/security/github-security-settings.json` remains point-in-time evidence rather than a live monitor or trust root.

## Reproduced hardening gaps

These defects were reproduced against `tools/check-supply-chain.mjs`. They were not promoted to reportable vulnerabilities because activating them requires the protected repository write/merge authority already held by the sole administrator, and no unsafe workflow is active at the reviewed revision. They remain engineering work because the intended controls should fail closed against mistakes and future repository-role changes.

1. A quoted YAML key such as `"pull_request_target":` bypasses the current privileged-event regex.
2. A quoted YAML key such as `"uses":` bypasses Action owner, allowlist and full-SHA checks.
3. The validator accepts arbitrary top-level or job-level write permissions because it checks only that a top-level `permissions:` mapping exists.
4. `externalGovernanceGate.status = "verified"` accepts any two array entries, including placeholders, without verifying provider identity, enforcement state, revision/digest or a failing tamper test.

An additional SBOM interoperability question remains: scoped npm PURLs currently percent-encode the namespace/name separator. No in-repository security consumer depends on those PURLs, so the scan treated this as a non-reportable format-hardening item.

## Required follow-up before SUPPLY-001 acceptance or release

- Replace security-sensitive workflow regex matching with a structural, fail-closed YAML inspection path or an equivalently complete restricted parser.
- Define per-workflow and per-job permission allowlists and reject every unapproved write scope.
- Make the external-governance transition schema explicit and keep `verified` impossible without independently verifiable evidence fields.
- Add negative regression tests for quoted event/action keys, permission escalation and placeholder governance evidence.
- Canonicalize scoped npm PURLs and add a representative regression assertion before an external SBOM consumer is adopted.
- Re-run `npm run check`, a security diff scan and GitHub required checks on the resulting immutable head.

## Coverage limitations

- No live GitHub workflow was created from the crafted YAML cases.
- No external SBOM consumer was available for interoperability validation.
- Delegated fresh-context reviewers did not return usable results after bounded attempts. The primary reviewer completed every changed file sequentially, so this checkpoint does not claim independent corroboration.

## Canonical artifact digests

The canonical scan bundle was sealed locally. These digests bind the exact machine-readable results used for this checkpoint:

| Artifact | SHA-256 |
| --- | --- |
| `scan-manifest.json` | `38c460a2f3c87e093384beef80254e7ebe461ad0f119e91733b296d4bdede58f` |
| `findings.json` | `7886baae04a82639c1ac2d8130ba6c0932e4ba20b70590ceb4bfcc6d2428469f` |
| `coverage.json` | `035ec1d38e2aac66dab479a11fad17b70e8d8b13c7a2d107e3d1c792afaae0c1` |
| `report.md` | `a37f43a2fa27af080e97342ccca88ef35a37d7abbe55e05f4fd33831b4a76fd8` |
| `results.sarif` | `aa607ca8aab221421fdb8a8ec4fd52034f2118a4de39ee75ebdb72588a5a9ee4` |
