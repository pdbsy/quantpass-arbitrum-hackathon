# AlphaForge Semgrep Dependency Patch Plan

> Execute inline as Macbeth. The current user prohibits workers and subagent delegation.

**Goal:** Restore every existing hosted CI gate with the user-authorized PyJWT 2.14 dependency patch before beginning the 24-hour reference paper acceptance.
**Architecture:** Derive a distinctly named wheel from each existing hash-pinned official Semgrep 1.177.0 wheel. Change exactly one METADATA dependency line, regenerate RECORD, and serialize deterministically. Preserve every executable, source and license byte. Pin recipe, patch, source and output digests. Keep complete resolver, hash checks, pip check and real OSS canaries.
**Toolchain:** Approved Node 24.21.0/npm 11.19.1, native CPython 3.12.9, standard library only for repackaging.

1. Add failing artifact tests for reproducibility, byte preservation, RECORD verification, tampering, ambiguous metadata, duplicate/unsafe ZIP members, bounded sizes and atomic failure.
2. Implement the restricted derivation recipe and fail-closed bootstrap integration. Compute both platform output hashes from existing official pinned artifacts; use a private selected-wheel directory for dependency resolution.
3. Qualify actual native installation and positive/negative OSS rule fixtures. Preserve the previous two failed hosted runs and document the patched build identity; do not label it unmodified official Semgrep.
4. Commit source C, collect actual management checks, commit manifest R, generate snapshot S. Run full local checks and every existing hosted CI gate on exact S. No merge, weakened gate, unsigned dependency bypass or rewritten evidence.
5. Only after all gates pass, restart the same local reference account with the approved 8 GB cap, create a starting consistent backup, and observe an actual 24-hour window. Preserve all records and evaluate the final automatic backup by independent restore/replay.
