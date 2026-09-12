# Macbeth02 persistent worker check-in

AGENT_NAME = Macbeth02
BRANCH_PREFIX = macbeth02/
Setup Task: AF-AGENT-SETUP
Current Business Task: NONE
STATUS: IDLE
Ready for Assignment: YES

## Identity and startup verification

Verified on 2026-09-12 from the persistent Macbeth02 session:

- Worker worktree and repository root: `<SOURCE_ROOT>`.
- Worker branch: `macbeth02/af-agent-setup`.
- Repository: `pdbsy/quantpass` (project name AlphaForge).
- Fetch and push remote: `git@github.com:pdbsy/quantpass.git`.
- GitHub default branch: `master`.
- Initial HEAD and verified remote master: `0a813de422a02a2b3f0ade7eee693f0d2491ec33`.
- Startup state: clean tracked and untracked state; no Macbeth02 remote branch or open PR existed at inspection.
- Isolation: linked worktree with its own Git directory; existing worker branch reused.
- `git fetch origin`: passed.
- Git author and committer configuration: unchanged; worker identity is commit metadata only.
- No business task has been assigned. The only authorized work is AF-AGENT-SETUP.

The app initially opened a clean detached checkout at `<SOURCE_ROOT>` at the same base SHA. Setup writes occur only in the prepared Macbeth02 worker worktree above. Future work in this session must explicitly use that worker worktree and recheck its branch before making changes.

## Protocol and communication

Read the published protocol 1.0.0, communication schema, and Macbeth02 bootstrap from [Draft PR #1](https://github.com/pdbsy/quantpass/pull/1), at head `bb994369fa96c443b529aaf6470610a797ef05fb`.

Read [Macbeth01's NOTICE](https://github.com/pdbsy/quantpass/pull/1#issuecomment-5645884454). CHECK_IN and ACK publication results are recorded in this worker's own Draft PR. The ACK must use the NOTICE's exact URL as Reply-To and address Macbeth01.

## Scope and dependencies

Only this worker's setup record and its own GitHub PR communication are in scope. Product UI, business runtime, other workers' state, Git identity configuration, credentials, rulesets, and merging are protected.

PR #1 supplies the protocol and forum tooling but remains unmerged. This setup branch stays based on the verified master SHA; it does not import that implementation. Shared registry and dashboard updates remain with their owning PR. The public PR log is the source of truth for actual CHECK_IN and ACK delivery.

## Verification policy

Record executed checks and any failures in the worker PR. Do not represent unrun checks or pending GitHub checks as passed. No product implementation or business task is started by this check-in.
