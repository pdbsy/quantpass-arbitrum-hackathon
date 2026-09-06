# Robinhood Chain target

The deployment target is Robinhood Chain Testnet, an EVM-compatible Arbitrum Chain built with Arbitrum Nitro.

| Field | Value |
| --- | --- |
| Chain ID | `46630` (`0xb626`) |
| Native currency | ETH |
| Public RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Faucet | `https://faucet.testnet.chain.robinhood.com` |

The constants live in `packages/robinhood-chain/src/network.ts`. `npm run robinhood:check` validates the runtime configuration without printing URL paths, query strings or credentials.

## Sources

- [Robinhood Chain: add the network to a wallet](https://docs.robinhood.com/chain/add-network-to-wallet/)
- [Robinhood Chain testnet overview](https://robinhood.com/us/en/support/articles/robinhood-chain-testnet/)
- [Robinhood Chain: run a full node](https://docs.robinhood.com/chain/run-a-full-node/)

## Scope boundary

This commit establishes network identity and configuration validation only. Contract deployment, wallet signing, RPC calls and real-value operation remain disabled until the corresponding tasks pass review and tests.
