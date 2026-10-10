import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const names = [
  'AlphaForgeFairLaunch',
  'AlphaForgePassFactory',
  'AlphaForgePassPool',
  'AlphaForgeNativeReserve',
  'AlphaForgeMarketRouter',
  'AlphaForgeClaimReserve',
  'AlphaForgeStrategyVault',
  'AlphaForgeStrategyVaultFactory',
  'AlphaForgeStockReserve',
  'AlphaForgeStrategyTestStock',
  'AlphaForgeStrategyReferenceFeed',
];
const write = process.argv.slice(2).includes('--write');
if (process.argv.slice(2).some((arg) => arg !== '--write')) throw new Error('Unsupported artifact argument');
const result = [];
for (const name of names) {
  const file =
    name.startsWith('AlphaForgeStrategy') || name === 'AlphaForgeStockReserve'
      ? 'AlphaForgeStrategyVault'
      : name;
  const compiled = JSON.parse(
    await readFile(resolve(root, `.checks/af-chain01/out/${file}.sol/${name}.json`), 'utf8'),
  );
  const source = resolve(
    root,
    `contracts/src/${file === 'AlphaForgeStrategyVault' ? 'launch-vault' : 'market'}/${file}.sol`,
  );
  const target = resolve(root, `contracts/deployment/market/abi/${name}.abi.json`);
  const expected = JSON.stringify(compiled.abi, null, 2) + '\n';
  if (write) {
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, expected);
  } else
    assert.deepEqual(
      JSON.parse(await readFile(target, 'utf8')),
      compiled.abi,
      'ABI differs from pinned compiler: ' + name,
    );
  const runtime = compiled.deployedBytecode.object.replace(/^0x/, ''),
    creation = compiled.bytecode.object.replace(/^0x/, '');
  assert.ok(runtime.length / 2 <= 24_576, 'Runtime exceeds EIP-170: ' + name);
  assert.ok(
    creation.length / 2 <= 49_152,
    'Creation code exceeds EIP-3860 before constructor arguments: ' + name,
  );
  result.push({
    name,
    runtimeBytes: runtime.length / 2,
    creationBytes: creation.length / 2,
    sourceSha256: createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
  });
}
const path = resolve(root, 'contracts/deployment/market/artifact-sizes.json');
const content =
  JSON.stringify(
    { compiler: '0.8.31', optimizer: false, viaIR: false, evmVersion: 'paris', contracts: result },
    null,
    2,
  ) + '\n';
if (write) await writeFile(path, content);
else assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), JSON.parse(content));
console.log(
  `${names.length} market/Vault ABIs match the pinned compiler; runtime and creation size bounds pass.`,
);
