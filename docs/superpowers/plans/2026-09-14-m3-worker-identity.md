# AlphaForge M3 Worker Identity Implementation Plan

> **For agentic workers:** Execute this bounded compatibility change in the manager's isolated checkout. Keep protocol implementation with Macbeth02 and request a separate code review before integration.

**Goal:** Unblock the assigned M3 worker branch/task identities without bypassing identity checks or invalidating historical AF records.

**Architecture:** Share exact branch-to-agent and task-to-agent validation between commit, registry and Forum consumers. Keep historical `macbeth0N/` and `AF-*` provenance valid; add `02/`–`05/` and owner-bound `M3-0N-*` identities. Registration is coordination metadata, never signing or merge authority.

**Tech Stack:** Node 24.21.0, npm 11.19.1, existing Node test runner; no dependency change.

**Spec:** Current user manager assignment and Macbeth02's M3-02-PROTOCOL startup requirements, recorded in `docs/management/agents/M3-ASSIGNMENTS.md`.

## Constraints

- Base: master `45e80f921df2d3f9172ddbbc8e6ab37c327107e7`; preserve complete Git history and evidence refs.
- No product, contract, runtime network, credentials, required-check or repository-rule changes.
- 02 implementation is assigned; 03–05 currently have readiness audits only.
- App task acknowledgments are not GitHub Forum acknowledgments or independent security approval.
- Source C, generated manifest R and generated Dashboard snapshot S remain separate commits.

## Task: M3 identity compatibility and assignment alignment

Files: `tools/agent-identity.mjs`, `tools/agent-identity-set.mjs`, `tools/check-agent-identity.mjs`, `tools/agent-forum.mjs`; existing agent management/lifecycle tests; registry, bootstraps and current management records.

Interfaces: `agentForBranch(branch)` returns the exact registered agent or null; `taskMatchesAgent(task, agentId)` accepts historical AF tasks or M3 tasks carrying that agent's two-digit ID. All existing validators retain their call signatures and failure behavior.

- [ ] Add failing real-validator tests: numbered branch + M3 PR/commit accepted; mismatched agent/task, malformed prefix, unsigned numbered-branch commit and mismatched Forum ownership rejected. Exercise fresh-branch/dispatch full-range validation in a real temporary Git repo.
- [ ] Run `node --test test/agent-management.test.mjs test/agent-identity-lifecycle.test.mjs test/agent-identity-bypass.test.mjs` and record the expected missing-compatibility failures.
- [ ] Implement exact mapping (`02/` -> Macbeth02, etc.) and owner-bound M3 task validation; reuse it for branch detection, base selection and Forum ownership. Do not turn unknown numeric branches into non-worker skips.
- [ ] Update registry and matching bootstrap declarations; record actual app receipts separately from public Forum state. Record 02 as M3-02-PROTOCOL, 03–05 as their M3 audit tasks, with implementation dependencies BLOCKED.
- [ ] Run targeted tests, full application checks and identity lifecycle checks. Obtain code review; fix substantive findings.
- [ ] Commit source C; run the existing full management collector; commit manifest-only R; build and commit snapshot-only S. Verify exact final head and open a reviewable PR. Do not change rules or merge without applicable authorization and checks.
