import { PreparedActionFactory } from './chain-wallet.ts';
import { asAddress, asHexData, type Address } from '../../../packages/chain-adapter/src/types.ts';

export interface M3PassTransferAction {
  readonly operationId: string;
  readonly recipient: Address;
  readonly passBaseUnits: string;
}

const maximumUint256 = (1n << 256n) - 1n;

function amount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('INVALID_M3_PASS_AMOUNT');
  const parsed = BigInt(value);
  if (parsed > maximumUint256) throw new Error('INVALID_M3_PASS_AMOUNT');
  return parsed;
}

function recipientWord(value: Address): string {
  const recipient = asAddress(value);
  if (/^0x0{40}$/i.test(recipient)) throw new Error('INVALID_M3_PASS_RECIPIENT');
  return recipient.slice(2).toLowerCase().padStart(64, '0');
}

export function createM3PassTransferFactory(options: { readonly chainId: number; readonly target: Address }) {
  return new PreparedActionFactory<M3PassTransferAction>({
    chainId: options.chainId,
    target: options.target,
    operationId: (action) => action.operationId,
    encode: (action) => ({
      data: asHexData(
        `0xa9059cbb${recipientWord(action.recipient)}${amount(action.passBaseUnits).toString(16).padStart(64, '0')}`,
      ),
      value: 0n,
    }),
  });
}
