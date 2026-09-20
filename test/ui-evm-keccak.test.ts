import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256Evm } from '../apps/web/src/evm-keccak.ts';
import { asHexData } from '../packages/chain-adapter/src/types.ts';

test('browser EVM Keccak matches the canonical empty-input vector', () => {
  assert.equal(
    keccak256Evm(asHexData('0x')),
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
  assert.equal(
    keccak256Evm(asHexData('0x616263')),
    '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
});

test('browser EVM Keccak is deterministic and byte-sensitive', () => {
  const first = keccak256Evm(asHexData('0x6000'));
  assert.equal(first, keccak256Evm(asHexData('0x6000')));
  assert.notEqual(first, keccak256Evm(asHexData('0x6001')));
});
