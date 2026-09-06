export interface LocalConfig {
  readonly mode: 'local';
  readonly adapter: 'mock';
  readonly realFundsEnabled: false;
}

// The current milestone has no production or testnet boot path. No approval flag can unlock it.
export function readConfig(env: Readonly<Record<string, string | undefined>>): LocalConfig {
  if (env.QP_MODE !== 'local') {
    throw new Error('Only explicit QP_MODE=local is supported; testnet/production remain closed');
  }
  if (env.QP_ADAPTER !== 'mock') {
    throw new Error('Local mode requires explicit QP_ADAPTER=mock');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Mock configuration must not run under NODE_ENV=production');
  }
  return Object.freeze({ mode: 'local', adapter: 'mock', realFundsEnabled: false });
}
