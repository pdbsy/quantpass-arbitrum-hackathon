import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../tools/testnet/preflight.ts', import.meta.url));
const executable = process.execPath;
const input = (dataDirectory: string) => ({
  schemaVersion: 1,
  profile: 'M3_READONLY_TESTNET',
  chainId: 46630,
  origin: 'http://127.0.0.1:4180',
  dataDirectory,
  syncIntervalMs: 5000,
  vaults: [],
});

test('operator preflight admits an unconfigured deployment without creating data or accessing RPC', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'alphaforge-preflight-'));
  try {
    const config = join(folder, 'operator.json');
    await writeFile(config, JSON.stringify(input(join(folder, 'uncreated-data'))));
    const result = spawnSync(executable, [cli, config], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        AF_TESTNET_RPC_URL: 'https://private-provider.invalid/credential-do-not-request',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.configuration, 'VALID');
    assert.equal(report.chainId, 46630);
    assert.equal(report.deploymentEvidence, 'NOT_DEPLOYED');
    assert.equal(report.rpcVerification, 'NOT_RUN');
    assert.equal(report.orderExecution, 'DISABLED');
    assert.deepEqual(await readdir(folder), ['operator.json']);
    assert.equal(result.stdout.includes('credential-do-not-request'), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('CLI rejects contradictory configuration and never prints secret fields or filesystem paths', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'alphaforge-preflight-'));
  try {
    const config = join(folder, 'secret-path.json');
    await writeFile(config, JSON.stringify({ ...input(folder), privateKey: 'sensitive-fixture-value' }));
    const result = spawnSync(executable, [cli, config], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'TESTNET_PREFLIGHT_REJECTED');
    assert.equal(result.stderr.includes(folder), false);
    assert.equal(result.stderr.includes('sensitive-fixture-value'), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('preflight refuses a symlinked operator input and oversized JSON while preserving originals', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'alphaforge-preflight-'));
  try {
    const source = join(folder, 'source.json');
    const linked = join(folder, 'link.json');
    const large = join(folder, 'large.json');
    const original = JSON.stringify(input(folder));
    await writeFile(source, original);
    await symlink(source, linked);
    await writeFile(large, ' '.repeat(256 * 1024 + 1));
    for (const path of [linked, large]) {
      const result = spawnSync(executable, [cli, path], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim(), 'TESTNET_PREFLIGHT_REJECTED');
    }
    assert.equal(await readFile(source, 'utf8'), original);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('offline help and invalid arguments cannot start a server or silently accept broadcast flags', () => {
  const help = spawnSync(executable, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /offline/);
  for (const args of [[], ['--broadcast'], ['config.json', '--force'], ['--serve']]) {
    const result = spawnSync(executable, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stderr.trim(), 'TESTNET_PREFLIGHT_USAGE');
  }
});

test('public offline preflight emits unsigned identities and missing-input blockers without creating storage', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'alphaforge-public-preflight-'));
  try {
    const config = join(folder, 'operator.json');
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        profile: 'PUBLIC_TESTNET',
        chainId: 46630,
        origin: 'https://test.example',
        dataDirectory: join(folder, 'uncreated'),
        syncIntervalMs: 5000,
        challengeTtlMs: 60000,
        sessionTtlMs: 60000,
        maxAuthRows: 10,
        maxStorageBytes: 1048576,
        vaults: [],
      }),
    );
    const result = spawnSync(executable, [cli, config], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.readiness, 'NOT_CONFIGURED');
    assert.match(report.configurationDigest, /^0x[a-f0-9]{64}$/);
    assert.match(report.networkDigest, /^0x[a-f0-9]{64}$/);
    assert.equal(report.mainnet, 'DISABLED_UNCONFIGURED');
    assert.equal(report.deploymentReceipts, 'NOT_RUN');
    assert.equal(report.rpcCapabilities.qualification, 'NOT_RUN');
    assert.deepEqual(await readdir(folder), ['operator.json']);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
