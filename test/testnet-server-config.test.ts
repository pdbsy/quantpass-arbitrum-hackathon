import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { deploymentManifestDigest } from '../packages/chain-adapter/src/manifest.ts';
import { asAddress, asBlockHash } from '../packages/chain-adapter/src/types.ts';
import { M3_VAULT_ABI_HASH, M3_VAULT_ABI_VERSION } from '../packages/chain-adapter/src/vault-abi.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../packages/chain-adapter/src/pass-abi.ts';
import { parseTestnetServerConfig, loadTestnetDeployments } from '../packages/testnet/src/server-config.ts';

const vault = asAddress('0x1111111111111111111111111111111111111111');
const pass = asAddress('0x2222222222222222222222222222222222222222');
const runtimeHash = asBlockHash('0x' + '33'.repeat(32));
const document = {
  schemaVersion: 1 as const,
  environment: 'robinhood-chain-testnet' as const,
  chainId: 46630 as const,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: vault,
  deploymentBlock: '100',
  abiVersion: M3_VAULT_ABI_VERSION,
  abiHash: M3_VAULT_ABI_HASH,
  runtimeBytecodeHash: runtimeHash,
  strategyPassAddress: pass,
  strategyPassDeploymentBlock: '99',
  strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: runtimeHash,
};
const manifest = { ...document, manifestDigest: deploymentManifestDigest(document) };
const fixture = () => ({
  schemaVersion: 1,
  profile: 'M3_READONLY_TESTNET',
  chainId: 46630,
  origin: 'http://127.0.0.1:4180',
  dataDirectory: resolve('/tmp/alphaforge-testnet-fixture'),
  syncIntervalMs: 5000,
  vaults: [
    {
      id: 'alice-vault',
      manifestFile: 'alice.json',
      manifestDigest: manifest.manifestDigest,
      vaultAddress: vault,
    },
  ],
});

test('Testnet deployment loading rejects mainnet and unknown secret fields before reading files', async () => {
  for (const input of [
    { ...fixture(), chainId: 4663 },
    { ...fixture(), privateKey: 'do-not-disclose' },
    { ...fixture(), rpcUrl: 'https://example.invalid/credential' },
  ]) {
    let reads = 0;
    await assert.rejects(
      loadTestnetDeployments(input, ['https://rpc.example.invalid/secret'], async () => {
        reads++;
        return manifest;
      }),
      /INVALID_TESTNET_SERVER_CONFIG/,
    );
    assert.equal(reads, 0);
  }
});

test('operator configuration refuses public ingress, ambiguous paths and malformed vault bindings', () => {
  for (const change of [
    { origin: 'https://test.example.com' },
    { origin: 'http://127.0.0.1:4180/api' },
    { dataDirectory: '../shared-data' },
    { syncIntervalMs: 0 },
    { schemaVersion: 2 },
    { vaults: [{ ...fixture().vaults[0], manifestFile: '../other.json' }] },
    { vaults: [{ ...fixture().vaults[0], vaultAddress: '0x' + '00'.repeat(20) }] },
    { vaults: [{ ...fixture().vaults[0], manifestDigest: '0x' + '00'.repeat(32) }] },
  ])
    assert.throws(
      () => parseTestnetServerConfig({ ...fixture(), ...change }),
      /INVALID_TESTNET_SERVER_CONFIG/,
    );
});

test('vault identities cannot create duplicated or case-colliding index databases', () => {
  const a = fixture().vaults[0]!;
  for (const b of [
    { ...a, id: 'ALICE-VAULT' },
    { ...a, id: 'bob-vault' },
    { ...a, manifestFile: 'bob.json' },
  ])
    assert.throws(
      () => parseTestnetServerConfig({ ...fixture(), vaults: [a, b] }),
      /INVALID_TESTNET_SERVER_CONFIG/,
    );
});

test('configuration is snapshotted before asynchronous reads and creates separate app/index identities', async () => {
  const input = fixture();
  const result = await loadTestnetDeployments(
    input,
    ['https://rpc.example.invalid/provider-key'],
    async (file) => {
      assert.equal(file, 'alice.json');
      input.vaults[0]!.vaultAddress = pass;
      return manifest;
    },
  );
  assert.equal(result.length, 1);
  const deployment = result[0]!;
  assert.equal(deployment.deploymentStatus, 'DEPLOYED');
  if (deployment.deploymentStatus !== 'DEPLOYED') assert.fail('expected configured deployment');
  assert.equal(deployment.expectedContractAddress, vault);
  assert.equal(deployment.dbPath, resolve('/tmp/alphaforge-testnet-fixture/vault-alice-vault.sqlite'));
  assert.notEqual(deployment.dbPath, resolve('/tmp/alphaforge-testnet-fixture/application.sqlite'));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(parseTestnetServerConfig(fixture()).vaults), true);
});

test('tampered deployment evidence cannot become a configured runtime', async () => {
  for (const modified of [
    { ...manifest, chainId: 4663 },
    { ...manifest, contractAddress: pass },
    { ...manifest, runtimeBytecodeHash: '0x' + '44'.repeat(32) },
    { ...manifest, abiHash: '0x' + '55'.repeat(32) },
  ]) {
    await assert.rejects(
      loadTestnetDeployments(fixture(), ['https://rpc.example.invalid'], async () => modified),
      /INVALID_DEPLOYMENT_MANIFEST|M3_VAULT_ABI_MISMATCH/,
    );
  }
});

test('an empty explicit deployment set remains NOT_DEPLOYED and reads no manifests', async () => {
  let reads = 0;
  const result = await loadTestnetDeployments({ ...fixture(), vaults: [] }, [], async () => {
    reads++;
    return manifest;
  });
  assert.deepEqual(result, [{ deploymentStatus: 'NOT_DEPLOYED' }]);
  assert.equal(reads, 0);
});

test('configured deployments require explicit HTTPS endpoints and hide provider details in errors', async () => {
  for (const endpoints of [
    [],
    ['http://example.invalid'],
    ['https://user:secret@example.invalid'],
    ['https://example.invalid/#secret'],
  ]) {
    let reads = 0;
    await assert.rejects(
      loadTestnetDeployments(fixture(), endpoints, async () => {
        reads++;
        return manifest;
      }),
      /INVALID_TESTNET_RPC_CONFIGURATION/,
    );
    assert.equal(reads, 0);
  }
});

test('manifest reader failures do not disclose operator file content or credential paths', async () => {
  await assert.rejects(
    loadTestnetDeployments(fixture(), ['https://rpc.example.invalid/provider-key'], async () => {
      throw new Error('private-path/provider-key');
    }),
    (error: unknown) => error instanceof Error && error.message === 'TESTNET_MANIFEST_READ_FAILED',
  );
});

test('network identity binds Testnet deployment/ABI/units/RPC/policy and rejects a mainnet chain toggle', async () => {
  const network = await import('../packages/testnet/src/network-identity.ts');
  const { tradingRpcFixture } = await import('./helpers/testnet-trading-rpc.ts');
  const f = tradingRpcFixture();
  const binding = {
    id: 'one',
    manifestDigest: f.manifest.manifestDigest,
    inventoryDigest: asBlockHash('0x' + 'ab'.repeat(32)),
    vaultAddress: f.manifest.contractAddress,
  };
  const input = {
    chainId: 46630,
    profile: 'PUBLIC_TESTNET',
    configurationDigest: '0x' + 'cd'.repeat(32),
    deployments: [{ manifest: f.manifest, inventory: f.inventory, binding }],
  };
  const result = network.testnetNetworkIdentity(input);
  assert.equal(result.descriptor.units.passRawPerUsdcRaw, '1000000000000');
  assert.equal(result.descriptor.mainnet, 'DISABLED_UNCONFIGURED');
  assert.deepEqual(result.descriptor.rpcRequirements, [
    'CHAIN_ID_46630',
    'EIP1898_REQUIRE_CANONICAL',
    'HISTORICAL_STATE',
    'CANONICAL_RECEIPTS_AND_LOGS',
  ]);
  assert.equal(result.descriptor.policy.softReadyDepth, 3);
  assert.equal(result.descriptor.policy.reorgSearchLimit, 128);
  assert.throws(() => network.testnetNetworkIdentity({ ...input, chainId: 1 }), /NETWORK_IDENTITY/);
  assert.throws(
    () =>
      network.testnetNetworkIdentity({
        ...input,
        deployments: [
          {
            ...input.deployments[0]!,
            manifest: { ...f.manifest, abiHash: asBlockHash('0x' + 'ef'.repeat(32)) },
          },
        ],
      }),
    /NETWORK_IDENTITY/,
  );
  assert.notEqual(
    network.testnetNetworkIdentity({ ...input, configurationDigest: '0x' + 'ac'.repeat(32) }).digest,
    result.digest,
  );
});
