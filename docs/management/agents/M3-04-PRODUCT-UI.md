# Macbeth04 M3 product implementation assignment

Assigned by Macbeth01 after receiving the user's explicit “Macbeth04 — M3 Product / Frontend Implementation” prompt on 2026-09-14. This supersedes Macbeth04's completed M3-04-AUDIT scope only; other worker scopes are unchanged.

User prompt SHA-256: `bbdb75bf8421373b32e6efc847315c816f0f316ef4b2f0d4a205058b040a3bfb`.

## Startup registration

- Agent: Macbeth04
- Task-ID: `M3-04-PRODUCT-UI` (manager-assigned execution identifier; the user prompt did not specify one)
- Repository: `pdbsy/quantpass-arbitrum-hackathon`
- Required branch: `macbeth04/M3-product-ui`
- Fixed M3 canonical baseline: `7ecba357d5a19f387e86f578822af04a6261fed2`
- Baseline status: actual PR #14 master merge; environment, identity, 378/378 application tests, Linux/Windows/ARM macOS CI and CodeQL verified by 01.
- Execution status: implementation authorized by the current user; dependency-specific operations remain gated.

The exact branch follows the user's new attachment. Identity protocol 1.1.0 already supports this prefix; no validator exception or rule change is needed. Registry and bootstrap select that supported alias for this task. Do not use `04/product-ui-m3`, develop on the audit branch, or substitute an arbitrary newer commit for the fixed baseline.

The manager's current registration carries the same `canonical_baseline` value. This assignment may be read at the immutable manager registration commit in its PR; that records existing user authorization, not unmerged product code. The implementation branch must start from the designated baseline itself. Do not copy unmerged manager/product changes into it merely to make a local historical task snapshot appear current.

## Scope and dependencies

Build the complete user-to-chain product path before strategy runtime: canonical strategy routing, wallet/network states, mode/data provenance, supported Pass/Vault read projections and asset actions, transaction feedback, readback and Account state. Preserve the warm hand-drawn product UI, Pass Price primary chart, Strategy Performance secondary chart and protected prototype bytes. The blue management Dashboard remains separate.

Start with the canonical product shell and explicitly labelled fixture/local/Testnet/not-implemented states. Consume Macbeth03's shared wallet/network/transaction/readback interface; do not introduce a competing permanent adapter or choose a new EVM dependency unilaterally. Macbeth02 owns contract capabilities, ABI/events/errors/authorization/deployment facts. Without genuine supporting capabilities, buttons remain visible, disabled and labelled NOT IMPLEMENTED. No fake receipts or local success presented as Testnet confirmation.

Account and wallet are separate identities. `CHAIN_CONFIRMED` means a successful chain receipt; `READY` additionally requires the relevant product readback/projection. Neither state claims irreversible settlement beyond the shared finality contract. Preserve rejection, account-switch, wrong-network, stale response, RPC failure and readback-delay cases.

Strategy runtime, venue execution, live positions and strategy-generated PnL are outside this frontend assignment. Product/UI decision labels D1–D3 belong to this frontend prompt; they do not replace the separately frozen protocol D1–D3. The broader proposed partial-withdrawal semantics remain subject to the user's response to the protocol Decision Request.

## Manager engineering decision: canonical Strategy ID

Use existing stable product IDs as logical product/domain identifiers; the first M3 UI strategy ID is `trend`. It is not a contract address or a chain-specific deployment ID. Future chains/deployments attach to the same logical identity through explicit metadata.

Keep `core-flow-demo` and `satellite-flow-demo` as explicit historical LOCAL simulation identities. Do not silently equate their accounts, balances, strategy economics or ownership with `trend`, and do not use their balances to populate Testnet holdings. A legacy route alias may redirect only through an explicit, tested, mode-scoped mapping; if actual strategy equivalence is not established, retain the distinct fixture instead of inventing equivalence.

This fixes the UI/domain identifier, not Solidity encoding or ABI. 02/03 must publish any bytes32/on-chain encoding and deployment map as a shared interface; 04 must not guess it. `/market` and `/trade/:strategyId` can converge on the logical identifier while unavailable chain capabilities remain disabled.

## Handoff and validation

Report Repo, actual origin, exact baseline, actual branch/HEAD and whether checkout creation succeeded. Then publish CAN IMPLEMENT NOW / UI SHELL ONLY / BLOCKED / NOT IMPLEMENTED with 02/03 dependencies, and an implementation plan. Use the approved Node 24.21.0 / npm 11.19.1 through fnm; independent checkout, dependencies and SQLite data.

Commit subjects include `[Macbeth04]`; trailers contain `Agent-ID: Macbeth04` and `Task-ID: M3-04-PRODUCT-UI`; PR title uses `[Macbeth04][M3-04-PRODUCT-UI] ...`. Keep meaningful unit/integration and DOM/E2E coverage for routing, provenance, wallet/network states, transaction lifecycle, rejection and stale/readback paths. Historical tests are not current PASS evidence.

The PR #14 one-time review exception is closed. This assignment grants no merge, repository-rule modification, deployment, broadcast, mainnet operation, private-key custody or protected-prototype modification. Escalate unresolved product/security/interface choices to 01 and continue independent authorized work.
