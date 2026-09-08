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
npm run supply:check
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

Governance decision status: **independent review (not accepted)**.

The canonical plan is [planning/roadmap.json](planning/roadmap.json). It generates [TODO.md](TODO.md), the [Markdown board](docs/TASK-BOARD.md) and the standalone [Chinese HTML security board](docs/task-board.html), so CI can reject status drift. Network assumptions and authoritative references are documented in [docs/ROBINHOOD-CHAIN.md](docs/ROBINHOOD-CHAIN.md). The proposed testnet scope and closed privilege baseline are documented in [ADR-0001](docs/adr/0001-testnet-mvp-scope-and-authority.md), with machine validation in [planning/security-boundary.json](planning/security-boundary.json). The generated [threat model](docs/THREAT-MODEL.md) records open risks without claiming they are fixed.

The active SUPPLY-001 work is documented in [docs/security/SUPPLY-CHAIN.md](docs/security/SUPPLY-CHAIN.md). Its offline check binds npm packages to the canonical registry and SHA-512 integrity, enforces the reviewed license and GitHub Action allowlists, and keeps the committed SPDX 2.3 SBOM synchronized with the lockfile. Vulnerability reports should follow [SECURITY.md](SECURITY.md).

GOV-001 acceptance evidence is tied to a real Git ancestor and a closed first-transition diff. Its repository validator can reject accidental or uncoordinated drift in the accepted ADR, this README's governance section, roadmap policy fields, the validator/tests and CI workflow while allowing roadmap lifecycle progress. The workflow invokes that validator and its tests directly instead of trusting mutable package-script indirection. Git provenance checks sanitize ambient Git configuration, ignore replace refs, distinguish an absent historical review file from an unreadable one, and reject reviewed commits dated after the verification instant.

This in-repository check is defense in depth, not its own trust root: one hostile commit could otherwise replace the workflow, validator and tests together. GOV-001 is therefore explicitly blocked on the current task, SUPPLY-001, which must establish a protected repository-external required workflow/status check and branch policy before governance can be accepted. In-repository reviewer IDs remain audit labels only; they are not external identity assurance. Both Testnet write planes remain closed.

## Safety

- Never commit `.env`, wallets, seed phrases, private keys or provider credentials.
- `.env.example` contains public network metadata only.
- The default app remains local-only until a reviewed testnet adapter is explicitly wired in.
- This prototype is not an investment product and does not handle real funds.
