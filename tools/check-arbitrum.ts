import { readArbitrumConfig } from '../packages/arbitrum/src/network.ts';

const config = readArbitrumConfig(process.env);
console.log(
  JSON.stringify({
    network: config.network.name,
    chainId: config.network.chainId,
    nativeCurrency: config.network.nativeCurrency,
    rpcOrigin: new URL(config.rpcUrl).origin,
    explorerOrigin: new URL(config.explorerUrl).origin,
  }),
);
