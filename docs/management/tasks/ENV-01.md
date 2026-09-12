# ENV-01–05 development toolchain alignment

Task ID: `ENV-01`

Title: `DEVELOPMENT TOOLCHAIN ALIGNMENT`

Worker: `Worker B / Macbeth`

Start: `2026-09-12T15:30:00+08:00`

Finish: `NOT_FINISHED`

Status: `IN_PROGRESS`

## Summary

The user assigned synchronization and project alignment against DEVELOPMENT-TOOLCHAIN.md to Macbeth. The supplied historical UNASSIGNED status is retained in the original document, with current authority and evidence in docs/DEVELOPMENT-TOOLCHAIN-STATUS.md. ENV-01 through ENV-05 are implemented in the actual source branch macbeth/env-01-toolchain; qualification and review remain required before completion.

## Changes and verification

Exact Node and npm inputs, root lock engines, generated SPDX namespace, effective npm configuration admission, native architecture and Git identity checks, bounded redacted environment report, clean CI wrapper and three supported hosted jobs. Existing dependency graph and engineering/security gates are retained. Disposable Git fixtures receive LF attributes before staging and isolate host configuration without overriding explicit test authors.

The qualified temporary Node 24.21.0 archive matched the official SHA-256; npm 11.19.1 matched registry SHA-512. The first truncated Node downloads were rejected and never executed. Clean npm ci --ignore-scripts installed the locked native package subset. Full local regression passed 240 tests; final source-bound management and GitHub evidence are collected after source freeze. These statements are technical self-review, not independent approval.

## Not fully resolved

- Three supported GitHub native CI jobs and exact final source evidence must be read back.
- The permanent macOS fnm environment and permanent checkout are not established by temporary qualification.
- Adding verify-macos to protected required checks and merging this new toolchain PR require the user's applicable authorization.
- ENV-06, external governance, independent security acceptance and chain access remain outside this implementation.
