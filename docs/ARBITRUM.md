# Arbitrum target

The hackathon target is Arbitrum Sepolia.

| Field | Value |
| --- | --- |
| Chain ID | `421614` (`0x66eee`) |
| Parent chain | Ethereum Sepolia (`11155111`) |
| Native currency | ETH |
| Public RPC | `https://sepolia-rollup.arbitrum.io/rpc` |
| Explorer | `https://sepolia.arbiscan.io` |

The constants live in `packages/arbitrum/src/network.ts`. `npm run arbitrum:check` validates the runtime configuration without printing URL paths, query strings or credentials.

## Sources

- [Arbitrum developer documentation](https://docs.arbitrum.io/)
- [Offchain Labs monitoring configuration](https://github.com/OffchainLabs/arbitrum-monitoring/blob/main/config.example.json)

## Scope boundary

This commit establishes network identity and configuration validation only. Contract deployment, wallet signing, RPC calls and real-value operation remain disabled until the corresponding tasks pass review and tests.
