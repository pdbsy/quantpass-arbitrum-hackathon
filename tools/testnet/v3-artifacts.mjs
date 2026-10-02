import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Exact scope of the user's 2026-10-01 admission; changing this requires a new review.
const approved = {
  UniswapV3Factory: [
    '@uniswap/v3-core',
    '1.0.1',
    'ed88be38ab2032d82bf10ac6f8d03aa631889d48',
    '599479f60ebb056804aff7b2d05bdd0830ddbb1fdfaa0b6c62c02294ca7188b0',
    'sha512-7pVk4hEm00j9tc71Y9+ssYpO6ytkeI0y7WE9P6UcmNzhxPePwyAxImuhVsTqWK9YFvzgtvzJHi64pBl4jUzKMQ==',
  ],
  SwapRouter02: [
    '@uniswap/swap-router-contracts',
    '1.3.1',
    '550c0f20373a487996fcc957075377b67af9df07',
    '210a7bf29f26de9f45d35dac1214943eca41c3a002007dd6a0e1aa870bf2d2d1',
    'sha512-mh/YNbwKb7Mut96VuEtL+Z5bRe0xVIbjjiryn+iMMrK2sFKhR4duk/86mEz0UO5gSx4pQIw9G5276P5heY/7Rg==',
  ],
  QuoterV2: [
    '@uniswap/swap-router-contracts',
    '1.3.1',
    '550c0f20373a487996fcc957075377b67af9df07',
    '9d0b8700b8b144aced9b5dd95bce4a68e03eb9a809eac53ac2e3ce739cc7d289',
    'sha512-mh/YNbwKb7Mut96VuEtL+Z5bRe0xVIbjjiryn+iMMrK2sFKhR4duk/86mEz0UO5gSx4pQIw9G5276P5heY/7Rg==',
  ],
};

export function validateV3Artifact(entry, text) {
  if (!Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= Date.now())
    throw new Error('V3_ARTIFACT_EXPIRED');
  if (
    entry.expiresAt !== '2026-11-01T00:00:00Z' ||
    JSON.stringify([
      entry.package,
      entry.version,
      entry.sourceCommit,
      entry.sha256,
      entry.tarballIntegrity,
    ]) !== JSON.stringify(approved[entry.contractName])
  )
    throw new Error('V3_ARTIFACT_APPROVAL');
  if (createHash('sha256').update(text).digest('hex') !== entry.sha256)
    throw new Error('V3_ARTIFACT_INTEGRITY');
  const a = JSON.parse(text);
  if (
    a.contractName !== entry.contractName ||
    !/^0x(?:[a-fA-F0-9]{2})+$/.test(a.bytecode) ||
    !/^0x(?:[a-fA-F0-9]{2})+$/.test(a.deployedBytecode) ||
    !Array.isArray(a.abi)
  )
    throw new Error('V3_ARTIFACT_FORMAT');
  if (a.contractName === 'SwapRouter02') {
    const method = a.abi.find((method) => method.name === 'exactInputSingle');
    const fields = method?.inputs?.[0]?.components?.map((field) => `${field.name}:${field.type}`).join(',');
    if (
      fields !==
      'tokenIn:address,tokenOut:address,fee:uint24,recipient:address,amountIn:uint256,amountOutMinimum:uint256,sqrtPriceLimitX96:uint160'
    )
      throw new Error('V3_ROUTER_INTERFACE');
  }
  return a;
}
export async function checkV3Artifacts() {
  const folder = new URL('../../deploy/testnet/vendor/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.artifacts.length !== 3 ||
    manifest.expiresAt !== '2026-11-01T00:00:00Z' ||
    manifest.approvalRef !== 'docs/specs/AF-TESTNET-DEPENDENCY-REVIEW.md'
  )
    throw new Error('V3_MANIFEST');
  const names = {
    'factory.json': 'UniswapV3Factory',
    'router.json': 'SwapRouter02',
    'quoter.json': 'QuoterV2',
  };
  const seen = new Set();
  const fixture = await readFile(
    new URL('../../contracts/test/fixtures/PinnedV3Bytecode.sol', import.meta.url),
    'utf8',
  );
  for (const entry of manifest.artifacts) {
    if (
      names[entry.file] !== entry.contractName ||
      seen.has(entry.file) ||
      entry.expiresAt !== manifest.expiresAt
    )
      throw new Error('V3_MANIFEST');
    seen.add(entry.file);
    const artifact = validateV3Artifact(entry, await readFile(new URL(entry.file, folder), 'utf8'));
    if (!fixture.includes(`return hex"${artifact.bytecode.slice(2)}";`)) throw new Error('V3_FIXTURE_DRIFT');
  }
  return { artifacts: seen.size, status: 'VERIFIED_OFFLINE', broadcast: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await checkV3Artifacts()));
  } catch {
    console.error('V3_ARTIFACT_REJECTED');
    process.exitCode = 1;
  }
}
