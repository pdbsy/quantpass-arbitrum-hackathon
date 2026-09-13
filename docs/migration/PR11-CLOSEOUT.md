# PR 11 engineering closeout

> Historical pre-review checkpoint. The later [remediation record](PR11-REMEDIATION.md) supersedes the status and merge authorization below, including the user's explicit waiver of human approval.

Status: **TECHNICALLY_READY_EXTERNAL_REVIEW_REQUIRED**, subject to the final-head gates recorded in PR 11. Change Draft to Ready for Review only after those checks pass. No merge, deployment, broadcast or real funds.

Canonical repository: `pdbsy/quantpass-arbitrum-hackathon`. Branch: `macbeth01/AF-MIGRATION-repository-consolidation`. Base: `cf2284af320461bb416b17fe4fb00a73f8ffdd68`. The PR body and final local report bind each executed gate to the final HEAD; this source document cannot contain its own commit SHA.

## Review Map

| Slice / files | Intent | Risk | Verification | Unresolved |
|---|---|---|---|---|
| Runtime Backend / API: `apps/server/src/{app,store,product-routes,product-cursors,product-views,api-schema,api-errors,strategy-catalog}.ts`; `test/{server,product-api,http-e2e}.test.ts` | Adapt product catalog/account/vault views to canonical ledger and exact error envelope | Owner/session/vault mismatch; corrupt persistence; revision/idempotency and pagination | Symmetric Alice/Bob vault and audit reads, strategy binding, bounded/malformed/tampered/wrong-owner/wrong-scope/replayed/restarted cursors, corrupt stored state/digest, transactional audit rollback, stale revision and exact idempotency, HTTP 429/Retry-After | Demo account selector is not production login; RPC and chain writes closed |
| Frontend / UI: `apps/web/src/{product-client,product-adapter,product-ui,api}.ts`, `tools/import-user-ui.mjs`, prototype, Vite | Preserve exact supplied UI while connecting local product API | Durable pending loss, stale reads/review, context mismatch, render/CSP | Storage corruption/failure, Alice/Bob switches, delayed read, exact retry/readback, persisted Retry-After, changed pending record retention, double submit, real browser reload/mobile/all command journey | Browser storage is not cross-tab transactional command storage; local mock only |
| Agent Forum / Worker Protocol: `tools/agent-*`, collector/builder; management Dashboard app/HTML/CSS; identity tests | PR-based communication, literal search, explicit source records; selectively adapted read-only Worker history | Agent spoofing, malformed data, active HTML, unsafe links, stale sync; proposed writer has no identity/audit | PR branch/title/author/Agent consistency, unknown identities and malformed fields, non-GitHub URLs, inert rendering, CSP, read-only route methods; browser search/reload/mobile | No independent Agent principals; Macbeth02–05 confirmations remain UNVERIFIED; no local write API |
| Contracts: `contracts/src/VaultIntentPreview.sol`, test suites, bootstrap/check script and locks | TEST_ONLY EIP-712 digest preview only | Missing field/domain binding or unverified tool artifacts | Verified tool hashes and package versions; Forge build/fmt/test; 13×256 fuzz; vector/domain/integer/malformed ABI; invariant 64×32, zero reverts; actual Slither | Strict Slither now passes after a hash-manifested pragma-only dependency derivation and ABI/bytecode equivalence checks; upstream installation remains unchanged. Independent review of the derivation remains required. No audited/production Vault claim |
| CI / Security / Governance: `.github/`, `SECURITY.md`, `docs/security/pr11-master-protection.json`, exact environment/supply/privacy tools | Preserve locked CI and strengthen real GitHub controls | Self-authored checks and single-owner governance; missing mandatory platform | Actual before/after GitHub readback: Linux/Windows/macOS/CodeQL/Dependency Review all required; strict; no bypass; approval 1; CODEOWNER; last-push; stale dismissal; thread resolution | GOV-001 OPEN; SUPPLY-001 external boundary OPEN; sole collaborator pdbsy cannot provide independent review |
| Migration / Provenance: `docs/migration/{inventory,artifact-provenance,dashboard-disposition}.json`, reports and provenance tests | Account for original versions and deliberate adaptations; retain old sources | Silent omission, private paths/secrets/caches, overwritten user UI | 369 source-version records; imported artifact hashes; 11 exact uncommitted input hashes with disposition; original UI SHA fixed; secrets/privacy and original source rehash | Historical PASS/FAIL/NOT_RUN remain scoped to original commits; local full paths never published |

## Eleven Dashboard inputs

All eleven entries are resolved in [dashboard-disposition.json](dashboard-disposition.json). Each includes relative source path, SHA-256, classification, action, reason and six boundary/overlap flags. Full original and archive paths are in the ignored local report. Exact source files are retained unchanged, including rejected code; no whole-tree copy entered the canonical runtime.

Adapted: the documented read-only evidence boundary, pure Worker activity projection, literal bounded search, accessible report controls and corresponding tests. Preserved: canonical layout, protected original product HTML and CSP. Superseded: the wholesale visual redesign. Archived: historical proposals. Rejected for runtime activation: `/api/posts` and its store because Origin/Host checks do not establish allowlisted Agent authorization and its bounded replacement file is not a durable audit log.

Writes remain structured GitHub PR messages. Worker A/B history is clearly labelled separately from Macbeth PR messages; no manufactured Worker replies or approvals.

## Identity and governance

Agent-ID validation is workflow/process identity consistency, not cryptographic identity assurance.

CODEOWNERS routes sensitive paths to the only actual collaborator, `@pdbsy`; it is ownership routing evidence, not independent governance. The active rules require CODEOWNER approval, so obtaining a real independent CODEOWNER/reviewer is a separate unresolved organizational step. No user or reviewer was invented and no approval was self-issued. Protection readback retains all previous checks and adds Windows, one approval, CODEOWNER and last-push approval. Readback records the existing `do_not_enforce_on_create: true`; deletion/non-fast-forward/linear-history rules remain active, bypass list empty.

## Review and actual failures

The fixed baseline scan `bde13a7d-f1ac-44dc-a03f-b25df2803e36` covers `cf2284a..aab4bc1`: 35 source inventory entries plus Solidity/workflow/provenance support, reviewed by Macbeth01. No reportable new security finding survived this local/mock scoped static review. This is neither independent review nor final-head assurance. Closeout changes are separately inspected with new regressions.

Regression-first corrections: commit subject Task-ID inconsistency; pending record changed during readback being cleared; narrow-screen evidence overflow. Initial browser, test and sandbox/tool bootstrap failures remain in local logs. The earlier migration format failure and source citation correction remain in Git history. No existing test or safety assertion was deleted.

Historical head `0a765d007fad717a719857f5128d59b65c216b3f`: Slither 0.11.3 completed analysis but the unchanged `--fail-pedantic` policy exited **255** on mixed OpenZeppelin pragma ranges. That failure remains in Git history and local evidence.

Current remediation: `contracts/openzeppelin-pragma-pins.json` identifies exactly ten upstream files with original/derived SHA-256 values. `contracts/script/pinned_dependency.py` narrows only their Solidity pragma to exact 0.8.31 in a distinct ignored dependency subset, preserving every other byte and the upstream MIT license. The original verified archive and installation are never patched. Existing derived-file drift, unexpected files and symlinks fail closed. Forge and Slither consume the same derived dependency through the explicit Foundry remapping. No analyzer patch, detector suppression, exclusion expansion or failure-threshold reduction was introduced.

Every contract check first verifies the original archives/installed contents and the derivation, then compiles the original and derived dependency trees with the same pinned solc settings. All compiled ABI and creation/runtime bytecode must match; the actual Forge preview artifact must also match (ABI entry order is canonicalized because Forge reorders it). Ten derivation regressions cover input/output drift, compatible constraints, byte preservation, repeatability, licenses, extra files, symlinks, unsafe paths and invalid equivalence. The complete check actually exits 0 with Slither success and zero reported findings, plus 20 passing Solidity tests. This is local engineering evidence, not independent approval. Exact final-head results are recorded in the PR body and local final report.

The existing portable management profile still lists ENV-06 tools NOT_RUN because it does not provision the macOS-only optional contract toolchain. Separate local Forge/Slither evidence is explicit and does not relabel those portable or historical checks.

## Remaining blockers

1. Real independent reviewer/CODEOWNER approval is unavailable with only pdbsy. GOV-001 and SUPPLY-001 external trust remain OPEN.

All chain execution, authorization, custody, production deployment and broader risk-register requirements remain outside this digest-only/local-mock PR acceptance. The existing threat model contains open release risks; zero new findings is not zero project risk.

## Industrial-Grade Merge Assessment

**TECHNICALLY_READY_EXTERNAL_REVIEW_REQUIRED**

The eleven migration inputs are resolved and the strict contract check passes with explicit dependency derivation and equivalence evidence. Final-head application/browser/CI checks must pass before removing Draft. Independent reviewer/CODEOWNER and last-push approval remain required; the author cannot supply them. GOV-001 and SUPPLY-001 external trust remain OPEN. Preserve sources and history; do not merge.
