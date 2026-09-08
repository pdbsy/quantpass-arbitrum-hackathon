# Security Policy

## Scope

Only the current `master` branch is supported. This repository is a Robinhood Chain Testnet competition prototype. It does not support mainnet, real-value assets, unattended trading, or custody of user private keys.

## Private reporting

Do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** flow in the repository Security tab:

<https://github.com/pdbsy/quantpass-arbitrum-hackathon/security/advisories/new>

Include the affected commit, preconditions, minimal reproduction, expected impact, and whether any secret may have been exposed. Do not include live credentials, seed phrases, private keys, or real-user data. We will acknowledge Critical reports within one day and High reports within three days. These are triage targets, not a bounty or payment promise.

## Safe handling

- Use local simulation or Robinhood Chain Testnet only.
- Use disposable accounts with no mainnet assets or reused keys.
- Stop after proving impact; do not persist access, degrade services, or access third-party data.
- Coordinate disclosure through the private advisory until a fix and release note are ready.

## Current limitation

The repository is presently owned by a single personal GitHub account. CODEOWNERS and in-repository Actions improve review routing and detection, but they do not provide independent identity assurance or an immutable external governance check. `SUPPLY-001` and `GOV-001` remain incomplete until that external trust boundary is established and verified.
