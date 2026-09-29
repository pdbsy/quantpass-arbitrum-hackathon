# Qinfra stage 1

User authorized hosted CI, necessary acceptance checks, merge with the note `Qinfra stage 1`, and validation of merged master before stage two. Stage two is limited to quantitative strategy integration, multi-asset configuration, continuous local simulation/recovery and monitoring; it is not a general-purpose Bot marketplace or a live-trading authorization.

## Preserved development history

The first local delivery used an unregistered `macbeth/` prefix and lacked required worker subject/trailers. `npm run check` passed but did not execute the separate CI identity entry point. The subsequent `verify:agent-identity` preflight correctly rejected this delivery. No gate is changed or bypassed.

Original branch `macbeth/AF-P1-rwa-automata` and immutable tag `qinfra-stage-1-original-evidence` retain the complete development history:

- Implementation: `cdde050a541af25fd72edcc9dcd098821a76edb4`.
- Source/provenance C: `ae43c76240c5e7e2eb5a4354c6413075d5adb1bc`.
- Manifest R: `f8dbf5d2ef1ad480662df5b515555a5ddb0fafc9`.
- Snapshot S: `0977c53d5bc1f7c44f3c0a427de0bb74e9a0735d`.

The compliant delivery branch `macbeth01/AF-QINFRA-STAGE-1` starts from the same master baseline `15d2a210e4a23ff16eb9270bde7c23b3657a441f` and imports the exact source diff through the original C. All four original commits remain intact, with original Macbeth01 authorship. The new delivery preserves the same author and adds required task identity. The provenance manifest still names the actual original file-changing commit; the source tag keeps those objects retrievable. Original R/S are historical results; new source-bound R/S are generated separately.

## Acceptance protocol

1. Verify registered branch, PR title and every delivery commit's `Agent-ID` / `Task-ID` metadata.
2. Run locked-toolchain environment admission, full local checks and source-bound management collection. Do not relabel missing contract collectors as PASS.
3. Publish the retained original evidence tag and the compliant branch. Create a PR titled `[Macbeth01][AF-QINFRA-STAGE-1] Qinfra stage 1`.
4. Verify actual head-bound hosted checks: Linux, Windows, ARM macOS, Semgrep CE, OSV, Gitleaks, contracts, and remaining workflow checks. Resolve failures without dropping checks.
5. Merge only after required checks and review-thread requirements pass; preserve `Qinfra stage 1` in the merge description. No administrative bypass.
6. Fetch and validate the actual merged master, then begin stage two. Record exact GitHub run URLs and resulting master identity in the PR/final delivery, because this source document precedes those outcomes.

Existing local results on original S: 1,513 tests, 1,507 PASS, zero failures, six skipped; 29 new automata behavioral tests. Original management report: 11 PASS, zero FAIL, four NOT_RUN. These are historical baseline observations, not substitutes for the compliant delivery's own validation.
