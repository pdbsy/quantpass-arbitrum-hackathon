import { PreparedActionFactory } from './chain-wallet.ts';
import { encodeM3VaultCall } from '../../../packages/chain-adapter/src/vault-abi.ts';
import type { Address } from '../../../packages/chain-adapter/src/types.ts';

export type M3VaultAction =
  | { readonly operationId: string; readonly type: 'deposit'; readonly usdcBaseUnits: string }
  | { readonly operationId: string; readonly type: 'withdraw'; readonly usdcBaseUnits: string }
  | { readonly operationId: string; readonly type: 'close' }
  | { readonly operationId: string; readonly type: 'rescue-token'; readonly token: Address }
  | { readonly operationId: string; readonly type: 'rescue-native' };

function amount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('INVALID_M3_VAULT_AMOUNT');
  const parsed = BigInt(value);
  if (parsed >= 1n << 256n) throw new Error('INVALID_M3_VAULT_AMOUNT');
  return parsed;
}

export function createM3VaultActionFactory(options: { readonly chainId: number; readonly target: Address }) {
  return new PreparedActionFactory<M3VaultAction>({
    chainId: options.chainId,
    target: options.target,
    operationId: (action) => action.operationId,
    encode: (action) => {
      switch (action.type) {
        case 'deposit':
          return { data: encodeM3VaultCall('deposit(uint256)', [amount(action.usdcBaseUnits)]), value: 0n };
        case 'withdraw':
          return { data: encodeM3VaultCall('withdraw(uint256)', [amount(action.usdcBaseUnits)]), value: 0n };
        case 'close':
          return { data: encodeM3VaultCall('close()', []), value: 0n };
        case 'rescue-token':
          return {
            data: encodeM3VaultCall('rescueUntrackedToken(address)', [action.token]),
            value: 0n,
          };
        case 'rescue-native':
          return { data: encodeM3VaultCall('rescueNative()', []), value: 0n };
      }
    },
  });
}
