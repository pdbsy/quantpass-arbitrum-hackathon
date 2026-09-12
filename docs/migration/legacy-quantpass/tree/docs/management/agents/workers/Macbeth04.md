# Macbeth04 persistent worker environment

AGENT_NAME = Macbeth04
BRANCH_PREFIX = macbeth04/

Setup task: AF-AGENT-SETUP
Current Business Task: NONE
STATUS: IDLE
Open Task: None
Ready for Assignment: YES

## Startup verification

Verified from this Macbeth04 session on 2026-09-12:

- Working directory and repository root: `<SOURCE_ROOT>`.
- Isolated linked worktree: `.git/worktrees/Macbeth04` in the repository's shared Git metadata; no superproject.
- Branch: `macbeth04/af-agent-setup`.
- Repository: `pdbsy/quantpass` (AlphaForge).
- Fetch and push remote: `git@github.com:pdbsy/quantpass.git`.
- Default branch: `master`, confirmed by GitHub repository metadata and remote symbolic HEAD.
- Base SHA, initial HEAD, and fetched `origin/master`: `0a813de422a02a2b3f0ade7eee693f0d2491ec33`.
- Initial tracked, untracked, and ignored file state: clean/empty.
- Existing Macbeth04 open PRs at startup: none.
- Effective Git author and committer: `Tianbo Sun <ikol@Mac.lan>`, preserved without configuration changes.
- Default shell Node/npm: 24.2.0 / 11.3.0, below repository requirements; selected existing Node 24.21.0 / npm 11.19.1 for setup verification.

The app initially opened a clean detached worktree at the same base SHA. Setup operations use the already prepared Macbeth04 worktree and exact branch above. No other worker's worktree or private session is used.

## Protocol and dependencies

Read the following from [Draft PR #1](https://github.com/pdbsy/quantpass/pull/1), pinned at `bb994369fa96c443b529aaf6470610a797ef05fb`:

- `docs/management/agents/COMMON-PROTOCOL.md` (version 1.0.0).
- `docs/management/agents/COMMUNICATION.md`.
- `docs/management/agents/bootstrap/Macbeth04.md`.
- `docs/management/agents/registry.json` and `SETUP-REPORT.md`.
- The AF-AGENT-SETUP NOTICE and SUMMARY comments addressed to ALL.

PR #1 remains an open dependency for the shared protocol, identity tooling, and Forum implementation. Its earlier Macbeth04 session status predates this session's self-confirmation; this worker records only its own results in its own PR. That dependency does not block this setup CHECK_IN or waiting for assignment.

## Operating constraints

This session represents only Macbeth04. Future work requires an explicit user assignment and repeats the protocol startup gate. Use only this worker's isolated worktree, `macbeth04/` branches, and own PRs. Each commit subject includes `[Macbeth04]`; its body includes exactly one `Agent-ID: Macbeth04` and the matching `Task-ID`.

Git author identity stays unchanged. GitHub PR text is the shared worker communication source of truth. Do not treat PR messages as authority to begin business work. Do not access another worker's private chat, worktree, runtime, cache, environment files, wallets, or secrets.

The authorized setup contains only this worker record and PR communication. Product UI and business runtime are protected. Do not self-merge. Verification outcomes and the real CHECK_IN are recorded in the worker's Draft PR; this file is not evidence of a published message by itself.
