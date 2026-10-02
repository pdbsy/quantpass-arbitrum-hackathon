import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPublicTestnetServer } from '../apps/server/src/testnet-startup.ts';
import { serverCli } from '../tools/testnet/server.ts';
const origin = 'https://test.example';
function configuration(directory: string) {
  return {
    schemaVersion: 1,
    profile: 'PUBLIC_TESTNET',
    chainId: 46630,
    origin,
    dataDirectory: directory,
    syncIntervalMs: 5000,
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxAuthRows: 100,
    maxStorageBytes: 8000000000,
    vaults: [],
  };
}
test('malformed operator inputs cause no manifest read, directory, database, listener or timer', async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-startup-'))),
    directory = join(folder, 'data');
  let reads = 0;
  try {
    for (const mutation of [
      { chainId: 4663 },
      { origin: 'http://test.example' },
      { vaults: [{ id: 'escape', manifestFile: '../bad.json' }] },
      { privateKey: 'not-a-real-key' },
    ])
      await assert.rejects(
        startPublicTestnetServer({
          configuration: { ...configuration(directory), ...mutation },
          manifestReader: async () => {
            ++reads;
            throw new Error();
          },
        }),
      );
    assert.equal(reads, 0);
    assert.equal(existsSync(directory), false);
    assert.equal(await serverCli(['--broadcast'], {}), 2);
    assert.equal(await serverCli(['--serve', 'missing.json', '0'], {}), 2);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
test(
  'an empty qualified server cannot enable trading and releases its private lock on repeated close',
  { skip: process.platform === 'win32' },
  async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-startup-'))),
      directory = join(folder, 'data');
    let server;
    try {
      server = await startPublicTestnetServer({
        configuration: configuration(directory),
        manifestReader: async () => {
          throw new Error('no configured deployment');
        },
      });
      const health = await server.app.inject({
        url: '/api/health',
        headers: { host: 'test.example', 'x-forwarded-proto': 'https' },
      });
      assert.equal(health.statusCode, 200);
      assert.equal(health.json().deployment, 'NOT_CONFIGURED');
      assert.equal(health.json().orderExecution, 'DISABLED');
      assert.equal(existsSync(join(directory, '.server.lock')), true);
      await server.close();
      await server.close();
      assert.equal(existsSync(join(directory, '.server.lock')), false);
      const restarted = await startPublicTestnetServer({
        configuration: configuration(directory),
        manifestReader: async () => {
          throw new Error();
        },
      });
      await restarted.close();
    } finally {
      await server?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
