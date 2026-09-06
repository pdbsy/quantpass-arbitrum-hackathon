# Competition TODO

The list is intentionally limited to work required for an honest Robinhood Chain testnet submission.

## Done

- [x] `RHC-001` Pin Robinhood Chain Testnet metadata and add a fail-closed configuration check.
- [x] `REP-001` Create a lean public-repository layout without private planning history or unrelated evidence.

## Now

- [ ] `RHC-002` Define the minimal on-chain vault interface and an adapter boundary; keep local simulation as the default.

## Next

- [ ] `RHC-003` Implement wallet connection and explicit Robinhood Chain Testnet switching.
- [ ] `RHC-004` Deploy contracts to Robinhood Chain Testnet and commit verified addresses plus transaction evidence.
- [ ] `RHC-005` Add contract tests for ownership, replay protection, withdrawals and invariant failures.
- [ ] `DEMO-001` Connect the web flow to the reviewed testnet adapter and show explorer links.
- [ ] `DEMO-002` Record a reproducible judge walkthrough and recovery path.

## Submission gate

- [ ] CI is green from a clean checkout.
- [ ] No secrets or personal data are committed.
- [ ] README distinguishes simulated, testnet and unimplemented behavior.
- [ ] Deployment addresses and explorer links are reproducible.
- [ ] Known limitations and threat boundaries are documented.
