import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LaunchMarketClient } from '../apps/web/src/launch-market/client.ts';
import { executorInterface, executorJournalKey } from '../apps/web/src/launch-market/executor.ts';
import { executorFixture, permission, VAULT } from './helpers/launch-market-executor-fixture.ts';
import { OWNER, OTHER, NOW, BLOCK, HASH } from './helpers/launch-market-ui-fixture.ts';

async function setup() {
  const f = executorFixture();
  const client = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    journal: f.journal,
    now: () => NOW,
  });
  await client.initialize();
  await client.connect();
  return { ...f, client };
}

test('executor permission is separately reviewed and sends the exact new owner Vault ABI with zero ETH', async () => {
  const f = await setup();
  await f.client.reviewExecutorPermission('AMZN', permission());
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0);
  assert.equal(f.client.state.executorReview!.gasEstimateRaw, '100000');
  await f.client.confirmExecutorPermission();
  const sent = f.provider.calls.find((call) => call.method === 'eth_sendTransaction')!.params![0] as {
    from: string;
    to: string;
    data: string;
    value: string;
  };
  assert.equal(sent.from, OWNER);
  assert.equal(sent.to, VAULT);
  assert.equal(sent.value, '0x0');
  const parsed = executorInterface.parseTransaction(sent)!;
  assert.equal(parsed.name, 'configureExecutor');
  assert.deepEqual(parsed.args[0].toArray().map(String), [
    OTHER,
    String(NOW + 3600),
    '10000000',
    '50000000',
    '100',
  ]);
  assert.equal(f.client.state.transaction.state, 'SUBMITTED');
  assert.equal(f.client.state.transaction.executor, true);
  assert.equal(f.state.requests.filter((call) => call.path.endsWith('/quote')).length, 0);
  assert.match(f.journal.getItem(executorJournalKey)!, /configure|CONFIGURE/);
});

test('revoke permission uses only revokeExecutor and never executes or sells a position', async () => {
  const f = await setup();
  f.current.grant = permission();
  await f.client.reviewExecutorPermission('AMZN', null);
  assert.equal(f.client.state.executorReview!.snapshot.grant.executor, OTHER);
  await f.client.confirmExecutorPermission();
  const tx = f.provider.calls.find((call) => call.method === 'eth_sendTransaction')!.params![0] as {
    data: string;
  };
  assert.equal(tx.data, executorInterface.encodeFunctionData('revokeExecutor'));
});

test('invalid executor authority parameters are rejected before any transaction is sent', async () => {
  const f = await setup();
  for (const invalid of [
    { ...permission(), executor: OWNER },
    { ...permission(), executor: VAULT },
    { ...permission(), maxSlippageBps: 501 },
    { ...permission(), expiresAt: String(NOW) },
    { ...permission(), maxOrderUsdc: '0' },
    { ...permission(), maxTotalBuyUsdc: '1' },
  ])
    await assert.rejects(f.client.reviewExecutorPermission('AMZN', invalid), /INVALID_EXECUTOR_PERMISSION/);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0);
});

test('changing owner, network or execution version after review prevents wallet send', async () => {
  for (const alteration of ['OWNER', 'CHAIN', 'VERSION'] as const) {
    const f = await setup();
    await f.client.reviewExecutorPermission('AMZN', permission());
    if (alteration === 'OWNER') f.provider.owner = OTHER;
    if (alteration === 'CHAIN') f.provider.chainId = '0x1';
    if (alteration === 'VERSION') f.current.version = 1;
    await assert.rejects(
      f.client.confirmExecutorPermission(),
      /WALLET_IDENTITY_CHANGED|WALLET_WRONG_CHAIN|EXECUTOR_REVIEW_EXPIRED/,
    );
    assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 0);
  }
});

test('executor receipts require three inclusive canonical blocks and exact owner calldata, then refresh permission', async () => {
  const f = await setup();
  await f.client.reviewExecutorPermission('AMZN', permission());
  await f.client.confirmExecutorPermission();
  f.provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    to: VAULT,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  f.provider.tip = '0x65';
  await f.client.refreshTransaction();
  assert.equal(f.client.state.transaction.state, 'INCLUDED');
  assert.equal(f.client.state.transaction.confirmations, 2);
  f.current.grant = permission();
  f.current.version = 1;
  f.provider.tip = '0x66';
  await f.client.refreshTransaction();
  assert.equal(f.client.state.transaction.state, 'COMPLETED');
  assert.equal(f.client.state.transaction.confirmations, 3);
  assert.equal(f.client.state.executorSnapshots!.AMZN!.grant.executor, OTHER);
  assert.equal(f.journal.getItem(executorJournalKey), null);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('reload recovers only submitted transaction metadata without rebroadcasting or projecting balances', async () => {
  const f = await setup();
  await f.client.reviewExecutorPermission('AMZN', permission());
  await f.client.confirmExecutorPermission();
  const recovered = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    journal: f.journal,
    now: () => NOW,
  });
  await recovered.initialize();
  await recovered.connect();
  assert.equal(recovered.state.transaction.hash, HASH);
  assert.equal(recovered.state.transaction.executor, true);
  assert.equal(recovered.state.transaction.state, 'SUBMITTED');
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
  const journal = JSON.parse(f.journal.getItem(executorJournalKey)!);
  assert.deepEqual(Object.keys(journal).sort(), ['data', 'hash', 'kind', 'owner', 'strategyId', 'vault']);
});

test('a reorganized executor receipt stays pending and never triggers another wallet transaction', async () => {
  const f = await setup();
  await f.client.reviewExecutorPermission('AMZN', permission());
  await f.client.confirmExecutorPermission();
  f.provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    to: VAULT,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  f.current.pinnedHash = `0x${'cc'.repeat(32)}`;
  await f.client.refreshTransaction();
  assert.equal(f.client.state.transaction.state, 'REORGED');
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('unknown broadcast survives reload and verifies an existing hash before releasing recovery', async () => {
  const f = await setup();
  f.provider.sendResult = 'unknown';
  await f.client.reviewExecutorPermission('AMZN', permission());
  await f.client.confirmExecutorPermission();
  assert.equal(f.client.state.transaction.state, 'RECOVERY_REQUIRED');
  assert.equal(JSON.parse(f.journal.getItem(executorJournalKey)!).hash, null);
  const recovered = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    journal: f.journal,
    now: () => NOW,
  });
  await recovered.initialize();
  await recovered.connect();
  assert.equal(recovered.state.transaction.state, 'RECOVERY_REQUIRED');
  await assert.rejects(recovered.reviewExecutorPermission('AMZN', permission()), /MARKET_ACTION_UNAVAILABLE/);
  await recovered.recoverExecutorTransaction(HASH);
  assert.equal(recovered.state.transaction.hash, HASH);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});

test('executor journal resumes after a recovered server operation completes', async () => {
  const f = await setup();
  await f.client.reviewExecutorPermission('AMZN', permission());
  await f.client.confirmExecutorPermission();
  f.state.operations = [f.state.operation];
  const recovered = new LaunchMarketClient({
    api: f.api,
    provider: f.provider,
    journal: f.journal,
    now: () => NOW,
  });
  await recovered.initialize();
  await recovered.connect();
  assert.equal(recovered.state.transaction.id, f.state.operation.id);
  f.state.operation = {
    ...f.state.operation,
    state: 'COMPLETED',
    confirmations: 3,
    location: { ...f.state.snapshot.location, transactionHash: HASH },
  };
  await recovered.refresh();
  assert.equal(recovered.state.transaction.executor, true);
  assert.equal(recovered.state.transaction.id, null);
  assert.equal(recovered.state.transaction.state, 'SUBMITTED');
});

test('a later reorg restores confirmed executor evidence and rereads the original transaction', async () => {
  const f = await setup();
  await f.client.reviewExecutorPermission('AMZN', permission());
  await f.client.confirmExecutorPermission();
  f.provider.receipt = {
    transactionHash: HASH,
    from: OWNER,
    to: VAULT,
    blockNumber: '0x64',
    blockHash: BLOCK,
    status: '0x1',
  };
  await f.client.refreshTransaction();
  assert.equal(f.client.state.transaction.state, 'COMPLETED');
  f.provider.receipt = null;
  await f.client.stream({ type: 'REORG', location: f.state.snapshot.location });
  assert.equal(f.client.state.transaction.state, 'REORGED');
  assert.match(f.journal.getItem(executorJournalKey)!, /CONFIGURE/);
  assert.equal(f.provider.calls.filter((call) => call.method === 'eth_sendTransaction').length, 1);
});
