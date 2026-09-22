# Audit calibration — 2026-09-22

Manager: Macbeth01. This is engineering calibration, not external security approval. The user-created audit report used ce6ac1f; its affected runtime/contract source was unchanged at979f4aa. Findings are kept separate from the 844 passing tests and overall readiness.

## AUDIT-001 — unverified transaction reservation

Confirmed by01 at979f4aa: a wrong Owner report receives202 without RPC, a later correct report receives409, and the conflict survives restart. Local/mock observation availability is affected; no unauthorized withdrawal was demonstrated.

Fix: retain immutable operation identity and all original rows. Schema7 changes the existing transaction uniqueness index to apply only to reconciled evidence, while a lookup index supports exact pending-report deduplication. Different unverified identities may be examined separately; a receipt alone is insufficient to reserve a transaction. Canonical event/projection uniqueness, receipt identity checks, calldata/event/state reconciliation, and no-sign/no-broadcast boundaries stay enforced. The API still refuses operation-id rebinding and forged state. A second reconciled binding fails with the existing fixed conflict error.

Version6 records migrate transactionally without rewriting their payloads. The offline recovery CLI accepts exact version6 or version7 DDL, validates source/destination snapshots in read-only mode, preserves source bytes and destination version, and refuses overwrite; a restored version6 copy migrates only on normal runtime opening. Older unsupported schemas remain rejected. Table/column/protocol names and existing IDs remain unchanged.

Evidence: two initial regression failures expose409/unique-index poisoning. The compatibility regression independently failed when version6 backups were rejected, before the compatibility fix. Final core suite124/124 and typecheck passed. Tests cover wrong Owner, wrong calldata, restart, correct registration, original-row preservation, idempotence, immutable operation identity, canonical tracking, one canonical event/projection, reconciled exclusivity, and version6 backup/restore. Full-candidate and independent post-fix review remain pending.

## AUDIT-002 — direct transfers to PassLocker

Auditor reports134/134 existing contract tests plus a dedicated locked-tool reproduction: tokens sent directly to Locker outside lockedBalance remain afterclose. Normal recorded locks are released. Manager has checked that current rescue interfaces are on Vault; final scope/remediation calibration remainsOPEN. Do not report this as stolen protocol funds or as already fixed. Existing phase-one Owner exit/rescue requirements are the decision basis; any contract/ABI change needs the existing complete contract/ABI/scanner regression path.

## AUDIT-003 — known transaction hash after registration outage

Auditor reports that wallet send succeeds but backend registration fails; the prepared registration data is not retained, refresh does not retry registration, and a new runtime loses the warning. No automatic resend or real fund loss was established. This maps to the existing PH1-05 ambiguous-submission recovery requirement, not a new trading feature. Manager reproduction and remedy remainOPEN: recovery should reuse the known hash and exact identity, never resend the economic transaction automatically.

## AUDIT-003 implementation checkpoint

01 independently reproduced the issue at54540a7: after a known wallet hash, registration failed; refresh issued no retry, reconstruction displayedIDLE, and another explicit review could send again. New runtime regressions first failed for both Vault and Pass because no recovery record existed.

The candidate now records the exact operation/chain/Owner/target/calldata/hash before awaiting backend registration. A bounded local browser journal is scoped by chain, reviewed Vault, manifest digest and Owner; these are recovery hints, never wallet authority or chain evidence. Reconnect and refresh can retry the same registration and query its evidence, with no wallet resend. An unresolved identical intent fails before send; a distinct Owner close review remains available. Runtime-set construction forwards the same storage boundary while retaining Vault selection invalidation. Storage corruption, cross-context identities, excess records and silently dropped writes fail closed; existing rows are not silently discarded. Product-ready or terminal evidence permits removing a finished hint. Unknown wallet outcomes without a returned hash remain ambiguous and are never invented as known submissions.

The three-file runtime/journal suite53/53, typecheck and lint passed locally. This includes original selection/callback/Owner exit tests and new persistence/reload, exact registration identity, zero automatic send, identical intent guard, malformed storage, independent namespaces, capacity and write failure cases. The first typecheck caught two incomplete fields in the new test fixture; the fixture now uses the real HEALTHY/degradedReason schema and typecheck passes. Accurate full-candidate/browser/coverage and independent post-fix review remain pending. Browser storage is not a server backup or finality oracle; backend canonical evidence continues to control readiness.

## Main delivery work

01 continues PR22 source integration, complete coverage measurement, C/R/S and handoff. User explicitly restored06 testing after Public visibility;06 checks the remote exact head separately. Neither this audit nor a local successful test removes hosted checks, external governance/review requirements or the need for applicable merge/deployment authorization.

## AUDIT-003 full-suite regression and correction

The actual7b00e9f management collector recorded10PASS/1FAIL/4NOT_RUN;744a206 preserves its unmodified manifest. The original injected flow failed because removal of the finished withdraw hint allowed an older deposit hint to replace the current operation, hiding a later reorg. A new reconnect assertion separately reproduced the same switch throughconnect. Both raw failures remain retained.

Refresh and reconnect now retain the same Owner's current in-memory operation for continued canonical/reorg tracking. Older saved operations are registered and checked separately, with their hints removed only on product-ready or terminal evidence. A new Owner does not inherit the old transaction display. The four runtime/journal/selection/injected suites58/58, typecheck and lint passed after correction. These are bounded local results; new full collector, browser and coverage evidence are still required.06 independently passed the original53 tests and typecheck at7b00e9f, explicitly without accepting that full candidate.

## AUDIT-002 bounded local repair

Workstream: AlphaForge / Robinhood Chain Testnet / pdbsy/quantpass-arbitrum-hackathon / PR22. Owner: Macbeth01; task M3-01-PHASE1-CLOSEOUT. Decision basis is PHASE1-CLOSEOUT-2026-09-20 sections6–7: close handles tracked assets; a separate post-close Owner rescue returns unreserved excess in the asset's raw units, and a rescue failure cannot undo an earlier close. This change addresses unsolicited configured Pass in this Vault's Locker, not arbitrary third-party tokens or a new withdrawal authority.

Two new Vault regressions first failed on missing Locker excess/failed healthy retry. Two additional positive Locker tests first failed because no excess rescue existed; the deficit rejection case already passed. The repair adds a Vault-only, nonReentrant Locker function returning balance minus lockedBalance to the immutable Owner, preserving every recorded lock. The existing post-close Vault rescue selector routes configured Pass excess from its Locker and its own balance; ordinary close/releaseAll behavior and the frozen Vault ABI remain unchanged. Empty rescue is rejected at the Vault; direct Owner-to-Locker calls remain unauthorized. New fuzz coverage checks raw-unit Locker-only rescue and later transfers after close. Failure/mismatched transfers roll back the rescue while leaving the earlier close intact.

Actual locked local entrypoint passed140 Solidity tests including fuzz/invariants,25 Python tests, Slither, exact Vault ABI equality, generated artifact-manifest equality and2 offline deployment rehearsals. The first manifest check failed because it was generated before the full compiler build; that failure remains retained, and the manifest was regenerated from the complete build before a successful full rerun. Runtime and creation bytecode have changed; no deployed address is claimed to run this version. Accurate candidate binding and independent final review remain pending. No external RPC, signature or broadcast occurred.

## Browser recovery acceptance correction

At c933e85, full npm check857/857, Semgrep139files/22rules/44fixtures and Gitleaks passed, while the actual M3 browser workflow failed. Its old driver attempted an identical unresolved withdrawal twice; journal protection correctly stopped the second request. Legacy/management and qualification workflows passed, but overall coverage aggregation stopped because the failed browser receipt omitted required workflow identity. Original artifacts and both errors remain preserved; no complete c933e85 coverage report exists. A simultaneous environment probe also reported portsFAIL while local browser services were running; it is not reused as admission.

The corrected driver asserts no second wallet send and the explicit recovery-required error, then supplies the existing canonical mock soft-ready evidence for the first operation before a new explicit degraded-mode withdrawal. No duplicate protection or business assertion was removed. The actual revised browser passed9 groups/9 precisely decoded mock sends with no page/CSP/external-request errors; the sequencing/runtime unit subset passed10/10. The first added browser assertion expected a bare error rather than the real dialog's explanatory suffix and timed out; this failure is retained, and the corrected assertion checks the exact error prefix. New whole-source coverage remains required.

06 independently validated195efd5:58/58 plus5 supplemental recovery/Owner/reorg probes and typecheck, with no new blocker in that bounded change. Receipt digestfc089a337b78dfad42346d54ebeeafd5c54f499bfdae651a7ae34fe4c69e5fdd. This remains LOCAL functional review, not external security or hosted approval.

## Failure evidence binding

06 independently confirmed the missing workflow/manifest fields in the failed-browser catch path. The repair preserves stateFAIL, nonzero exit and the raw failure artifact reference. No missing index, nodeChild or lifecycle is replaced with fabricated success. A real isolated browser-driver failure first reproduced undefined workflow; its regression also checks that rehashed but rebound workflow/digest metadata or missing replay index remains rejected. The targeted qualified regression passed after the observed RED: actual driver failure remainsFAIL with a valid replay index, and all three rehashed metadata/index mutations were rejected. The original c933e85 artifacts were not edited.


## Independent rescue rollback receipt and permanent regression

Ownership: AlphaForge / Robinhood Chain Testnet / Hackathon / PR22; implementation integrator Macbeth01, independent engineering verifier Macbeth06. No Xlayer evidence is included. Macbeth06 independently copied and hash-verified existing approved tool archives, rebuilt source d9c5889 (contract source identical at778f71a), passed140 Forge tests and verified8 fresh compiler artifacts plus23 dependency derivation equivalences. Its separate failing-second-transfer probe passed1/1: revert data proves Owner received Locker3raw before the Vault5raw transfer failed; final balances fully rolled back while prior close and zero accounting remained, healthy retry returned8raw, empty replay rejected. The original receipt SHA-256 is14fa3f23d3566319b649f494956d9b594050ca01084821574d56f32e916befff, probe source SHA-256a7709771f2f609395f3b033e22fc2603e01c824721789858f72a0bcb555b0890, final probe log SHA-25618a86dda484c1429f5cc497e92a98d5e50176a2970ed060fc457a925ab4c3db4. Earlier compile-path/import failures remain preserved.06 did not run Slither, the complete Python suite or deployment rehearsals.

Macbeth01 adopted that attributed probe into contracts/test/AlphaForgeVault.rescue-atomicity.t.sol (relative imports and repository formatting). The complete actual contract entry then passed141 Solidity tests,25 Python,2 offline rehearsals, Slither and frozenVaultABI/compiler-manifest equality. Production contract source and committed deployment artifacts did not change. This is persistent regression coverage, not a new deployment or external security approval.
