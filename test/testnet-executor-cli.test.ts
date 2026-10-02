import assert from 'node:assert/strict';
import test from 'node:test';
import { executorCli } from '../tools/testnet/executor.ts';
test('executor help, CI invocation and unapproved signing flags never load a key, open data or access RPC', async () => {
  assert.equal(await executorCli(['--help'], {}), 0);
  for (const args of [
    [],
    ['--broadcast'],
    ['--run-testnet', 'missing.json'],
    ['--run-testnet', '--enable-signing', 'missing.json'],
  ])
    assert.equal(await executorCli(args, {}), 2);
  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }])
    assert.equal(
      await executorCli(['--run-testnet', '--enable-signing', 'missing.json'], {
        ...env,
        AF_TESTNET_EXECUTION_ACK: 'I_AUTHORIZE_TESTNET_SIGNING_46630',
      }),
      2,
    );
  assert.equal(await executorCli(['--watch', 'missing.json'], {}), 1);
});
