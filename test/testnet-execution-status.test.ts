import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readExecutionStatus } from '../packages/testnet/src/execution-status.ts';
test('status projection exposes only the matching owner Vault and rejects stale or wrong-source status', () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-status-'))),
    file = join(folder, 'execution-status.json'),
    digest = '0x' + 'ab'.repeat(32),
    owner = '0x' + '1'.repeat(40),
    vault = '0x' + '2'.repeat(40);
  try {
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        chainId: 46630,
        configurationDigest: digest,
        observedAt: 1000,
        signingEnabled: true,
        vaults: [
          { owner, vault, state: 'PAUSED_POOL_PRICE_DEVIATION' },
          { owner: '0x' + '3'.repeat(40), vault: '0x' + '4'.repeat(40), state: 'BROADCAST_UNCERTAIN' },
        ],
        scope: 'TEST_SUBSTITUTES_ONLY',
        privateKey: 'not-real-secret',
      }),
    );
    const binding = { file, configurationDigest: digest };
    assert.deepEqual(readExecutionStatus(binding, owner, vault, 1001), {
      state: 'PAUSED_POOL_PRICE_DEVIATION',
      signingEnabled: true,
      observedAt: 1000,
    });
    assert.equal(readExecutionStatus(binding, owner, vault, 92000).state, 'STATUS_UNAVAILABLE_OR_STALE');
    assert.equal(
      readExecutionStatus({ ...binding, configurationDigest: '0x' + 'cd'.repeat(32) }, owner, vault, 1001)
        .state,
      'STATUS_UNAVAILABLE_OR_STALE',
    );
    assert.equal(
      readExecutionStatus(binding, owner, '0x' + '5'.repeat(40), 1001).state,
      'STATUS_UNAVAILABLE_OR_STALE',
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
