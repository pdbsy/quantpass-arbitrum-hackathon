export const ROBINHOOD_CHAIN_TESTNET = Object.freeze({
  key: 'robinhood-chain-testnet',
  name: 'Robinhood Chain Testnet',
  chainId: 46_630,
  nativeCurrency: 'ETH',
  rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
  explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
} as const);

export interface RobinhoodChainConfig {
  readonly network: typeof ROBINHOOD_CHAIN_TESTNET;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
}

function requireUrl(value: string | undefined, field: string): string {
  if (!value) throw new Error(`${field} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Parser errors may carry the raw endpoint in an `input` property.
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  return url.toString().replace(/\/$/, '');
}

export function readRobinhoodChainConfig(
  env: Readonly<Record<string, string | undefined>>,
): RobinhoodChainConfig {
  if (env.QP_CHAIN !== ROBINHOOD_CHAIN_TESTNET.key) {
    throw new Error(`QP_CHAIN must be ${ROBINHOOD_CHAIN_TESTNET.key}`);
  }
  if (env.QP_CHAIN_ID !== String(ROBINHOOD_CHAIN_TESTNET.chainId)) {
    throw new Error(`QP_CHAIN_ID must be ${ROBINHOOD_CHAIN_TESTNET.chainId}`);
  }

  return Object.freeze({
    network: ROBINHOOD_CHAIN_TESTNET,
    rpcUrl: requireUrl(env.QP_RPC_URL, 'QP_RPC_URL'),
    explorerUrl: requireUrl(env.QP_EXPLORER_URL, 'QP_EXPLORER_URL'),
  });
}
