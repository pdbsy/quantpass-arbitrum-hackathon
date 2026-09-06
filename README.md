# QuantPass Arbitrum Hackathon

QuantPass is a safety-first prototype for separating strategy access rights from user funds. The current demo makes allowance, idle cash, active strategy cash, pending withdrawals, positions and fees independently visible in an auditable ledger.

## Hackathon status

- Local end-to-end simulator with persistent SQLite state
- Strict money parsing and vault invariants
- Idempotent commands, optimistic revisions and audit history
- Arbitrum Sepolia network metadata and fail-closed configuration guard
- Automated tests, linting, formatting, build and baseline secret checks

No contract is deployed yet and the application does not sign or submit transactions. Every balance in the UI is simulated.

## Quick start

Requirements: Node.js 24.12.x and npm 11.6.x.

```bash
npm ci --ignore-scripts
npm run check
npm run demo
```

Open `http://127.0.0.1:4180`. Runtime data is written to `.data/` and is ignored by Git.

To validate only the target network configuration:

```bash
node --env-file=.env.example tools/check-arbitrum.ts
```

## Project layout

```text
apps/server/          Fastify API and SQLite-backed ledger
apps/web/             React competition demo
packages/arbitrum/    Arbitrum Sepolia network boundary
packages/config/      Runtime safety gate
packages/domain/      Exact money and vault state machine
src/security-model/   Threat and trust-boundary model
test/                 Unit, integration and HTTP end-to-end tests
```

## Current work

The competition-only backlog is in [TODO.md](TODO.md), with execution status in [docs/TASK-BOARD.md](docs/TASK-BOARD.md). Network assumptions and authoritative references are documented in [docs/ARBITRUM.md](docs/ARBITRUM.md).

## Safety

- Never commit `.env`, wallets, seed phrases, private keys or provider credentials.
- `.env.example` contains public network metadata only.
- The default app remains local-only until a reviewed testnet adapter is explicitly wired in.
- This prototype is not an investment product and does not handle real funds.
