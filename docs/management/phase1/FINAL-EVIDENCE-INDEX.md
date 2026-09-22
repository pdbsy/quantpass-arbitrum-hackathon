# Current integration update — 2026-09-22

Last fully measured candidate 66b14aa passed 837 tests/full check, all five functional workflows, exact Semgrep/Gitleaks/source-policy scans and 142 LOCAL commit identities. Coverage 87.91/82.70/85.83/76.30 remains below the conservative threshold. Complete local handoff and original logs: outputs/phase1-local-closeout/66b14aa-handoff/DELIVERY.md. Subsequent changes require new evidence.

The user continued after the exact 04 metadata-only request. Original bf54f914 is retained under refs/archive/macbeth04/bf54f914-original-delivery; corrected 1dd5ca0 changes only the two required message trailers. Tree, parent, author and both original timestamps match. No worker working directory or remote ref was modified. Four visible-browser groups were integrated. The stale migration digest correctly failed at168cae1; original failure remains committed atb534c73, and only the current artifact digest/source explanation changed in ce6ac1f. Its new collector result is11PASS/0FAIL/4NOT_RUN.

Seven new tests exercise real isolated environment probes, including hidden Git changes, interpreter injection, unsafe config/grafts, shared data, malformed native dependencies, dirty non-hosted CI, bounded input/UTF-8. They passed7/7; this is fixture evidence, not machine or hosted admission. Production environment policy is unchanged. Accurate new full coverage, browser and scanner results are pending; not READY_TO_MERGE.

## Earlier measured checkpoint

# AlphaForge PR22 evidence index — in progress

This index is a reproducible local checkpoint, not final acceptance or READY_TO_MERGE. Manager: Macbeth01. Exact measured S `c0dfe0884894076bc2f5f5bf5077b53ec22aa9cf`, tree `146627240318fb410cdc345f193a6f92497cc725`. Later commits need their own results or explicit source-equivalence limits.

| Evidence | Actual scope/result |
| --- | --- |
| Versioned management C/R/S | e252319 / 6c39f69 / c0dfe08; collector 11 PASS, 0 FAIL, 4 unregistered NOT_RUN |
| Whole source workflow | 835/835 tests and full check PASS; M3, legacy, management browsers and method qualification PASS |
| Canonical source coverage | 134 entries; lines 87.91%, statements 82.73%, functions 85.87%, branches 76.32%; threshold NOT_MET, method admission PENDING |
| LOCAL identity | 139 commits verified; 101 imported/38 manager; not GitHub status or independent attestation |
| Native contract entrypoint | 134 Solidity / 25 Python / 2 offline rehearsal tests; ABI/manifest/Slither PASS; management NOT_RUN entries unchanged |
| Source policy / OSV | PASS; OSV includes versioned coverage toolchain inventory; no new dependency finding |
| Gitleaks | Current tree and full history/canary checked; sole raw finding remains approved, precisely verified GITLEAKS-FP-001 |
| Semgrep | FAIL at c0dfe08: hand-written Git SHA-1 in local runner; 22 rules/44 fixtures; remediation 21/21 executor regressions, new source scan pending |
| Independent 05 child review | Bounded 77e925c review and S3965df9 child replay only; 6+13 tests PASS; not this full candidate's independent final approval |
| GitHub | Latest observation PRIVATE; PR22 Draft at3a78e34; new source not published, hosted result unavailable for it |

Coverage raw directory (ignored local evidence): `outputs/phase1-local-closeout/coverage/2026-09-21T20-38-53.146Z-39e4063c-48d6-4dfe-950c-5af829872544`. Report `report-6c537cff-16d5-4ae4-9dbe-710147e58077.json` SHA-256 `67e80364e1bf7af85120f5718558575df29187c1572047b4281453d8594d3f3b`. Scanner/full-run/identity/RED/GREEN raw files are retained under `outputs/phase1-local-closeout/c0dfe08-gates/`, with SHA256SUMS.json. These logs remain local and may contain host paths; the table below carries digests only.

| Local raw file | Bytes | SHA-256 |
| --- | --- | --- |
| alphaforge-contracts-c0dfe08.log | 52824 | `2caa6951aca86293a91387abd56c6bc1609955cc5f187ddca577229adaad374c` |
| alphaforge-coverage-lease-20260922.log | 1634 | `3153e2dffd6c45e5681568972c0cb382e4162a03ab900f88f290b871b3eb06bd` |
| alphaforge-gitleaks-c0dfe08.log | 8689 | `d34feaa2763b7d63cb4f34c61837439118f100a51234406c5062f177959a687a` |
| alphaforge-local-identity-c0dfe08-exact.json | 129 | `b124cb7e5f3826b2277d8b8a55be04ee7e2f8ace49ee5f44912757bb98df3012` |
| alphaforge-local-identity-c0dfe08.json | 84 | `75e6d06699dd2cf6108eef3c1500c2bdb14f0bacf53b765079c0c15c029ec3bc` |
| alphaforge-management-checks-20260922-lease.log | 195 | `68b0fb9ef0207f8a9e9505862acfa30319d7532fc87b11ac3f28df19081b73a8` |
| alphaforge-native-git-binding-green.log | 1979 | `66ee5d994f13292be72de5d8817b4def95f1cce03861143d26b6338f36a94d15` |
| alphaforge-native-git-binding-red-final.log | 976 | `6f5a646aab6baa82ebfe38a3d8a26d1d769995c2f12f44a8ae2485afae6cf4f8` |
| alphaforge-native-git-binding-red-verified.log | 1897 | `f34f6a42fb76a0b55f43bdc32f97e8d087153b592b163f1a1ae51330844623fc` |
| alphaforge-native-git-binding-red.log | 1896 | `54d5cd5db090357c1dca6691803d4ade0e310d81d66e3aad8ce32108f1fb866a` |
| alphaforge-osv-c0dfe08.log | 21329 | `dd238d426f040986efba0cd4724397b9062950d98d00f9c228f393d612ee9245` |
| alphaforge-semgrep-c0dfe08.log | 983 | `11d1e67b1863a8896d9a0857f381ecc4886eadf232f3165efdac80c822a2f942` |
| alphaforge-source-policy-c0dfe08.log | 618 | `278abec624fa8f28f19951f1c3bf4566c2496717af1bbc74213791fd361cb757` |

Unresolved: final coverage and critical semantic/method admission; expanded product workflow delivery; exact new source scanner/full replay; independent final security/governance/eligible review; hosted availability and accurate candidate checks; applicable merge authorization. Testnet remains NOT_DEPLOYED and separately authorized. Current private visibility does not erase older public-history publication concerns or grant history rewriting. No rule removal, fabricated hosted identity, force push, deployment or signature.
