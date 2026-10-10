import { Interface, ZeroAddress, keccak256 } from 'ethers';
import { executorInterface, type ExecutorPermission } from '../../apps/web/src/launch-market/executor.ts';
import { fixture, OWNER, OTHER, NOW, BLOCK, HASH } from './launch-market-ui-fixture.ts';
import type { Eip1193Request } from '../../apps/web/src/chain-wallet.ts';

export const VAULT = '0x3333333333333333333333333333333333333333';
export const FACTORY_CODE = '0x60006000';
export const permission = (): ExecutorPermission => ({
  executor: OTHER,
  expiresAt: String(NOW + 3600),
  maxOrderUsdc: '10000000',
  maxTotalBuyUsdc: '50000000',
  maxSlippageBps: 100,
});
export function executorFixture() {
  const f = fixture();
  const cfg = f.state.config.manifest!;
  f.state.config = {
    ...f.state.config,
    manifest: {
      ...cfg,
      runtimeCodeHashes: { ...cfg.runtimeCodeHashes, [cfg.vaultFactory!]: keccak256(FACTORY_CODE) },
    },
  };
  f.state.wallet = {
    ...f.state.wallet,
    vaults: [
      {
        strategyId: 'AMZN',
        address: VAULT,
        principalBasisRaw: '10000000',
        equityRaw: '10000000',
        cashRaw: '10000000',
        lockedPassRaw: '10000000000000000000',
        realizedPnlRaw: '0',
        unrealizedPnlRaw: '0',
        valuationState: 'FRESH',
        withdrawableProfitRaw: '0',
        withdrawablePrincipalRaw: '10000000',
        status: 'OPEN',
        holdings: [],
      },
    ],
  };
  const current = {
    version: 0,
    grant: { ...permission(), executor: ZeroAddress, expiresAt: '0' },
    pinnedHash: BLOCK,
  };
  const request = f.provider.request.bind(f.provider);
  const factoryInterface = new Interface(['function vaults(address,uint8) view returns(address)']);
  f.provider.request = async (input: Eip1193Request): Promise<unknown> => {
    const [tx, block] = input.params ?? [];
    if (input.method === 'eth_getBlockByNumber') {
      f.provider.calls.push(input);
      return {
        number: '0x64',
        hash: tx === 'latest' ? BLOCK : current.pinnedHash,
        timestamp: `0x${NOW.toString(16)}`,
      };
    }
    if (input.method === 'eth_getCode') {
      f.provider.calls.push(input);
      return FACTORY_CODE;
    }
    if (input.method === 'eth_estimateGas') {
      f.provider.calls.push(input);
      return '0x186a0';
    }
    if (input.method === 'eth_call' && typeof tx === 'object' && tx && 'data' in tx) {
      const data = String(tx.data);
      if ('to' in tx && tx.to === cfg.vaultFactory) {
        f.provider.calls.push(input);
        return factoryInterface.encodeFunctionResult('vaults', [VAULT]);
      }
      if (block !== 'latest') {
        f.provider.calls.push(input);
        const decoded = executorInterface.parseTransaction({ data })!;
        const results: Record<string, unknown[]> = {
          owner: [OWNER],
          pass: [cfg.strategies.AMZN.pass],
          afUsdc: [cfg.usdc],
          closed: [false],
          executionVersion: [current.version],
          totalBuyUsdc: [0],
          grant: [
            current.grant.executor,
            current.grant.expiresAt,
            current.grant.maxOrderUsdc,
            current.grant.maxTotalBuyUsdc,
            current.grant.maxSlippageBps,
          ],
        };
        return executorInterface.encodeFunctionResult(decoded.name, results[decoded.name]!);
      }
    }
    if (input.method === 'eth_getTransactionByHash') {
      f.provider.calls.push(input);
      const sent = f.provider.calls.find((call) => call.method === 'eth_sendTransaction')!.params![0] as {
        data: string;
      };
      return { hash: HASH, from: OWNER, to: VAULT, input: sent.data, value: '0x0' };
    }
    return request(input);
  };
  const entries = new Map<string, string>();
  const journal: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
  return { ...f, current, journal };
}
