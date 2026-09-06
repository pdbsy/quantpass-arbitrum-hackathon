# QuantPass on Robinhood Chain Testnet

QuantPass is a safety-first prototype for separating strategy access rights from user funds. It targets Robinhood Chain Testnet, an Arbitrum Chain built with Arbitrum Nitro. The current demo makes allowance, idle cash, active strategy cash, pending withdrawals, positions and fees independently visible in an auditable ledger.

## Hackathon status

- Local end-to-end simulator with persistent SQLite state
- Strict money parsing and vault invariants
- Idempotent commands, optimistic revisions and audit history
- Robinhood Chain Testnet metadata and fail-closed configuration guard
- Automated tests, linting, formatting, build and baseline secret checks

No contract is deployed yet and the application does not sign or submit transactions. Every balance in the UI is simulated.

## Quick start

Requirements: Node.js 24.12.x and npm 11.6.x.

```bash
npm ci --ignore-scripts
npm run check
npm run demo
```

Open `http://127.0.0.1:4180`. The Chinese security board is available at `http://127.0.0.1:4180/task-board.html`. Runtime data is written to `.data/` and is ignored by Git.

To validate only the target network configuration:

```bash
npm run robinhood:check
npm run governance:check
```

## Project layout

```text
apps/server/          Fastify API and SQLite-backed ledger
apps/web/             React competition demo
packages/robinhood-chain/  Robinhood Chain Testnet boundary
packages/config/      Runtime safety gate
packages/domain/      Exact money and vault state machine
src/security-model/   Threat and trust-boundary model
test/                 Unit, integration and HTTP end-to-end tests
```

## Current work

The canonical plan is [planning/roadmap.json](planning/roadmap.json). It generates [TODO.md](TODO.md), the [Markdown board](docs/TASK-BOARD.md) and the standalone [Chinese HTML security board](docs/task-board.html), so CI can reject status drift. Network assumptions and authoritative references are documented in [docs/ROBINHOOD-CHAIN.md](docs/ROBINHOOD-CHAIN.md). The proposed testnet scope and closed privilege baseline are under independent review in [ADR-0001](docs/adr/0001-testnet-mvp-scope-and-authority.md), with machine validation in [planning/security-boundary.json](planning/security-boundary.json). The generated [threat model](docs/THREAT-MODEL.md) records open risks without claiming they are fixed.

## Safety

- Never commit `.env`, wallets, seed phrases, private keys or provider credentials.
- `.env.example` contains public network metadata only.
- The default app remains local-only until a reviewed testnet adapter is explicitly wired in.
- This prototype is not an investment product and does not handle real funds.
