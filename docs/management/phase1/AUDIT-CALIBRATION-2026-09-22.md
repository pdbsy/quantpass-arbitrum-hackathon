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

## Main delivery work

01 continues PR22 source integration, complete coverage measurement, C/R/S and handoff. User explicitly restored06 testing after Public visibility;06 checks the remote exact head separately. Neither this audit nor a local successful test removes hosted checks, external governance/review requirements or the need for applicable merge/deployment authorization.
