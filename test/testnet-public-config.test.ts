import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePublicTestnetConfig } from '../packages/testnet/src/public-config.ts';
const config = () => ({
  schemaVersion: 1,
  profile: 'PUBLIC_TESTNET',
  chainId: 46630,
  origin: 'https://alphaforge.example',
  dataDirectory: resolve(tmpdir(), 'alphaforge-public'),
  syncIntervalMs: 5000,
  challengeTtlMs: 300000,
  sessionTtlMs: 3600000,
  maxAuthRows: 1000,
  maxStorageBytes: 8000000000,
  vaults: [],
});
test('public admission requires exact Testnet identity, HTTPS and explicit bounded authentication/storage policy', () => {
  const valid = parsePublicTestnetConfig(config());
  assert.equal(valid.profile, 'PUBLIC_TESTNET');
  assert.equal(Object.isFrozen(valid), true);
  for (const mutation of [
    { chainId: 4663 },
    { origin: 'http://alphaforge.example' },
    { origin: 'https://alphaforge.example/path' },
    { origin: 'https://credential@alphaforge.example' },
    { origin: 'https://alphaforge.example?key=secret' },
    { privateKey: 'secret' },
    { challengeTtlMs: 0 },
    { sessionTtlMs: 28800001 },
    { maxAuthRows: 10001 },
    { maxStorageBytes: 9000000000 },
    { dataDirectory: resolve('/') },
    { profile: 'MAINNET' },
  ])
    assert.throws(
      () => parsePublicTestnetConfig({ ...config(), ...mutation }),
      /PUBLIC_TESTNET_CONFIGURATION/,
    );
});
test('configured Vault paths are separate, immutable and bound to nonzero manifest and contract identities', () => {
  const first = {
    id: 'owner-one',
    manifestFile: 'owner-one.json',
    manifestDigest: '0x' + 'ab'.repeat(32),
    vaultAddress: '0x' + '12'.repeat(20),
    inventoryFile: 'owner-one.inventory.json',
    inventoryDigest: '0x' + 'cd'.repeat(32),
  };
  const input = { ...config(), vaults: [first] };
  const result = parsePublicTestnetConfig(input);
  first.id = 'mutated';
  assert.equal(result.vaults[0]!.id, 'owner-one');
  assert.equal(Object.isFrozen(result.vaults[0]), true);
  for (const vaults of [
    [{ ...first, manifestFile: '../escape.json' }],
    [{ ...first, vaultAddress: '0x' + '0'.repeat(40) }],
    [first, { ...first, id: 'second' }],
  ]) {
    assert.throws(() => parsePublicTestnetConfig({ ...config(), vaults }), /PUBLIC_TESTNET_CONFIGURATION/);
  }
});
