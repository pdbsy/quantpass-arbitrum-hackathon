# Task board

Updated: 2026-09-06

| Status | ID | Task | Acceptance check |
| --- | --- | --- | --- |
| Done | ARB-001 | Arbitrum Sepolia configuration guard | Correct chain ID and HTTPS endpoints pass; wrong network, insecure URL and embedded credentials fail tests. |
| Done | REP-001 | Competition-only public snapshot | Runtime source, tests and CI are present; internal planning and unrelated evidence are absent. |
| Now | ARB-002 | Minimal on-chain vault interface and adapter | Interface covers deposit, allocation, withdrawal and state reads; simulator remains the default implementation. |
| Next | ARB-003 | Wallet and network UX | User must explicitly connect and switch to chain `421614`; no silent signing. |
| Next | ARB-004 | Testnet deployment evidence | Addresses, compiler inputs and Arbiscan links are committed and independently checkable. |
| Next | ARB-005 | Contract safety tests | Authorization, replay, withdrawal and accounting invariants have negative tests. |
| Next | DEMO-001 | Testnet-backed demo flow | UI labels testnet state and links every transaction to the explorer. |
| Later | DEMO-002 | Judge walkthrough | Clean-checkout setup and a short recovery-aware demo are reproducible. |

## Work-in-progress rule

Only one engineering task is in **Now**. A task moves to **Done** only after its acceptance check passes locally and in CI.
