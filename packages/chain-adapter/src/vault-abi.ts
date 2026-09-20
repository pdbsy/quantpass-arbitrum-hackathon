import { asAddress, asBlockHash, asHexData, type Address, type HexData } from './types.ts';
import type { ChainLog } from './rpc.ts';
import type { DecodedContractEvent } from './reconciliation.ts';

type AbiArgument = 'address' | 'uint256';

export const M3_VAULT_ABI_VERSION = 'm3-vault-db620d6';
export const M3_VAULT_ABI_HASH = asBlockHash(
  '0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977',
);

const functionDefinitions = Object.freeze({
  'afBtc()': { selector: '0xa8d937e9', arguments: [] },
  'afEth()': { selector: '0xf20173bc', arguments: [] },
  'afUsdc()': { selector: '0x8b5a851f', arguments: [] },
  'close()': { selector: '0x43d726d6', arguments: [] },
  'closed()': { selector: '0x597e1fb5', arguments: [] },
  'deposit(uint256)': { selector: '0xb6b55f25', arguments: ['uint256'] },
  'openTrackedPositionCount()': { selector: '0x34dda870', arguments: [] },
  'owner()': { selector: '0x8da5cb5b', arguments: [] },
  'pass()': { selector: '0xa7a1ed72', arguments: [] },
  'passLocker()': { selector: '0xab88dc4b', arguments: [] },
  'passToUsdcRaw(uint256)': { selector: '0x18ba7fe2', arguments: ['uint256'] },
  'principalBasis()': { selector: '0xad587035', arguments: [] },
  'realizedProfit()': { selector: '0x738b74f0', arguments: [] },
  'rescueNative()': { selector: '0xfc82f084', arguments: [] },
  'rescueUntrackedToken(address)': { selector: '0x45f5030f', arguments: ['address'] },
  'reservedTrackedBalance(address)': { selector: '0xc0bdb971', arguments: ['address'] },
  'strategyCreator()': { selector: '0x499bb2ab', arguments: [] },
  'strategyId()': { selector: '0x492f4e18', arguments: [] },
  'strategyRef()': { selector: '0xc288f3de', arguments: [] },
  'trackedPosition(address)': { selector: '0xb31ede63', arguments: ['address'] },
  'trackedUsdcBalance()': { selector: '0x0510ca51', arguments: [] },
  'untrackedExcess(address)': { selector: '0x21f38bbd', arguments: ['address'] },
  'usdcToPassRaw(uint256)': { selector: '0x643456f6', arguments: ['uint256'] },
  'withdraw(uint256)': { selector: '0x2e1a7d4d', arguments: ['uint256'] },
  'withdrawableUsdc()': { selector: '0x442ad6a0', arguments: [] },
} as const satisfies Readonly<Record<string, { selector: string; arguments: readonly AbiArgument[] }>>);

export type M3VaultFunctionSignature = keyof typeof functionDefinitions;

const eventTopics = Object.freeze({
  'Closed(address,uint256,uint256)': asHexData(
    '0x792b1058d55c02122048f16ecbfdaab6be257e8c903a60a01f220960238aefc7',
  ),
  'Deposited(address,uint256,uint256,uint256,uint256)': asHexData(
    '0xe3b53cd1a44fbf11535e145d80b8ef1ed6d57a73bf5daa7e939b6b01657d6549',
  ),
  'NativeRescued(address,uint256)': asHexData(
    '0xe3eb98b7fe2a0c1d490b92af73eeae611e9b00ab3c3f70b20bd7bb43f67a0f43',
  ),
  'TrackedPositionChanged(address,uint256,uint256)': asHexData(
    '0xc918adb5da6f1094bf877bef10e664cd7ca5fb1216d89f807c19cdf60e5f1c88',
  ),
  'TrackedUsdcBalanceChanged(uint256,uint256)': asHexData(
    '0x29a4ed269a24b639ce9313072bca1d8d408f35f61108737792b18153b9c5b470',
  ),
  'UntrackedTokenRescued(address,address,uint256)': asHexData(
    '0x204874061edf1b61f01e55eb957ff789bf733451c43d111f54ba6d84122b7160',
  ),
  'Withdrawn(address,uint256,uint256,uint256,uint256,uint256,uint256)': asHexData(
    '0x6b4651e8f4162f82274a25e57a29f7ed9156d17078e76dd4d05f04ba08831aa4',
  ),
});

export const M3_VAULT_REVIEW_ABI = Object.freeze({
  status: 'COMPILED_LOCAL_REVIEW_DRAFT_NOT_DEPLOYED' as const,
  handoffCommit: '8afb96e4671b2ace5e59c99617c79b4bdca5b627',
  implementationCommit: 'db620d68a635259f53f48c33defff4273237d372',
  publishedAbiSha256: '7be3e2be3897b634d47d3766f26b088994884a169fb8e39ffbd3b3cf2133669f',
  functionSelectors: Object.freeze(
    Object.fromEntries(
      Object.entries(functionDefinitions).map(([signature, definition]) => [
        signature,
        asHexData(definition.selector),
      ]),
    ) as Readonly<Record<M3VaultFunctionSignature, HexData>>,
  ),
  eventTopics,
});

const maximumUint256 = (1n << 256n) - 1n;

function uintWord(value: unknown): string {
  if (typeof value !== 'bigint' || value < 0n || value > maximumUint256)
    throw new Error('INVALID_M3_VAULT_CALL');
  return value.toString(16).padStart(64, '0');
}

function addressWord(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_M3_VAULT_CALL');
  return asAddress(value).slice(2).toLowerCase().padStart(64, '0');
}

export function encodeM3VaultCall(signature: M3VaultFunctionSignature, values: readonly unknown[]): HexData {
  const definition = functionDefinitions[signature];
  if (!definition || values.length !== definition.arguments.length) throw new Error('INVALID_M3_VAULT_CALL');
  const encoded = definition.arguments.map((type, index) =>
    type === 'uint256' ? uintWord(values[index]) : addressWord(values[index]),
  );
  return asHexData(`${definition.selector}${encoded.join('')}`);
}

function exactWords(data: HexData, count: number): readonly string[] {
  if (data.length !== 2 + count * 64) throw new Error('INVALID_M3_VAULT_EVENT');
  const words: string[] = [];
  for (let offset = 2; offset < data.length; offset += 64) words.push(data.slice(offset, offset + 64));
  return words;
}

function parseUintWord(value: string): bigint {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('INVALID_M3_VAULT_ABI_WORD');
  return BigInt(`0x${value}`);
}

function parseAddressWord(value: string): Address {
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(value)) throw new Error('INVALID_M3_VAULT_ABI_WORD');
  return asAddress(`0x${value.slice(24)}`);
}

function outputWord(data: HexData): string {
  if (data.length !== 66) throw new Error('INVALID_M3_VAULT_CALL_RESULT');
  return data.slice(2);
}

export function decodeM3VaultUintResult(data: HexData): bigint {
  try {
    return parseUintWord(outputWord(data));
  } catch {
    throw new Error('INVALID_M3_VAULT_CALL_RESULT');
  }
}

export function decodeM3VaultAddressResult(data: HexData): Address {
  try {
    return parseAddressWord(outputWord(data));
  } catch {
    throw new Error('INVALID_M3_VAULT_CALL_RESULT');
  }
}

export function decodeM3VaultBytes32Result(data: HexData): HexData {
  try {
    return asHexData(`0x${outputWord(data)}`);
  } catch {
    throw new Error('INVALID_M3_VAULT_CALL_RESULT');
  }
}

export function decodeM3VaultBoolResult(data: HexData): boolean {
  const value = decodeM3VaultUintResult(data);
  if (value !== 0n && value !== 1n) throw new Error('INVALID_M3_VAULT_CALL_RESULT');
  return value === 1n;
}

export type M3VaultCalldata =
  | { readonly kind: 'DEPOSIT'; readonly usdcAmount: bigint }
  | { readonly kind: 'WITHDRAW'; readonly usdcAmount: bigint }
  | { readonly kind: 'CLOSE' }
  | { readonly kind: 'RESCUE_UNTRACKED_TOKEN'; readonly token: Address }
  | { readonly kind: 'RESCUE_NATIVE' };

export function decodeM3VaultCalldata(data: HexData): M3VaultCalldata | null {
  const selector = data.slice(0, 10).toLowerCase();
  try {
    if (selector === functionDefinitions['deposit(uint256)'].selector && data.length === 74)
      return Object.freeze({ kind: 'DEPOSIT', usdcAmount: parseUintWord(data.slice(10)) });
    if (selector === functionDefinitions['withdraw(uint256)'].selector && data.length === 74)
      return Object.freeze({ kind: 'WITHDRAW', usdcAmount: parseUintWord(data.slice(10)) });
    if (selector === functionDefinitions['close()'].selector && data.length === 10)
      return Object.freeze({ kind: 'CLOSE' });
    if (selector === functionDefinitions['rescueUntrackedToken(address)'].selector && data.length === 74)
      return Object.freeze({
        kind: 'RESCUE_UNTRACKED_TOKEN',
        token: parseAddressWord(data.slice(10)),
      });
    if (selector === functionDefinitions['rescueNative()'].selector && data.length === 10)
      return Object.freeze({ kind: 'RESCUE_NATIVE' });
    return null;
  } catch {
    return null;
  }
}

function indexedAddress(topics: readonly HexData[], index: number): Address {
  const topic = topics[index];
  if (!topic) throw new Error('INVALID_M3_VAULT_EVENT');
  try {
    return parseAddressWord(topic.slice(2));
  } catch {
    throw new Error('INVALID_M3_VAULT_EVENT');
  }
}

function uintValues(data: HexData, count: number): readonly string[] {
  try {
    return exactWords(data, count).map((value) => parseUintWord(value).toString());
  } catch {
    throw new Error('INVALID_M3_VAULT_EVENT');
  }
}

function decoded(
  signature: HexData,
  name: string,
  normalizedData: Readonly<Record<string, unknown>>,
): DecodedContractEvent {
  return Object.freeze({
    eventSignature: signature,
    eventName: name,
    normalizedData: Object.freeze(normalizedData),
  });
}

export function decodeM3VaultEvent(log: ChainLog): DecodedContractEvent | null {
  const signature = log.topics[0];
  if (!signature) return null;
  const topic = signature.toLowerCase();
  if (topic === eventTopics['Deposited(address,uint256,uint256,uint256,uint256)']) {
    if (log.topics.length !== 2) throw new Error('INVALID_M3_VAULT_EVENT');
    const [usdcAmount, passRaw, principalBasis, trackedUsdcBalance] = uintValues(log.data, 4);
    return decoded(signature, 'Deposited', {
      owner: indexedAddress(log.topics, 1),
      usdcAmount,
      passRaw,
      principalBasis,
      trackedUsdcBalance,
    });
  }
  if (topic === eventTopics['Withdrawn(address,uint256,uint256,uint256,uint256,uint256,uint256)']) {
    if (log.topics.length !== 2) throw new Error('INVALID_M3_VAULT_EVENT');
    const [usdcAmount, profitAmount, principalAmount, passRawUnlocked, principalBasis, trackedUsdcBalance] =
      uintValues(log.data, 6);
    return decoded(signature, 'Withdrawn', {
      owner: indexedAddress(log.topics, 1),
      usdcAmount,
      profitAmount,
      principalAmount,
      passRawUnlocked,
      principalBasis,
      trackedUsdcBalance,
    });
  }
  if (topic === eventTopics['Closed(address,uint256,uint256)']) {
    if (log.topics.length !== 2) throw new Error('INVALID_M3_VAULT_EVENT');
    const [usdcReturned, passRawReleased] = uintValues(log.data, 2);
    return decoded(signature, 'Closed', {
      owner: indexedAddress(log.topics, 1),
      usdcReturned,
      passRawReleased,
    });
  }
  if (topic === eventTopics['TrackedUsdcBalanceChanged(uint256,uint256)']) {
    if (log.topics.length !== 1) throw new Error('INVALID_M3_VAULT_EVENT');
    const [previousBalance, newBalance] = uintValues(log.data, 2);
    return decoded(signature, 'TrackedUsdcBalanceChanged', { previousBalance, newBalance });
  }
  if (topic === eventTopics['TrackedPositionChanged(address,uint256,uint256)']) {
    if (log.topics.length !== 2) throw new Error('INVALID_M3_VAULT_EVENT');
    const [previousAmount, newAmount] = uintValues(log.data, 2);
    return decoded(signature, 'TrackedPositionChanged', {
      token: indexedAddress(log.topics, 1),
      previousAmount,
      newAmount,
    });
  }
  if (topic === eventTopics['UntrackedTokenRescued(address,address,uint256)']) {
    if (log.topics.length !== 3) throw new Error('INVALID_M3_VAULT_EVENT');
    const [amount] = uintValues(log.data, 1);
    return decoded(signature, 'UntrackedTokenRescued', {
      token: indexedAddress(log.topics, 1),
      owner: indexedAddress(log.topics, 2),
      amount,
    });
  }
  if (topic === eventTopics['NativeRescued(address,uint256)']) {
    if (log.topics.length !== 2) throw new Error('INVALID_M3_VAULT_EVENT');
    const [amount] = uintValues(log.data, 1);
    return decoded(signature, 'NativeRescued', { owner: indexedAddress(log.topics, 1), amount });
  }
  return null;
}
