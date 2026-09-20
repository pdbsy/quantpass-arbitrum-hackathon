import { asBlockHash, asHexData, type BlockHash, type HexData } from './types.ts';

const mask64 = (1n << 64n) - 1n;
const rateBytes = 136;
const rotations = Object.freeze([
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
]);
const roundConstants = Object.freeze([
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
]);

function rotateLeft(value: bigint, count: number): bigint {
  if (count === 0) return value & mask64;
  const shift = BigInt(count);
  return ((value << shift) | (value >> (64n - shift))) & mask64;
}

function permutation(state: bigint[]): void {
  const columns = new Array<bigint>(5);
  const mixed = new Array<bigint>(25);
  for (const constant of roundConstants) {
    for (let x = 0; x < 5; x++)
      columns[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
    for (let x = 0; x < 5; x++) {
      const delta = columns[(x + 4) % 5]! ^ rotateLeft(columns[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y++) state[x + 5 * y] = state[x + 5 * y]! ^ delta;
    }
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const destinationX = y;
        const destinationY = (2 * x + 3 * y) % 5;
        mixed[destinationX + 5 * destinationY] = rotateLeft(state[x + 5 * y]!, rotations[x + 5 * y]!);
      }
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        state[x + 5 * y] =
          mixed[x + 5 * y]! ^ (~mixed[((x + 1) % 5) + 5 * y]! & mixed[((x + 2) % 5) + 5 * y]!);
    state[0] = state[0]! ^ constant;
  }
}

export function keccak256(input: HexData): BlockHash {
  const normalized = asHexData(input);
  const bytes = Uint8Array.from(Buffer.from(normalized.slice(2), 'hex'));
  const paddedLength = Math.ceil((bytes.length + 1) / rateBytes) * rateBytes;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rateBytes) {
    for (let lane = 0; lane < rateBytes / 8; lane++) {
      let value = 0n;
      for (let byte = 0; byte < 8; byte++)
        value |= BigInt(padded[offset + lane * 8 + byte]!) << BigInt(byte * 8);
      state[lane] = state[lane]! ^ value;
    }
    permutation(state);
  }

  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index++)
    output[index] = Number((state[Math.floor(index / 8)]! >> BigInt((index % 8) * 8)) & 0xffn);
  return asBlockHash(`0x${Buffer.from(output).toString('hex')}`);
}
