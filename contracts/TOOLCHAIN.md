> Migration note: original AF-CHAIN01 local-only foundation. Target ADR 0001, planning/security-boundary.json and DEVELOPMENT-TOOLCHAIN-STATUS.md take precedence. Historical verification is not current target acceptance; ENV-06 remains NOT_RUN.

# AF-CHAIN01 exact toolchain and supply-chain record

Agent: Macbeth04. Verification date: 2026-09-12. Scope: local development only. Machine: Darwin arm64. Runtime chosen: CPython 3.12.9; root Node checks use the existing Node 24.21.0 / npm 11.19.1 without changing root dependencies.

| Tool | Exact selection | Official source / artifact verification | License | Platform scope |
| --- | --- | --- | --- | --- |
| Foundry / Forge | 1.5.1; commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2` | [Release](https://github.com/foundry-rs/foundry/releases/tag/v1.5.1); official `@foundry-rs/forge-darwin-arm64@1.5.1` registry tarball; fixed SHA-512 SRI and computed SHA-256 in toolchain.lock.json | MIT OR Apache-2.0 ([MIT](https://github.com/foundry-rs/foundry/blob/v1.5.1/LICENSE-MIT), [Apache](https://github.com/foundry-rs/foundry/blob/v1.5.1/LICENSE-APACHE)) | Upstream has macOS/Linux/Alpine amd64+arm64 and Windows amd64 artifacts; this installation extracts only Forge for macOS arm64 |
| solc | 0.8.31+commit.fd3a2265 | [Release](https://github.com/argotorg/solidity/releases/tag/v0.8.31); [official solc-bin index](https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/macosx-amd64/list.json); both publish SHA-256 `f5a243d6b2dd8fba307e36c5fefa2d8eb3ae74ba81036d1c17c971b5d346ade9` for the selected macOS artifact | GPL-3.0 ([license](https://github.com/argotorg/solidity/blob/v0.8.31/LICENSE.txt)) | Upstream macOS, Linux amd64/arm64, Windows, soljson; only selected macOS artifact is used here |
| OpenZeppelin Contracts | 5.4.0; Git tag commit `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0` | [Release](https://github.com/OpenZeppelin/openzeppelin-contracts/releases/tag/v5.4.0); official `@openzeppelin/contracts@5.4.0` package, fixed SHA-512 SRI and archive SHA-256 in lock | MIT ([license](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.4.0/LICENSE)) | Platform-independent Solidity source; this project only consumes EIP712 and its transitive imports |
| Slither | slither-analyzer 0.11.3; crytic-compile 0.3.11 | [Release](https://github.com/crytic/slither/releases/tag/0.11.3), [PyPI](https://pypi.org/project/slither-analyzer/0.11.3/); `requirements-slither.lock` pins all 47 downloaded wheels by exact version/SHA-256, including transitive dependencies | AGPL-3.0 ([license](https://github.com/crytic/slither/blob/0.11.3/LICENSE)); transitive packages have their own licenses | Upstream Python >=3.8; selected binary wheel lock is CPython 3.12/macOS arm64 only; crytic-compile excludes Python 3.12.0 |

## Why these versions

Foundry 1.5.1 explicitly added solc 0.8.31 support. That compatible pair is pinned instead of a moving channel. solc pragmas are exactly `0.8.31`; Foundry auto compiler selection and downloads are disabled. `evm_version = paris`, optimizer disabled, via IR disabled, metadata hash disabled, FFI disabled and filesystem permissions empty. These are local compiler/test choices, not chain deployment parameters or promises of production safety.

OpenZeppelin 5.4.0 supplies standard EIP-712 hashing; the preview does not implement its own cryptographic primitive and does not import token, proxy, governance or signature-verification modules. Slither 0.11.3 is a fixed analyzer with a fully resolved wheel set. Selecting versions is not a claim that every upstream code path or transitive dependency is vulnerability-free; production dependency review remains a separate gate.

## Integrity and installation

`toolchain.lock.json` pins all downloaded primary artifacts. Foundry/OpenZeppelin SHA-512 values come from official npm version metadata, and the native solc SHA-256 matches both official GitHub release metadata and solc-bin. The local script checks all fixed hashes before extraction/execution. Slither installation uses `--require-hashes --only-binary=:all:` in a project-local venv; no floating dependency or source build is allowed. The lock file's own SHA-256 is included in the toolchain record.

All tools, package archives, venv, caches and reports remain in `.checks/af-chain01/{toolchain,evidence,out,cache}` and `contracts/node_modules/@openzeppelin/contracts`, which are ignored. Root package files, global tool installations, Git author configuration and other workers' caches are unchanged. Anvil, Cast and Chisel are not installed by this bootstrap.

The source repository contains no project-wide license grant, so new local Solidity files use `SPDX-License-Identifier: UNLICENSED`; upstream licenses are preserved in the extracted packages. Tool licenses do not confer a license to the project or change deployment permissions. Full transitive license/legal approval is NOT RUN; use the pinned wheel metadata when performing that review.

## Actual failures and limits

The first GitHub Foundry archive download terminated with IncompleteRead; the first official npm tarball attempt was also truncated and failed the fixed SRI check. Neither partial artifact was executed. A resumed official npm download passed SRI and installed Forge. The Solidity binaries endpoint returned HTTP 403, so the identical officially indexed solc-bin artifact is obtained through its official repository distribution URL. Download availability is not a compiler test result.

Official npm provenance attestations and GitHub signatures were discovered but **not independently verified**. Hash matching proves consistency with the recorded publisher metadata, not independent build provenance. Reproducible source rebuilds, hardware architecture variants, Linux/Windows verification, transitive vulnerability/license audit, and real Robinhood compatibility remain NOT RUN. Exact build/test/static-analysis results belong in the verification report, never inferred from a successful install.

## Coordination

Macbeth01 approved these task-local locks/docs and explicit ID/Adapter boundaries in [PR #8 decision](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646402687). No root package/config/CI/shared types/backend/UI changes are authorized by that decision. Updating a pin means reviewing new official metadata, hashes, licenses and compatibility and re-running the relevant checks; never replace a failing expected digest with the bytes of an unexplained download.
