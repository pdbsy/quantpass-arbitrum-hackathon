# Phase One Browser Acceptance

## Candidate and environment

- Product source candidate: `86f2f9036657eeda3a7357943b6fcac6de3e5dbe`
- Candidate tree: `ae90be8d3411d921bdaf37cf15d3fdea01ce22b3`
- Chain/API source consumed read-only: `500914b900d61ea5b26c32ab5cc39c4b0d829c3c`
- Chain/API source tree: `f5257183b1b114295e565f1799b736a124797f72`
- OS: macOS `26.6.2`, Apple Silicon
- Node: `24.21.0`
- npm: `11.19.1`
- Browser: Codex in-app browser; the browser API did not expose a reliable browser version string
- URL: `http://127.0.0.1:5194/?m3Fixture=1#/trade/trend`
- Transport: production browser runtime with `DEV_MOCK`; loopback only, no external RPC or broadcast
- Date: `2026-09-20`, Asia/Shanghai

Three screenshots were captured in the task record through the computer-use tool: one shows the
wrong network state with writes disabled; one shows the closed Vault with only the two owner rescue
actions enabled; and one shows the final candidate's selected Vault and initial Pass allocation.
The tool did not expose a repository file path for those captures, so this document does not claim
an image artifact in Git.

The interactive sequence was rerun after consuming the corrected Chain/API handoff. The explicit
mock banner remained visible, runtime bytecode verification allowed the reviewed fixture contracts,
the Pass submission registered successfully and displayed `SUBMITTED`, and the post-refresh balance
again decreased by exactly one raw unit. Closed-Vault and wrong-network write states were also
rechecked.

## Steps and observed results

1. Opened the actual product route with the mock fixture query.
2. Selected the correct test network and connected the owner wallet.
3. Observed wallet `0x1111…1111`, chain ID `46630`, selected Vault
   `0x2222…2222`, fixed Pass `0x4444…4444`, and a `2.000000000000000000` Pass balance.
4. Confirmed Deposit, Withdraw, and Close were available while rescue was disabled on the open
   Vault. Deposit review displayed both exact finite allowances and the fixed Vault spender.
5. Opened Pass transfer, entered recipient `0x9999…9999`, and entered
   `0.000000000000000001` Pass.
6. Observed the confirmation dialog bind the owner, fixed Pass contract, exact recipient, one Pass
   base unit, and a unique operation ID.
7. Confirmed once and observed `SUBMITTED` with the mock transaction hash. After refresh, the balance
   was exactly `1.999999999999999999` Pass / `1999999999999999999` base units.
8. Changed the Vault fixture to closed. Observed Deposit, Withdraw, Close, and approval disabled;
   token rescue and native rescue remained enabled for the owner.
9. Reviewed and confirmed native rescue. The dialog showed no amount and the exact owner-bound
   operation; the runtime reported `SUBMITTED`.
10. Switched to chain ID `1`. Observed `WRONG` network and every write disabled, including Pass
    transfer and both rescue actions.

Result: **PASS within LOCAL / MOCK scope**.

## Automated verification

The exact candidate passed:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- ten focused wallet, Pass, Vault, runtime, dialog, allowance, and live-reader test files: `118/118`
- `npm run build:web`
- `npm run verify:agent-identity`

The coverage follow-up measures the seven assigned wallet/runtime modules at `99.96%` lines,
`98.51%` branches, and `99.15%` functions; exact per-file results and residual defensive branches
are recorded in `docs/product/PHASE1-COVERAGE-EVIDENCE.md`.

`npm test` ran `638` tests: `637` passed and one shared provenance test failed. The only failure is
`test/migration-provenance.test.mjs`, because
`docs/migration/artifact-provenance.json` still records the previous `product-ui.ts` SHA-256
`56c01e81072d10088eef3011d317ff8e34b8e7bd1d1dd19548baf812c82f3ea2`; the candidate file is
`335dd498b1b70a4b52ec1029e59b2efda7f9f750f47f4d7b1459e80c4a75c0db`. The shared migration
evidence is outside Macbeth04's assigned file scope and must be updated by Macbeth01 during
integration. This failure remains recorded and is not reclassified as a pass.

## Not run

- Real Robinhood Chain Testnet deployment and wallet acceptance: `NOT_RUN` because no deployment
  address or authorization exists.
- Hosted CI and independent Macbeth05 acceptance against the unified candidate: `NOT_RUN`.
- Multi-Vault creation/discovery browser flow: `NOT_RUN` because no exact integrated factory or
  discovery interface exists.
