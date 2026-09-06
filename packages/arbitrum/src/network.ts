export const ARBITRUM_SEPOLIA = Object.freeze({
  key: 'arbitrum-sepolia',
  name: 'Arbitrum Sepolia',
  chainId: 421_614,
  nativeCurrency: 'ETH',
  rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  explorerUrl: 'https://sepolia.arbiscan.io',
} as const);

export interface ArbitrumConfig {
  readonly network: typeof ARBITRUM_SEPOLIA;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
}

function requireUrl(value: string | undefined, field: string): string {
  if (!value) throw new Error(`${field} is required`);
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  return url.toString().replace(/\/$/, '');
}

export function readArbitrumConfig(env: Readonly<Record<string, string | undefined>>): ArbitrumConfig {
  if (env.QP_CHAIN !== ARBITRUM_SEPOLIA.key) {
    throw new Error(`QP_CHAIN must be ${ARBITRUM_SEPOLIA.key}`);
  }
  if (env.QP_CHAIN_ID !== String(ARBITRUM_SEPOLIA.chainId)) {
    throw new Error(`QP_CHAIN_ID must be ${ARBITRUM_SEPOLIA.chainId}`);
  }

  return Object.freeze({
    network: ARBITRUM_SEPOLIA,
    rpcUrl: requireUrl(env.QP_RPC_URL, 'QP_RPC_URL'),
    explorerUrl: requireUrl(env.QP_EXPLORER_URL, 'QP_EXPLORER_URL'),
  });
}
