# Macbeth04 Task Intake — M3-04-PHASE1-PRODUCT

- Agent: `Macbeth04`
- Task: `M3-04-PHASE1-PRODUCT`
- Goal: complete the real product-entry loop for Phase One Pass and Vault operations, preserve truthful runtime provenance, and produce reproducible browser acceptance evidence.
- Repository: `git@github.com:pdbsy/quantpass-arbitrum-hackathon.git`
- Default branch: `master`
- Worktree: independent Macbeth04 task worktree; local path intentionally omitted
- Branch: `macbeth04/m3-phase1-product`
- HEAD / base: `18f5352070910a867b9729b031aa2e3951785e01`
- Registration source read-only: `48cccb8743d2e77ec8001187c00e95044a3d2f40` from Draft PR #22; it is not merged or cherry-picked into this branch.
- Clean state: clean before dependency installation and after baseline verification; `node_modules` is ignored and private to this worktree.
- Environment: macOS `26.6.2` arm64; Git `2.50.1`; Node `24.21.0`; npm `11.19.1`.

## Actual product entry and current coverage

`apps/web/index.html` loads the mechanically imported `user-ui.js` asset and the active `apps/web/src/product-ui.ts` extension. The React `App.tsx` entry is not the Phase One delivery path. The six-page English warm hand-drawn product structure remains protected.

The base already implements wallet connection and chain checks, configured Vault reads, fixed-Vault finite AF-USDC and Pass approvals, deposit/withdraw/close review and submission, pre-submit session revalidation, canonical evidence readback, degraded-indexer direct owner exits, reorg handling, collision-resistant operation IDs, explicit MOCK/LOCAL/TESTNET/NOT_DEPLOYED states, and closed-Vault disabling for deposit/withdraw/close.

The remaining product gaps are full 18-decimal Pass transfer, initial-allocation presentation, Vault creation or selection, post-close owner-only token/native rescue, and browser acceptance for refresh/restart/double-click/precision and direct-read recovery across those actions. Paid sale and real Buy/Sell are outside Phase One.

## Scope and protected files

- Expected files: `apps/web/**`; assigned `test/ui-*.test.ts`, `test/m3-*-runtime.test.ts`, `test/m3-product*.test.ts`, `test/m3-chain-action-flow.test.ts`, `test/hackathon-ui-build.test.mjs`; `docs/product/PHASE1-*`; `docs/management/phase1/Macbeth04-*`.
- Protected/shared files: `package.json`, `package-lock.json`, workflows, registry/bootstrap, roadmap, shared management generators and generated snapshots. Any required change is sent to Macbeth01 as a minimal request.
- Historical prototype source is preserved; product changes target the active extension/runtime modules and keep migration provenance explicit.

## Dependencies

- Consume the base ABI/adapter first.
- Macbeth02 must provide exact immutable interfaces for any new Vault factory/create path and the authoritative initial-allocation/deployment representation.
- Macbeth03 must provide an exact handoff SHA for any new multi-Vault discovery, submission/evidence registration, or rescue reconciliation API.
- Pass transfer can use the standard deployed token interface once the reviewed deployment manifest supplies the fixed Pass address; no sale, price, AMM, platform liquidity or redemption semantics will be inferred.

## Risks and controls

- A factory or allocation workflow invented in the browser would create unauthorized protocol semantics. Those paths remain fail-closed until the 02/03 handoff is version-bound.
- Pass uses 18 decimals for ordinary transfers; the `10^12` conversion applies only to Vault capacity. Tests must catch accidental six-decimal truncation or rounding.
- Rescue must remain owner-only, post-close, target a reviewed Vault, calculate/display token raw units independently, and remain available when the index API is degraded if live ownership and closed state are verifiable.
- Wallet/account/chain changes, ambiguous submissions and repeated clicks must not create automatic resubmission.
- Browser acceptance uses only the explicit mock transport on `127.0.0.1:5194`; no real wallet, RPC signing, Testnet broadcast or deployment is authorized.

## Acceptance criteria

1. Preserve the active six-page English product UI and distinguish the user forum from the internal Worker Forum.
2. Show strategy, Pass and Vault identity consistently and label all data provenance honestly.
3. Support reviewed full-precision Pass transfer and the authorized initial-allocation state without paid-sale language.
4. Create or select a Vault only through a reviewed, version-bound interface; otherwise render a precise fail-closed prerequisite.
5. Preserve finite fixed-spender approvals and complete deposit/withdraw/close with simulation, session recheck and evidence tracking.
6. Disable deposit/withdraw/close and related approvals after close while preserving legal owner-only post-close rescue.
7. Preserve direct-read owner exits/rescue during API/index degradation and recover safely across refresh, restart, wallet/chain changes, double click and precision errors.
8. Run focused tests red-first, complete local gates, and an actual browser journey on port `5194`; record PASS/FAIL/BLOCKED/NOT_RUN with exact SHAs.

## Baseline verification

- `npm ci --ignore-scripts`: PASS, 193 packages installed in this isolated worktree; audit reported 0 vulnerabilities.
- `npm run check`: typecheck, lint, format, 591/591 tests, secrets, privacy, network, governance, supply-chain, threat, planning and Forum checks PASS. The command then stopped at `management:check` with `RECORDED_GIT_BRANCH_MISMATCH` because the committed management snapshot is bound to the merged source branch rather than this new worker branch. No source failure was observed.
- NOT_RUN at intake: browser acceptance, external Testnet RPC, real wallet signing, broadcast, deployment, hosted CI, independent QA/security acceptance and merge.

## Communication

- Manager coordination thread: `M3-01-PHASE1-CLOSEOUT`.
- Public assignment notice: <https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/22#issuecomment-5747100835>.
- This worker will publish its own ACK in its own Draft PR and will report dependency questions and blockers to Macbeth01.
