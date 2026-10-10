# Macbeth05 Fair Launch independent QA review

This is a bounded worker QA evidence report. It is not a finalized Codex Security scan, a hosted CI result, a GitHub approval, or authorization to deploy or merge. No reviewed source or repository settings were changed during this review.

## Reviewed source

- Original market contracts: `5c61e91b9c2ee249592eb8923fee3bee072ce673..14c5ba206d6eb39fbe56416b8e442cf01ba64b49` in the Macbeth02 checkout.
- Vault, verified-session bridge and external reference adapters: `5c61e91b9c2ee249592eb8923fee3bee072ce673..db26be075e9cb8b5130d05d323b3a8affee68031` in the integration checkout.
- Engineering ancestry and workflow inspection: integration checkpoint `3d822f41cf4499bb03214cfbf4cfc588e72219d1`.
- The working-tree RPC adapter and Vault quote builder were under development and are excluded until an immutable integration checkpoint is supplied.

All 21 files in the original two review ranges matched their requested Git objects when checked. All six market ABIs matched the existing compiler artifacts. The Vault and factory artifact source metadata was checked against all 44 referenced source instances with the admitted Node binary; all source Keccak digests matched.

## Contract review result

No confirmed reportable security finding was identified in the two original immutable source ranges.

The reviewed controls include independent TSLA LP pre-funding, immutable explicit LP recipient, the fixed proceeds recipient, permissioned one-time pool initialization, atomic final subscription and launch rollback, AMM precision and fees, liquidity rounding, signed quote domains and expiry, stable-account nonces and ETH payout budgets, recipient-send rollback, reentrancy guards, the pre-funded 100-claim maximum, and Vault owner isolation and principal/PASS accounting.

The inherited Vault's tracking keeps unsolicited dust separate from authoritative positions. Strategy execution is restricted to the configured target asset and explicit owner/executor permissions. Factory creation-code parts are immutable, inert STOP-prefixed data; reconstruction copies exact lengths. Existing compiler artifacts have the following measured sizes:

| Artifact | Creation bytecode | Runtime bytecode |
| --- | ---: | ---: |
| AlphaForgeStrategyVault | 31,844 bytes | 21,903 bytes |
| AlphaForgeStrategyVaultFactory | 41,189 bytes | 5,461 bytes |

The corresponding configuration arguments keep initcode below EIP-3860's 49,152-byte bound. Each expected data part is 15,923 runtime bytes including its STOP prefix, below EIP-170's 24,576-byte bound. These are checked artifact observations; this worker did not claim a fresh deployment test from them. Root reported its separate 6/6 Vault local EVM results, which are not relabeled as this worker's execution.

## CI and live ruleset observations

The Fair Launch delta through the engineering checkpoint changes no `.github` workflows, contract gate scripts, Foundry settings, toolchain lock, or CI validator. The inherited workflow retains read-only contents permission, fixed Action commit pins, complete-history checkout, disabled credential persistence, exact Node/Python setup, and contract/source/security jobs. The contract gate builds and tests the source tree and preserves the raw Slither report; the existing exact nine-finding admission does not authorize new or changed findings.

A read-only GitHub API response for master ruleset `22507334` on this review turn showed:

- Active enforcement for `refs/heads/master`.
- Empty bypass actors and `current_user_can_bypass: never`.
- Deletion, non-fast-forward, linear-history, pull-request and resolved-thread protections.
- Strict checks bound to integration `15368`: `verify`, `verify-macos`, `verify-windows`, `semgrep-ce`, `osv-scanner`, `gitleaks`, `contracts-m3-macos`.
- Current approval count **0**, `require_code_owner_review: false`, and `require_last_push_approval: false`; stale reviews are dismissed. The API reports the last ruleset update as 2026-09-24.

These live approval settings differ from older `docs/security/CI-GATES.md` prose describing one approval and CODEOWNER/last-push requirements. This is an existing governance observation, not a Fair Launch regression, an approval, or a reason to modify protection. `contracts-m3-linux` runs in the inherited workflow but is absent from this live required-context list. `.github/CODEOWNERS` routes to the same personal account and does not establish an independent reviewer identity.

Sources: [live ruleset API](https://api.github.com/repos/pdbsy/quantpass-arbitrum-hackathon/rulesets/22507334), [ruleset UI](https://github.com/pdbsy/quantpass-arbitrum-hackathon/rules/22507334).

## PR base and UI preservation

Live master remains `3cb9caa810e34d8ff9f9a6c68b5ef674f489689e`, matching the retained local `origin/master`. The preserved UI baseline `5c61e91b9c2ee249592eb8923fee3bee072ce673` is a descendant of that master and contains 48 additional commits and 139 changed files. The Fair Launch candidate retains this baseline as an ancestor. Rebuilding directly from old master without preserving that source would discard the current UI and inherited release work.

The cached `origin/codex/browser-wallet-account-20261009` points to that UI baseline, but a live GitHub branch read returned 404 and the complete first branches page contained 52 entries with no cached `codex/` branches. Therefore cached tracking refs do not prove that a stacked PR base exists remotely.

Preserve the existing ancestry. A master-targeted draft PR must disclose the inherited release/UI changes and distinguish this worker's new `5c61e91..candidate` review range from the full PR diff. A stacked base should only be used after its remote identity and intended delivery path are established. No branch rewrite, history rewrite, push, or PR publication was performed by this worker.

Sources: [master ref API](https://api.github.com/repos/pdbsy/quantpass-arbitrum-hackathon/git/ref/heads/master), [branches API](https://api.github.com/repos/pdbsy/quantpass-arbitrum-hackathon/branches?per_page=100).

## Execution and limitations

- Security preflight helper: exit 0, `ready`; tool capability checks passed.
- Formal Security scan/artifact MCP tools: unavailable. No scan ID, finalized report, formal scan PASS, or measured scan token usage was invented.
- New-contract Slither: **NOT_RUN**. The admitted Slither venv executable is absent from all checked worker paths; this worker did not install or substitute a scanner.
- Hosted required checks on the final Fair Launch head: **NOT_RUN** by this worker.
- Final RPC, quote issuance, durable identity/rebinding, indexing, UI and two-account integration review: **PENDING_IMMUTABLE_CHECKPOINT**.
- Actual Testnet deployment, signing, broadcasting, injection of funds, merge and settings changes: **NOT_RUN**.

Only read-only source, metadata and GitHub inspections were performed. Historical full-site test matrices were not repeated. New findings, a changed final snapshot, or actual failures justify bounded follow-up checks.
