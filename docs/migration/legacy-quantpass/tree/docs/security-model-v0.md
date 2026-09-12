# QuantPass Security Model v0

Status: executable reference model, not production deployment guidance.

## Design goal

QuantPass must protect two parties that do not fully trust each other:

1. A user must be able to use a strategy without letting the builder withdraw funds, exceed an agreed risk envelope, silently change the authorized strategy family, or replay stale decisions.
2. A builder must be able to deliver useful trades without distributing source code, model weights, features, parameters, or intermediate signals.

The key design decision is to authorize **bounded execution**, not to give either party control of the other party's asset. A Strategy Pass proves eligibility. It does not itself authorize an arbitrary trade.

## What the model can and cannot guarantee

It can enforce a user-signed risk envelope, bind every decision to an approved strategy release, reject replay and stale state, remove withdrawal capabilities, and minimize strategy data crossing trust boundaries.

It cannot guarantee profit, eliminate exchange or oracle risk, make a compromised host trustworthy, or make output extraction impossible. A user necessarily observes trades placed in their own account. Enough observations can reveal aspects of a strategy. QuantPass can raise the cost of imitation through output minimization, rate limits, capacity controls, and confidential compute; it cannot promise perfect secrecy from strategy behavior.

## Trust zones

```text
 Builder zone                 Confidential runtime
 source + weights  ──seal──>  attested release + signing key
                                      │ signed target positions
                                      ▼
 User zone                   Independent risk zone
 signed risk grant ─────────> policy hash + limits + kill switch
 account snapshot ──────────> replay protection + permit signer
                                      │ short-lived signed permit
                                      ▼
                              Execution connector
                              account/read + trade only
                              no withdraw, no transfer
                                      │
                                      ▼
                                User subaccount
```

No production component should combine builder source, raw user exchange credentials, and unrestricted outbound networking in one trust zone.

## Protocol

### 1. Register a release

The platform records a `TrustedStrategyRelease` containing the strategy family, immutable version, code measurement, and the public key belonging to its confidential runtime. Production registration should require reproducible packaging, malware review, and remote attestation. The reference implementation models this as a trusted registry entry.

### 2. User signs an authorization grant

The grant binds:

- user and Strategy Family;
- validity window;
- exact venue and instrument allowlists;
- per-order, per-position, gross exposure, leverage, and daily-loss limits;
- freshness windows;
- the fixed `trade-only-v1` permission profile.

Money values are canonical integer strings in USD micros. This avoids floating-point and cross-language serialization ambiguity. The current reference uses Ed25519; an EVM-facing implementation should use an audited EIP-712 typed-data schema and verify current Pass ownership before accepting or renewing a grant.

### 3. Private runtime emits a signed decision

The runtime receives normalized market data, not the user's exchange secret. It emits only target notionals plus bindings to:

- grant ID;
- Strategy Family and registered release measurement;
- exact user policy hash;
- venue;
- issue/expiry time;
- single-use nonce.

Features, rationale, parameters, confidence vectors, raw model output, and source code must never be present in this message or application logs.

### 4. Independent risk engine issues a permit

The risk engine verifies both signatures and all bindings against a fresh, trusted account snapshot. It computes order deltas and the resulting whole-account exposure. It fails closed on stale data, unknown releases, policy mismatch, replay, or any limit breach.

After the daily-loss threshold is reached, only true exposure-reducing orders are allowed. Closing risk remains possible; increasing or flipping a position does not.

The output is a risk-engine-signed, short-lived execution permit. It contains the minimum data required by the connector and commitments to the decision and account snapshot. It deliberately excludes strategy version and code measurement.

### 5. Connector executes once

The connector accepts only a valid risk-engine signature, unexpired permit, matching dedicated user subaccount, and unused permit ID. Venue credentials must be created with withdrawal and transfer disabled. Where a venue cannot technically enforce this permission split, that venue is not compatible with `trade-only-v1`.

## Threats and controls

| Threat | Primary control | Remaining risk |
|---|---|---|
| Malicious builder takes excessive risk | User-signed hard limits enforced outside strategy runtime | Loss within the authorized envelope |
| Builder attempts withdrawals | Venue-scoped credential without withdraw/transfer permissions | Venue permission bug or account takeover |
| User modifies a decision | Runtime signature and release binding | Compromised runtime signing key |
| Replay or delayed execution | Single-use nonce, account snapshot hash, short TTL | Production store must provide atomic consume across nodes |
| Strategy update swaps behavior | Immutable code measurement and explicit release registry | Governance approving a malicious release |
| User extracts IP | No artifact delivery, minimal outputs, query/capacity limits, confidential compute | Behavioral inference from user's own trades |
| Platform operator reads strategy | TEE/confidential VM, encrypted artifacts, remote attestation, separated keys | Host/TEE supply-chain vulnerabilities |
| Audit log leaks alpha | Commitments and aggregate receipts; no signals/features | Exchange trade history is visible to account owner |
| Compromised connector broadens orders | Risk-signed exact permit, one-time permit ID, venue allowlist | Connector and venue enforcement need independent monitoring |

## Data placement

On-chain:

- Strategy Family and Pass ownership;
- supply/capacity rules;
- release measurement and activation history;
- policy/receipt commitments and aggregate verified performance.

Never on-chain:

- strategy artifact, weights, parameters, features, or raw signals;
- user exchange credentials;
- exact private account positions or individual order payloads;
- personally identifying account mappings.

Encrypted off-chain:

- sealed strategy artifacts;
- user-to-venue account mapping;
- execution receipts needed for disputes;
- credential handles held by a secret manager, not credentials embedded in application rows.

## Production gaps intentionally left open

The executable core proves protocol semantics, not infrastructure security. Before live or even public paper trading, implement:

1. A durable, atomic replay store and one-time execution-permit store.
2. An exchange connector on dedicated subaccounts with permission introspection and withdrawal probes that must fail.
3. A confidential-runtime packaging and attestation flow; start with one provider and publish the exact trust assumptions.
4. KMS/HSM-held risk keys with rotation and an append-only audit chain.
5. Independent price, equity, PnL, and position snapshots; never accept these values from the builder runtime or browser.
6. EIP-712 grants, chain reorg handling, Pass ownership checks, revocation, and emergency pause.
7. Per-strategy query budgets and randomized/coarsened non-execution analytics to reduce model extraction.
8. Adversarial tests for concurrent replay, stale snapshots, partial fills, precision/rounding, venue outages, and position reconciliation.

`MemoryReplayStore` is test-only. It is process-local and must not be used in a multi-instance or production service.

