import { asAddress, asBlockHash, asHexData, type Address, type HexData } from './types.ts';
import type { ChainLog } from './rpc.ts';
import type { DecodedContractEvent } from './reconciliation.ts';

export const M3_STRATEGY_PASS_ABI_HASH = asBlockHash(
  '0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f',
);
export const M3_STRATEGY_PASS_SOURCE_COMMIT = '2ad816200e7edfbfad96d765b4a696bc8b838c2d';
export const M3_STRATEGY_PASS_TRANSFER_TOPIC = asHexData(
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
);

const maximumUint256 = (1n << 256n) - 1n;

function nonzeroAddress(value: string): Address {
  const address = asAddress(value);
  if (/^0x0{40}$/i.test(address)) throw new Error('INVALID_M3_PASS_TRANSFER');
  return address;
}

function addressWord(value: Address): string {
  return value.slice(2).toLowerCase().padStart(64, '0');
}

export function encodeM3StrategyPassTransfer(recipient: Address, amountRaw: bigint): HexData {
  const exactRecipient = nonzeroAddress(recipient);
  if (typeof amountRaw !== 'bigint' || amountRaw < 1n || amountRaw > maximumUint256)
    throw new Error('INVALID_M3_PASS_TRANSFER');
  return asHexData(`0xa9059cbb${addressWord(exactRecipient)}${amountRaw.toString(16).padStart(64, '0')}`);
}

export type M3StrategyPassCalldata = Readonly<{
  kind: 'TRANSFER';
  recipient: Address;
  amountRaw: bigint;
}>;

export function decodeM3StrategyPassCalldata(data: HexData): M3StrategyPassCalldata | null {
  if (typeof data !== 'string' || data.length !== 138 || data.slice(0, 10).toLowerCase() !== '0xa9059cbb')
    return null;
  const recipientWord = data.slice(10, 74);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(recipientWord)) return null;
  try {
    const recipient = nonzeroAddress(`0x${recipientWord.slice(24)}`);
    const amountRaw = BigInt(`0x${data.slice(74)}`);
    if (amountRaw < 1n) return null;
    return Object.freeze({ kind: 'TRANSFER', recipient, amountRaw });
  } catch {
    return null;
  }
}

export function encodeM3StrategyPassBalanceOf(owner: Address): HexData {
  return asHexData(`0x70a08231${addressWord(asAddress(owner))}`);
}

export const M3_STRATEGY_PASS_DECIMALS_CALL = asHexData('0x313ce567');
export const M3_STRATEGY_PASS_STRATEGY_ID_CALL = asHexData('0x492f4e18');

function indexedAddress(topic: HexData): Address {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(topic)) throw new Error('INVALID_M3_PASS_EVENT');
  return asAddress(`0x${topic.slice(-40)}`);
}

export function decodeM3StrategyPassEvent(log: ChainLog): DecodedContractEvent | null {
  if (log.topics[0]?.toLowerCase() !== M3_STRATEGY_PASS_TRANSFER_TOPIC.toLowerCase()) return null;
  if (log.topics.length !== 3 || !/^0x[0-9a-fA-F]{64}$/.test(log.data))
    throw new Error('INVALID_M3_PASS_EVENT');
  return Object.freeze({
    eventSignature: M3_STRATEGY_PASS_TRANSFER_TOPIC,
    eventName: 'Transfer',
    normalizedData: Object.freeze({
      from: indexedAddress(log.topics[1]!),
      to: indexedAddress(log.topics[2]!),
      amountRaw: BigInt(log.data).toString(),
    }),
  });
}
